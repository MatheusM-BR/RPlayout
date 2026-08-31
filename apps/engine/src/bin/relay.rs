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
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Espera entre tentativas. Dobra a cada falha até o teto, e volta ao piso
/// assim que uma conexão se sustenta -- destino que cai e volta não deve
/// herdar a punição da queda anterior.
const BACKOFF_MIN: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
/// Acima disso, a conexão é considerada boa e o backoff é perdoado.
const STABLE_AFTER: Duration = Duration::from_secs(20);

#[derive(serde::Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum Event<'a> {
    Connecting { to: &'a str, attempt: u32 },
    Connected { to: &'a str },
    /// Quantos fluxos a origem ofereceu e quantos foram para o destino.
    Assembled { offered: usize, linked: usize },
    Disconnected { to: &'a str, reason: String },
    Fatal { message: String },
}

impl Event<'_> {
    fn emit(&self) {
        match serde_json::to_string(self) {
            Ok(line) => println!("{line}"),
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
fn attempt(from: &str, to: &str) -> Result<(Duration, String)> {
    let pipeline = gst::Pipeline::with_name("relay");

    let src = gst::ElementFactory::make("rtspsrc")
        .property("location", from)
        .property("latency", 200u32)
        .build()
        .context("rtspsrc não existe nesta instalação do GStreamer")?;
    pipeline.add(&src)?;

    // Os fluxos do RTSP aparecem um a um, e o `flvmux` escreve o cabeçalho no
    // primeiro que recebe. Montar a saída antes de todos chegarem produz um FLV
    // com uma faixa só, que o servidor de destino recusa -- foi exatamente isso
    // que derrubava a conexão um segundo depois de conectar.
    let pending: Arc<Mutex<Vec<gst::Pad>>> = Arc::new(Mutex::new(Vec::new()));
    let collected = Arc::clone(&pending);
    src.connect_pad_added(move |_, pad| {
        if let Ok(mut pads) = collected.lock() {
            pads.push(pad.clone());
        }
    });

    let stage = pipeline.clone();
    let destination = to.to_string();
    let ready = Arc::clone(&pending);
    src.connect_no_more_pads(move |_| {
        let pads = match ready.lock() {
            Ok(pads) => pads.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        if let Err(error) = assemble(&stage, &destination, &pads) {
            eprintln!("[relay] não montei a saída: {error}");
        }
    });

    // Descobre os fluxos em PAUSED e só então sobe. Acrescentar o `rtmp2sink`
    // a um pipeline que já está em PLAYING faz ele abrir a conexão antes de ter
    // o que publicar, e o destino fecha a ligação por falta de assunto.
    pipeline.set_state(gst::State::Paused)?;
    let (result, _, _) = pipeline.state(gst::ClockTime::from_seconds(10));
    result.context("a origem não abriu")?;

    pipeline.set_state(gst::State::Playing)?;
    let started = Instant::now();
    let mut announced = false;

    let bus = pipeline.bus().ok_or_else(|| anyhow!("pipeline sem bus"))?;
    let reason = loop {
        let Some(message) = bus.timed_pop(gst::ClockTime::from_mseconds(500)) else {
            // Sem notícia é boa notícia: o fluxo está passando.
            if !announced && started.elapsed() >= Duration::from_secs(3) {
                announced = true;
                Event::Connected { to }.emit();
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

/// Monta muxer e saída com todos os fluxos de uma vez.
fn assemble(pipeline: &gst::Pipeline, to: &str, pads: &[gst::Pad]) -> Result<()> {
    let mux = gst::ElementFactory::make("flvmux")
        .property("streamable", true)
        .build()?;
    let queue = gst::ElementFactory::make("queue")
        .property("max-size-time", 3_000_000_000u64)
        .build()?;
    let sink = gst::ElementFactory::make("rtmp2sink")
        .property("location", to)
        .build()
        .context("rtmp2sink não existe nesta instalação do GStreamer")?;

    pipeline.add_many([&mux, &queue, &sink])?;
    gst::Element::link_many([&mux, &queue, &sink])?;

    let mut linked = 0;
    for pad in pads {
        match branch(pipeline, &mux, pad) {
            Ok(()) => linked += 1,
            Err(error) => eprintln!("[relay] fluxo ignorado: {error}"),
        }
    }
    Event::Assembled {
        offered: pads.len(),
        linked,
    }
    .emit();

    if linked == 0 {
        return Err(anyhow!("nenhum fluxo relayável na origem"));
    }

    // Em PAUSED, sincronizar é levar tudo junto ao estado do pipeline; quando a
    // montagem acontece já em PLAYING, é o que põe a saída no ar.
    for element in [&mux, &queue, &sink] {
        element.sync_state_with_parent()?;
    }
    Ok(())
}

/// Liga um fluxo do RTSP ao muxer, escolhendo o depayloader pelo formato.
fn branch(pipeline: &gst::Pipeline, mux: &gst::Element, pad: &gst::Pad) -> Result<()> {
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
    let queue = gst::ElementFactory::make("queue").build()?;

    pipeline.add_many([&depay, &parse, &queue])?;
    gst::Element::link_many([&depay, &parse, &queue])?;
    for element in [&depay, &parse, &queue] {
        element.sync_state_with_parent()?;
    }

    pad.link(
        &depay
            .static_pad("sink")
            .ok_or_else(|| anyhow!("depayloader sem sink"))?,
    )?;

    let mux_pad = mux
        .request_pad_simple(slot)
        .ok_or_else(|| anyhow!("flvmux recusou o fluxo de {slot}"))?;
    queue
        .static_pad("src")
        .ok_or_else(|| anyhow!("queue sem src"))?
        .link(&mux_pad)?;

    Ok(())
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
