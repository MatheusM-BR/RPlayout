//! Mede o descasamento entre imagem e som num arquivo.
//!
//! Não é ferramenta do produto: é instrumento de medição. Ela decodifica as
//! duas trilhas do mesmo arquivo, anota o instante em que a imagem clareia e o
//! instante em que o som começa, e diz a diferença. Sem isso, "o áudio está
//! dessincronizado" é uma impressão -- com isso é um número.
//!
//! Uma armadilha ao ler o que ela mede: material com cadência diferente da do
//! canal (um arquivo a 30 num canal a 29,97) cai numa grade de quadros que não
//! é a dele, e a sobra entre as duas grades passeia de zero a um quadro e volta
//! ao zero. É um dente de serra, não uma deriva: o período é `den/num` da
//! diferença -- 1001/30, ou uns 33 s, no caso de 30 contra 29,97. Medir por
//! menos que um período inteiro mostra só a rampa, e a rampa parece uma deriva
//! de 1 ms por segundo que na verdade nunca acumula. Meça por vários períodos
//! antes de dizer que alguma coisa está derivando.

use anyhow::{anyhow, Result};
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use std::sync::{Arc, Mutex};

/// Instantes em que cada trilha passou do limiar, em nanossegundos.
#[derive(Default)]
struct Bordas {
    video: Mutex<Vec<u64>>,
    audio: Mutex<Vec<u64>>,
}

fn main() -> Result<()> {
    gst::init()?;
    let caminho = std::env::args().nth(1).ok_or_else(|| anyhow!("dê o arquivo"))?;
    let uri = gst::glib::filename_to_uri(&caminho, None)?.to_string();

    let pipeline = gst::Pipeline::new();
    let src = gst::ElementFactory::make("uridecodebin")
        .property("uri", &uri)
        .build()?;
    pipeline.add(&src)?;

    let bordas = Arc::new(Bordas::default());
    let palco = pipeline.clone();
    let achados = Arc::clone(&bordas);

    src.connect_pad_added(move |_, pad| {
        let caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
        let Some(estrutura) = caps.structure(0) else { return };
        let nome = estrutura.name().to_string();

        if nome.starts_with("video/") {
            let _ = ligar_video(&palco, pad, &achados);
        } else if nome.starts_with("audio/") {
            let _ = ligar_audio(&palco, pad, &achados);
        }
    });

    pipeline.set_state(gst::State::Playing)?;
    let bus = pipeline.bus().unwrap();
    loop {
        let Some(msg) = bus.timed_pop(gst::ClockTime::from_seconds(120)) else { break };
        match msg.view() {
            gst::MessageView::Eos(_) => break,
            gst::MessageView::Error(e) => {
                let _ = pipeline.set_state(gst::State::Null);
                return Err(anyhow!("{}", e.error()));
            }
            _ => {}
        }
    }
    let _ = pipeline.set_state(gst::State::Null);

    let v = bordas.video.lock().unwrap().clone();
    let a = bordas.audio.lock().unwrap().clone();
    println!("{}", serde_json::json!({
        "video_ns": v,
        "audio_ns": a,
    }));
    Ok(())
}

/// Anota o instante de cada quadro cuja luminância média passa do limiar.
fn ligar_video(pipeline: &gst::Pipeline, pad: &gst::Pad, bordas: &Arc<Bordas>) -> Result<()> {
    let conv = gst::ElementFactory::make("videoconvert").build()?;
    let escala = gst::ElementFactory::make("videoscale").build()?;
    // Reduzir a 32x18 antes de medir: a média de luminância é a mesma e o
    // custo cai por mil. O que interessa é claro contra escuro, não detalhe.
    let caps = gst::ElementFactory::make("capsfilter").build()?;
    caps.set_property(
        "caps",
        gst::Caps::builder("video/x-raw")
            .field("format", "GRAY8")
            .field("width", 32i32)
            .field("height", 18i32)
            .build(),
    );
    let sink = gst::ElementFactory::make("appsink")
        .property("sync", false)
        .property("max-buffers", 4u32)
        .build()?;

    pipeline.add_many([&conv, &escala, &caps, &sink])?;
    gst::Element::link_many([&conv, &escala, &caps, &sink])?;
    for e in [&conv, &escala, &caps, &sink] {
        e.sync_state_with_parent()?;
    }

    let achados = Arc::clone(bordas);
    let app: gst_app::AppSink = sink.clone().dynamic_cast().unwrap();
    app.set_callbacks(
        gst_app::AppSinkCallbacks::builder()
            .new_sample(move |s| {
                let amostra = s.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                let Some(buffer) = amostra.buffer() else { return Ok(gst::FlowSuccess::Ok) };
                let Some(pts) = buffer.pts() else { return Ok(gst::FlowSuccess::Ok) };
                let Ok(mapa) = buffer.map_readable() else { return Ok(gst::FlowSuccess::Ok) };
                let dados = mapa.as_slice();
                let media = dados.iter().map(|b| *b as u64).sum::<u64>() / dados.len().max(1) as u64;
                if media > 160 {
                    achados.video.lock().unwrap().push(pts.nseconds());
                }
                Ok(gst::FlowSuccess::Ok)
            })
            .build(),
    );

    pad.link(&conv.static_pad("sink").unwrap())?;
    Ok(())
}

/// Anota o instante de cada bloco de áudio cujo pico passa do limiar.
fn ligar_audio(pipeline: &gst::Pipeline, pad: &gst::Pad, bordas: &Arc<Bordas>) -> Result<()> {
    let conv = gst::ElementFactory::make("audioconvert").build()?;
    let resample = gst::ElementFactory::make("audioresample").build()?;
    let caps = gst::ElementFactory::make("capsfilter").build()?;
    caps.set_property(
        "caps",
        gst::Caps::builder("audio/x-raw")
            .field("format", "F32LE")
            .field("layout", "interleaved")
            .field("rate", 48_000i32)
            .field("channels", 1i32)
            .build(),
    );
    let sink = gst::ElementFactory::make("appsink")
        .property("sync", false)
        .property("max-buffers", 8u32)
        .build()?;

    pipeline.add_many([&conv, &resample, &caps, &sink])?;
    gst::Element::link_many([&conv, &resample, &caps, &sink])?;
    for e in [&conv, &resample, &caps, &sink] {
        e.sync_state_with_parent()?;
    }

    let achados = Arc::clone(bordas);
    let app: gst_app::AppSink = sink.clone().dynamic_cast().unwrap();
    app.set_callbacks(
        gst_app::AppSinkCallbacks::builder()
            .new_sample(move |s| {
                let amostra = s.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                let Some(buffer) = amostra.buffer() else { return Ok(gst::FlowSuccess::Ok) };
                let Some(pts) = buffer.pts() else { return Ok(gst::FlowSuccess::Ok) };
                let Ok(mapa) = buffer.map_readable() else { return Ok(gst::FlowSuccess::Ok) };
                // Anota a amostra exata em que o som começa dentro do bloco, e
                // não o início do bloco: um bloco tem dezenas de milissegundos,
                // que é a mesma ordem de grandeza do erro que se procura.
                for (i, quadro) in mapa.as_slice().chunks_exact(4).enumerate() {
                    let v = f32::from_le_bytes([quadro[0], quadro[1], quadro[2], quadro[3]]);
                    if v.abs() > 0.2 {
                        let deslocamento = (i as u64) * 1_000_000_000 / 48_000;
                        achados.audio.lock().unwrap().push(pts.nseconds() + deslocamento);
                        break;
                    }
                }
                Ok(gst::FlowSuccess::Ok)
            })
            .build(),
    );

    pad.link(&conv.static_pad("sink").unwrap())?;
    Ok(())
}
