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
use gstreamer as gst;
use gstreamer::prelude::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::protocol::ItemSpec;

/// Para onde o programa sai. Todas as saídas penduram no mesmo par de tees,
/// então o canal codifica uma vez, não uma vez por destino.
#[derive(Debug, Clone)]
pub enum Output {
    /// Descarta, contando os frames. É o modo de teste e de canal ocioso.
    Null,
    File(String),
    Rtmp(String),
    Srt(String),
    /// Um quadro por segundo em JPEG. Serve de monitor barato e de prova de
    /// que o programa está de fato com imagem, sem depender de muxer.
    Snapshot(String),
}

impl Output {
    pub fn parse(text: &str) -> Result<Self> {
        if text == "null" {
            return Ok(Output::Null);
        }
        match text.split_once(':') {
            Some(("file", path)) => Ok(Output::File(path.to_string())),
            Some(("rtmp", _)) => Ok(Output::Rtmp(text.to_string())),
            Some(("srt", _)) => Ok(Output::Srt(text.to_string())),
            Some(("snapshot", pattern)) => Ok(Output::Snapshot(pattern.to_string())),
            _ => Err(anyhow!("saída desconhecida: {text}")),
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
    pub outputs: Vec<Output>,
}

/// Um item aberto, no seu próprio pipeline.
struct Item {
    spec: ItemSpec,
    pipeline: gst::Pipeline,
    volume: gst::Element,
    on_air: bool,
}

pub struct Channel {
    pipeline: gst::Pipeline,
    config: Config,
    video_channel: String,
    audio_channel: String,
    on_air: Option<Item>,
    armed: Option<Item>,
    frames_out: Arc<AtomicU64>,
}

fn make(factory: &str) -> Result<gst::Element> {
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

/// dB para o fator linear que o elemento `volume` espera.
fn linear_gain(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}

impl Channel {
    pub fn video_caps(&self) -> gst::Caps {
        gst::Caps::builder("video/x-raw")
            .field("format", "I420")
            .field("width", self.config.width)
            .field("height", self.config.height)
            .field(
                "framerate",
                gst::Fraction::new(self.config.fps_n, self.config.fps_d),
            )
            .build()
    }

    pub fn new(config: Config) -> Result<Self> {
        let pipeline = gst::Pipeline::with_name(&format!("canal-{}", config.channel_id));
        let video_channel = format!("{}-video", config.channel_id);
        let audio_channel = format!("{}-audio", config.channel_id);

        let video_caps = gst::Caps::builder("video/x-raw")
            .field("format", "I420")
            .field("width", config.width)
            .field("height", config.height)
            .field("framerate", gst::Fraction::new(config.fps_n, config.fps_d))
            .build();
        let audio_caps = gst::Caps::builder("audio/x-raw")
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
        let vout_caps = make("capsfilter")?;
        vout_caps.set_property("caps", &video_caps);
        let tee_video = make_named("tee", "tee-video")?;

        let aconv = make("audioconvert")?;
        let ares = make("audioresample")?;
        let aout_caps = make("capsfilter")?;
        aout_caps.set_property("caps", &audio_caps);
        let level = make_named("level", "level")?;
        level.set_property("interval", 100_000_000u64);
        level.set_property("post-messages", true);
        let tee_audio = make_named("tee", "tee-audio")?;

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
            &vout_caps,
            &tee_video,
            &aconv,
            &ares,
            &aout_caps,
            &level,
            &tee_audio,
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
        gst::Element::link_many([&compositor, &vconv, &vout_caps, &tee_video])?;
        gst::Element::link_many([&mixer, &aconv, &ares, &aout_caps, &level, &tee_audio])?;

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

        let channel = Self {
            pipeline,
            config,
            video_channel,
            audio_channel,
            on_air: None,
            armed: None,
            frames_out,
        };

        for output in channel.config.outputs.clone() {
            channel.attach_output(&output, &tee_video, &tee_audio)?;
        }

        Ok(channel)
    }

    /// Cadeia de codificação compartilhada. Um encode por perfil de saída.
    ///
    /// O formato do H.264 é do container, não do encoder: FLV quer `avc`, MPEG-TS
    /// quer `byte-stream`. Deixar a negociação adivinhar produz um fluxo que o
    /// servidor de destino recusa com "unexpected video packet" -- e como o erro
    /// sobe pelo pipeline, o canal inteiro cai junto.
    fn encode_chain(
        &self,
        stream_format: &str,
    ) -> Result<(
        gst::Element,
        gst::Element,
        gst::Element,
        gst::Element,
        gst::Element,
        gst::Element,
    )> {
        let venc = make("x264enc")?;
        venc.set_property("bitrate", self.config.bitrate_kbps);
        venc.set_property_from_str("tune", "zerolatency");
        venc.set_property_from_str("speed-preset", "veryfast");
        venc.set_property(
            "key-int-max",
            (self.config.fps_n / self.config.fps_d) as u32 * 2,
        );

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
                .field("stream-format", if stream_format == "avc" { "raw" } else { "adts" })
                .build(),
        );

        Ok((venc, vparse, vcaps, aenc, aparse, acaps))
    }

    fn attach_output(
        &self,
        output: &Output,
        tee_video: &gst::Element,
        tee_audio: &gst::Element,
    ) -> Result<()> {
        let vqueue = make("queue")?;
        let aqueue = make("queue")?;
        for queue in [&vqueue, &aqueue] {
            queue.set_property("max-size-time", 2_000_000_000u64);
            // Fila com descarte só serve para saída que pode perder frame. Num
            // muxer, o buraco vira erro de multiplexação e a gravação morre.
            if matches!(output, Output::Null | Output::Snapshot(_)) {
                queue.set_property_from_str("leaky", "downstream");
            }
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
            Output::File(path) => {
                let (venc, vparse, vcaps, aenc, aparse, acaps) = self.encode_chain("avc")?;
                let mux = make("matroskamux")?;
                let sink = make("filesink")?;
                sink.set_property("location", path);
                self.pipeline
                    .add_many([&venc, &vparse, &vcaps, &aenc, &aparse, &acaps, &mux, &sink])?;
                gst::Element::link_many([&vqueue, &venc, &vparse, &vcaps, &mux, &sink])?;
                gst::Element::link_many([&aqueue, &aenc, &aparse, &acaps])?;
                acaps.link(&mux)?;
            }
            Output::Rtmp(url) => {
                let (venc, vparse, vcaps, aenc, aparse, acaps) = self.encode_chain("avc")?;
                let mux = make("flvmux")?;
                mux.set_property("streamable", true);
                let sink = make("rtmp2sink")?;
                sink.set_property("location", url);
                self.pipeline
                    .add_many([&venc, &vparse, &vcaps, &aenc, &aparse, &acaps, &mux, &sink])?;
                gst::Element::link_many([&vqueue, &venc, &vparse, &vcaps, &mux, &sink])?;
                gst::Element::link_many([&aqueue, &aenc, &aparse, &acaps])?;
                acaps.link(&mux)?;
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
            Output::Srt(uri) => {
                let (venc, vparse, vcaps, aenc, aparse, acaps) =
                    self.encode_chain("byte-stream")?;
                let mux = make("mpegtsmux")?;
                let sink = make("srtsink")?;
                sink.set_property("uri", uri);
                self.pipeline
                    .add_many([&venc, &vparse, &vcaps, &aenc, &aparse, &acaps, &mux, &sink])?;
                gst::Element::link_many([&vqueue, &venc, &vparse, &vcaps, &mux, &sink])?;
                gst::Element::link_many([&aqueue, &aenc, &aparse, &acaps])?;
                acaps.link(&mux)?;
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

    /// Sobe o canal e só volta quando ele está de fato no ar.
    pub fn start(&self) -> Result<()> {
        self.pipeline.set_state(gst::State::Playing)?;
        let (result, _, _) = self.pipeline.state(gst::ClockTime::from_seconds(10));
        result.context("o canal não chegou a entrar em execução")?;
        Ok(())
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
        let item = self.build_item(&spec)?;

        item.pipeline.set_state(gst::State::Paused)?;
        let (result, _, _) = item.pipeline.state(gst::ClockTime::from_seconds(10));
        result.with_context(|| format!("não consegui abrir {}", spec.path))?;

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

    fn build_item(&self, spec: &ItemSpec) -> Result<Item> {
        let pipeline = gst::Pipeline::with_name(&format!("item-{}", spec.item_id));

        let src = make("uridecodebin")?;
        let uri = if spec.path.contains("://") {
            spec.path.clone()
        } else {
            gst::glib::filename_to_uri(&spec.path, None)?.to_string()
        };
        src.set_property("uri", &uri);

        let vconv = make("videoconvert")?;
        let vscale = make("videoscale")?;
        let vrate = make("videorate")?;
        let vcaps = make("capsfilter")?;
        vcaps.set_property("caps", self.video_caps());
        let vqueue = make("queue")?;
        let video_sink = make("intervideosink")?;
        video_sink.set_property("channel", &self.video_channel);

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
        audio_sink.set_property("channel", &self.audio_channel);

        pipeline.add_many([
            &src,
            &vconv,
            &vscale,
            &vrate,
            &vcaps,
            &vqueue,
            &video_sink,
            &aconv,
            &ares,
            &volume,
            &acaps,
            &aqueue,
            &audio_sink,
        ])?;
        gst::Element::link_many([&vconv, &vscale, &vrate, &vcaps, &vqueue, &video_sink])?;
        gst::Element::link_many([&aconv, &ares, &volume, &acaps, &aqueue, &audio_sink])?;

        let video_target = vconv
            .static_pad("sink")
            .ok_or_else(|| anyhow!("videoconvert sem sink"))?;
        let audio_target = aconv
            .static_pad("sink")
            .ok_or_else(|| anyhow!("audioconvert sem sink"))?;
        src.connect_pad_added(move |_, pad| {
            // Pad recém-nascido nem sempre traz caps prontas; perguntar ao pad
            // evita descartar o fluxo em silêncio e deixar o item sem áudio.
            let caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
            let Some(structure) = caps.structure(0) else {
                return;
            };
            let name = structure.name();

            let target = if name.starts_with("video/") {
                &video_target
            } else if name.starts_with("audio/") {
                &audio_target
            } else {
                return;
            };

            if target.is_linked() {
                return;
            }
            if let Err(error) = pad.link(target) {
                eprintln!("[engine] não liguei o pad {name}: {error}");
            }
        });

        Ok(Item {
            spec: spec.clone(),
            pipeline,
            volume,
            on_air: false,
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

        let item_id = item.spec.item_id.clone();
        self.on_air = Some(item);
        Ok(item_id)
    }

    pub fn stop(&mut self) -> Result<()> {
        if let Some(item) = self.on_air.take() {
            discard(item);
        }
        Ok(())
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
