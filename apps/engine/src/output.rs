//! Saída de rede em pipeline próprio, com reconexão.
//!
//! Uma saída de rede falha por motivo que não é culpa do playout: o servidor
//! reinicia, a rede oscila, o destino recusa. O problema é que, dentro do
//! mesmo pipeline do canal, essa falha não fica contida: o sink devolve erro
//! de fluxo, a fila para, o `tee` propaga o erro para cima e o canal inteiro
//! morre -- é o "Internal data stream error" em cascata que derrubava o PGM
//! junto com o RTMP, mesmo com o compositor produzindo imagem normalmente.
//!
//! Por isso cada saída de rede vive num pipeline separado, alimentado pelo
//! canal por um par `inter`. O pior que uma falha faz agora é derrubar a si
//! mesma; o programa continua sendo produzido e a saída volta sozinha, com
//! espera crescente entre as tentativas.
//!
//! O custo é codificar uma vez por destino de rede. Não é regressão: as saídas
//! já tinham cadeia de codificação própria antes desta separação.

use anyhow::{anyhow, Context, Result};
use gstreamer as gst;
use gstreamer::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::channel::make;

/// Espera máxima entre tentativas. Quinze segundos é curto o bastante para o
/// destino voltar sozinho e longo o bastante para não inundar o log.
const RETRY_CAP: Duration = Duration::from_secs(15);

/// Quanto o muxer pode esperar por uma das trilhas antes de fechar o pacote.
/// Fontes ao vivo não chegam alinhadas ao nanossegundo e um muxer sem folga
/// simplesmente descarta o que chegar atrasado.
const MUX_LATENCY: u64 = 500_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Health {
    /// Pipeline no ar, ainda sem confirmação de entrega.
    Connecting,
    /// O sink está recebendo buffer: existe transmissão de verdade.
    OnAir,
    /// Caiu e está esperando a próxima tentativa.
    Retrying,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub url: String,
    pub health: Health,
    /// Tentativas desde a última entrega. Zera quando volta a entregar, para
    /// que uma queda depois de horas no ar seja tratada como a primeira.
    pub attempts: u32,
    /// Buffers que chegaram ao sink. Zero com saúde `onAir` é impossível: é
    /// essa contagem que define a saúde.
    pub delivered: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Para onde a saída empurra, e em que container.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Rtmp,
    Srt,
    /// Gravação as-run. Vive aqui pelo mesmo motivo das outras: um erro de
    /// multiplexação dela derrubava o canal inteiro -- foi o que aconteceu na
    /// primeira vez que a gravação foi exercitada de verdade.
    File,
}

impl Kind {
    /// Reconectar faz sentido para rede; para arquivo, não.
    ///
    /// Reabrir um `filesink` recomeça a gravação por cima da anterior, e o
    /// motivo de uma gravação falhar -- disco cheio, caminho sumido -- não se
    /// resolve sozinho em segundos. Melhor parar e dizer.
    fn retries(self) -> bool {
        !matches!(self, Kind::File)
    }
}

impl Kind {
    /// O formato do H.264 é do container, não do encoder: FLV quer `avc`,
    /// MPEG-TS quer `byte-stream`. Deixar a negociação adivinhar produz um
    /// fluxo que o servidor recusa com "unexpected video packet".
    fn stream_format(self) -> &'static str {
        match self {
            Kind::Rtmp | Kind::File => "avc",
            Kind::Srt => "byte-stream",
        }
    }
}

pub struct PublisherSpec {
    pub kind: Kind,
    /// URL de rede ou caminho de arquivo, conforme o `kind`.
    pub url: String,
    pub video_channel: String,
    pub audio_channel: String,
    pub width: i32,
    pub height: i32,
    /// Cadência de **quadros** desta saída.
    pub fps_n: i32,
    pub fps_d: i32,
    pub bitrate_kbps: u32,
    /// Esta saída sai entrelaçada. Independente da varredura do canal: um
    /// canal em 1080i5994 entrega a gravação em campos e a rede progressiva.
    pub interlaced: bool,
    pub top_field_first: bool,
}

pub struct Publisher {
    spec: PublisherSpec,
    pipeline: Option<gst::Pipeline>,
    bus: Option<gst::Bus>,
    delivered: Arc<AtomicU64>,
    health: Health,
    attempts: u32,
    retry_at: Option<Instant>,
    error: Option<String>,
}

impl Publisher {
    pub fn new(spec: PublisherSpec) -> Self {
        Self {
            spec,
            pipeline: None,
            bus: None,
            delivered: Arc::new(AtomicU64::new(0)),
            health: Health::Retrying,
            attempts: 0,
            retry_at: Some(Instant::now()),
            error: None,
        }
    }

    pub fn report(&self) -> Report {
        Report {
            url: self.spec.url.clone(),
            health: self.health,
            attempts: self.attempts,
            delivered: self.delivered.load(Ordering::Relaxed),
            error: self.error.clone(),
        }
    }

    /// Roda o que houver para rodar e devolve relatório quando algo mudou de
    /// verdade. Chamada a cada volta do laço principal, nunca bloqueia.
    pub fn service(&mut self) -> Option<Report> {
        let before = self.health;

        if let Some(bus) = self.bus.clone() {
            while let Some(message) = bus.pop() {
                match message.view() {
                    gst::MessageView::Error(error) => {
                        let text = format!(
                            "{} ({})",
                            error.error(),
                            error.debug().unwrap_or_else(|| "sem detalhe".into())
                        );
                        self.fall(text);
                        break;
                    }
                    gst::MessageView::Eos(_) => {
                        self.fall("o destino encerrou o fluxo".to_string());
                        break;
                    }
                    _ => {}
                }
            }
        }

        if self.health == Health::Connecting && self.delivered.load(Ordering::Relaxed) > 0 {
            // Entrega é o único critério honesto de "no ar": o pipeline pode
            // estar em PLAYING com o sink sem ter escrito um byte sequer.
            self.health = Health::OnAir;
            self.error = None;
            self.attempts = 0;
        }

        if let Some(when) = self.retry_at {
            if Instant::now() >= when {
                self.retry_at = None;
                self.attempts += 1;
                match self.open() {
                    Ok(()) => {
                        self.health = Health::Connecting;
                        self.error = None;
                    }
                    Err(error) => self.fall(error.to_string()),
                }
            }
        }

        if self.health != before {
            Some(self.report())
        } else {
            None
        }
    }

    /// Derruba o pipeline e marca a próxima tentativa.
    fn fall(&mut self, reason: String) {
        self.close();
        self.health = Health::Retrying;
        self.error = Some(reason);
        if !self.spec.kind.retries() {
            self.retry_at = None;
            return;
        }
        let wait = Duration::from_secs(1 << self.attempts.min(4)).min(RETRY_CAP);
        self.retry_at = Some(Instant::now() + wait);
    }

    fn close(&mut self) {
        self.bus = None;
        if let Some(pipeline) = self.pipeline.take() {
            let _ = pipeline.set_state(gst::State::Null);
        }
        self.delivered.store(0, Ordering::Relaxed);
    }

    pub fn shutdown(&mut self) {
        self.retry_at = None;

        // Arquivo precisa de EOS antes do NULL: ir direto para NULL deixa o
        // container sem índice e a gravação as-run inútil justamente no dia em
        // que alguém precisar dela.
        if self.spec.kind == Kind::File {
            if let Some(pipeline) = self.pipeline.as_ref() {
                pipeline.send_event(gst::event::Eos::new());
                if let Some(bus) = pipeline.bus() {
                    let _ = bus.timed_pop_filtered(
                        gst::ClockTime::from_seconds(5),
                        &[gst::MessageType::Eos, gst::MessageType::Error],
                    );
                }
            }
        }

        self.close();
        self.health = Health::Retrying;
    }

    fn open(&mut self) -> Result<()> {
        self.close();
        let pipeline = self.build()?;
        pipeline
            .set_state(gst::State::Playing)
            .context("a saída não entrou em execução")?;
        self.bus = pipeline.bus();
        self.pipeline = Some(pipeline);
        Ok(())
    }

    fn build(&self) -> Result<gst::Pipeline> {
        let spec = &self.spec;
        let pipeline = gst::Pipeline::new();

        // Mesma fixação de colorimetria do canal, e pelo mesmo motivo: o
        // encoder não pode ver a colorimetria mudar no meio.
        let video_caps = gst::Caps::builder("video/x-raw")
            .field("format", "I420")
            .field("width", spec.width)
            .field("height", spec.height)
            .field("framerate", gst::Fraction::new(spec.fps_n, spec.fps_d))
            .field("pixel-aspect-ratio", gst::Fraction::new(1, 1))
            .field(
                "colorimetry",
                if spec.height >= 720 { "bt709" } else { "bt601" },
            )
            .build();
        let audio_caps = gst::Caps::builder("audio/x-raw")
            .field("rate", 48_000i32)
            .field("channels", 2i32)
            .build();

        // O `inter` entrega preto no formato dele enquanto ninguém publicou
        // ainda; converter e reamostrar aqui é o que impede o encoder de fixar
        // 320x240 no primeiro frame e recusar o programa depois.
        let vsrc = make("intervideosrc")?;
        vsrc.set_property("channel", &spec.video_channel);
        vsrc.set_property("timeout", 200_000_000u64);
        let vconv = make("videoconvert")?;
        let vscale = make("videoscale")?;
        let vrate = make("videorate")?;
        let vcapsf = make("capsfilter")?;
        vcapsf.set_property("caps", &video_caps);
        let vqueue = make("queue")?;
        vqueue.set_property("max-size-time", 2_000_000_000u64);

        let asrc = make("interaudiosrc")?;
        asrc.set_property("channel", &spec.audio_channel);
        let aconv = make("audioconvert")?;
        let ares = make("audioresample")?;
        let acapsf = make("capsfilter")?;
        acapsf.set_property("caps", &audio_caps);
        let aqueue = make("queue")?;
        aqueue.set_property("max-size-time", 2_000_000_000u64);

        let (venc, vparse, vcaps, aenc, aparse, acaps) = encode_chain(
            spec.bitrate_kbps,
            spec.fps_n,
            spec.fps_d,
            spec.kind.stream_format(),
        )?;

        let (mux, sink) = match spec.kind {
            Kind::Rtmp => {
                let mux = make("flvmux")?;
                mux.set_property("streamable", true);
                mux.set_property("latency", MUX_LATENCY);
                let sink = make("rtmp2sink")?;
                sink.set_property("location", &spec.url);
                (mux, sink)
            }
            Kind::Srt => {
                let mux = make("mpegtsmux")?;
                // Sete pacotes de 188 bytes por buffer, que é o payload padrão
                // do SRT (1316 bytes). Sem isto o muxer entrega buffers de
                // tamanho qualquer, o `srtsink` os corta em datagramas que não
                // caem na fronteira do pacote de transporte, e o receptor não
                // ressincroniza: o caminho fica "pronto" no servidor, os bytes
                // entram e saem, e ninguém consegue decodificar um quadro.
                mux.set_property("alignment", 7i32);
                let sink = make("srtsink")?;
                sink.set_property("uri", &spec.url);
                (mux, sink)
            }
            Kind::File => {
                let mux = make("matroskamux")?;
                let sink = make("filesink")?;
                sink.set_property("location", &spec.url);
                (mux, sink)
            }
        };
        sink.set_property("async", false);

        pipeline.add_many([
            &vsrc, &vconv, &vscale, &vrate, &vcapsf, &vqueue, &venc, &vparse, &vcaps, &asrc,
            &aconv, &ares, &acapsf, &aqueue, &aenc, &aparse, &acaps, &mux, &sink,
        ])?;

        // Tece os campos quando a saída pede. `field-pattern=1:1` faz cada
        // quadro que chega virar um campo, e é por isso que o canal
        // entrelaçado compõe no dobro da cadência da grade.
        if spec.interlaced {
            let interlace = make("interlace")?;
            interlace.set_property_from_str("field-pattern", "1:1");
            interlace.set_property("top-field-first", spec.top_field_first);
            let woven = make("capsfilter")?;
            woven.set_property(
                "caps",
                gst::Caps::builder("video/x-raw")
                    .field("interlace-mode", "interleaved")
                    .field("framerate", gst::Fraction::new(spec.fps_n, spec.fps_d))
                    .build(),
            );
            venc.set_property("interlaced", true);
            pipeline.add_many([&interlace, &woven])?;
            gst::Element::link_many([
                &vsrc, &vconv, &vscale, &vrate, &vcapsf, &vqueue, &interlace, &woven, &venc,
            ])?;
        } else {
            gst::Element::link_many([&vsrc, &vconv, &vscale, &vrate, &vcapsf, &vqueue, &venc])?;
        }
        gst::Element::link_many([&venc, &vparse, &vcaps, &mux, &sink])?;
        gst::Element::link_many([&asrc, &aconv, &ares, &acapsf, &aqueue, &aenc, &aparse, &acaps])?;
        // As duas trilhas entram no muxer antes de qualquer estado: muxer que
        // começa com uma trilha só escreve cabeçalho de uma trilha só, e o
        // destino recusa a outra quando ela aparece.
        acaps.link(&mux)?;

        // Conta buffer avulso e lista de buffers. O `flvmux` empurra um a um;
        // o `mpegtsmux` agrupa em lista, e uma sonda que só olha `BUFFER`
        // nunca dispara para SRT -- a saída funciona e o painel diz
        // "conectando" para sempre, que é pior do que não mostrar nada.
        let counter = Arc::clone(&self.delivered);
        sink.static_pad("sink")
            .ok_or_else(|| anyhow!("sink da saída sem pad"))?
            .add_probe(
                gst::PadProbeType::BUFFER | gst::PadProbeType::BUFFER_LIST,
                move |_, info| {
                    let count = match &info.data {
                        Some(gst::PadProbeData::BufferList(list)) => list.len() as u64,
                        _ => 1,
                    };
                    counter.fetch_add(count, Ordering::Relaxed);
                    gst::PadProbeReturn::Ok
                },
            );

        Ok(pipeline)
    }
}

/// Codificadores de H.264 que sabemos configurar, do mais rápido para o mais
/// lento.
///
/// A ordem não é gosto: é o que a máquina aguenta. Um canal 1080p50 em x264
/// come um punhado de núcleos, e três canais numa estação comum começam a
/// engasgar -- o programa pisca preto porque o encoder não entrega o quadro a
/// tempo. Havendo placa, ela faz isso sem tirar CPU de ninguém.
const ENCODERS: &[&str] = &["nvh264enc", "qsvh264enc", "mfh264enc", "x264enc"];

/// Monta o codificador de vídeo, preferindo o que a máquina tiver de hardware.
///
/// `RPLAYOUT_ENCODER` força um: é a saída para quando a placa existe e mente
/// sobre estar pronta, que acontece com driver desatualizado.
fn video_encoder(bitrate_kbps: u32, key_int_max: u32) -> Result<gst::Element> {
    let forced = std::env::var("RPLAYOUT_ENCODER").ok();
    let candidates: Vec<&str> = match forced.as_deref() {
        Some(name) => vec![name],
        None => ENCODERS.to_vec(),
    };

    for name in candidates {
        let Ok(encoder) = make(name) else { continue };

        // Cada um chama as coisas pelo seu nome. Ajustar só o que existe evita
        // um `set_property` que derruba o processo por propriedade ausente.
        match name {
            "x264enc" => {
                encoder.set_property("bitrate", bitrate_kbps);
                encoder.set_property_from_str("tune", "zerolatency");
                encoder.set_property_from_str("speed-preset", "veryfast");
                encoder.set_property("key-int-max", key_int_max);
            }
            "nvh264enc" => {
                // NVENC fala em bits por segundo, não em kbps.
                set_if_exists(&encoder, "bitrate", bitrate_kbps);
                set_if_exists(&encoder, "gop-size", key_int_max as i32);
                encoder.set_property_from_str("preset", "low-latency-hq");
                set_if_exists(&encoder, "zerolatency", true);
            }
            _ => {
                set_if_exists(&encoder, "bitrate", bitrate_kbps);
                set_if_exists(&encoder, "gop-size", key_int_max as i32);
                set_if_exists(&encoder, "low-latency", true);
            }
        }

        eprintln!("[engine] codificando com {name}");
        return Ok(encoder);
    }

    Err(anyhow!(
        "nenhum codificador de H.264 disponível: instale o GStreamer completo (x264enc) \
         ou verifique a placa"
    ))
}

/// Ajusta uma propriedade só se o elemento tiver.
///
/// Os codificadores de hardware mudam de nome de propriedade entre versões, e
/// um `set_property` em propriedade que não existe derruba o processo -- num
/// playout, derrubar por causa de um ajuste opcional é o pior negócio possível.
fn set_if_exists<V>(element: &gst::Element, name: &str, value: V)
where
    V: Into<gst::glib::Value>,
{
    if element.find_property(name).is_some() {
        element.set_property_from_value(name, &value.into());
    }
}

/// Cadeia de codificação de um destino.
pub fn encode_chain(
    bitrate_kbps: u32,
    fps_n: i32,
    fps_d: i32,
    stream_format: &str,
) -> Result<(
    gst::Element,
    gst::Element,
    gst::Element,
    gst::Element,
    gst::Element,
    gst::Element,
)> {
    let venc = video_encoder(bitrate_kbps, (fps_n / fps_d.max(1)) as u32 * 2)?;

    let vparse = make("h264parse")?;
    // Parâmetros do codec voltam de tempos em tempos: quem sintoniza no meio
    // da transmissão não viu o começo.
    vparse.set_property("config-interval", -1i32);
    let vcaps = make("capsfilter")?;
    vcaps.set_property(
        "caps",
        gst::Caps::builder("video/x-h264")
            .field("stream-format", stream_format)
            .field("alignment", "au")
            .build(),
    );

    let aenc = make("avenc_aac")?;
    aenc.set_property("bitrate", 128_000i32);
    let aparse = make("aacparse")?;
    let acaps = make("capsfilter")?;
    acaps.set_property(
        "caps",
        gst::Caps::builder("audio/mpeg")
            .field("mpegversion", 4i32)
            .field(
                "stream-format",
                if stream_format == "avc" { "raw" } else { "adts" },
            )
            .build(),
    );

    Ok((venc, vparse, vcaps, aenc, aparse, acaps))
}
