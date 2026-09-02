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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

// O medidor é compartilhado com o engine por inclusão de caminho: são dois
// binários do mesmo crate, e o mesmo código medindo em ingest e no ar é o que
// garante que o número do acervo e o número do medidor sejam comparáveis.
//
// A sonda usa só parte dele -- não há janela momentânea nem redução de ganho
// para reportar num arquivo parado --, então o resto fica sem uso aqui.
#[allow(dead_code)]
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

/// Uma trilha de áudio do arquivo, do jeito que ele a declara.
///
/// O índice é a ordem em que a trilha aparece, que é a mesma que o engine usa
/// para escolher qual tocar. Idioma vem da tag do arquivo quando existe -- e
/// não existe com frequência, então ele é opcional em vez de inventado.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioTrack {
    index: usize,
    rate: i32,
    channels: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioInfo {
    rate: i32,
    channels: i32,
    /// Loudness integrada gateada do arquivo inteiro, em LUFS.
    ///
    /// Ausente quando a medição foi dispensada. Mandar -70 nesse caso seria
    /// indistinguível de um arquivo mudo medido de verdade.
    #[serde(skip_serializing_if = "Option::is_none")]
    integrated_lufs: Option<f64>,
    /// Faixa de loudness, em LU.
    #[serde(skip_serializing_if = "Option::is_none")]
    lra: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    true_peak_dbtp: Option<f64>,
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
    /// Todas as trilhas de áudio, na ordem em que o arquivo as declara.
    ///
    /// A medição vale para a primeira, que é a que a sonda decodifica; as
    /// outras entram aqui para o operador poder escolher.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    audio_tracks: Vec<AudioTrack>,
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
    /// Segundo de onde tirar o quadro. Sem isto, o quadro é o do começo.
    ///
    /// É o que permite montar a régua de miniaturas do in/out: marcar corte
    /// olhando só o primeiro quadro é marcar no escuro.
    at: Option<f64>,
    /// Quantos quadros tirar de uma vez, espalhados pelo arquivo inteiro.
    ///
    /// Abrir e posicionar um arquivo grande custa segundos; a régua do in/out
    /// quer dezesseis quadros e abrir dezesseis vezes levaria um minuto. Com
    /// `--fita`, abre-se uma vez e salta-se dentro do mesmo pipeline: os
    /// quadros saem como `<prefixo>-0.jpg`, `<prefixo>-1.jpg`, e assim por
    /// diante, onde o prefixo é o que veio em `--thumbnail`.
    fita: Option<u32>,
    /// Largura da miniatura em pixels. A régua do in/out quer quadro pequeno,
    /// para encher rápido; a tela de conferência quer quadro grande, para dar
    /// para ver onde cortar.
    largura: i32,
}

fn parse_args() -> Result<Args> {
    let mut path = None;
    let mut thumbnail = None;
    let mut measure = true;
    let mut at = None;
    let mut largura = 320i32;
    let mut fita = None;

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
            "--at" => {
                index += 1;
                at = Some(
                    args.get(index)
                        .ok_or_else(|| anyhow!("--at precisa de um número de segundos"))?
                        .parse()
                        .context("--at")?,
                );
            }
            "--fita" => {
                index += 1;
                fita = Some(
                    args.get(index)
                        .ok_or_else(|| anyhow!("--fita precisa de um número de quadros"))?
                        .parse()
                        .context("--fita")?,
                );
            }
            "--largura" => {
                index += 1;
                largura = args
                    .get(index)
                    .ok_or_else(|| anyhow!("--largura precisa de um número"))?
                    .parse()
                    .context("--largura")?;
            }
            other => path = Some(other.to_string()),
        }
        index += 1;
    }

    Ok(Args {
        path: path.ok_or_else(|| anyhow!("falta o caminho do arquivo"))?,
        thumbnail,
        measure,
        at,
        fita: fita.map(|n: u32| n.clamp(1, 64)),
        // Largura ímpar quebra a subamostragem de croma do JPEG; e uma largura
        // absurda transformaria a sonda num gerador de imagem enorme.
        largura: largura.clamp(64, 1920) & !1,
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
    // Toda trilha entra na lista; só a primeira é decodificada e medida.
    let audio_tracks: Arc<Mutex<Vec<AudioTrack>>> = Arc::new(Mutex::new(Vec::new()));
    let meter: Arc<Mutex<Option<Meter>>> = Arc::new(Mutex::new(None));
    let thumbnail_done = Arc::new(AtomicU64::new(0));
    // Sem `--at` nem `--fita`, o primeiro quadro serve e a captura já nasce
    // liberada.
    let liberado = Arc::new(AtomicBool::new(args.at.is_none() && args.fita.is_none()));
    // Para onde o próximo quadro capturado vai. Com `--fita` isso muda a cada
    // salto, então o destino não pode ficar preso dentro da callback.
    let alvo: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(match args.fita {
        Some(_) => None,
        None => args.thumbnail.clone(),
    }));

    let stage = pipeline.clone();
    let seen_video = Arc::clone(&video_info);
    let seen_audio = Arc::clone(&audio_info);
    let listed_audio = Arc::clone(&audio_tracks);
    let shared_meter = Arc::clone(&meter);
    let want_thumbnail = Arc::clone(&alvo);
    let measure = args.measure;
    let largura_thumb = args.largura;
    let thumb_flag = Arc::clone(&thumbnail_done);
    let porteiro_video = Arc::clone(&liberado);

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
                &want_thumbnail,
                &thumb_flag,
                &porteiro_video,
                largura_thumb,
            ) {
                eprintln!("[probe] vídeo ignorado: {error}");
            }
        } else if name.starts_with("audio/") {
            let mut tracks = listed_audio.lock().unwrap();
            let index = tracks.len();
            tracks.push(AudioTrack {
                index,
                rate: structure.get::<i32>("rate").unwrap_or(0),
                channels: structure.get::<i32>("channels").unwrap_or(0),
                language: language_of(pad),
            });
            drop(tracks);

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

    // Quadro de uma posição pedida: espera o pipeline responder (só aí o
    // arquivo aceita busca), salta, e só então libera a captura. A ordem
    // importa: liberar antes do salto grava o primeiro quadro do arquivo.
    if let Some(segundos) = args.at {
        let _ = pipeline.state(gst::ClockTime::from_seconds(10));
        let alvo = gst::ClockTime::from_nseconds((segundos.max(0.0) * 1e9) as u64);
        if pipeline
            .seek_simple(gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT, alvo)
            .is_err()
        {
            // Arquivo sem índice não busca; o quadro do começo é melhor do que
            // nenhum, e a régua fica com repetição em vez de buraco.
            eprintln!("[probe] o arquivo não aceitou busca; usando o começo");
        }
        let _ = pipeline.state(gst::ClockTime::from_seconds(10));
        liberado.store(true, Ordering::Release);
    }

    // A fita inteira numa abertura só. O caro aqui é abrir e posicionar o
    // arquivo -- um MKV de duzentos megabytes leva segundos para o primeiro
    // salto. Repetir isso dezesseis vezes levaria um minuto; dentro do mesmo
    // pipeline, cada salto seguinte custa uma fração disso.
    if let Some(quantos) = args.fita {
        let _ = pipeline.state(gst::ClockTime::from_seconds(15));
        let total = pipeline
            .query_duration::<gst::ClockTime>()
            .map(|d| d.nseconds())
            .unwrap_or(0);
        if total == 0 {
            let _ = pipeline.set_state(gst::State::Null);
            fail("o arquivo não disse quanto dura; sem isso não dá para montar a fita".to_string());
        }

        let prefixo = args
            .thumbnail
            .clone()
            .unwrap_or_else(|| "quadro".to_string());
        let mut escritos = 0u32;

        for i in 0..quantos {
            // O quadro sai do meio da fatia, não da borda: a borda de uma
            // fatia é a mesma imagem da vizinha, e a fita sairia com pares
            // repetidos.
            let alvo_ns = ((i as f64 + 0.5) / quantos as f64 * total as f64) as u64;

            liberado.store(false, Ordering::Release);
            thumbnail_done.store(0, Ordering::Release);
            *alvo.lock().unwrap() = Some(format!("{prefixo}-{i}.jpg"));

            if pipeline
                .seek_simple(
                    gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                    gst::ClockTime::from_nseconds(alvo_ns),
                )
                .is_err()
            {
                eprintln!("[probe] o arquivo não aceitou busca; fita interrompida");
                break;
            }
            let _ = pipeline.state(gst::ClockTime::from_seconds(15));
            liberado.store(true, Ordering::Release);

            // Espera o quadro chegar. Quem escreve é a callback do appsink, e
            // ela avisa pelo contador -- sem isso o próximo salto derrubaria o
            // quadro atual antes de ele virar arquivo.
            let limite = std::time::Instant::now() + std::time::Duration::from_secs(15);
            while thumbnail_done.load(Ordering::Acquire) == 0 {
                if std::time::Instant::now() > limite {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            if thumbnail_done.load(Ordering::Acquire) > 0 {
                escritos += 1;
            }
        }

        liberado.store(false, Ordering::Release);
        let _ = pipeline.set_state(gst::State::Null);
        let probe = Probe {
            ok: true,
            duration_ns: total,
            video: video_info.lock().unwrap().take(),
            audio: None,
            audio_tracks: std::mem::take(&mut *audio_tracks.lock().unwrap()),
            // Aqui a miniatura não é um arquivo só, então o campo diz quantos
            // quadros saíram -- é o que o servidor precisa saber.
            thumbnail: Some(format!("{escritos}")),
        };
        println!("{}", serde_json::to_string(&probe)?);
        return Ok(());
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
        let reading = args
            .measure
            .then(|| guard.as_mut().map(|meter| meter.read()))
            .flatten();
        AudioInfo {
            rate,
            channels,
            integrated_lufs: reading.as_ref().map(|value| value.integrated_lufs),
            lra: reading.as_ref().map(|value| value.range_lu),
            true_peak_dbtp: reading.as_ref().map(|value| value.true_peak_dbtp),
        }
    });

    let probe = Probe {
        ok: true,
        duration_ns,
        video: video_info.lock().unwrap().take(),
        audio,
        audio_tracks: std::mem::take(&mut *audio_tracks.lock().unwrap()),
        thumbnail: args
            .thumbnail
            .filter(|_| thumbnail_done.load(Ordering::Relaxed) > 0),
    };
    println!("{}", serde_json::to_string(&probe)?);
    Ok(())
}

/// Idioma declarado da trilha, quando o arquivo diz.
///
/// A tag chega como evento pegajoso no pad, então dá para ler sem decodificar
/// nada. Arquivo que não declara idioma é a maioria -- daí `Option`, e não uma
/// string vazia que a interface teria de adivinhar o que significa.
fn language_of(pad: &gst::Pad) -> Option<String> {
    let mut index = 0;
    while let Some(event) = pad.sticky_event::<gst::event::Tag>(index) {
        if let Some(language) = event.tag().get::<gst::tags::LanguageCode>() {
            return Some(language.get().to_string());
        }
        index += 1;
    }
    None
}

/// Liga o ramo de vídeo: guarda a geometria e escreve a miniatura.
fn attach_video(
    pipeline: &gst::Pipeline,
    pad: &gst::Pad,
    info: &Arc<Mutex<Option<VideoInfo>>>,
    // Destino do próximo quadro. Vazio quer dizer "não escreva nada".
    thumbnail: &Arc<Mutex<Option<String>>>,
    done: &Arc<AtomicU64>,
    // Enquanto `liberado` for falso, o quadro que chega é descartado: com
    // `--at`, o pipeline entrega o primeiro quadro do arquivo antes de o salto
    // acontecer, e capturá-lo daria sempre a mesma miniatura.
    liberado: &Arc<AtomicBool>,
    // Largura pedida na linha de comando.
    largura: i32,
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
    // Altura calculada da proporção do arquivo. Fixar só a largura deixa o
    // `videoscale` manter a altura original, e um 16:9 chega ao explorador
    // esticado -- foi o que aconteceu.
    let thumb_width = largura;
    let thumb_height = if source_width > 0 && source_height > 0 {
        let scaled = (thumb_width as i64 * source_height as i64 / source_width as i64) as i32;
        (scaled + scaled % 2).max(2)
    } else {
        thumb_width * 9 / 16
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

    // O `appsink` precisa de alguém puxando **sempre**, mesmo sem miniatura a
    // escrever: sem consumidor ele fica preso no preroll, o ramo de vídeo nunca
    // chega a PLAYING e o arquivo inteiro morre no tempo limite. Foi assim que
    // uma sonda sem `--thumbnail` passou a travar sessenta segundos.
    let target = Arc::clone(thumbnail);
    let flag = Arc::clone(done);
    let porteiro = Arc::clone(liberado);
    let app_sink = sink
        .clone()
        .dynamic_cast::<gst_app::AppSink>()
        .map_err(|_| anyhow!("appsink de vídeo não é appsink"))?;
    app_sink.set_callbacks(
        gst_app::AppSinkCallbacks::builder()
            .new_sample(move |sink| {
                let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                if !porteiro.load(Ordering::Acquire) {
                    return Ok(gst::FlowSuccess::Ok);
                }
                let destino = target.lock().unwrap().clone();
                let Some(destino) = destino else {
                    return Ok(gst::FlowSuccess::Ok);
                };
                // Só o primeiro quadro interessa; escrever a cada quadro
                // deixaria a miniatura sendo o último frame do arquivo, que
                // costuma ser preto.
                if flag
                    .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Relaxed)
                    .is_ok()
                {
                    if let Some(buffer) = sample.buffer() {
                        if let Ok(map) = buffer.map_readable() {
                            if std::fs::write(&destino, map.as_slice()).is_err() {
                                flag.store(0, Ordering::Relaxed);
                            }
                        }
                    }
                }
                Ok(gst::FlowSuccess::Ok)
            })
            .build(),
    );

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
