//! Sonda de arquivo de mídia.
//!
//! Abre o arquivo com o **mesmo GStreamer que vai tocá-lo**. É isso que faz o
//! resultado valer alguma coisa: se a sonda abriu, o playout abre; se a sonda
//! não abriu, o motivo que ela devolve é o mesmo que o playout daria. Uma lista
//! de extensões nossa não teria essa propriedade -- diria "sim" para arquivo
//! que o pipeline recusa e "não" para arquivo que ele tocaria sem reclamar.
//!
//! Mede a loudness de verdade no mesmo passe, pela BS.1770-4. É o que faz o
//! nivelamento automático parar de depender de metadado que alguém digitou.
//!
//! Uma linha de JSON no stdout. Erro também é JSON: quem chama não deve ter que
//! adivinhar pela ausência de saída.

use anyhow::{anyhow, Context, Result};
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[path = "../loudness.rs"]
mod loudness;

use loudness::Meter;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoInfo {
    width: i32,
    height: i32,
    /// Cadência como razão exata, nunca decimal: 59,94 é 60000/1001.
    rate_num: i32,
    rate_den: i32,
    /// `progressive`, `interleaved` ou `mixed`, como o GStreamer reporta.
    interlace_mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioInfo {
    rate: i32,
    channels: i32,
    /// Loudness integrada gateada do arquivo inteiro, em LUFS.
    integrated_lufs: f64,
    /// Faixa de loudness, em LU.
    lra: f64,
    true_peak_dbtp: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Probe {
    ok: bool,
    /// Duração em nanossegundos. Converter para frames é de quem sabe a
    /// cadência do canal, não da sonda.
    duration_ns: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    video: Option<VideoInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio: Option<AudioInfo>,
    /// Caminho da miniatura escrita, quando pedida e possível.
    #[serde(skip_serializing_if = "Option::is_none")]
    thumbnail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Failure {
    ok: bool,
    /// O motivo como o GStreamer deu. É a informação acionável quando o que
    /// falta é um plugin.
    reason: String,
}

fn fail(reason: String) -> ! {
    let payload = Failure { ok: false, reason };
    println!("{}", serde_json::to_string(&payload).unwrap_or_default());
    std::process::exit(0);
}

struct Args {
    path: String,
    thumbnail: Option<String>,
    /// Medir loudness custa decodificar o áudio inteiro. Vale desligar quando
    /// só se quer saber se o arquivo abre.
    measure: bool,
}

fn parse_args() -> Result<Args> {
    let mut path = None;
    let mut thumbnail = None;
    let mut measure = true;

    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--thumbnail" => {
                index += 1;
                thumbnail = Some(
                    args.get(index)
                        .cloned()
                        .ok_or_else(|| anyhow!("--thumbnail precisa de um caminho"))?,
                );
            }
            "--no-loudness" => measure = false,
            other => path = Some(other.to_string()),
        }
        index += 1;
    }

    Ok(Args {
        path: path.ok_or_else(|| anyhow!("falta o caminho do arquivo"))?,
        thumbnail,
        measure,
    })
}

fn uri_for(path: &str) -> Result<String> {
    if path.contains("://") {
        return Ok(path.to_string());
    }
    Ok(gst::glib::filename_to_uri(path, None)?.to_string())
}

fn main() -> Result<()> {
    gst::init().context("GStreamer não inicializou")?;
    let args = parse_args()?;

    if !args.path.contains("://") && !std::path::Path::new(&args.path).is_file() {
        fail("o arquivo não existe ou não é um arquivo".to_string());
    }

    let uri = match uri_for(&args.path) {
        Ok(uri) => uri,
        Err(error) => fail(format!("caminho inválido: {error}")),
    };

    let pipeline = gst::Pipeline::new();
    let src = gst::ElementFactory::make("uridecodebin")
        .property("uri", &uri)
        .build()
        .context("uridecodebin não existe nesta instalação do GStreamer")?;
    pipeline.add(&src)?;

    // O vídeo vai para um `appsink` de um quadro por segundo: um deles vira a
    // miniatura e o resto é descartado sem custo de codificação.
    let video_info: Arc<Mutex<Option<VideoInfo>>> = Arc::new(Mutex::new(None));
    let audio_info: Arc<Mutex<Option<(i32, i32)>>> = Arc::new(Mutex::new(None));
    let meter: Arc<Mutex<Option<Meter>>> = Arc::new(Mutex::new(None));
    let thumbnail_done = Arc::new(AtomicU64::new(0));

    let stage = pipeline.clone();
    let seen_video = Arc::clone(&video_info);
    let seen_audio = Arc::clone(&audio_info);
    let shared_meter = Arc::clone(&meter);
    let want_thumbnail = args.thumbnail.clone();
    let measure = args.measure;
    let thumb_flag = Arc::clone(&thumbnail_done);

    src.connect_pad_added(move |_, pad| {
        let caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
        let Some(structure) = caps.structure(0) else { return };
        let name = structure.name().to_string();

        if name.starts_with("video/") {
            if seen_video.lock().unwrap().is_some() {
                return;
            }
            if let Err(error) = attach_video(
                &stage,
                pad,
                &seen_video,
                want_thumbnail.as_deref(),
                &thumb_flag,
            ) {
                eprintln!("[probe] vídeo ignorado: {error}");
            }
        } else if name.starts_with("audio/") {
            if seen_audio.lock().unwrap().is_some() {
                return;
            }
            if let Err(error) = attach_audio(&stage, pad, &seen_audio, &shared_meter, measure) {
                eprintln!("[probe] áudio ignorado: {error}");
            }
        }
    });

    if let Err(error) = pipeline.set_state(gst::State::Playing) {
        fail(format!("não consegui abrir: {error}"));
    }

    let bus = pipeline.bus().expect("pipeline sempre tem bus");
    let mut duration_ns = 0u64;

    loop {
        let Some(message) = bus.timed_pop(gst::ClockTime::from_seconds(60)) else {
            let _ = pipeline.set_state(gst::State::Null);
            fail("o arquivo não respondeu em sessenta segundos".to_string());
        };

        match message.view() {
            gst::MessageView::Eos(_) => break,
            gst::MessageView::Error(error) => {
                let reason = format!(
                    "{} ({})",
                    error.error(),
                    error.debug().unwrap_or_else(|| "sem detalhe".into())
                );
                let _ = pipeline.set_state(gst::State::Null);
                fail(reason);
            }
            gst::MessageView::AsyncDone(_) => {
                if let Some(duration) = pipeline.query_duration::<gst::ClockTime>() {
                    duration_ns = duration.nseconds();
                }
            }
            _ => {}
        }
    }

    if duration_ns == 0 {
        if let Some(duration) = pipeline.query_duration::<gst::ClockTime>() {
            duration_ns = duration.nseconds();
        }
    }
    let _ = pipeline.set_state(gst::State::Null);

    let audio = audio_info.lock().unwrap().take().map(|(rate, channels)| {
        let mut guard = meter.lock().unwrap();
        let reading = guard.as_mut().map(|meter| meter.read());
        AudioInfo {
            rate,
            channels,
            integrated_lufs: reading.as_ref().map_or(-70.0, |value| value.integrated_lufs),
            lra: reading.as_ref().map_or(0.0, |value| value.range_lu),
            true_peak_dbtp: reading.as_ref().map_or(-90.0, |value| value.true_peak_dbtp),
        }
    });

    let probe = Probe {
        ok: true,
        duration_ns,
        video: video_info.lock().unwrap().take(),
        audio,
        thumbnail: args
            .thumbnail
            .filter(|_| thumbnail_done.load(Ordering::Relaxed) > 0),
    };
    println!("{}", serde_json::to_string(&probe)?);
    Ok(())
}

/// Liga o ramo de vídeo: guarda a geometria e escreve a miniatura.
fn attach_video(
    pipeline: &gst::Pipeline,
    pad: &gst::Pad,
    info: &Arc<Mutex<Option<VideoInfo>>>,
    thumbnail: Option<&str>,
    done: &Arc<AtomicU64>,
) -> Result<()> {
    // A geometria vem das caps do pad de origem, não do que foi escalado.
    let source_caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
    let structure = source_caps
        .structure(0)
        .ok_or_else(|| anyhow!("pad de vídeo sem caps"))?;
    let source_width: i32 = structure.get("width").unwrap_or(0);
    let source_height: i32 = structure.get("height").unwrap_or(0);

    let convert = gst::ElementFactory::make("videoconvert").build()?;
    let scale = gst::ElementFactory::make("videoscale").build()?;
    let caps = gst::ElementFactory::make("capsfilter").build()?;
    // Miniatura com 320 de largura e altura calculada da proporção do arquivo.
    // Fixar só a largura deixa o `videoscale` manter a altura original, e um
    // 16:9 chega ao explorador esticado -- foi o que aconteceu.
    let thumb_width = 320i32;
    let thumb_height = if source_width > 0 && source_height > 0 {
        let scaled = (thumb_width as i64 * source_height as i64 / source_width as i64) as i32;
        (scaled + scaled % 2).max(2)
    } else {
        180
    };
    caps.set_property(
        "caps",
        gst::Caps::builder("video/x-raw")
            .field("width", thumb_width)
            .field("height", thumb_height)
            .build(),
    );
    let encoder = gst::ElementFactory::make("jpegenc").build()?;
    let sink = gst::ElementFactory::make("appsink")
        .property("sync", false)
        .property("max-buffers", 1u32)
        .property("drop", true)
        .build()?;

    pipeline.add_many([&convert, &scale, &caps, &encoder, &sink])?;
    gst::Element::link_many([&convert, &scale, &caps, &encoder, &sink])?;
    for element in [&convert, &scale, &caps, &encoder, &sink] {
        element.sync_state_with_parent()?;
    }

    let rate = structure
        .get::<gst::Fraction>("framerate")
        .unwrap_or_else(|_| gst::Fraction::new(25, 1));
    *info.lock().unwrap() = Some(VideoInfo {
        width: source_width,
        height: source_height,
        rate_num: rate.numer(),
        rate_den: rate.denom(),
        interlace_mode: structure
            .get::<String>("interlace-mode")
            .unwrap_or_else(|_| "progressive".to_string()),
    });

    if let Some(path) = thumbnail {
        let target = path.to_string();
        let flag = Arc::clone(done);
        let app_sink = sink
            .clone()
            .dynamic_cast::<gst_app::AppSink>()
            .map_err(|_| anyhow!("appsink de vídeo não é appsink"))?;
        app_sink.set_callbacks(
            gst_app::AppSinkCallbacks::builder()
                .new_sample(move |sink| {
                    let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                    // Só o primeiro quadro interessa; escrever a cada quadro
                    // deixaria a miniatura sendo o último frame do arquivo,
                    // que costuma ser preto.
                    if flag
                        .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Relaxed)
                        .is_ok()
                    {
                        if let Some(buffer) = sample.buffer() {
                            if let Ok(map) = buffer.map_readable() {
                                if std::fs::write(&target, map.as_slice()).is_err() {
                                    flag.store(0, Ordering::Relaxed);
                                }
                            }
                        }
                    }
                    Ok(gst::FlowSuccess::Ok)
                })
                .build(),
        );
    }

    pad.link(
        &convert
            .static_pad("sink")
            .ok_or_else(|| anyhow!("videoconvert sem sink"))?,
    )?;
    Ok(())
}

/// Liga o ramo de áudio: guarda o formato e mede a loudness.
fn attach_audio(
    pipeline: &gst::Pipeline,
    pad: &gst::Pad,
    info: &Arc<Mutex<Option<(i32, i32)>>>,
    meter: &Arc<Mutex<Option<Meter>>>,
    measure: bool,
) -> Result<()> {
    let convert = gst::ElementFactory::make("audioconvert").build()?;
    let resample = gst::ElementFactory::make("audioresample").build()?;
    let caps = gst::ElementFactory::make("capsfilter").build()?;
    // A BS.1770 tem coeficientes tabelados por taxa, e os nossos são de
    // 48 kHz. Reamostrar antes de medir é mais certo do que medir com o
    // filtro errado.
    caps.set_property(
        "caps",
        gst::Caps::builder("audio/x-raw")
            .field("format", "F32LE")
            .field("layout", "interleaved")
            .field("rate", 48_000i32)
            .field("channels", 2i32)
            .build(),
    );
    let sink = gst::ElementFactory::make("appsink")
        .property("sync", false)
        .property("max-buffers", 64u32)
        .build()?;

    pipeline.add_many([&convert, &resample, &caps, &sink])?;
    gst::Element::link_many([&convert, &resample, &caps, &sink])?;
    for element in [&convert, &resample, &caps, &sink] {
        element.sync_state_with_parent()?;
    }

    let source_caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
    if let Some(structure) = source_caps.structure(0) {
        *info.lock().unwrap() = Some((
            structure.get("rate").unwrap_or(48_000),
            structure.get("channels").unwrap_or(2),
        ));
    }

    *meter.lock().unwrap() = Some(Meter::new(48_000, 2));
    let shared = Arc::clone(meter);
    let app_sink = sink
        .clone()
        .dynamic_cast::<gst_app::AppSink>()
        .map_err(|_| anyhow!("appsink de áudio não é appsink"))?;
    app_sink.set_callbacks(
        gst_app::AppSinkCallbacks::builder()
            .new_sample(move |sink| {
                let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                if !measure {
                    return Ok(gst::FlowSuccess::Ok);
                }
                let Some(buffer) = sample.buffer() else {
                    return Ok(gst::FlowSuccess::Ok);
                };
                let Ok(map) = buffer.map_readable() else {
                    return Ok(gst::FlowSuccess::Ok);
                };
                let samples: Vec<f32> = map
                    .as_slice()
                    .chunks_exact(4)
                    .map(|raw| f32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]))
                    .collect();
                if let Some(meter) = shared.lock().unwrap().as_mut() {
                    meter.push(&samples);
                }
                Ok(gst::FlowSuccess::Ok)
            })
            .build(),
    );

    pad.link(
        &convert
            .static_pad("sink")
            .ok_or_else(|| anyhow!("audioconvert sem sink"))?,
    )?;
    Ok(())
}
