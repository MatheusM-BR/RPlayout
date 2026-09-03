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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    /// Parada de propósito, esperando alguém pedir.
    ///
    /// Diferente de `Retrying`: não é falha, não conta tentativa e não vira
    /// alerta na tela. É o monitor que ninguém abriu.
    Idle,
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
    /// Codificar em software mesmo havendo placa.
    ///
    /// Sessão de placa é recurso escasso e contado: o preview, que sai em
    /// metade do tamanho, não gasta uma -- ela fica para o programa.
    pub prefer_software: bool,
    /// Nome pelo qual esta saída é comandada de fora: "pgm", "pvw", "mon".
    ///
    /// Sem um nome, ligar e desligar um monitor exigiria endereçá-lo pela URL,
    /// que muda quando o canal é renomeado.
    pub role: String,
    /// Nasce parada, esperando alguém pedir.
    ///
    /// É o caso dos monitores: encodar para uma janela que ninguém abriu é
    /// gastar CPU do ar com nada. Numa máquina com quatro canais isso são
    /// quatro codificações que só passam a existir quando alguém está de fato
    /// assistindo.
    pub on_demand: bool,
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
            pipeline: None,
            bus: None,
            delivered: Arc::new(AtomicU64::new(0)),
            health: if spec.on_demand { Health::Idle } else { Health::Retrying },
            attempts: 0,
            retry_at: if spec.on_demand { None } else { Some(Instant::now()) },
            error: None,
            spec,
        }
    }

    /// Nome pelo qual esta saída é comandada de fora.
    pub fn role(&self) -> &str {
        &self.spec.role
    }

    /// Liga ou desliga uma saída sob demanda, sem tocar no resto do canal.
    ///
    /// Os pipelines de saída são independentes do pipeline do canal -- eles
    /// puxam do `intervideosrc` --, então parar um não interrompe o programa.
    /// É isso que permite o monitor existir só enquanto alguém olha.
    pub fn set_wanted(&mut self, on: bool) {
        if !self.spec.on_demand {
            return;
        }
        if on {
            if self.health != Health::Idle {
                return;
            }
            self.health = Health::Retrying;
            self.attempts = 0;
            self.retry_at = Some(Instant::now());
            self.error = None;
        } else {
            self.close();
            self.health = Health::Idle;
            self.retry_at = None;
            self.error = None;
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
        // Placa que recusou sessão não melhora tentando de novo: o processo
        // inteiro passa a software, e a próxima tentativa já sobe assim.
        if e_do_hardware(&reason) {
            desistir_do_hardware(&reason);
        }
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

        // Latência dita, não negociada.
        //
        // Sem isto o GStreamer adota o máximo que os elementos anunciarem, e
        // esse número muda com o que estiver instalado na máquina, com o
        // codificador que entrou e com o humor da negociação. Num playout a
        // latência é uma promessa que se faz ao destino: ela precisa ser a
        // mesma hoje e amanhã, e a mesma nas quatro saídas do mesmo canal --
        // duas saídas com latências diferentes são duas versões do mesmo
        // programa saindo em tempos diferentes.
        pipeline.set_latency(LATENCIA_DA_SAIDA);

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

        // O codificador é montado antes das caps porque é ele quem decide o
        // formato cru que elas vão fixar.
        let (venc, vparse, vcaps, aenc, aparse, acaps) = encode_chain(
            spec.bitrate_kbps,
            spec.fps_n,
            spec.fps_d,
            spec.kind.stream_format(),
            spec.prefer_software,
        )?;

        // Mesma fixação de colorimetria do canal, e pelo mesmo motivo: o
        // encoder não pode ver a colorimetria mudar no meio.
        let video_caps = gst::Caps::builder("video/x-raw")
            .field("format", formato_do_encoder(&venc))
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
        // A mesma latência dita do lado do canal. Deixar o padrão aqui poria
        // de volta os 100 ms que o canal acabou de tirar.
        crate::channel::aplicar_latencia_de_audio(&asrc);
        let aconv = make("audioconvert")?;
        let ares = make("audioresample")?;
        let acapsf = make("capsfilter")?;
        acapsf.set_property("caps", &audio_caps);
        let aqueue = make("queue")?;
        aqueue.set_property("max-size-time", 2_000_000_000u64);

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
/// Latência que toda saída promete.
///
/// Meio segundo é o que absorve um soluço de disco ou uma rajada de rede sem
/// virar atraso perceptível numa transmissão. O número importa menos que o
/// fato de ele ser fixo: latência negociada muda com a máquina, e duas saídas
/// do mesmo canal com latências diferentes são o mesmo programa saindo em
/// tempos diferentes.
const LATENCIA_DA_SAIDA: gst::ClockTime = gst::ClockTime::from_mseconds(650);

const ENCODERS: &[&str] = &["nvh264enc", "qsvh264enc", "mfh264enc", "x264enc"];

/// Se ainda vale tentar o codificador de hardware neste processo.
///
/// Placa de consumo limita quantas sessões de codificação existem ao mesmo
/// tempo -- três em muitas GeForce, cinco nas mais novas. Um playout com
/// quatro canais pede oito (programa e preview de cada), estoura o limite, e o
/// que se vê é a saída caindo e subindo em laço sem explicação.
///
/// Estourou uma vez, o processo inteiro passa a codificar em software. Insistir
/// na placa quando ela já disse não é o que transforma um limite conhecido numa
/// tempestade de reconexões.
static HARDWARE_DISPONIVEL: AtomicBool = AtomicBool::new(true);

/// Marca a placa como indisponível. Devolve `true` se foi a primeira vez.
pub fn desistir_do_hardware(motivo: &str) -> bool {
    if !HARDWARE_DISPONIVEL.swap(false, Ordering::Relaxed) {
        return false;
    }
    eprintln!("[engine] a placa recusou mais uma sessão de codificação ({motivo}); daqui em diante, software");
    true
}

/// O erro veio do codificador de hardware?
///
/// A mensagem do GStreamer traz o nome do elemento, e é por ele que se sabe --
/// tratar qualquer queda como culpa da placa desligaria o hardware por causa de
/// um cabo de rede solto.
fn e_do_hardware(erro: &str) -> bool {
    let baixo = erro.to_lowercase();
    ["nvh264enc", "qsvh264enc", "mfh264enc", "nvenc", "cuda", "session"]
        .iter()
        .any(|marca| baixo.contains(marca))
}

/// Monta o codificador de vídeo, preferindo o que a máquina tiver de hardware.
///
/// `RPLAYOUT_ENCODER` força um: é a saída para quando a placa existe e mente
/// sobre estar pronta, que acontece com driver desatualizado.
fn video_encoder(bitrate_kbps: u32, key_int_max: u32, prefer_software: bool) -> Result<gst::Element> {
    let forced = std::env::var("RPLAYOUT_ENCODER").ok();
    let candidates: Vec<&str> = match forced.as_deref() {
        Some(name) => vec![name],
        // Sessão de placa é recurso escasso: o preview, que sai em metade do
        // tamanho, não gasta uma. Sobra para o programa, que é o que vai ao ar.
        None if prefer_software || !HARDWARE_DISPONIVEL.load(Ordering::Relaxed) => {
            vec!["x264enc"]
        }
        None => ENCODERS.to_vec(),
    };

    for name in candidates {
        let Ok(encoder) = make(name) else { continue };

        // Existir não é servir. Quando o driver não responde à consulta de
        // capacidade, o elemento da placa registra sem formato nenhum: ele é
        // criado, é escolhido, e só falha na hora de ligar o pipeline -- que é
        // a saída caindo e voltando sem dizer por quê. Perguntar antes custa
        // uma consulta e evita o laço inteiro.
        if formato_do_encoder_bruto(&encoder).is_empty() {
            eprintln!("[engine] {name} existe mas não aceita vídeo cru; pulando");
            continue;
        }

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

        // Log só quando a escolha muda: um publisher que reconecta imprimiria
        // a mesma linha para sempre e afogaria o que importa no terminal.
        anunciar_encoder(name);
        return Ok(encoder);
    }

    Err(anyhow!(
        "nenhum codificador de H.264 disponível: instale o GStreamer completo (x264enc) \
         ou verifique a placa"
    ))
}

/// Os formatos crus deste codificador, ou vazio quando ele não anuncia nenhum.
fn formato_do_encoder_bruto(encoder: &gst::Element) -> Vec<String> {
    let Some(pad) = encoder.static_pad("sink") else {
        return Vec::new();
    };
    formatos_de(&pad.query_caps(None))
}

/// O formato cru que este codificador aceita, para o filtro fixar o certo.
///
/// Fixar I420 para todo mundo era o que produzia
/// `Failed to link elements 'queue' and 'nvh264enc'`: o NVENC recebe NV12
/// nativamente e a maioria das versões do `nvh264enc` não anuncia I420 nenhum.
/// O `videoconvert` logo antes converteria de bom grado -- só que o filtro já
/// tinha decidido por ele, e a negociação morria ali. Numa máquina com placa
/// isso não é intermitente: falha sempre, o programa fica preto, e a saída
/// entra num laço de reconexão que não explica nada.
///
/// Preferência por I420 quando existe, porque é o que o resto do canal já usa
/// e evita uma conversão; NV12 em seguida, que é o que a placa quer.
fn formato_do_encoder(encoder: &gst::Element) -> String {
    let aceitos = formato_do_encoder_bruto(encoder);

    for preferido in ["I420", "NV12"] {
        if aceitos.iter().any(|f| f == preferido) {
            return preferido.to_string();
        }
    }
    // Codificador exótico: o primeiro que ele anuncia serve mais do que um
    // palpite nosso. Sem nenhum, I420 -- que é o caso do software.
    aceitos
        .into_iter()
        .next()
        .unwrap_or_else(|| "I420".to_string())
}

/// Os formatos de `video/x-raw` que estas caps aceitam em memória de sistema.
///
/// Variante em memória de placa (CUDA, GL) é ignorada: o que chega aqui vem do
/// `videoconvert`, que entrega em memória de sistema.
fn formatos_de(caps: &gst::Caps) -> Vec<String> {
    let mut achados = Vec::new();

    for (estrutura, features) in caps.iter_with_features() {
        if estrutura.name() != "video/x-raw" {
            continue;
        }
        if !features.is_empty() && !features.contains("memory:SystemMemory") {
            continue;
        }
        match estrutura.value("format") {
            Ok(valor) => coletar_formatos(valor, &mut achados),
            Err(_) => continue,
        }
    }

    achados
}

/// Um campo de caps pode ser uma string só ou uma lista delas.
fn coletar_formatos(valor: &gst::glib::Value, saida: &mut Vec<String>) {
    if let Ok(texto) = valor.get::<String>() {
        saida.push(texto);
        return;
    }
    if let Ok(lista) = valor.get::<gst::List>() {
        for item in lista.iter() {
            if let Ok(texto) = item.get::<String>() {
                saida.push(texto);
            }
        }
    }
}

/// Diz qual codificador entrou, uma vez por escolha.
fn anunciar_encoder(nome: &str) {
    use std::sync::Mutex;
    static ULTIMO: Mutex<Option<String>> = Mutex::new(None);

    let Ok(mut ultimo) = ULTIMO.lock() else { return };
    if ultimo.as_deref() == Some(nome) {
        return;
    }
    eprintln!("[engine] codificando com {nome}");
    *ultimo = Some(nome.to_string());
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
    prefer_software: bool,
) -> Result<(
    gst::Element,
    gst::Element,
    gst::Element,
    gst::Element,
    gst::Element,
    gst::Element,
)> {
    let venc = video_encoder(bitrate_kbps, (fps_n / fps_d.max(1)) as u32 * 2, prefer_software)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    fn init() {
        let _ = gst::init();
    }

    /// O formato tem que sair do que o codificador anuncia, não de um palpite.
    ///
    /// É este o teste que faltava quando o filtro fixava I420 para todo mundo:
    /// `x264enc` aceita I420 e nunca reclamou, enquanto o `nvh264enc` da
    /// máquina do operador só anuncia NV12 e o pipeline não ligava.
    #[test]
    fn formato_vem_do_codificador() {
        init();
        let Ok(x264) = make("x264enc") else {
            // Máquina sem o plugin: o teste não tem o que afirmar.
            return;
        };
        assert_eq!(formato_do_encoder(&x264), "I420");
    }

    /// Codificador que só aceita NV12 recebe NV12, e não o I420 preferido.
    ///
    /// É o caso da placa: o `nvh264enc` recebe NV12 nativamente e a maioria das
    /// versões não anuncia I420 nenhum. Sem placa nesta máquina, quem faz o
    /// papel dela é um `capsfilter` limitado a NV12 -- um elemento de verdade,
    /// cujo pad de entrada anuncia só isso, que é exatamente o que a função lê.
    ///
    /// Este é o teste que pega alguém fixando um formato na mão de novo: se
    /// `formato_do_encoder` voltar a devolver I420 sem perguntar, ele cai.
    #[test]
    fn sem_i420_cai_no_nv12() {
        init();
        let placa_de_mentira = make("capsfilter").expect("capsfilter é do núcleo");
        placa_de_mentira.set_property(
            "caps",
            gst::Caps::builder("video/x-raw")
                .field("format", gst::List::new(["NV12", "Y444"]))
                .build(),
        );
        assert_eq!(formato_do_encoder(&placa_de_mentira), "NV12");
    }

    /// Caps de memória de placa não contam: o que chega ali vem em memória de
    /// sistema, e aceitar uma variante CUDA daria um formato que não se pode
    /// pedir ao `videoconvert`.
    #[test]
    fn memoria_de_placa_nao_conta() {
        init();
        let mut caps = gst::Caps::builder("video/x-raw")
            .field("format", "P010_10LE")
            .build();
        caps.get_mut()
            .unwrap()
            .set_features(0, Some(gst::CapsFeatures::new(["memory:CUDAMemory"])));
        assert!(formatos_de(&caps).is_empty());
    }

    /// Sem formato nenhum -- placa cujo driver não respondeu -- o codificador
    /// é recusado antes de entrar no pipeline.
    #[test]
    fn caps_vazias_nao_dao_formato() {
        init();
        assert!(formatos_de(&gst::Caps::new_empty()).is_empty());
    }

    /// Monta o começo do publisher com um formato fixo e diz se o pipeline
    /// chegou a ligar. É a mesma corrente do `build`: filtro, fila, encoder.
    fn liga_com(formato: &str, encoder: &gst::Element) -> bool {
        let pipeline = gst::Pipeline::new();
        let src = make("videotestsrc").expect("videotestsrc é do plugin base");
        let conv = make("videoconvert").expect("videoconvert é do plugin base");
        let filtro = make("capsfilter").expect("capsfilter é do núcleo");
        filtro.set_property(
            "caps",
            gst::Caps::builder("video/x-raw").field("format", formato).build(),
        );
        let fila = make("queue").expect("queue é do núcleo");

        pipeline
            .add_many([&src, &conv, &filtro, &fila, encoder])
            .expect("adicionar ao pipeline não falha");
        gst::Element::link_many([&src, &conv, &filtro, &fila, encoder]).is_ok()
    }

    /// Fixar um formato que o codificador não aceita quebra o link entre a
    /// fila e ele -- e perguntar ao codificador resolve.
    ///
    /// Este é o defeito que apareceu na máquina do operador, com a mensagem
    /// `Failed to link elements 'queue3' and 'nvh264enc0'`: o filtro fixava
    /// I420 e a placa só aceita NV12. Aqui o caso é o espelho -- `openh264enc`
    /// só aceita I420 -- porque o que se testa é a regra, não a marca da placa,
    /// e assim o teste roda em máquina sem placa nenhuma.
    #[test]
    fn formato_errado_no_filtro_quebra_o_link() {
        init();
        let (Ok(errado), Ok(certo)) = (make("openh264enc"), make("openh264enc")) else {
            // Sem o plugin, não há o que afirmar.
            return;
        };

        assert!(
            !liga_com("NV12", &errado),
            "fixar um formato que o codificador recusa tem que quebrar o link"
        );
        assert!(
            liga_com(&formato_do_encoder(&certo), &certo),
            "o formato pedido ao próprio codificador tem que ligar"
        );
    }
}

#[cfg(test)]
mod testes_monitor {
    use super::*;

    fn spec(on_demand: bool) -> PublisherSpec {
        PublisherSpec {
            kind: Kind::File,
            url: "/dev/null".to_string(),
            video_channel: "v".to_string(),
            audio_channel: "a".to_string(),
            width: 854,
            height: 480,
            fps_n: 30,
            fps_d: 1,
            bitrate_kbps: 2000,
            interlaced: false,
            top_field_first: true,
            prefer_software: true,
            role: "mon".to_string(),
            on_demand,
        }
    }

    /// Monitor nasce parado: sem isso ele codificaria para uma janela fechada
    /// desde o instante em que o canal sobe.
    #[test]
    fn sob_demanda_nasce_parado() {
        let p = Publisher::new(spec(true));
        assert_eq!(p.report().health, Health::Idle);
    }

    /// Saída de verdade nasce querendo subir: quem publica para o mundo não
    /// pode depender de alguém estar olhando.
    #[test]
    fn saida_de_verdade_nasce_tentando() {
        let p = Publisher::new(spec(false));
        assert_eq!(p.report().health, Health::Retrying);
    }

    #[test]
    fn liga_e_desliga_sob_demanda() {
        let mut p = Publisher::new(spec(true));
        p.set_wanted(true);
        assert_eq!(p.report().health, Health::Retrying, "ligado, vai tentar subir");
        p.set_wanted(false);
        assert_eq!(p.report().health, Health::Idle, "desligado, volta a esperar");
    }

    /// `set_wanted` não encosta em saída que não é sob demanda -- desligar o
    /// programa porque ninguém está olhando seria tirar o canal do ar.
    #[test]
    fn nao_desliga_saida_de_verdade() {
        let mut p = Publisher::new(spec(false));
        p.set_wanted(false);
        assert_eq!(p.report().health, Health::Retrying);
    }
}

/// O nome que o Decklink dá ao formato de vídeo do canal.
///
/// A placa não aceita largura, altura e cadência soltas: ela tem uma lista
/// fechada de modos, e o `decklinkvideosink` quer o nome exato de um deles.
/// Errar aqui não dá imagem torta -- dá pipeline que não liga, e a saída
/// simplesmente não existe.
///
/// A cadência do canal é sempre de **quadros**. Um 1080i59,94 tem 29,97
/// quadros e 59,94 campos, e é por isso que a linha entrelaçada de 29,97
/// aponta para `1080i5994`: o número no nome do modo é de campos.
///
/// Nulo quer dizer "esta placa não tem modo para este formato", e é melhor
/// dizer isso do que escolher um parecido: sair em 1080i quando o canal é
/// 1080p muda o que vai ao ar.
pub fn decklink_mode(width: i32, height: i32, fps_n: i32, fps_d: i32, interlaced: bool) -> Option<&'static str> {
    // Milésimos de quadro por segundo: 29,97 vira 29970 e cabe num inteiro,
    // sem a comparação de ponto flutuante que erra por um bit.
    let milesimos = (fps_n as i64 * 1000 / fps_d.max(1) as i64) as i32;

    match (width, height, interlaced) {
        (1920, 1080, false) => Some(match milesimos {
            23976 => "1080p2398",
            24000 => "1080p24",
            25000 => "1080p25",
            29970 => "1080p2997",
            30000 => "1080p30",
            50000 => "1080p50",
            59940 => "1080p5994",
            60000 => "1080p60",
            _ => return None,
        }),
        (1920, 1080, true) => Some(match milesimos {
            // O nome conta campos: 25 quadros entrelaçados são 50 campos.
            25000 => "1080i50",
            29970 => "1080i5994",
            30000 => "1080i60",
            _ => return None,
        }),
        (1280, 720, false) => Some(match milesimos {
            50000 => "720p50",
            59940 => "720p5994",
            60000 => "720p60",
            _ => return None,
        }),
        // Definição padrão, que ainda existe em muita ilha de exibição.
        (720, 486, true) | (720, 480, true) if milesimos == 29970 => Some("ntsc"),
        (720, 576, true) if milesimos == 25000 => Some("pal"),
        _ => None,
    }
}

#[cfg(test)]
mod testes_decklink {
    use super::decklink_mode;

    /// O formato padrão daqui. Se este errar, não sai imagem pela placa.
    #[test]
    fn o_formato_da_casa() {
        assert_eq!(decklink_mode(1920, 1080, 30000, 1001, false), Some("1080p2997"));
    }

    /// O nome do modo conta campos, não quadros: 29,97 quadros entrelaçados
    /// são 59,94 campos. Confundir os dois é escolher o modo errado.
    #[test]
    fn entrelacado_conta_campos() {
        assert_eq!(decklink_mode(1920, 1080, 30000, 1001, true), Some("1080i5994"));
        assert_eq!(decklink_mode(1920, 1080, 25, 1, true), Some("1080i50"));
    }

    /// 29,97 e 30 são modos diferentes na placa, e a diferença é de 0,1%: em
    /// meia hora é um quadro de deriva.
    #[test]
    fn ntsc_nao_e_trinta_exatos() {
        assert_ne!(
            decklink_mode(1920, 1080, 30000, 1001, false),
            decklink_mode(1920, 1080, 30, 1, false)
        );
    }

    #[test]
    fn setecentos_e_vinte() {
        assert_eq!(decklink_mode(1280, 720, 60000, 1001, false), Some("720p5994"));
        assert_eq!(decklink_mode(1280, 720, 50, 1, false), Some("720p50"));
    }

    #[test]
    fn definicao_padrao() {
        assert_eq!(decklink_mode(720, 486, 30000, 1001, true), Some("ntsc"));
        assert_eq!(decklink_mode(720, 576, 25, 1, true), Some("pal"));
    }

    /// Formato sem modo na placa devolve nulo, e quem chama recusa a saída --
    /// escolher um parecido mudaria o que vai ao ar sem avisar.
    #[test]
    fn formato_sem_modo_e_nulo() {
        assert_eq!(decklink_mode(1920, 1080, 48, 1, false), None);
        assert_eq!(decklink_mode(1024, 768, 30, 1, false), None);
        assert_eq!(decklink_mode(1280, 720, 25, 1, false), None);
    }
}
