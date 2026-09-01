//! Pipeline de um canal.
//!
//! O canal é montado uma vez e nunca mais é operado por dentro: nada de pedir,
//! ligar e soltar pads num grafo que já está no ar. Cada item roda no seu
//! próprio pipeline e entrega o sinal por um canal `inter`; o take é uma troca
//! de nome de canal, não uma cirurgia.
//!
//! Isso resolve de uma vez três problemas que a manipulação dinâmica trouxe: o
//! item armado não vaza para o programa, o fim de um item não vira fim do
//! canal, e uma falha ao abrir arquivo não derruba o que está no ar.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

pub use crate::loudness::Reading;
use crate::limiter_element;
use crate::loudness::Meter;
use crate::output::{Kind, Publisher, PublisherSpec, Report};
use crate::protocol::{Fit, ItemSpec};

/// Para onde o programa sai. Todas as saídas penduram no mesmo par de tees,
/// então o canal codifica uma vez, não uma vez por destino.
#[derive(Debug, Clone)]
pub enum Output {
    /// Descarta, contando os frames. É o modo de teste e de canal ocioso.
    Null,
    /// Um quadro por segundo em JPEG. Serve de monitor barato e de prova de
    /// que o programa está de fato com imagem, sem depender de muxer.
    Snapshot(String),
    /// Saída codificada, com perfil próprio.
    Encoded(OutputSpec),
}

/// Perfil de uma saída codificada.
///
/// Os campos em branco herdam do canal. É o que permite `--output rtmp://...`
/// continuar valendo para teste e uso manual enquanto o servidor manda o perfil
/// inteiro em JSON.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSpec {
    pub kind: Kind,
    pub target: String,
    #[serde(default)]
    pub width: Option<i32>,
    #[serde(default)]
    pub height: Option<i32>,
    #[serde(default)]
    pub rate_num: Option<i32>,
    #[serde(default)]
    pub rate_den: Option<i32>,
    /// `progressive` ou `interlaced`. Em branco herda a varredura do canal --
    /// menos na rede, que nunca sai entrelaçada.
    #[serde(default)]
    pub scan: Option<String>,
    #[serde(default)]
    pub bitrate_kbps: Option<u32>,
}

impl Output {
    /// Aceita duas formas: o atalho de linha de comando (`rtmp://...`,
    /// `file:...`, `null`, `snapshot:...`), que herda tudo do canal, e o
    /// perfil completo em JSON, que é o que o servidor manda.
    pub fn parse(text: &str) -> Result<Self> {
        let text = text.trim();
        if text.starts_with('{') {
            let spec: OutputSpec =
                serde_json::from_str(text).context("perfil de saída inválido")?;
            return Ok(Output::Encoded(spec));
        }
        if text == "null" {
            return Ok(Output::Null);
        }

        let shorthand = |kind: Kind, target: String| {
            Output::Encoded(OutputSpec {
                kind,
                target,
                width: None,
                height: None,
                rate_num: None,
                rate_den: None,
                scan: None,
                bitrate_kbps: None,
            })
        };

        match text.split_once(':') {
            Some(("file", path)) => Ok(shorthand(Kind::File, path.to_string())),
            Some(("rtmp", _)) => Ok(shorthand(Kind::Rtmp, text.to_string())),
            Some(("srt", _)) => Ok(shorthand(Kind::Srt, text.to_string())),
            Some(("snapshot", pattern)) => Ok(Output::Snapshot(pattern.to_string())),
            _ => Err(anyhow!("saída desconhecida: {text}")),
        }
    }
}

/// Como o canal varre a imagem.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scan {
    Progressive,
    /// Entrelaçado. A cadência do canal continua sendo a de **quadros**
    /// -- 1080i5994 é 29,97 quadros, 59,94 campos --, e é essa que a grade
    /// conta. A composição é que roda no dobro.
    Interlaced,
}

impl Scan {
    pub fn parse(text: &str) -> Result<Self> {
        match text {
            "progressive" | "p" => Ok(Scan::Progressive),
            "interlaced" | "i" => Ok(Scan::Interlaced),
            other => Err(anyhow!("varredura desconhecida: {other}")),
        }
    }
}

pub struct Config {
    pub channel_id: String,
    pub width: i32,
    pub height: i32,
    pub fps_n: i32,
    pub fps_d: i32,
    pub bitrate_kbps: u32,
    /// Teto de pico verdadeiro da saída, em dBTP. É o teto do limiter.
    pub ceiling_dbtp: f64,
    pub scan: Scan,
    /// Campo de cima primeiro. 1080i é TFF; só formatos SD antigos são BFF.
    pub top_field_first: bool,
    pub outputs: Vec<Output>,
    /// Para onde o preview sai. Vazio deixa o canal sem barramento de preview.
    pub preview: Option<Output>,
}

/// Um item aberto, no seu próprio pipeline.
struct Item {
    spec: ItemSpec,
    pipeline: gst::Pipeline,
    volume: gst::Element,
    on_air: bool,
    /// Só o item do preview tem: o programa é medido depois do mix, que é onde
    /// a medição vale. No preview não há mix, então mede-se o próprio item.
    meter_sink: Option<gst_app::AppSink>,
}

/// Quantos quadros uma imagem parada precisa gerar para durar o que a grade
/// pediu.
///
/// O corte do item está na cadência da grade; o pipeline anda na cadência de
/// composição, que é o dobro quando o canal é entrelaçado. Contar na cadência
/// errada é erro de fator dois na duração -- por isso a conta sai das caps de
/// destino, que são as que o item realmente produz.
fn still_frames(grid_frames: i64, grid_rate: (i32, i32), caps: &gst::Caps) -> i32 {
    let grid = grid_frames.max(0);
    let Some(structure) = caps.structure(0) else {
        return grid as i32;
    };
    let Ok(rate) = structure.get::<gst::Fraction>("framerate") else {
        return grid as i32;
    };
    // A duração em segundos vem da grade e é o que manda; a cadência de saída
    // só diz em quantos quadros ela cabe.
    let seconds = grid as f64 * grid_rate.1 as f64 / grid_rate.0.max(1) as f64;
    (seconds * rate.numer() as f64 / rate.denom().max(1) as f64).round() as i32
}

/// A cadeia de vídeo do item, montada mas ainda fora do pipeline.
///
/// Vale o mesmo raciocínio da cadeia de áudio: arquivo só de áudio existe (uma
/// trilha de locução, uma vinheta sonora) e, com o ramo de vídeo montado à
/// toa, o sink fica esperando quadro que nunca vem e o item não carrega. Sem
/// vídeo, o que aparece é o preto do canal.
struct VideoChain {
    /// Do `videoconvert` até o `intervideosink`, na ordem.
    elements: Vec<gst::Element>,
    /// Quantos quadros a imagem parada deve gerar antes de acabar. A grade é
    /// que diz quanto tempo ela fica, porque o arquivo não tem duração.
    still_frames: i32,
}

impl VideoChain {
    fn attach(self, pipeline: &gst::Pipeline, pad: &gst::Pad) -> Result<()> {
        // Imagem parada chega com cadência 0/1: um quadro só, e o pipeline
        // acabaria antes de aparecer. O `imagefreeze` repete o quadro pelo
        // tempo que a grade marcou e então encerra sozinho, como um arquivo.
        let freeze = still_rate(pad).then(|| make("imagefreeze")).transpose()?;
        if let Some(freeze) = &freeze {
            freeze.set_property("num-buffers", self.still_frames);
        }

        let mut chain: Vec<&gst::Element> = Vec::with_capacity(self.elements.len() + 1);
        if let Some(freeze) = &freeze {
            pipeline.add(freeze)?;
            chain.push(freeze);
        }
        for element in &self.elements {
            pipeline.add(element)?;
            chain.push(element);
        }
        gst::Element::link_many(chain.clone())?;
        for element in chain.iter() {
            element.sync_state_with_parent()?;
        }

        let head = chain.first().ok_or_else(|| anyhow!("cadeia de vídeo vazia"))?;
        pad.link(
            &head
                .static_pad("sink")
                .ok_or_else(|| anyhow!("cabeça da cadeia de vídeo sem sink"))?,
        )?;
        Ok(())
    }
}

/// A cadência do pad é a de imagem parada: um quadro, sem tempo próprio.
fn still_rate(pad: &gst::Pad) -> bool {
    let caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
    let Some(structure) = caps.structure(0) else {
        return false;
    };
    match structure.get::<gst::Fraction>("framerate") {
        Ok(rate) => rate.numer() == 0,
        // Sem cadência declarada também é imagem parada: vídeo traz a sua.
        Err(_) => true,
    }
}

/// A cadeia de áudio do item, montada mas ainda fora do pipeline.
///
/// Ela só entra quando aparece uma trilha de áudio de verdade. Um sink de
/// áudio esperando um fluxo que nunca vem não deixa o pipeline chegar a
/// PAUSED, e o item não carrega -- é por isso que arquivo mudo não entrava no
/// ar.
struct AudioChain {
    /// Do `audioconvert` até o `interaudiosink`, na ordem.
    main: Vec<gst::Element>,
    /// Ramo do medidor, vazio quando o item não é medido.
    meter: Vec<gst::Element>,
    tee: Option<gst::Element>,
}

impl AudioChain {
    /// Põe a cadeia no pipeline que já está rodando e liga o pad recebido.
    fn attach(self, pipeline: &gst::Pipeline, pad: &gst::Pad) -> Result<()> {
        let all: Vec<&gst::Element> = self.main.iter().chain(self.meter.iter()).collect();
        for element in &all {
            pipeline.add(*element)?;
        }

        let main: Vec<&gst::Element> = self.main.iter().collect();
        gst::Element::link_many(main)?;
        if let Some(tee) = &self.tee {
            let meter: Vec<&gst::Element> = self.meter.iter().collect();
            gst::Element::link_many(meter)?;
            let head = self
                .meter
                .first()
                .ok_or_else(|| anyhow!("ramo do medidor vazio"))?;
            tee.request_pad_simple("src_%u")
                .ok_or_else(|| anyhow!("tee do item recusou o medidor"))?
                .link(
                    &head
                        .static_pad("sink")
                        .ok_or_else(|| anyhow!("queue do medidor sem sink"))?,
                )?;
        }

        // Elementos acrescentados a um pipeline que já anda nascem parados.
        for element in &all {
            element.sync_state_with_parent()?;
        }

        let head = self
            .main
            .first()
            .ok_or_else(|| anyhow!("cadeia de áudio vazia"))?;
        pad.link(
            &head
                .static_pad("sink")
                .ok_or_else(|| anyhow!("audioconvert sem sink"))?,
        )?;
        Ok(())
    }
}

/// O grafismo no ar e a entrada/saída dele.
///
/// A opacidade anda por passos em vez de saltar: grafismo que aparece de
/// estalo é o que denuncia gerador de caracteres improvisado. A animação é
/// barata -- um punhado de re-renderizações do SVG durante a transição, e
/// nada entre uma e outra.
#[derive(Default)]
struct Graphic {
    /// O SVG que o servidor mandou, já com os campos preenchidos.
    svg: Option<String>,
    /// Opacidade agora e para onde ela vai, de 0 a 1.
    opacity: f64,
    target: f64,
    /// Quanto a opacidade anda por milissegundo.
    per_ms: f64,
    /// Última opacidade desenhada, para não re-renderizar à toa.
    drawn: f64,
}

impl Graphic {
    /// Anda a transição e diz o que desenhar, ou `None` se nada mudou.
    fn advance(&mut self, elapsed_ms: f64) -> Option<Option<String>> {
        if (self.opacity - self.target).abs() > f64::EPSILON {
            let step = self.per_ms * elapsed_ms;
            self.opacity = if self.opacity < self.target {
                (self.opacity + step).min(self.target)
            } else {
                (self.opacity - step).max(self.target)
            };
        }

        // Um passo de 1% é invisível e custa uma re-renderização: não vale.
        if (self.opacity - self.drawn).abs() < 0.01 && self.opacity != self.target {
            return None;
        }
        if (self.opacity - self.drawn).abs() < f64::EPSILON {
            return None;
        }
        self.drawn = self.opacity;

        let Some(svg) = self.svg.as_deref() else {
            return Some(None);
        };
        if self.opacity <= 0.0 {
            // Saiu de vez: o SVG some junto, para o elemento voltar a ser
            // passagem em vez de desenhar nada caro.
            self.svg = None;
            return Some(None);
        }
        Some(Some(wrap_opacity(svg, self.opacity)))
    }
}

/// Embrulha o SVG num grupo com opacidade. SVG dentro de `<g>` é SVG válido,
/// então o modelo do operador não precisa saber que existe transição.
fn wrap_opacity(svg: &str, opacity: f64) -> String {
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1920 1080\" \
         preserveAspectRatio=\"none\"><g opacity=\"{opacity:.3}\">{svg}</g></svg>"
    )
}

pub struct Channel {
    pipeline: gst::Pipeline,
    config: Config,
    video_channel: String,
    audio_channel: String,
    on_air: Option<Item>,
    armed: Option<Item>,
    frames_out: Arc<AtomicU64>,
    /// Saídas de rede. Cada uma tem pipeline próprio e cai sozinha.
    publishers: Vec<Publisher>,
    /// Barramento de preview: nomes do par `inter` e o que estiver aberto nele.
    preview_channels: Option<(String, String)>,
    previewing: Option<Item>,
    /// Medidor de loudness do programa e a torneira de onde ele bebe.
    meter: Meter,
    meter_sink: gst_app::AppSink,
    /// Medidor do preview. Vive à parte porque mede outro barramento.
    preview_meter: Meter,
    limiter: gst::Element,
    /// Camada de grafismo e o estado da entrada/saída dela.
    graphics: gst::Element,
    gfx: Graphic,
    /// Buffer reaproveitado da conversão de bytes para amostras. Alocar a cada
    /// volta do laço num processo que fica meses no ar não é opção.
    meter_scratch: Vec<f32>,
}

pub(crate) fn make(factory: &str) -> Result<gst::Element> {
    gst::ElementFactory::make(factory)
        .build()
        .with_context(|| format!("elemento {factory} não existe nesta instalação do GStreamer"))
}

fn make_named(factory: &str, name: &str) -> Result<gst::Element> {
    gst::ElementFactory::make(factory)
        .name(name)
        .build()
        .with_context(|| format!("elemento {factory} não existe nesta instalação do GStreamer"))
}

/// Por que um item pode não ter aberto, em português de operador.
///
/// "Element failed to change its state" é a verdade e não serve para nada: quem
/// está no ar precisa saber se o problema é a placa, a rede ou o arquivo.
fn open_failure(spec: &ItemSpec, where_: &str) -> String {
    match spec.source.as_deref() {
        Some(source) if source.starts_with("sdi:") => format!(
            "a entrada {source} não respondeu{where_} -- confira se a placa está instalada, \
             se o sub-dispositivo existe e se há sinal nele"
        ),
        Some(source) => format!("não consegui abrir a fonte {source}{where_}"),
        None => format!("não consegui abrir {}{where_}", spec.path),
    }
}

/// De onde o item tira o sinal: arquivo do acervo ou fonte ao vivo.
///
/// Fonte com esquema de URI (`srt://`, `rtsp://`, `rtmp://`) entra pelo mesmo
/// `uridecodebin` do arquivo -- é o mesmo pipeline, e é por isso que um estúdio
/// ao vivo e um VT são a mesma coisa para o resto do canal. Placa e NDI têm
/// elemento próprio.
fn source_for(spec: &ItemSpec) -> Result<gst::Element> {
    let Some(source) = spec.source.as_deref() else {
        let src = make("uridecodebin")?;
        let uri = if spec.path.contains("://") {
            spec.path.clone()
        } else {
            gst::glib::filename_to_uri(&spec.path, None)?.to_string()
        };
        src.set_property("uri", &uri);
        return Ok(src);
    };

    if source.contains("://") {
        let src = make("uridecodebin")?;
        src.set_property("uri", source);
        // Fonte ao vivo não pode ficar remoendo: o buffer que interessa é o
        // mínimo que segura o jitter da rede, e o resto é atraso no ar.
        src.set_property("buffer-duration", 500_000_000i64);
        return Ok(src);
    }

    match source.split_once(':') {
        Some(("sdi", index)) => {
            let src = make("decklinkvideosrc")?;
            src.set_property(
                "device-number",
                index.parse::<i32>().context("índice de SDI inválido")?,
            );
            // `auto` deixa a placa detectar o formato do sinal que chegou, que
            // é o que o operador espera de uma entrada.
            src.set_property_from_str("mode", "auto");
            Ok(src)
        }
        Some(("ndi", name)) => {
            let src = make("ndisrc").context(
                "a entrada NDI precisa do plugin `ndisrc`, que não está nesta instalação",
            )?;
            src.set_property("ndi-name", name);
            Ok(src)
        }
        _ => Err(anyhow!("fonte ao vivo desconhecida: {source}")),
    }
}

/// Consome o que houver no `appsink` e entrega ao medidor.
///
/// O buffer de conversão é emprestado: alocar a cada volta do laço num
/// processo que fica meses no ar não é opção.
fn drain(sink: &gst_app::AppSink, scratch: &mut Vec<f32>, meter: &mut Meter) {
    while let Some(sample) = sink.try_pull_sample(gst::ClockTime::ZERO) {
        let Some(buffer) = sample.buffer() else { continue };
        let Ok(map) = buffer.map_readable() else { continue };
        // F32LE intercalado, garantido pelo capsfilter do ramo. Ler byte a
        // byte evita depender do alinhamento do buffer do GStreamer.
        scratch.clear();
        scratch.extend(
            map.as_slice()
                .chunks_exact(4)
                .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])),
        );
        meter.push(scratch);
    }
}

/// Ramo de medição: fila que descarta, conversão para F32 e um `appsink`.
///
/// A fila descarta de propósito. Medidor que segura o `tee` para o programa,
/// e perder uma medição é irrelevante perto disso.
fn meter_branch() -> Result<(gst::Element, gst::Element, gst::Element, gst::Element)> {
    let queue = make("queue")?;
    queue.set_property("max-size-time", 500_000_000u64);
    queue.set_property_from_str("leaky", "downstream");

    let convert = make("audioconvert")?;
    let caps = make("capsfilter")?;
    caps.set_property(
        "caps",
        gst::Caps::builder("audio/x-raw")
            .field("format", "F32LE")
            .field("layout", "interleaved")
            .field("rate", 48_000i32)
            .field("channels", 2i32)
            .build(),
    );

    let sink = make("appsink")?;
    sink.set_property("sync", false);
    sink.set_property("max-buffers", 32u32);
    sink.set_property("drop", true);

    Ok((queue, convert, caps, sink))
}

/// Caps de vídeo do canal.
///
/// Colorimetria e proporção de pixel ficam **fixas**. Sem isso elas seguem a
/// fonte: o preto de fundo entra em bt709 e um VT em bt601 troca a colorimetria
/// do programa no meio da transmissão. O `flvmux` engole a troca; o Matroska
/// não, e a gravação as-run morre com "caps changes are not supported" -- que
/// foi exatamente o que aconteceu aqui, e só apareceu quando a gravação passou
/// a ser exercitada.
///
/// HD é bt709 e SD é bt601, que é a convenção de broadcast.
/// Proporção de exibição do canal, tirada das caps de destino.
///
/// É o alvo do corte: aparar o material até esta proporção e só então escalar
/// enche a tela sem deformar. Sem caps fixas, 16:9 -- o único palpite que não
/// piora um canal HD.
fn channel_aspect(caps: &gst::Caps) -> gst::Fraction {
    let fallback = gst::Fraction::new(16, 9);
    let Some(structure) = caps.structure(0) else {
        return fallback;
    };
    match (structure.get::<i32>("width"), structure.get::<i32>("height")) {
        (Ok(width), Ok(height)) if width > 0 && height > 0 => gst::Fraction::new(width, height),
        _ => fallback,
    }
}

fn channel_video_caps(width: i32, height: i32, framerate: gst::Fraction) -> gst::Caps {
    gst::Caps::builder("video/x-raw")
        .field("format", "I420")
        .field("width", width)
        .field("height", height)
        .field("framerate", framerate)
        .field("pixel-aspect-ratio", gst::Fraction::new(1, 1))
        .field("colorimetry", if height >= 720 { "bt709" } else { "bt601" })
        // Posição do croma junto com o resto. Arquivo vindo de JPEG chega com
        // `chroma-site=jpeg` e, sem fixar, esse campo atravessa o canal e
        // aparece nas caps do H.264 -- o Matroska recusa mudança de caps e a
        // gravação morre no meio, uma imagem parada depois de um VT. `mpeg2`
        // é o que material de broadcast usa.
        .field("chroma-site", "mpeg2")
        .build()
}

/// dB para o fator linear que o elemento `volume` espera.
fn linear_gain(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}

impl Channel {
    /// Cadência em que o programa é composto.
    ///
    /// Num canal entrelaçado a composição roda no **dobro** da cadência da
    /// grade: cada quadro composto vira um campo. É isso que dá o movimento
    /// certo de 1080i -- compor a 29,97 e repetir o quadro nos dois campos
    /// custa metade, mas o grafismo em movimento denuncia.
    ///
    /// Este número não pode sair do engine. A grade conta 29,97; confundir uma
    /// coisa com a outra é erro de fator dois na duração de item.
    fn composition_rate(&self) -> gst::Fraction {
        let factor = match self.config.scan {
            Scan::Progressive => 1,
            Scan::Interlaced => 2,
        };
        gst::Fraction::new(self.config.fps_n * factor, self.config.fps_d)
    }

    /// Caps do programa dentro do canal: sempre progressivo, na cadência de
    /// composição. O entrelaçamento acontece só na saída que o pede.
    pub fn video_caps(&self) -> gst::Caps {
        channel_video_caps(self.config.width, self.config.height, self.composition_rate())
    }

    pub fn new(config: Config) -> Result<Self> {
        let pipeline = gst::Pipeline::with_name(&format!("canal-{}", config.channel_id));
        let video_channel = format!("{}-video", config.channel_id);
        let audio_channel = format!("{}-audio", config.channel_id);

        let composition = match config.scan {
            Scan::Progressive => gst::Fraction::new(config.fps_n, config.fps_d),
            Scan::Interlaced => gst::Fraction::new(config.fps_n * 2, config.fps_d),
        };
        let video_caps = channel_video_caps(config.width, config.height, composition);
        let audio_caps = gst::Caps::builder("audio/x-raw")
            .field("rate", 48_000i32)
            .field("channels", 2i32)
            .build();
        // Depois do limiter tudo anda em F32LE intercalado, que é o formato em
        // que o DSP trabalha e o que o `avenc_aac` já pede.
        let program_audio_out = gst::Caps::builder("audio/x-raw")
            .field("format", "F32LE")
            .field("layout", "interleaved")
            .field("rate", 48_000i32)
            .field("channels", 2i32)
            .build();

        // Fundo: preto e silêncio ao vivo. O compositor nunca fica sem pauta,
        // então o programa continua existindo mesmo sem nada no ar.
        let black = make("videotestsrc")?;
        black.set_property_from_str("pattern", "black");
        black.set_property("is-live", true);
        let black_caps = make("capsfilter")?;
        black_caps.set_property("caps", &video_caps);

        let silence = make("audiotestsrc")?;
        silence.set_property_from_str("wave", "silence");
        silence.set_property("is-live", true);
        let silence_caps = make("capsfilter")?;
        silence_caps.set_property("caps", &audio_caps);

        // Entrada do programa: o que estiver publicando neste canal `inter`.
        let program_video = make("intervideosrc")?;
        program_video.set_property("channel", &video_channel);
        program_video.set_property("timeout", 200_000_000u64);
        let program_video_convert = make("videoconvert")?;
        let program_video_scale = make("videoscale")?;
        let program_video_rate = make("videorate")?;
        let program_video_caps = make("capsfilter")?;
        program_video_caps.set_property("caps", &video_caps);

        let program_audio = make("interaudiosrc")?;
        program_audio.set_property("channel", &audio_channel);
        let program_audio_convert = make("audioconvert")?;
        let program_audio_resample = make("audioresample")?;
        let program_audio_caps = make("capsfilter")?;
        program_audio_caps.set_property("caps", &audio_caps);

        let compositor = make_named("compositor", "pgm")?;
        compositor.set_property_from_str("background", "black");
        let mixer = make_named("audiomixer", "mix")?;

        let vconv = make("videoconvert")?;
        // Camada de grafismo, entre a composição e as saídas.
        //
        // Fica em linha, não como pad do compositor, e isso é decisão de
        // segurança: um pad a mais no compositor faz o programa esperar por
        // ele, e grafismo que trava não pode parar o ar. Em linha, sem SVG,
        // o elemento é passagem.
        //
        // O preço é o par de conversões para BGRA, que é o único formato que
        // o `rsvgoverlay` aceita.
        let gfx_in = make("videoconvert")?;
        let gfx_caps = make("capsfilter")?;
        gfx_caps.set_property(
            "caps",
            gst::Caps::builder("video/x-raw").field("format", "BGRA").build(),
        );
        let graphics = make_named("rsvgoverlay", "gfx")?;
        graphics.set_property("fit-to-frame", true);
        let gfx_out = make("videoconvert")?;
        let vout_caps = make("capsfilter")?;
        vout_caps.set_property("caps", &video_caps);
        let tee_video = make_named("tee", "tee-video")?;

        let aconv = make("audioconvert")?;
        let ares = make("audioresample")?;
        let aout_caps = make("capsfilter")?;
        aout_caps.set_property("caps", &program_audio_out);

        // Rede de proteção da saída, não ferramenta de mixagem: quem põe o
        // programa no alvo é o nivelamento por item. Se este elemento estiver
        // trabalhando o tempo todo, o problema está no nivelamento -- e é por
        // isso que a redução de ganho aparece no medidor.
        let limiter = make_named(limiter_element::FACTORY, "limiter")?;
        limiter.set_property("ceiling-dbtp", config.ceiling_dbtp);

        let tee_audio = make_named("tee", "tee-audio")?;

        // Ramo de medição: o mix cru sai por aqui e a conta de loudness é
        // feita em Rust. O `level` do GStreamer entrega RMS, e RMS não é
        // loudness -- sem ponderação K e sem gate, dois programas com o mesmo
        // RMS soam com volumes diferentes.
        let (meter_queue, meter_convert, meter_caps, meter_sink) = meter_branch()?;

        pipeline.add_many([
            &black,
            &black_caps,
            &silence,
            &silence_caps,
            &program_video,
            &program_video_convert,
            &program_video_scale,
            &program_video_rate,
            &program_video_caps,
            &program_audio,
            &program_audio_convert,
            &program_audio_resample,
            &program_audio_caps,
            &compositor,
            &mixer,
            &vconv,
            &gfx_in,
            &gfx_caps,
            &graphics,
            &gfx_out,
            &vout_caps,
            &tee_video,
            &aconv,
            &ares,
            &aout_caps,
            &limiter,
            &tee_audio,
            &meter_queue,
            &meter_convert,
            &meter_caps,
            &meter_sink,
        ])?;

        gst::Element::link_many([&black, &black_caps])?;
        gst::Element::link_many([&silence, &silence_caps])?;
        gst::Element::link_many([
            &program_video,
            &program_video_convert,
            &program_video_scale,
            &program_video_rate,
            &program_video_caps,
        ])?;
        gst::Element::link_many([
            &program_audio,
            &program_audio_convert,
            &program_audio_resample,
            &program_audio_caps,
        ])?;
        gst::Element::link_many([
            &compositor,
            &vconv,
            &gfx_in,
            &gfx_caps,
            &graphics,
            &gfx_out,
            &vout_caps,
            &tee_video,
        ])?;
        gst::Element::link_many([&mixer, &aconv, &ares, &aout_caps, &limiter, &tee_audio])?;
        gst::Element::link_many([&meter_queue, &meter_convert, &meter_caps, &meter_sink])?;
        tee_audio
            .request_pad_simple("src_%u")
            .ok_or_else(|| anyhow!("tee de áudio recusou o medidor"))?
            .link(
                &meter_queue
                    .static_pad("sink")
                    .ok_or_else(|| anyhow!("queue do medidor sem sink"))?,
            )?;

        let background_pad = compositor
            .request_pad_simple("sink_%u")
            .ok_or_else(|| anyhow!("compositor recusou o pad do fundo"))?;
        background_pad.set_property("zorder", 0u32);
        black_caps
            .static_pad("src")
            .ok_or_else(|| anyhow!("capsfilter do fundo sem src"))?
            .link(&background_pad)?;

        let program_pad = compositor
            .request_pad_simple("sink_%u")
            .ok_or_else(|| anyhow!("compositor recusou o pad do programa"))?;
        program_pad.set_property("zorder", 1u32);
        program_video_caps
            .static_pad("src")
            .ok_or_else(|| anyhow!("capsfilter do programa sem src"))?
            .link(&program_pad)?;

        let silence_pad = mixer
            .request_pad_simple("sink_%u")
            .ok_or_else(|| anyhow!("audiomixer recusou o pad do silêncio"))?;
        silence_caps
            .static_pad("src")
            .ok_or_else(|| anyhow!("capsfilter do silêncio sem src"))?
            .link(&silence_pad)?;

        let program_audio_pad = mixer
            .request_pad_simple("sink_%u")
            .ok_or_else(|| anyhow!("audiomixer recusou o áudio do programa"))?;
        program_audio_caps
            .static_pad("src")
            .ok_or_else(|| anyhow!("capsfilter do áudio do programa sem src"))?
            .link(&program_audio_pad)?;

        // Contador de frames na saída do compositor: prova objetiva de que o
        // programa continua sendo produzido, com ou sem item no ar.
        let frames_out = Arc::new(AtomicU64::new(0));
        let counter = Arc::clone(&frames_out);
        compositor
            .static_pad("src")
            .ok_or_else(|| anyhow!("compositor sem src"))?
            .add_probe(gst::PadProbeType::BUFFER, move |_, _| {
                counter.fetch_add(1, Ordering::Relaxed);
                gst::PadProbeReturn::Ok
            });

        let mut channel = Self {
            pipeline,
            config,
            video_channel,
            audio_channel,
            on_air: None,
            armed: None,
            frames_out,
            publishers: Vec::new(),
            preview_channels: None,
            previewing: None,
            meter: Meter::new(48_000, 2),
            meter_sink: meter_sink
                .dynamic_cast::<gst_app::AppSink>()
                .map_err(|_| anyhow!("appsink do medidor não é appsink"))?,
            preview_meter: Meter::new(48_000, 2),
            limiter,
            graphics,
            gfx: Graphic::default(),
            meter_scratch: Vec::with_capacity(16_384),
        };

        for (index, output) in channel.config.outputs.clone().iter().enumerate() {
            channel.attach_output(index, output, &tee_video, &tee_audio)?;
        }

        if let Some(output) = channel.config.preview.clone() {
            channel.attach_preview(&output)?;
        }

        Ok(channel)
    }

    fn attach_output(
        &mut self,
        index: usize,
        output: &Output,
        tee_video: &gst::Element,
        tee_audio: &gst::Element,
    ) -> Result<()> {
        let vqueue = make("queue")?;
        let aqueue = make("queue")?;
        for queue in [&vqueue, &aqueue] {
            queue.set_property("max-size-time", 2_000_000_000u64);
            // Fila com descarte só serve para saída que pode perder frame. Num
            // muxer, o buraco vira erro de multiplexação e a gravação morre --
            // por isso saída codificada leva o descarte só até o `inter`, e
            // dali para a frente corre num pipeline que ninguém segura.
            queue.set_property_from_str("leaky", "downstream");
        }
        self.pipeline.add_many([&vqueue, &aqueue])?;

        match output {
            Output::Null => {
                let vsink = make("fakesink")?;
                let asink = make("fakesink")?;
                for sink in [&vsink, &asink] {
                    sink.set_property("sync", true);
                    sink.set_property("async", false);
                }
                self.pipeline.add_many([&vsink, &asink])?;
                gst::Element::link_many([&vqueue, &vsink])?;
                gst::Element::link_many([&aqueue, &asink])?;
            }
            Output::Snapshot(pattern) => {
                let rate = make("videorate")?;
                let caps = make("capsfilter")?;
                caps.set_property(
                    "caps",
                    gst::Caps::builder("video/x-raw")
                        .field("framerate", gst::Fraction::new(1, 1))
                        .build(),
                );
                let convert = make("videoconvert")?;
                let enc = make("jpegenc")?;
                let sink = make("multifilesink")?;
                sink.set_property("location", pattern);
                let asink = make("fakesink")?;
                asink.set_property("sync", true);
                asink.set_property("async", false);

                self.pipeline
                    .add_many([&rate, &caps, &convert, &enc, &sink, &asink])?;
                gst::Element::link_many([&vqueue, &rate, &caps, &convert, &enc, &sink])?;
                gst::Element::link_many([&aqueue, &asink])?;
            }
            Output::Encoded(spec) => {
                self.attach_encoded(index, spec, &vqueue, &aqueue)?;
            }
        }

        tee_video
            .request_pad_simple("src_%u")
            .ok_or_else(|| anyhow!("tee de vídeo recusou a saída"))?
            .link(
                &vqueue
                    .static_pad("sink")
                    .ok_or_else(|| anyhow!("queue de vídeo sem sink"))?,
            )?;
        tee_audio
            .request_pad_simple("src_%u")
            .ok_or_else(|| anyhow!("tee de áudio recusou a saída"))?
            .link(
                &aqueue
                    .static_pad("sink")
                    .ok_or_else(|| anyhow!("queue de áudio sem sink"))?,
            )?;

        Ok(())
    }

    /// Saída codificada: o canal só entrega o sinal cru num par `inter` e quem
    /// codifica, muxa e empurra é um pipeline à parte.
    ///
    /// O que o perfil não disser, herda do canal. A varredura tem uma exceção:
    /// a rede nunca sai entrelaçada, porque o RTMP não declara entrelaçamento
    /// e a maior parte dos destinos assume progressivo.
    fn attach_encoded(
        &mut self,
        index: usize,
        spec: &OutputSpec,
        vqueue: &gst::Element,
        aqueue: &gst::Element,
    ) -> Result<()> {
        let video_channel = format!("{}-saida{index}-video", self.config.channel_id);
        let audio_channel = format!("{}-saida{index}-audio", self.config.channel_id);

        let vsink = make("intervideosink")?;
        vsink.set_property("channel", &video_channel);
        let asink = make("interaudiosink")?;
        asink.set_property("channel", &audio_channel);
        self.pipeline.add_many([&vsink, &asink])?;
        gst::Element::link_many([vqueue, &vsink])?;
        gst::Element::link_many([aqueue, &asink])?;

        let interlaced = match spec.scan.as_deref() {
            Some("interlaced") => spec.kind == Kind::File,
            Some(_) => false,
            None => spec.kind == Kind::File && self.config.scan == Scan::Interlaced,
        };

        self.publishers.push(Publisher::new(PublisherSpec {
            kind: spec.kind,
            url: spec.target.clone(),
            video_channel,
            audio_channel,
            width: spec.width.unwrap_or(self.config.width),
            height: spec.height.unwrap_or(self.config.height),
            fps_n: spec.rate_num.unwrap_or(self.config.fps_n),
            fps_d: spec.rate_den.unwrap_or(self.config.fps_d),
            bitrate_kbps: spec.bitrate_kbps.unwrap_or(self.config.bitrate_kbps),
            interlaced,
            top_field_first: self.config.top_field_first,
        }));
        Ok(())
    }

    /// Liga o barramento de preview.
    ///
    /// Não há palco nenhum entre o item e a saída: o `intervideosrc` da saída
    /// já entrega preto enquanto ninguém publica, e já normaliza formato e
    /// cadência. Um pipeline intermediário só para segurar um fundo preto
    /// seria uma peça a mais para quebrar.
    fn attach_preview(&mut self, output: &Output) -> Result<()> {
        let Output::Encoded(spec) = output else {
            return Err(anyhow!("preview só sai por rede, não por {output:?}"));
        };
        if spec.kind == Kind::File {
            return Err(anyhow!("preview não sai para arquivo"));
        }

        let video_channel = format!("{}-pvw-video", self.config.channel_id);
        let audio_channel = format!("{}-pvw-audio", self.config.channel_id);

        // Metade da altura e um terço do bitrate: é um monitor, não uma saída.
        // Codificar o preview em 1080p50 dobraria o custo do canal para nada.
        let (width, height) = (self.config.width / 2, self.config.height / 2);
        self.publishers.push(Publisher::new(PublisherSpec {
            kind: spec.kind,
            url: spec.target.clone(),
            video_channel: video_channel.clone(),
            audio_channel: audio_channel.clone(),
            width: width - width % 2,
            height: height - height % 2,
            fps_n: self.config.fps_n,
            fps_d: self.config.fps_d,
            bitrate_kbps: (self.config.bitrate_kbps / 3).max(500),
            // Monitor é sempre progressivo: quem olha o preview está num
            // navegador, não num monitor de referência.
            interlaced: false,
            top_field_first: self.config.top_field_first,
        }));

        self.preview_channels = Some((video_channel, audio_channel));
        Ok(())
    }

    /// Caps do preview: mesma cadência do canal, metade do tamanho.
    fn preview_caps(&self) -> gst::Caps {
        let (width, height) = (self.config.width / 2, self.config.height / 2);
        gst::Caps::builder("video/x-raw")
            .field("format", "I420")
            .field("width", width - width % 2)
            .field("height", height - height % 2)
            .field(
                "framerate",
                gst::Fraction::new(self.config.fps_n, self.config.fps_d),
            )
            .build()
    }

    /// Abre um arquivo no preview e o deixa rodando.
    ///
    /// O preview é um tocador independente: não é o item armado com outro
    /// destino. É isso que permite ver um arquivo que nem está na grade sem
    /// encostar no que vai entrar no ar.
    pub fn preview(&mut self, spec: Option<ItemSpec>) -> Result<()> {
        if let Some(previous) = self.previewing.take() {
            discard(previous);
        }
        let Some(spec) = spec else { return Ok(()) };
        let Some((video_channel, audio_channel)) = self.preview_channels.clone() else {
            return Err(anyhow!("este canal não tem barramento de preview"));
        };
        // Arquivo novo no preview, medida nova.
        self.preview_meter.reset();

        let mut item =
            self.build_item(&spec, &video_channel, &audio_channel, &self.preview_caps(), true)?;
        item.pipeline
            .set_state(gst::State::Paused)
            .with_context(|| open_failure(&spec, " no preview"))?;
        let (result, _, _) = item.pipeline.state(gst::ClockTime::from_seconds(10));
        result.with_context(|| open_failure(&spec, " no preview"))?;

        item.pipeline
            .seek(
                1.0,
                gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                gst::SeekType::Set,
                self.frame_to_time(spec.trim_in),
                gst::SeekType::Set,
                self.frame_to_time(spec.trim_out),
            )
            .context("o preview não aceitou o ponto de entrada")?;

        item.pipeline.set_state(gst::State::Playing)?;
        item.on_air = true;
        self.previewing = Some(item);
        Ok(())
    }

    /// Bus do que está no preview, para captar fim e erro sem confundir com o ar.
    pub fn preview_bus(&self) -> Option<gst::Bus> {
        self.previewing.as_ref().and_then(|item| item.pipeline.bus())
    }

    pub fn preview_id(&self) -> Option<String> {
        self.previewing.as_ref().map(|item| item.spec.item_id.clone())
    }

    /// Consome o áudio que chegou desde a última volta e devolve a medição.
    ///
    /// Roda no laço principal, sem thread nem trava: o `appsink` descarta
    /// quando enche, então uma volta lenta custa uma medição, nunca o programa.
    pub fn measure(&mut self) -> (Reading, Reading) {
        let program = self.meter_sink.clone();
        drain(&program, &mut self.meter_scratch, &mut self.meter);

        // Sem nada aberto no preview não há o que medir, e mostrar a última
        // leitura seria o medidor falando de um arquivo que já fechou.
        let preview = match self.previewing.as_ref().and_then(|item| item.meter_sink.clone()) {
            Some(sink) => {
                drain(&sink, &mut self.meter_scratch, &mut self.preview_meter);
                self.preview_meter.read()
            }
            None => Reading::SILENT,
        };

        // A redução vem do próprio elemento, que a acumula na thread de
        // streaming; ler zera, então o que chega é o pico do intervalo.
        let mut program = self.meter.read();
        program.gain_reduction_db = self.limiter.property::<f64>("gain-reduction-db");

        (program, preview)
    }

    /// Sobe o canal e só volta quando ele está de fato no ar.
    pub fn start(&self) -> Result<()> {
        self.pipeline.set_state(gst::State::Playing)?;
        let (result, _, _) = self.pipeline.state(gst::ClockTime::from_seconds(10));
        result.context("o canal não chegou a entrar em execução")?;
        Ok(())
    }

    /// Dá uma volta nas saídas de rede: colhe falha, reconecta o que caiu e
    /// devolve só o que mudou de estado.
    pub fn service_outputs(&mut self) -> Vec<Report> {
        self.publishers
            .iter_mut()
            .filter_map(|publisher| publisher.service())
            .collect()
    }

    /// Situação de todas as saídas de rede, mudando ou não.
    pub fn outputs_report(&self) -> Vec<Report> {
        self.publishers.iter().map(Publisher::report).collect()
    }

    pub fn bus(&self) -> gst::Bus {
        self.pipeline.bus().expect("pipeline sempre tem bus")
    }

    /// Bus do item no ar, para captar o fim do trecho e os erros dele.
    pub fn item_bus(&self) -> Option<gst::Bus> {
        self.on_air.as_ref().and_then(|item| item.pipeline.bus())
    }

    pub fn frames_out(&self) -> u64 {
        self.frames_out.load(Ordering::Relaxed)
    }

    /// O que está no ar é fonte ao vivo.
    pub fn on_air_is_live(&self) -> bool {
        self.on_air.as_ref().is_some_and(|item| item.spec.is_live())
    }

    /// Reabre a fonte ao vivo que está no ar.
    ///
    /// Fonte ao vivo que cai não é fim de item: o estúdio pode voltar, e a hora
    /// de sair continua sendo a que a grade marcou. Enquanto não volta, o
    /// programa fica no preto do canal -- que é o comportamento certo, e é
    /// melhor do que pular para o item seguinte antes da hora.
    pub fn restart_on_air(&mut self) -> Result<()> {
        let spec = self
            .on_air
            .as_ref()
            .map(|item| item.spec.clone())
            .ok_or_else(|| anyhow!("nada no ar para reabrir"))?;

        if let Some(previous) = self.on_air.take() {
            discard(previous);
        }

        let mut item = self.build_item(
            &spec,
            &self.video_channel.clone(),
            &self.audio_channel.clone(),
            &self.video_caps(),
            false,
        )?;
        item.pipeline.set_state(gst::State::Playing)?;
        item.on_air = true;
        self.on_air = Some(item);
        Ok(())
    }

    pub fn on_air_id(&self) -> Option<String> {
        self.on_air.as_ref().map(|item| item.spec.item_id.clone())
    }

    pub fn armed_id(&self) -> Option<String> {
        self.armed.as_ref().map(|item| item.spec.item_id.clone())
    }

    fn frame_to_time(&self, frames: i64) -> gst::ClockTime {
        let nanos = frames as u128 * 1_000_000_000u128 * self.config.fps_d as u128
            / self.config.fps_n as u128;
        gst::ClockTime::from_nseconds(nanos as u64)
    }

    fn time_to_frames(&self, time: gst::ClockTime) -> i64 {
        (time.nseconds() as u128 * self.config.fps_n as u128
            / (1_000_000_000u128 * self.config.fps_d as u128)) as i64
    }

    /// Abre o item no pipeline dele e o deixa parado no ponto de entrada.
    ///
    /// Enquanto está armado, publica num canal `inter` que ninguém escuta --
    /// é isso que o mantém pronto sem aparecer no programa.
    pub fn load(&mut self, spec: ItemSpec) -> Result<()> {
        if let Some(previous) = self.armed.take() {
            discard(previous);
        }

        // O item já nasce publicando no canal definitivo. Trocar o nome depois
        // não adianta: o `inter` fixa a superfície ao entrar em PAUSED, e o
        // sinal ficaria publicando num canal que ninguém escuta.
        //
        // Publicar cedo não vaza nada: em PAUSED o item não empurra buffer
        // nenhum. Quem solta o sinal é o PLAYING, no take.
        let item = self.build_item(
            &spec,
            &self.video_channel.clone(),
            &self.audio_channel.clone(),
            &self.video_caps(),
            false,
        )?;

        item.pipeline
            .set_state(gst::State::Paused)
            .with_context(|| open_failure(&spec, ""))?;
        let (result, _, _) = item.pipeline.state(gst::ClockTime::from_seconds(10));
        result.with_context(|| open_failure(&spec, ""))?;

        // Item ao vivo não tem ponto de entrada nem de saída: ele já está
        // acontecendo. Quem decide quando ele sai é a grade.
        if spec.is_live() {
            self.armed = Some(item);
            return Ok(());
        }

        // O corte vira um seek com início e fim: o item termina sozinho no
        // ponto de saída, sem ninguém precisar cronometrar.
        item.pipeline
            .seek(
                1.0,
                gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                gst::SeekType::Set,
                self.frame_to_time(spec.trim_in),
                gst::SeekType::Set,
                self.frame_to_time(spec.trim_out),
            )
            .context("o item não aceitou o ponto de entrada")?;

        // Agora dá para esperar de verdade: o pipeline do item tem sinks, e
        // parar num pipeline próprio não bloqueia nada do canal.
        let (result, _, _) = item.pipeline.state(gst::ClockTime::from_seconds(10));
        result.context("o item não parou no ponto de entrada")?;

        self.armed = Some(item);
        Ok(())
    }

    /// Monta o pipeline de um item, publicando no par `inter` que for pedido.
    ///
    /// Programa e preview usam a mesma montagem e diferem só no destino e no
    /// tamanho: o preview não precisa sair em 1080p para caber num monitor.
    fn build_item(
        &self,
        spec: &ItemSpec,
        video_channel: &str,
        audio_channel: &str,
        caps: &gst::Caps,
        metered: bool,
    ) -> Result<Item> {
        let pipeline = gst::Pipeline::with_name(&format!("item-{}", spec.item_id));

        let src = source_for(spec)?;

        let vconv = make("videoconvert")?;
        // Fonte entrelaçada vira progressiva aqui. O compositor não trabalha em
        // campos -- e sem compositor não há grafismo nem escala --, então o
        // caminho é desentrelaçar na entrada e entrelaçar de novo na saída que
        // pedir. Em `auto` o elemento deixa material progressivo passar.
        let vdeint = make("deinterlace")?;
        vdeint.set_property_from_str("mode", "auto");
        let vscale = make("videoscale")?;
        // Proporção diferente da do canal não pode virar deformação. Em
        // `Pillarbox` o `videoscale` põe a barra preta sozinho -- é o padrão
        // dele, mas fica escrito porque é decisão, não sorte. Em `Crop` a
        // borda é aparada antes da escala, e aí a imagem enche a tela.
        vscale.set_property("add-borders", spec.fit == Fit::Pillarbox);
        let vcrop = match spec.fit {
            Fit::Pillarbox => None,
            Fit::Crop => {
                let crop = make("aspectratiocrop")?;
                crop.set_property("aspect-ratio", channel_aspect(caps));
                Some(crop)
            }
        };
        let vrate = make("videorate")?;
        let vcaps = make("capsfilter")?;
        vcaps.set_property("caps", caps);
        let vqueue = make("queue")?;
        let video_sink = make("intervideosink")?;
        video_sink.set_property("channel", video_channel);

        let aconv = make("audioconvert")?;
        let ares = make("audioresample")?;
        let volume = make("volume")?;
        volume.set_property("volume", linear_gain(spec.gain_db));
        let acaps = make("capsfilter")?;
        acaps.set_property(
            "caps",
            gst::Caps::builder("audio/x-raw")
                .field("rate", 48_000i32)
                .field("channels", 2i32)
                .build(),
        );
        let aqueue = make("queue")?;
        let audio_sink = make("interaudiosink")?;
        audio_sink.set_property("channel", audio_channel);

        pipeline.add(&src)?;

        let mut video_elements = vec![vconv, vdeint];
        if let Some(crop) = vcrop {
            video_elements.push(crop);
        }
        video_elements.extend([vscale, vrate, vcaps, vqueue, video_sink]);
        let video = VideoChain {
            elements: video_elements,
            still_frames: still_frames(
                spec.trim_out - spec.trim_in,
                (self.config.fps_n, self.config.fps_d),
                caps,
            ),
        };

        // O áudio do item sai do `acaps` já nivelado. Sem medição, vai direto
        // para o `inter`; com medição, um `tee` abre a segunda saída.
        let (chain, meter_sink) = if metered {
            let tee = make("tee")?;
            let (queue, convert, caps_filter, sink) = meter_branch()?;
            let appsink = sink
                .clone()
                .dynamic_cast::<gst_app::AppSink>()
                .map_err(|_| anyhow!("appsink do medidor não é appsink"))?;
            (
                AudioChain {
                    main: vec![aconv, ares, volume.clone(), acaps, tee.clone(), aqueue, audio_sink],
                    meter: vec![queue, convert, caps_filter, sink],
                    tee: Some(tee),
                },
                Some(appsink),
            )
        } else {
            (
                AudioChain {
                    main: vec![aconv, ares, volume.clone(), acaps, aqueue, audio_sink],
                    meter: Vec::new(),
                    tee: None,
                },
                None,
            )
        };

        // O vídeo só entra no pipeline se o arquivo tiver vídeo.
        let pending_video = std::sync::Mutex::new(Some(video));
        let video_pipeline = pipeline.clone();
        // O áudio só entra no pipeline se o arquivo tiver áudio.
        //
        // Montar a cadeia de áudio à toa parece inofensivo e não é: o sink
        // fica esperando um fluxo que nunca chega, o pipeline não chega a
        // PAUSED e o item nunca carrega. Vinheta muda, slate e exportação de
        // grafismo são material corriqueiro -- e antes disto nenhum deles
        // entrava no ar. Sem áudio, quem segura o canal é o silêncio do
        // `interaudiosrc`, que já existe.
        let pending = std::sync::Mutex::new(Some(chain));
        let audio_pipeline = pipeline.clone();
        let seen_audio = Arc::new(AtomicUsize::new(0));
        let wanted_track = spec.audio_track;
        src.connect_pad_added(move |_, pad| {
            // Pad recém-nascido nem sempre traz caps prontas; perguntar ao pad
            // evita descartar o fluxo em silêncio e deixar o item sem áudio.
            let caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
            let Some(structure) = caps.structure(0) else {
                return;
            };
            let name = structure.name();

            if name.starts_with("video/") {
                // Só a primeira trilha de vídeo: arquivo com duas é raro e
                // compor as duas não é o que ninguém espera.
                let Ok(mut slot) = pending_video.lock() else {
                    return;
                };
                let Some(chain) = slot.take() else {
                    return;
                };
                if let Err(error) = chain.attach(&video_pipeline, pad) {
                    eprintln!("[engine] não montei o vídeo do item: {error}");
                }
                return;
            }

            if !name.starts_with("audio/") {
                return;
            }

            // Entra uma trilha só: a que o operador escolheu, contada na
            // ordem em que o arquivo as declara. Ligar todas somaria os
            // idiomas, e é assim que dublagem vira ruído.
            let index = seen_audio.fetch_add(1, Ordering::Relaxed);
            if index != wanted_track {
                return;
            }
            let Ok(mut slot) = pending.lock() else {
                return;
            };
            let Some(chain) = slot.take() else {
                return;
            };
            if let Err(error) = chain.attach(&audio_pipeline, pad) {
                eprintln!("[engine] não montei o áudio do item: {error}");
            }
        });

        Ok(Item {
            spec: spec.clone(),
            pipeline,
            volume,
            on_air: false,
            meter_sink,
        })
    }

    /// Coloca no ar o item armado: troca o nome do canal e solta o pipeline.
    /// O canal não é tocado, então o encoder não pisca.
    pub fn take(&mut self) -> Result<String> {
        let mut item = self
            .armed
            .take()
            .ok_or_else(|| anyhow!("nada armado para entrar no ar"))?;

        if let Some(previous) = self.on_air.take() {
            discard(previous);
        }

        item.pipeline.set_state(gst::State::Playing)?;
        item.on_air = true;

        // Item novo no ar, medida nova: a integrada do item anterior não diz
        // nada sobre este.
        self.meter.reset();

        let item_id = item.spec.item_id.clone();
        self.on_air = Some(item);
        Ok(item_id)
    }

    pub fn stop(&mut self) -> Result<()> {
        if let Some(item) = self.on_air.take() {
            discard(item);
        }
        // Nada no ar, nada a integrar: continuar mostrando a medida do item
        // que saiu seria o medidor mentindo sobre o que está saindo agora.
        self.meter.reset();
        Ok(())
    }

    /// Põe (ou tira) o grafismo no ar.
    ///
    /// O engine não sabe o que é um template: quem preenche os campos é o
    /// servidor, e aqui chega SVG pronto. Assim o modelo de grafismo evolui
    /// sem recompilar o processo que está no ar.
    pub fn set_graphic(&mut self, svg: Option<String>, fade_ms: u64) {
        let fade = fade_ms.max(1) as f64;
        self.gfx.per_ms = 1.0 / fade;
        match svg {
            Some(svg) => {
                self.gfx.svg = Some(svg);
                self.gfx.target = 1.0;
                // Entrar de uma opacidade já acesa seria um salto: quem
                // troca de arte volta do zero.
                self.gfx.opacity = 0.0;
                self.gfx.drawn = -1.0;
            }
            None => self.gfx.target = 0.0,
        }
    }

    /// Anda a transição do grafismo. Chamado a cada volta do laço principal.
    pub fn tick_graphics(&mut self, elapsed_ms: f64) {
        let Some(draw) = self.gfx.advance(elapsed_ms) else {
            return;
        };
        match draw {
            Some(svg) => self.graphics.set_property("data", svg),
            None => self.graphics.set_property("data", None::<String>),
        }
    }

    /// O que está no ar em grafismo, para a interface conferir.
    pub fn graphic_on_air(&self) -> bool {
        self.gfx.svg.is_some() && self.gfx.target > 0.0
    }

    pub fn set_gain(&mut self, gain_db: f64) -> Result<()> {
        let item = self
            .on_air
            .as_mut()
            .ok_or_else(|| anyhow!("nada no ar para nivelar"))?;
        item.volume.set_property("volume", linear_gain(gain_db));
        item.spec.gain_db = gain_db;
        Ok(())
    }

    /// Posição do item no ar, em frames desde o ponto de entrada.
    pub fn position(&self) -> Option<(String, i64, i64)> {
        let item = self.on_air.as_ref()?;
        if !item.on_air {
            return None;
        }
        let position = item.pipeline.query_position::<gst::ClockTime>()?;
        let frames = self.time_to_frames(position) - item.spec.trim_in;
        let duration = item.spec.trim_out - item.spec.trim_in;
        Some((item.spec.item_id.clone(), frames.max(0), duration))
    }

    /// Encerra o canal fechando os arquivos que estiver gravando.
    ///
    /// Ir direto para NULL deixa o container sem índice e a gravação as-run
    /// inútil justamente no dia em que alguém precisar dela.
    pub fn shutdown(&mut self) {
        if let Some(item) = self.previewing.take() {
            discard(item);
        }
        for publisher in &mut self.publishers {
            publisher.shutdown();
        }
        if let Some(item) = self.on_air.take() {
            discard(item);
        }
        if let Some(item) = self.armed.take() {
            discard(item);
        }

        self.pipeline.send_event(gst::event::Eos::new());
        if let Some(bus) = self.pipeline.bus() {
            let _ = bus.timed_pop_filtered(
                gst::ClockTime::from_seconds(5),
                &[gst::MessageType::Eos, gst::MessageType::Error],
            );
        }
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

/// Desliga o pipeline do item. Falhar aqui não pode derrubar o canal, então o
/// erro vira log: um item mal encerrado é irrelevante perto do PGM parar.
fn discard(item: Item) {
    if let Err(error) = item.pipeline.set_state(gst::State::Null) {
        eprintln!("[engine] item {} não encerrou limpo: {error}", item.spec.item_id);
    }
}
