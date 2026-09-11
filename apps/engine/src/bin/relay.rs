//! Relay de um destino externo.
//!
//! Puxa o programa do servidor local por RTSP e empurra para fora por RTMP,
//! **sem recodificar**: só troca de embalagem, do RTP para o FLV. O H.264 e o
//! AAC que saem daqui são exatamente os que o canal codificou.
//!
//! A leitura é por RTSP porque o `rtmp2src` do GStreamer não consegue ler do
//! MediaMTX -- ele é fechado no `createStream`. Como a leitura é interna, o
//! RTSP fica em loopback e não aparece na rede.
//!
//! Um processo por destino, de propósito. O YouTube cair, engasgar ou rejeitar
//! a chave não pode tocar no encoder, nos outros destinos nem na saída SDI --
//! e não toca, porque nada disso está neste processo.

use anyhow::{anyhow, Context, Result};
use gstreamer as gst;
use gstreamer::prelude::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Espera entre tentativas. Dobra a cada falha até o teto, e volta ao piso
/// assim que uma conexão se sustenta -- destino que cai e volta não deve
/// herdar a punição da queda anterior.
const BACKOFF_MIN: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
/// Acima disso, a conexão é considerada boa e o backoff é perdoado.
const STABLE_AFTER: Duration = Duration::from_secs(20);
/// Quanto o muxer pode esperar por uma das trilhas antes de fechar o pacote.
const MUX_LATENCY: u64 = 500_000_000;

#[derive(serde::Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum Event<'a> {
    Connecting { to: &'a str, attempt: u32 },
    Connected { to: &'a str },
    /// Quantos fluxos a origem ofereceu e quantos foram para o destino.
    Assembled { offered: usize, linked: usize, streams: Vec<String> },
    /// Buffers que passaram por cada ponto. Diz onde o fluxo para, quando para.
    Flow { video: u64, audio: u64, sink: u64 },
    Disconnected { to: &'a str, reason: String },
    Fatal { message: String },
}

impl Event<'_> {
    fn emit(&self) {
        match serde_json::to_string(self) {
            Ok(line) => {
                // Quem lê isto é um supervisor, não um terminal: sem flush o
                // stdout fica em bloco e o servidor passa minutos sem notícia.
                println!("{line}");
                let _ = std::io::Write::flush(&mut std::io::stdout());
            }
            Err(error) => eprintln!("[relay] evento não serializou: {error}"),
        }
    }
}

struct Args {
    from: String,
    to: String,
}

fn parse_args() -> Result<Args> {
    let mut from = None;
    let mut to = None;

    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < args.len() {
        let flag = args[index].clone();
        index += 1;
        let value = args
            .get(index)
            .cloned()
            .ok_or_else(|| anyhow!("{flag} precisa de um valor"))?;
        index += 1;

        match flag.as_str() {
            "--from" => from = Some(value),
            "--to" => to = Some(value),
            other => return Err(anyhow!("argumento desconhecido: {other}")),
        }
    }

    Ok(Args {
        from: from.ok_or_else(|| anyhow!("--from é obrigatório"))?,
        to: to.ok_or_else(|| anyhow!("--to é obrigatório"))?,
    })
}

/// Uma tentativa de conexão. Volta quando a ligação cai, dizendo por quê e
/// quanto tempo ela durou.
#[derive(Default)]
struct Counters {
    video: AtomicU64,
    audio: AtomicU64,
    sink: AtomicU64,
}

fn attempt(from: &str, to: &str) -> Result<(Duration, String)> {
    let pipeline = gst::Pipeline::with_name("relay");
    let counters = Arc::new(Counters::default());

    let src = gst::ElementFactory::make("rtspsrc")
        .property("location", from)
        .property("latency", 200u32)
        // RTSP interleaved sobre TCP: em loopback não há perda a compensar e
        // não há porta UDP para acertar.
        .property_from_str("protocols", "tcp")
        .build()
        .context("rtspsrc não existe nesta instalação do GStreamer")?;

    // Sem folga, o `flvmux` fecha o pacote com o que tiver na mão e deixa o
    // carimbo de tempo andar para trás quando uma das trilhas atrasa. No RTMP
    // o carimbo do pedaço é uma diferença de 24 bits: diferença negativa vira
    // número gigante, o destino cai em "received type 3 chunk without previous
    // chunk" e derruba a conexão. Meio segundo de espera é o que separa um
    // relay que entrega de um que reconecta para sempre.
    let mux = gst::ElementFactory::make("flvmux")
        .property("streamable", true)
        .property("latency", MUX_LATENCY)
        .build()?;
    let queue = gst::ElementFactory::make("queue")
        .property("max-size-time", 3_000_000_000u64)
        .build()?;
    let sink = gst::ElementFactory::make("rtmp2sink")
        .property("location", to)
        .build()
        .context("rtmp2sink não existe nesta instalação do GStreamer")?;

    pipeline.add_many([&src, &mux, &queue, &sink])?;
    gst::Element::link_many([&mux, &queue, &sink])?;

    // Os dois pads do muxer são pedidos agora, antes de qualquer fluxo aparecer.
    //
    // Foi a única forma de sair do impasse: os fluxos do rtspsrc só surgem
    // depois do PLAYING, mas em PLAYING os dados já correm -- montar o muxer
    // depois deixa o ramo empurrando sem destino, e o pad que leva `not-linked`
    // para de vez. Como o programa de um canal sempre tem vídeo e áudio, dá
    // para reservar os dois lugares e esperar cada um ser ocupado.
    let slots: HashMap<String, gst::Pad> = ["video", "audio"]
        .into_iter()
        .map(|slot| {
            mux.request_pad_simple(slot)
                .map(|pad| (slot.to_string(), pad))
                .ok_or_else(|| anyhow!("flvmux recusou o lugar de {slot}"))
        })
        .collect::<Result<_>>()?;

    if let Some(pad) = sink.static_pad("sink") {
        let counted = Arc::clone(&counters);
        pad.add_probe(gst::PadProbeType::BUFFER, move |_, _| {
            counted.sink.fetch_add(1, Ordering::Relaxed);
            gst::PadProbeReturn::Ok
        });
    }

    let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stage = pipeline.clone();
    let counted = Arc::clone(&counters);
    let listed = Arc::clone(&seen);
    src.connect_pad_added(move |_, pad| {
        let outcome = match branch(&stage, pad, &counted, &slots) {
            Ok(slot) => slot,
            Err(error) => {
                eprintln!("[relay] fluxo ignorado: {error}");
                format!("recusado: {error}")
            }
        };
        if let Ok(mut list) = listed.lock() {
            list.push(outcome);
        }
    });

    pipeline.set_state(gst::State::Playing)?;
    let started = Instant::now();
    let mut announced = false;
    let mut reported = Instant::now();

    let bus = pipeline.bus().ok_or_else(|| anyhow!("pipeline sem bus"))?;
    let reason = loop {
        let Some(message) = bus.timed_pop(gst::ClockTime::from_mseconds(200)) else {
            let sink_count = counters.sink.load(Ordering::Relaxed);
            // Conectado é quando o destino recebeu buffer, não quando o relógio
            // passou: um sink que abriu o TCP e não publicou nada estava sendo
            // anunciado como se estivesse no ar.
            if !announced && sink_count > 0 {
                announced = true;
                let streams = match seen.lock() {
                    Ok(list) => list.clone(),
                    Err(poisoned) => poisoned.into_inner().clone(),
                };
                Event::Assembled {
                    offered: streams.len(),
                    linked: streams.iter().filter(|s| !s.starts_with("recusado")).count(),
                    streams,
                }
                .emit();
                Event::Connected { to }.emit();
            }
            if reported.elapsed() >= Duration::from_secs(1) {
                reported = Instant::now();
                Event::Flow {
                    video: counters.video.load(Ordering::Relaxed),
                    audio: counters.audio.load(Ordering::Relaxed),
                    sink: sink_count,
                }
                .emit();
            }
            continue;
        };

        match message.view() {
            gst::MessageView::Error(error) => break error.error().to_string(),
            gst::MessageView::Eos(_) => break String::from("a origem encerrou"),
            _ => {}
        }
    };

    let _ = pipeline.set_state(gst::State::Null);
    Ok((started.elapsed(), reason))
}

/// Liga um fluxo do RTSP ao muxer, escolhendo o depayloader pelo formato.
fn branch(
    pipeline: &gst::Pipeline,
    pad: &gst::Pad,
    counters: &Arc<Counters>,
    slots: &HashMap<String, gst::Pad>,
) -> Result<String> {
    let caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
    let structure = caps
        .structure(0)
        .ok_or_else(|| anyhow!("fluxo sem caps"))?;
    let encoding = structure
        .get::<String>("encoding-name")
        .unwrap_or_default()
        .to_uppercase();

    let (depay, parse, slot) = match encoding.as_str() {
        "H264" => ("rtph264depay", "h264parse", "video"),
        "MPEG4-GENERIC" | "MP4A-LATM" => ("rtpmp4gdepay", "aacparse", "audio"),
        other => return Err(anyhow!("formato não relayável: {other}")),
    };

    let depay = gst::ElementFactory::make(depay).build()?;
    let parse = gst::ElementFactory::make(parse).build()?;
    // O RTMP precisa dos parâmetros do codec voltando de tempos em tempos: quem
    // sintoniza no meio da transmissão não viu o começo.
    if slot == "video" {
        parse.set_property("config-interval", -1i32);
    }
    let queue = gst::ElementFactory::make("queue").build()?;

    // O flvmux só aceita H.264 em `avc` e AAC em `raw`. Deixar a negociação
    // adivinhar é o caminho para um pipeline que liga tudo e não passa nada.
    let caps = gst::ElementFactory::make("capsfilter").build()?;
    caps.set_property(
        "caps",
        if slot == "video" {
            gst::Caps::builder("video/x-h264")
                .field("stream-format", "avc")
                .field("alignment", "au")
                .build()
        } else {
            gst::Caps::builder("audio/mpeg")
                .field("mpegversion", 4i32)
                .field("stream-format", "raw")
                .build()
        },
    );

    pipeline.add_many([&depay, &parse, &caps, &queue])?;
    gst::Element::link_many([&depay, &parse, &caps, &queue])?;
    for element in [&depay, &parse, &caps, &queue] {
        element.sync_state_with_parent()?;
    }

    // Conta no pad da origem: assim "não chega nada" distingue fluxo que nunca
    // chegou de fluxo que chegou e ficou preso adiante.
    {
        let branch_counter = Arc::clone(counters);
        let is_video = slot == "video";
        pad.add_probe(gst::PadProbeType::BUFFER, move |_, _| {
            let field = if is_video {
                &branch_counter.video
            } else {
                &branch_counter.audio
            };
            field.fetch_add(1, Ordering::Relaxed);
            gst::PadProbeReturn::Ok
        });
    }

    pad.link(
        &depay
            .static_pad("sink")
            .ok_or_else(|| anyhow!("depayloader sem sink"))?,
    )?;

    let mux_pad = slots
        .get(slot)
        .ok_or_else(|| anyhow!("sem lugar reservado para {slot}"))?;
    queue
        .static_pad("src")
        .ok_or_else(|| anyhow!("queue sem src"))?
        .link(mux_pad)?;

    Ok(format!("{encoding} -> {slot}"))
}

fn main() -> Result<()> {
    gst::init().context("GStreamer não inicializou")?;
    let args = parse_args()?;

    let mut backoff = BACKOFF_MIN;
    let mut attempts: u32 = 0;

    loop {
        attempts += 1;
        Event::Connecting {
            to: &args.to,
            attempt: attempts,
        }
        .emit();

        match attempt(&args.from, &args.to) {
            Ok((lasted, reason)) => {
                Event::Disconnected {
                    to: &args.to,
                    reason,
                }
                .emit();

                if lasted >= STABLE_AFTER {
                    backoff = BACKOFF_MIN;
                    attempts = 0;
                }
            }
            Err(error) => {
                // Falha de montagem não se resolve tentando de novo.
                Event::Fatal {
                    message: error.to_string(),
                }
                .emit();
                return Err(error);
            }
        }

        std::thread::sleep(backoff);
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
}
