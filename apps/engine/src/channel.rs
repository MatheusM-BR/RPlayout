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
//! A admissão HA é uma exceção explícita: destinos são construídos uma única
//! vez enquanto o PGM externo ainda está retido, nunca como TAKE de item.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub use crate::loudness::Reading;
use crate::limiter_element;
use crate::loudness::Meter;
use crate::output::{retain_last_video_frame, Kind, Publisher, PublisherSpec, Report};
use crate::protocol::{Fit, ItemSpec, SourceSignalReport};
use crate::live_replacement::{Journal as ReplacementJournal, Phase as ReplacementPhase, Receipt as ReplacementReceipt, Request as ReplacementRequest};

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
    /// Saída por placa SDI. `sdi:0` é o primeiro sub-dispositivo da placa.
    ///
    /// Não passa por codificador: o sinal sai cru, no formato do canal, e é a
    /// placa que faz o relógio. Por isso ela não tem bitrate nem perfil -- o
    /// que existe para escolher é qual conector.
    Sdi { device: i32 },
}

/// Perfil de uma saída codificada.
///
/// Os campos em branco herdam do canal. É o que permite `--output rtmp://...`
/// continuar valendo para teste e uso manual enquanto o servidor manda o perfil
/// inteiro em JSON.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSpec {
    /// Identidade estável do perfil no servidor. Ausente só nos atalhos CLI.
    #[serde(default)]
    pub id: Option<String>,
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
    /// Papel desta saída. "mon" marca um monitor: sob demanda e em software.
    ///
    /// Monitor não é destino -- é a janela que o operador abre no navegador.
    /// Codificar para uma janela fechada é gastar CPU do ar com nada.
    #[serde(default)]
    pub role: Option<String>,
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
                id: None,
                kind,
                target,
                width: None,
                height: None,
                rate_num: None,
                rate_den: None,
                scan: None,
                bitrate_kbps: None,
                role: None,
            })
        };

        match text.split_once(':') {
            Some(("file", path)) => Ok(shorthand(Kind::File, path.to_string())),
            Some(("rtmp", _)) => Ok(shorthand(Kind::Rtmp, text.to_string())),
            Some(("srt", _)) => Ok(shorthand(Kind::Srt, text.to_string())),
            Some(("ndi", name)) => Ok(shorthand(Kind::Ndi, format!("ndi:{name}"))),
            Some(("omt", name)) => Ok(shorthand(Kind::Omt, format!("omt:{name}"))),
            Some(("snapshot", pattern)) => Ok(Output::Snapshot(pattern.to_string())),
            Some(("sdi", index)) => Ok(Output::Sdi {
                device: index.parse().context("índice de SDI inválido")?,
            }),
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
    /// Numbered embedded channels; 2 by default, otherwise 8 or 16.
    pub audio_channels: usize,
    pub scan: Scan,
    /// Campo de cima primeiro. 1080i é TFF; só formatos SD antigos são BFF.
    pub top_field_first: bool,
    pub outputs: Vec<Output>,
    /// Para onde o preview sai. Vazio deixa o canal sem barramento de preview.
    pub preview: Option<Output>,
}

/// Um item aberto, no seu próprio pipeline.
static NEXT_DECODER_ID: AtomicU64 = AtomicU64::new(1);

struct Item {
    /// Unique opening identity, distinct from the editorial item ID.
    decoder_id: u64,
    dynamic_source: bool,
    slot: usize,
    spec: ItemSpec,
    pipeline: gst::Pipeline,
    volume: gst::Element,
    on_air: bool,
    /// Só fica pronto depois que um quadro de vídeo realmente alcançou o
    /// `intervideosink`. Para fonte ao vivo, PLAYING significa apenas que o
    /// decoder foi aberto -- não que já há imagem segura para comutar.
    video_ready: Arc<AtomicBool>,
    audio_ready:Arc<AtomicBool>,
    audio_error:Arc<std::sync::Mutex<Option<String>>>,
    video_pad_found: Arc<AtomicBool>,
    pads_complete: Arc<AtomicBool>,
    audio_tracks_seen: Arc<AtomicUsize>,
    source_statistics: Arc<std::sync::Mutex<SourceStatistics>>,
    closing: Arc<AtomicBool>,
    mounting: Arc<std::sync::Mutex<()>>,
    /// Só o item do preview tem: o programa é medido depois do mix, que é onde
    /// a medição vale. No preview não há mix, então mede-se o próprio item.
    meter_sink: Option<gst_app::AppSink>,
    /// Raw preview branch, before crop/240p scaling. Closed by default.
    qc_valve: Option<gst::Element>,
    qc_ready: Arc<AtomicBool>,
}

#[derive(Default)]
struct SourceStatistics {
    video_caps: Option<gst::Caps>,
    audio_caps: Option<gst::Caps>,
    last_video: Option<Instant>,
    last_audio: Option<Instant>,
    last_delivered_video: Option<Instant>,
    last_delivered_audio: Option<Instant>,
    frames: u64,
    jitter_ms: Option<f64>,
    content_fingerprint: Option<u64>,
    content_since: Option<Instant>,
    last_content_sample: Option<Instant>,
    content_sample_frames: u64,
}

impl Item {
    fn close(&mut self) {
        if self.closing.swap(true,Ordering::AcqRel) { return; }
        // Finish any in-flight pad assembly before NULL, but never hold this
        // lock during a state change that joins the streaming threads.
        drop(self.mounting.lock());
        if let Err(error)=self.pipeline.set_state(gst::State::Null) {
            eprintln!("[engine] item {} não encerrou limpo: {error}",self.spec.item_id);
        }
    }
    fn requires_audio(&self) -> bool {
        self.spec.audio_routing.required() || self.spec.audio_track > 0 || !self.spec.auxiliary_pairs.is_empty()
    }
    /// File preroll may remain paused indefinitely. Live readiness must age
    /// out at both the decoder and the intersink, not latch on its first frame.
    fn live_ready(&self) -> bool {
        self.spec.is_live() && self.routing_ready().unwrap_or(false)
            && self.source_statistics.lock().is_ok_and(|statistics| statistics.live_ready(
                self.video_ready.load(Ordering::Acquire), self.requires_audio(),
                self.audio_ready.load(Ordering::Acquire),
            ))
    }
    fn routing_ready(&self)->Result<bool> {
        if let Some(error)=self.audio_error.lock().map_err(|_|anyhow!("estado de áudio indisponível"))?.as_ref(){return Err(anyhow!("roteamento de áudio: {error}"));}
        Ok(!self.requires_audio() || self.audio_ready.load(Ordering::Acquire))
    }
    /// State-change acceptance is not a preroll buffer. Decoder pads can be
    /// added after the pipeline's initial state snapshot has settled.
    fn wait_for_preroll(&self, where_: &str) -> Result<()> {
        let deadline=Instant::now()+Duration::from_secs(10);
        let (result,_,_)=self.pipeline.state(gst::ClockTime::from_seconds(10));
        result.with_context(||open_failure(&self.spec,where_))?;
        loop {
            let video=self.video_ready.load(Ordering::Acquire);
            let audio=self.routing_ready()?;
            if video && audio { return Ok(()); }
            if self.pads_complete.load(Ordering::Acquire) {
                if !self.video_pad_found.load(Ordering::Acquire) {
                    return Err(anyhow!("arquivo não entregou quadro de vídeo {where_}; PGM anterior preservado"));
                }
                if !audio && self.audio_tracks_seen.load(Ordering::Acquire)<=self.spec.audio_track {
                    return Err(anyhow!("trilha/canais selecionados sem áudio {where_}; PGM anterior preservado"));
                }
            }
            if Instant::now()>=deadline {
                return Err(if !video {anyhow!("arquivo não entregou quadro de vídeo {where_}; PGM anterior preservado")}
                    else {anyhow!("trilha/canais selecionados sem áudio {where_}; PGM anterior preservado")});
            }
            if let Some(message)=self.pipeline.bus().and_then(|bus|bus.timed_pop_filtered(gst::ClockTime::from_mseconds(10),&[gst::MessageType::Error,gst::MessageType::Eos])) {
                if let gst::MessageView::Error(error)=message.view() {return Err(anyhow!("preroll recusado {where_}: {}; PGM anterior preservado",error.error()));}
                if matches!(message.view(),gst::MessageView::Eos(_)) {return Err(anyhow!("arquivo encerrou antes do quadro/áudio exigido {where_}; PGM anterior preservado"));}
            }
        }
    }
}

impl SourceStatistics {
    fn recent(last: Option<Instant>) -> bool {
        last.is_some_and(|last| last.elapsed() <= Duration::from_secs(2))
    }

    fn live_ready(&self, delivered_video: bool, requires_audio: bool, delivered_audio: bool) -> bool {
        delivered_video && Self::recent(self.last_video) && Self::recent(self.last_delivered_video)
            && (!requires_audio || delivered_audio && Self::recent(self.last_audio) && Self::recent(self.last_delivered_audio))
    }
    fn video(&mut self, pad: &gst::Pad, buffer:&gst::BufferRef) {
        if !received_video_frame(buffer) { return; }
        let now = Instant::now();
        let caps = pad.current_caps();
        if self.video_caps!=caps||self.last_video.is_some_and(|last|now.duration_since(last)>Duration::from_secs(2)){
            self.content_fingerprint=None;self.content_since=None;self.last_content_sample=None;self.content_sample_frames=0;
        }
        // Bounded sparse sample of decoded raw bytes, at most four times/s.
        // A static scene can match: this is a warning, never TAKE permission.
        if self.last_content_sample.map_or(true,|last|now.duration_since(last)>=Duration::from_millis(250)){
            let raw=caps.as_ref().and_then(|caps|caps.structure(0)).is_some_and(|s|s.name()=="video/x-raw");
            if let Some(map)=raw.then(||buffer.map_readable().ok()).flatten().filter(|map|!map.as_slice().is_empty()){
                let bytes=map.as_slice();let mut fingerprint=14695981039346656037u64;
                for index in 0..512usize{let offset=index*(bytes.len()-1)/511;fingerprint=(fingerprint^u64::from(bytes[offset])).wrapping_mul(1099511628211);}
                fingerprint^=bytes.len()as u64;
                if self.content_fingerprint!=Some(fingerprint){self.content_since=Some(now);self.content_sample_frames=0;}
                self.content_fingerprint=Some(fingerprint);self.last_content_sample=Some(now);self.content_sample_frames=self.content_sample_frames.saturating_add(1);
            }else{self.content_fingerprint=None;self.content_since=None;self.last_content_sample=None;self.content_sample_frames=0;}
        }
        if let (Some(last), Some(structure)) = (self.last_video, caps.as_ref().and_then(|caps| caps.structure(0))) {
            if let Ok(rate) = structure.get::<gst::Fraction>("framerate") {
                if rate.numer() > 0 && rate.denom() > 0 {
                    let deviation = (now.duration_since(last).as_secs_f64() * 1000.0 - 1000.0 * rate.denom() as f64 / rate.numer() as f64).abs();
                    self.jitter_ms = Some(self.jitter_ms.map_or(deviation, |old| old * 0.9 + deviation * 0.1));
                }
            }
        }
        self.video_caps = caps;
        self.last_video = Some(now);
        self.frames = self.frames.saturating_add(1);
    }

    fn report(&self, delivered_video: bool) -> SourceSignalReport {
        let video = self.video_caps.as_ref().and_then(|caps| caps.structure(0));
        let audio = self.audio_caps.as_ref().and_then(|caps| caps.structure(0));
        let rate = video.and_then(|s| s.get::<gst::Fraction>("framerate").ok());
        let video_age_ms = self.last_video.map(|last| last.elapsed().as_millis() as u64);
        let audio_age_ms = self.last_audio.map(|last| last.elapsed().as_millis() as u64);
        SourceSignalReport {
            width: video.and_then(|s| s.get::<i32>("width").ok()),
            height: video.and_then(|s| s.get::<i32>("height").ok()),
            rate_num: rate.map(|r| r.numer()).filter(|num| *num > 0),
            rate_den: rate.map(|r| r.denom()).filter(|den| *den > 0),
            interlace_mode: video.and_then(|s| s.get::<String>("interlace-mode").ok()),
            audio_channels: audio.and_then(|s| s.get::<i32>("channels").ok()),
            sample_rate: audio.and_then(|s| s.get::<i32>("rate").ok()),
            video_age_ms,
            audio_age_ms,
            video_present: self.live_ready(delivered_video, false, false),
            audio_present: Self::recent(self.last_audio) && Self::recent(self.last_delivered_audio),
            received_frames: self.frames,
            arrival_jitter_ms: self.jitter_ms,
            sampled_content_unchanged_ms:self.content_since.map(|since|since.elapsed().as_millis().min(u128::from(u64::MAX))as u64),
            content_sample_age_ms:self.last_content_sample.map(|last|last.elapsed().as_millis().min(u128::from(u64::MAX))as u64),
            content_sample_frames:self.content_sample_frames,
        }
    }
}

/// Neutral gap fillers, decode-only buffers and corrupt/empty data are not
/// proof of a received displayable frame. A real black frame and the first
/// DISCONT/RESYNC frame after reconnect are valid; this is not a black alarm.
fn received_video_frame(buffer: &gst::BufferRef) -> bool {
    buffer.size() > 0 && !buffer.flags().intersects(
        gst::BufferFlags::GAP | gst::BufferFlags::CORRUPTED | gst::BufferFlags::DECODE_ONLY
    )
}

impl Drop for Item {
    fn drop(&mut self) {
        // Inclui os retornos antecipados de load/preview por erro de seek.
        // Um pipeline recusado não pode continuar ocupando arquivo e decoder.
        self.close();
    }
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
    qc_branch: Option<(gst::Element, Vec<gst::Element>)>,
    /// Quantos quadros a imagem parada deve gerar antes de acabar. A grade é
    /// que diz quanto tempo ela fica, porque o arquivo não tem duração.
    still_frames: i32,
    /// Live demux pads can appear before fixed caps. Missing framerate is
    /// not evidence of a still image and must never insert imagefreeze live.
    allow_still: bool,
}

impl VideoChain {
    fn attach(
        self,
        pipeline: &gst::Pipeline,
        pad: &gst::Pad,
        video_ready: Arc<AtomicBool>,
        statistics: Arc<std::sync::Mutex<SourceStatistics>>,
    ) -> Result<()> {
        // Imagem parada chega com cadência 0/1: um quadro só, e o pipeline
        // acabaria antes de aparecer. O `imagefreeze` repete o quadro pelo
        // tempo que a grade marcou e então encerra sozinho, como um arquivo.
        let freeze = (self.allow_still && still_rate(pad)).then(|| make("imagefreeze")).transpose()?;
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
        if let Some((tee, branch)) = &self.qc_branch {
            pipeline.add_many(branch)?;
            gst::Element::link_many(branch)?;
            tee.link(branch.first().ok_or_else(|| anyhow!("inspeção sem destino"))?)?;
            for element in branch { element.sync_state_with_parent()?; }
        }
        for element in chain.iter() {
            element.sync_state_with_parent()?;
        }

        // `PAUSED`/`PLAYING` de uma entrada de rede só confirma que o
        // decodificador foi construído. O primeiro buffer neste sink é a
        // primeira evidência de que existe imagem que pode entrar no PGM.
        // Sem essa fronteira, TAKE comutava para uma superfície ainda preta.
        let tail = chain.last().ok_or_else(|| anyhow!("cadeia de vídeo sem destino"))?;
        tail.static_pad("sink")
            .ok_or_else(|| anyhow!("destino de vídeo sem sink"))?
            .add_probe(gst::PadProbeType::BUFFER, move |_, info| {
                if !info.buffer().is_some_and(|buffer| received_video_frame(buffer)) { return gst::PadProbeReturn::Ok; }
                if let Ok(mut statistics) = statistics.lock() { statistics.last_delivered_video = Some(Instant::now()); }
                video_ready.store(true, Ordering::Release);
                gst::PadProbeReturn::Ok
            });
        // Instalar antes de ligar o decoder: um arquivo em PAUSED pode
        // entregar seu único buffer de preroll imediatamente após pad.link.
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
    /// Each interaudio consumer needs its OWN surface: its adapter is drained
    /// on read. Share decoded buffers with tee, never one FIFO across PVW/QC.
    inspection: Vec<gst::Element>,
    tee: Option<gst::Element>,
    /// Split the decoded track BEFORE the master's mix/gain.
    raw_tee: Option<gst::Element>,
    auxiliary: Vec<gst::Element>,
    auxiliary_routing: Option<crate::audio_bus::AuxiliaryRouting>,
}

impl AudioChain {
    /// Põe a cadeia no pipeline que já está rodando e liga o pad recebido.
    fn attach(self, pipeline: &gst::Pipeline, pad: &gst::Pad,routing:crate::audio_routing::AudioRouting,ready:Arc<AtomicBool>,failure:Arc<std::sync::Mutex<Option<String>>>,statistics:Arc<std::sync::Mutex<SourceStatistics>>) -> Result<()> {
        let convert=self.main.first().ok_or_else(||anyhow!("cadeia de áudio vazia"))?.clone();
        if routing.required(){
            if let Some(caps)=pad.current_caps().filter(|caps|caps.is_fixed()){routing.configure(&convert,&caps)?;}
            let element=convert.clone();let errors=Arc::clone(&failure);let route=routing.clone();let owner=pipeline.downgrade();
            pad.add_probe(gst::PadProbeType::EVENT_DOWNSTREAM,move|_,info|{
                if let Some(gst::PadProbeData::Event(event))=info.data.as_ref(){if let gst::EventView::Caps(caps)=event.view(){
                    if let Err(error)=route.configure(&element,caps.caps()){
                        if let Ok(mut state)=errors.lock(){*state=Some(error.to_string());}
                        let message=gst::message::Error::builder(gst::StreamError::Format,&error.to_string()).src(&element).build();if let Some(owner)=owner.upgrade(){let _=owner.post_message(message);}
                        return gst::PadProbeReturn::Drop;
                    }
                }}
                gst::PadProbeReturn::Ok
            });
        }
        if let Some(route) = &self.auxiliary_routing {
            let element = self.auxiliary.get(1).ok_or_else(||anyhow!("conversor auxiliar ausente"))?.clone();
            if let Some(caps) = pad.current_caps().filter(|caps|caps.is_fixed()) { route.configure(&element, &caps)?; }
            let route=route.clone(); let errors=Arc::clone(&failure); let owner=pipeline.downgrade();
            pad.add_probe(gst::PadProbeType::EVENT_DOWNSTREAM, move |_, info| {
                if let Some(gst::PadProbeData::Event(event))=info.data.as_ref() { if let gst::EventView::Caps(caps)=event.view() {
                    if let Err(error)=route.configure(&element,caps.caps()) {
                        if let Ok(mut state)=errors.lock(){*state=Some(error.to_string());}
                        let message=gst::message::Error::builder(gst::StreamError::Format,&error.to_string()).src(&element).build(); if let Some(owner)=owner.upgrade(){let _=owner.post_message(message);}
                        return gst::PadProbeReturn::Drop;
                    }
                }}
                gst::PadProbeReturn::Ok
            });
        }
        let tail=self.main.last().ok_or_else(||anyhow!("cadeia de áudio vazia"))?;
        tail.static_pad("sink").ok_or_else(||anyhow!("sink de áudio ausente"))?.add_probe(gst::PadProbeType::BUFFER,move|_,_|{
            if let Ok(mut statistics)=statistics.lock(){statistics.last_delivered_audio=Some(Instant::now());}
            ready.store(true,Ordering::Release);gst::PadProbeReturn::Ok
        });
        let all: Vec<&gst::Element> = self.main.iter().chain(self.meter.iter()).chain(self.inspection.iter()).chain(self.raw_tee.iter()).chain(self.auxiliary.iter()).collect();
        for element in &all {
            pipeline.add(*element)?;
        }

        crate::audio_bus::link_item_audio_branches(&self.main,self.raw_tee.as_ref(),&self.auxiliary)?;
        if let Some(tee) = &self.tee {
          for branch in [&self.meter,&self.inspection] {
            if branch.is_empty(){continue;}
            gst::Element::link_many(branch.iter())?;
            let head = branch.first().ok_or_else(||anyhow!("ramo de áudio vazio"))?;
            tee.request_pad_simple("src_%u")
                .ok_or_else(|| anyhow!("tee do item recusou ramo de áudio"))?
                .link(
                    &head
                        .static_pad("sink")
                        .ok_or_else(|| anyhow!("queue de áudio sem sink"))?,
                )?;
          }
        }

        // Elementos acrescentados a um pipeline que já anda nascem parados.
        for element in &all {
            element.sync_state_with_parent()?;
        }

        let head = self.raw_tee.as_ref().or_else(||self.main.first())
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
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1920\" height=\"1080\" viewBox=\"0 0 1920 1080\" \
         preserveAspectRatio=\"none\"><g opacity=\"{opacity:.3}\">{svg}</g></svg>"
    )
}

/// Time on air belongs to the selected live occurrence, not to its sender's
/// last buffer PTS. A missing/reset sender must not freeze/rewind the rundown.
#[derive(Clone, Copy)]
struct LiveProgramClock { started: Instant, offset: i64 }
const LIVE_TAKE_DEADLINE: Duration=Duration::from_secs(10);
fn live_take_expired(started:Option<Instant>,now:Instant)->bool {
    started.is_some_and(|at|now.saturating_duration_since(at)>=LIVE_TAKE_DEADLINE)
}
impl LiveProgramClock {
    fn frames(&self, now:Instant, numerator:i32, denominator:i32)->i64 {
        let elapsed=now.saturating_duration_since(self.started).as_nanos()
            .saturating_mul(numerator.max(1) as u128)
            / (1_000_000_000u128 * denominator.max(1) as u128);
        self.offset.max(0).saturating_add(elapsed.min(i64::MAX as u128) as i64)
    }
}

pub struct Channel {
    generation_id: String,
    pipeline: gst::Pipeline,
    config: Config,
    video_channel: String,
    audio_channel: String,
    video_selector: gst::Element,
    audio_selector: gst::Element,
    program_hold_volume: gst::Element,
    program_hold_cursor: Option<i64>,
    program_hold_unconfirmed: bool,
    on_air: Option<Item>,
    armed: Option<Item>,
    /// Independent third selector slot; never steals the next item's decoder.
    live_replacement: Option<Item>,
    replacement_journal: ReplacementJournal,
    replacement_events: Vec<ReplacementReceipt>,
    replacement_selection_uncertain: bool,
    live_program_clock: Option<LiveProgramClock>,
    /// Only restart_on_air may transfer this occurrence clock to its own
    /// prepared decoder. Normal LOAD/STOP/operator replacement clears it.
    armed_live_clock: Option<(u64, LiveProgramClock)>,
    /// TAKE de fonte ao vivo aguardando o primeiro quadro. Manter a fonte
    /// anterior no seletor até este ponto é o que impede o flash preto entre
    /// NDI/SRT/RTMP e o PGM.
    pending_live_take: bool,
    pending_live_take_started: Option<Instant>,
    frames_out: Arc<AtomicU64>,
    /// Saídas de rede. Cada uma tem pipeline próprio e cai sozinha.
    publishers: Vec<Publisher>,
    program_outputs_held: bool,
    /// Conectores SDI usados como saída. Vazio quando não há nenhuma.
    sdi_devices: Vec<i32>,
    /// Barramento de preview: nomes do par `inter` e o que estiver aberto nele.
    preview_channels: Option<(String, String)>,
    /// Private HQ destination retained with PVW during restore admission.
    /// No QC publisher/surface may exist before preview is explicitly released.
    held_qc_preview: Option<Output>,
    qc_video_channel: Option<String>,
    qc_deadline: Option<Instant>,
    /// Dedicated QC decoder: QC inspects a live source without touching the
    /// Master's PVW (they used to share it and knocked each other out).
    qc_item: Option<Item>,
    qc_reopen_at: Option<Instant>,
    previewing: Option<Item>,
    /// Medidor de loudness do programa e a torneira de onde ele bebe.
    meter: Meter,
    meter_sink: gst_app::AppSink,
    /// Amostra reduzida do vídeo do PGM para detectar preto sustentado.
    video_sink: gst_app::AppSink,
    video_luma: f64,
    video_signature: Option<u64>,
    video_freeze_since: Option<Instant>,
    video_sampled_at: Option<Instant>,
    black_since: Option<Instant>,
    black_announced: bool,
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

/// A regra de comutação é deliberadamente pequena e isolada para que uma
/// alteração futura não volte a trocar para um live ainda sem frame.
fn waits_for_live_frame(is_live: bool, video_ready: bool) -> bool {
    is_live && !video_ready
}
fn free_program_slot(occupied: &[Option<usize>]) -> Option<usize> {
    (0..3).find(|slot| !occupied.contains(&Some(*slot)))
}
fn validate_program_hold(expected_item:&str,expected_decoder:u64,actual_item:&str,actual_decoder:u64,live:bool,pending_take:bool)->Result<()> {
    if expected_item!=actual_item || expected_decoder!=actual_decoder {return Err(anyhow!("PGM/geração mudou; quadro mantido recusado"));}
    if live || pending_take {return Err(anyhow!("quadro mantido exige arquivo e nenhum TAKE pendente"));}
    Ok(())
}

#[derive(Clone, Copy)]
pub struct VideoProbeReading {
    pub luma: f64,
    pub black: bool,
    pub freeze: bool,
    pub freeze_duration_ms: u64,
    pub sample_age_ms: Option<u64>,
}

pub(crate) fn make(factory: &str) -> Result<gst::Element> {
    gst::ElementFactory::make(factory)
        .build()
        .with_context(|| format!("elemento {factory} não existe nesta instalação do GStreamer"))
}

/// Inspection follows negotiated, deinterlaced source caps, not channel/PVW
/// dimensions. Square-pixel browser rendition, bounded 4K/60, never upscale.
fn inspection_profile(caps:&gst::Caps)->Result<(i32,i32,i32,i32,u32)> {
    let s=caps.structure(0).ok_or_else(||anyhow!("formato real da inspeção indisponível"))?;
    let width=s.get::<i32>("width")?;
    let height=s.get::<i32>("height")?;
    let rate=s.get::<gst::Fraction>("framerate")?;
    let par=s.get::<gst::Fraction>("pixel-aspect-ratio").unwrap_or(gst::Fraction::new(1,1));
    if !(2..=16384).contains(&width) || !(2..=16384).contains(&height) || rate.numer()<=0 || rate.denom()<=0 || par.numer()<=0 || par.denom()<=0 {
        return Err(anyhow!("geometria/cadência real da inspeção inválida"));
    }
    let display_width=width as f64 * par.numer() as f64 / par.denom() as f64;
    let scale=(3840.0/display_width).min(2160.0/height as f64).min(1.0);
    let w=((display_width*scale).floor() as i32/2*2).max(2);
    let h=((height as f64*scale).floor() as i32/2*2).max(2);
    let (n,d)=if rate.numer() as f64/rate.denom() as f64>60.0 {(60,1)} else {(rate.numer(),rate.denom())};
    let bitrate=((w as f64*h as f64*n as f64/d as f64*0.16/1000.).round() as u32).clamp(6000,50000);
    Ok((w,h,n,d,bitrate))
}

#[cfg(test)]
mod qc_profile_tests {
    use super::*;
    fn caps(w:i32,h:i32,n:i32,d:i32)->gst::Caps {gst::init().unwrap();gst::Caps::builder("video/x-raw").field("width",w).field("height",h).field("framerate",gst::Fraction::new(n,d)).build()}
    #[test] fn follows_source_without_channel_upscaling_and_preserves_fractional_rate(){
        assert_eq!(inspection_profile(&caps(1280,720,25,1)).unwrap(),(1280,720,25,1,6000));
        assert_eq!(inspection_profile(&caps(320,180,30000,1001)).unwrap(),(320,180,30000,1001,6000));
    }
    #[test] fn bounds_large_source_and_rate_not_cpu_or_bandwidth_unbounded(){
        assert_eq!(inspection_profile(&caps(7680,4320,120,1)).unwrap(),(3840,2160,60,1,50000));
        let p=inspection_profile(&caps(4096,2160,25,1)).unwrap();assert_eq!((p.0,p.1),(3840,2024));
    }
    #[test] fn refuses_unknown_geometry_or_cadence_instead_of_claiming_native_quality(){
        assert!(inspection_profile(&caps(1,720,25,1)).is_err());assert!(inspection_profile(&caps(1280,720,0,1)).is_err());
    }
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
/// A entrada de um item ao vivo.
///
/// Placa entrega vídeo e áudio por elementos separados -- são dois fluxos
/// diferentes do mesmo conector --, enquanto arquivo e rede entregam os dois
/// pelo mesmo decodificador. Quem monta o item precisa saber a diferença.
pub struct LiveInput {
    pub video: gst::Element,
    /// Fonte de áudio separada, quando existe.
    pub audio: Option<gst::Element>,
    /// Os pads aparecem depois (decodificador) ou já existem (placa)?
    ///
    /// Não é detalhe: quem tem pad estático nunca dispara `pad-added`, e uma
    /// montagem que só espera por esse sinal deixa a entrada sem imagem e sem
    /// som -- que era o que acontecia com a SDI.
    pub dynamic: bool,
}

fn decoder_allowed(klass: &str, hardware_enabled: bool) -> bool {
    hardware_enabled || !(klass.split('/').any(|part|part=="Decoder")
        && klass.split('/').any(|part|part=="Hardware"))
}

/// Do not auto-select a GPU driver inside the on-air process. Some installed
/// DXVA drivers fault during simultaneous decoder teardown/reopen. Software
/// is portable and deterministic; acceleration is an explicit qualified opt-in.
/// This is per decoder, not a mutation of registry ranks or the machine driver.
fn uri_decoder_with_policy(hardware_enabled: bool) -> Result<gst::Element> {
    let source=make("uridecodebin")?;
    let signal=gst::glib::subclass::SignalId::lookup("autoplug-select",source.type_())
        .ok_or_else(||anyhow!("uridecodebin sem contrato de seleção de decoder"))?;
    let result=gst::glib::EnumClass::with_type(signal.query().return_type().type_())
        .ok_or_else(||anyhow!("tipo de seleção de decoder indisponível"))?;
    source.connect("autoplug-select",false,move|values|{
        let allowed=values.get(3).and_then(|value|value.get::<gst::ElementFactory>().ok())
            .is_some_and(|factory|decoder_allowed(factory.klass(),hardware_enabled));
        result.to_value_by_nick(if allowed {"try"} else {"skip"})
    });
    Ok(source)
}

fn uri_decoder() -> Result<gst::Element> {
    uri_decoder_with_policy(std::env::var("RPLAYOUT_HARDWARE_DECODE").is_ok_and(|value|value=="1"))
}

fn source_for(spec: &ItemSpec) -> Result<LiveInput> {
    let Some(source) = spec.source.as_deref() else {
        let src = uri_decoder()?;
        let uri = if spec.path.contains("://") {
            spec.path.clone()
        } else {
            gst::glib::filename_to_uri(&spec.path, None)?.to_string()
        };
        src.set_property("uri", &uri);
        return Ok(LiveInput { video: src, audio: None, dynamic: true });
    };

    // Normaliza esquemas conhecidos para a forma interna do motor:
    // decklink://0 ou sdi://0 ou decklink:0 -> sdi:0
    // ndi://ESTUDIO -> ndi:ESTUDIO
    let source_norm: String;
    let source = if let Some(stripped) = source.strip_prefix("decklink://").or_else(|| source.strip_prefix("sdi://")) {
        source_norm = format!("sdi:{stripped}");
        source_norm.as_str()
    } else if let Some(stripped) = source.strip_prefix("decklink:") {
        source_norm = format!("sdi:{stripped}");
        source_norm.as_str()
    } else if let Some(stripped) = source.strip_prefix("ndi://") {
        source_norm = format!("ndi:{stripped}");
        source_norm.as_str()
    } else {
        source
    };

    // OMT é um protocolo TCP próprio, descoberto pelo nome DNS-SD. O receiver
    // entrega os quadros em um appsrc; depois daqui ele percorre a mesma cadeia
    // inter do restante do engine e nunca abre uma conexão por tela.
    if let Some(name) = source.strip_prefix("omt:") {
        let (video, audio) = crate::omt::receiver(name).context("não consegui abrir a entrada OMT")?;
        return Ok(LiveInput { video, audio: Some(audio), dynamic: false });
    }

    if source.contains("://") {
        let src = uri_decoder()?;
        src.set_property("uri", source);
        // Fonte ao vivo não pode ficar remoendo: o buffer que interessa é o
        // mínimo que segura o jitter da rede, e o resto é atraso no ar.
        let mut buffer_duration = 500_000_000i64;
        if source.starts_with("srt://") {
            if let Some(pos) = source.find("latency=") {
                let tail = &source[pos + 8..];
                let num_str: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
                if let Ok(ms) = num_str.parse::<i64>() {
                    buffer_duration = (ms * 1_000_000).max(120_000_000).min(3_000_000_000);
                }
            }
        }
        src.set_property("buffer-duration", buffer_duration);
        return Ok(LiveInput { video: src, audio: None, dynamic: true });
    }

    match source.split_once(':') {
        Some(("sdi", index)) => {
            let device = index.parse::<i32>().context("índice de SDI inválido")?;
            let src = make("decklinkvideosrc")?;
            src.set_property("device-number", device);
            // `auto` deixa a placa detectar o formato do sinal que chegou, que
            // é o que o operador espera de uma entrada.
            src.set_property_from_str("mode", "auto");

            // O áudio embutido no SDI vem por elemento próprio, no mesmo
            // dispositivo. Sem ele a entrada ao vivo entra muda -- e mudo no
            // ar é o defeito que só quem está de fone descobre.
            let capture_channels=crate::audio_bus::sdi_capture_channels(&spec.audio_routing,&spec.auxiliary_pairs)?;
            let capture=make("decklinkaudiosrc");
            if capture.is_err() && (spec.audio_routing.required() || !spec.auxiliary_pairs.is_empty() || spec.audio_track>0) {
                return Err(anyhow!("entrada SDI requer áudio para os pares selecionados, mas decklinkaudiosrc está indisponível; confira plugin/driver; PGM anterior preservado"));
            }
            let audio=capture.inspect(|audio|{
                audio.set_property("device-number",device);
                audio.set_property_from_str("channels",&capture_channels.to_string());
            }).ok();
            if audio.is_none() {
                eprintln!("[engine] sem `decklinkaudiosrc`: a entrada SDI vai entrar muda");
            }

            Ok(LiveInput { video: src, audio, dynamic: false })
        }
        Some(("ndi", name)) => {
            let src = make("ndisrc").context(
                "a entrada NDI precisa do plugin `ndisrc`, que não está nesta instalação",
            )?;
            src.set_property("ndi-name", name);
            // The bundled gst-plugin-ndi turns both connection/receive timeouts
            // into EOS and stops its receiver thread. An input selected for
            // CUE/PGM must instead stay subscribed when its sender disappears.
            // Zero disables that terminal EOS, not our independent 2s signal
            // freshness check or the bounded TAKE/preroll admission deadline.
            src.set_property("connect-timeout", 0u32);
            src.set_property("timeout", 0u32);
            // O `ndisrc` entrega um fluxo combinado; quem separa vídeo de áudio
            // é o demux, e é dele que os pads nascem.
            let demux = make("ndisrcdemux").context(
                "a entrada NDI precisa do `ndisrcdemux`, que vem no mesmo plugin",
            )?;
            Ok(LiveInput { video: src, audio: Some(demux), dynamic: true })
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
    crate::audio_bus::numbered_channels(&convert, 2)?;
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

/// Tamanho de um monitor: o do canal reduzido até caber em 240 de altura.
///
/// Monitor é janela de navegador, não saída. Manter a proporção do canal
/// importa -- monitor esticado engana quem confere enquadramento --, mas a
/// resolução não: 1080p numa janela de trezentos pixels é banda e CPU jogadas
/// fora nas duas pontas.
///
/// Largura e altura saem pares porque a subamostragem de croma do H.264 exige.
pub fn monitor_size(width: i32, height: i32) -> (i32, i32) {
    // PVW/QC é referência operacional, não saída de contribuição. A 240p
    // quatro monitores não disputam decoder, GPU e rede com o PGM.
    const TETO: i32 = 240;
    if height <= TETO || height <= 0 || width <= 0 {
        return (width - width % 2, height - height % 2);
    }
    // Para cima até o par seguinte, igual ao lado TypeScript: 1920x1080 em 240
    // de altura dá 426,66 e o valor consagrado é 428. As duas contas precisam
    // bater, porque o servidor calcula o tamanho do perfil e o engine calcula
    // as caps do preview -- divergir aqui daria escala no meio do caminho.
    let alto = height as i64;
    let escalada = ((width as i64 * TETO as i64 + alto - 1) / alto) as i32;
    (escalada + escalada % 2, TETO)
}

/// Fixa a latência de uma fonte `interaudiosrc`.
///
/// O padrão dela é 100 ms anunciados sobre um anel de um segundo. Os dois
/// números são grandes demais para playout: o primeiro vira descasamento entre
/// imagem e som, e o segundo, começando com quantidade variável de áudio
/// dentro, faz esse descasamento mudar a cada subida.
pub fn aplicar_latencia_de_audio(src: &gst::Element) {
    // Um período de áudio: menos de um terço de quadro a 29,97.
    src.set_property("latency-time", 10_000_000u64);
    // Folga contra soluço de disco, sem virar atraso perceptível.
    src.set_property("buffer-time", 200_000_000u64);
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

/// O som do monitor pode sair em Opus?
///
/// Só em MPEG-TS. O FLV do RTMP não carrega Opus, e o monitor por RTMP
/// continua saindo em AAC -- ou seja, mudo no navegador, como sempre foi.
pub(crate) fn som_de_monitor(kind: Kind) -> bool {
    kind == Kind::Srt
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
        Self::new_with_program_hold(config,false)
    }
    pub fn new_with_program_hold(config: Config,program_outputs_held:bool) -> Result<Self> {
        crate::audio_bus::validate_channels(config.audio_channels)?;
        let pipeline = gst::Pipeline::with_name(&format!("canal-{}", config.channel_id));
        let video_channel = format!("{}-video", config.channel_id);
        let audio_channel = format!("{}-audio", config.channel_id);

        let composition = match config.scan {
            Scan::Progressive => gst::Fraction::new(config.fps_n, config.fps_d),
            Scan::Interlaced => gst::Fraction::new(config.fps_n * 2, config.fps_d),
        };
        let video_caps = channel_video_caps(config.width, config.height, composition);
        let audio_caps = crate::audio_bus::caps(config.audio_channels);
        // Depois do limiter tudo anda em F32LE intercalado, que é o formato em
        // que o DSP trabalha e o que o `avenc_aac` já pede.
        let program_audio_out = crate::audio_bus::caps(config.audio_channels);

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

        // Fila antes de cada entrada de agregador.
        //
        // Sem elas o GStreamer reclamava a cada recálculo de latência:
        // "Impossible to configure latency: max 0 < min 33,366 ms. Add queues
        // or other buffering elements." O mínimo é exatamente um quadro --
        // o compositor precisa segurar um para compor --, e as fontes ao vivo
        // (`intervideosrc`, `videotestsrc is-live`) anunciam máximo zero: elas
        // não seguram nada. Agregador que não consegue configurar latência não
        // tem folga nenhuma para buffer atrasado, e quadro que chega tarde é
        // quadro descartado -- que é como a travadinha rítmica aparece.
        //
        // A fila é o que dá essa folga: ela anuncia a capacidade dela como
        // latência máxima, e aí máximo passa a ser maior que mínimo.
        let fila = |nome: &str| -> Result<gst::Element> {
            let q = make("queue")?;
            // Meio segundo de folga. Menos que isso não cobre um soluço de
            // disco; muito mais seria atraso de verdade no ar.
            q.set_property("max-size-time", 500_000_000u64);
            q.set_property("max-size-buffers", 0u32);
            q.set_property("max-size-bytes", 0u32);
            // Descarte para a frente: entrada de agregador que enche e bloqueia
            // trava o canal inteiro, e um canal parado é pior que um quadro
            // perdido.
            q.set_property_from_str("leaky", "downstream");
            q.set_property("name", nome);
            Ok(q)
        };
        let black_queue = fila("fila-fundo")?;
        let silence_queue = fila("fila-silencio")?;
        let program_video_queue = fila("fila-video")?;
        let program_audio_queue = fila("fila-audio")?;

        // Entrada do programa: o que estiver publicando neste canal `inter`.
        let program_video = make("intervideosrc")?;
        program_video.set_property("channel", format!("{video_channel}-0"));
        // Uma fonte viva pode precisar de alguns quadros para o decoder
        // entregar imagem após o TAKE; conservar o último frame evita flash
        // preto durante esse aquecimento transitório.
        retain_last_video_frame(&program_video);
        let program_video_convert = make("videoconvert")?;
        let program_video_scale = make("videoscale")?;
        let program_video_rate = make("videorate")?;
        // O relógio do canal continua entregando a cadência declarada durante
        // jitter ou troca de fonte: repetir o último frame é preferível a
        // publicar uma lacuna perceptível no PGM.
        program_video_rate.set_property("drop-only", false);
        program_video_rate.set_property("skip-to-first", false);
        let program_video_caps = make("capsfilter")?;
        program_video_caps.set_property("caps", &video_caps);

        let program_audio = make("interaudiosrc")?;
        program_audio.set_property("channel", format!("{audio_channel}-0"));
        // Latência do áudio, dita e não herdada.
        //
        // O padrão do `interaudiosrc` é 100 ms de latência anunciada e um anel
        // de um segundo. Cem milissegundos é justamente a ordem do
        // descasamento que se mede entre imagem e som -- e o anel de um
        // segundo, que começa com quantidade variável de áudio dentro, é o que
        // fazia o erro mudar a cada subida do canal em vez de ser constante.
        //
        // Dez milissegundos é um período de áudio: menos que um terço de
        // quadro, pequeno demais para se ver na tela. O anel de 200 ms
        // continua absorvendo soluço de disco sem virar atraso.
        aplicar_latencia_de_audio(&program_audio);
        let program_audio_convert = make("audioconvert")?;
        crate::audio_bus::numbered_channels(&program_audio_convert, config.audio_channels)?;
        let program_audio_resample = make("audioresample")?;
        let program_audio_caps = make("capsfilter")?;
        program_audio_caps.set_property("caps", &audio_caps);

        // Três barramentos permanentes: preparar/descartar um item nunca
        // reseta a superfície usada pelo item que está no ar.
        let video_selector = make("input-selector")?;
        let audio_selector = make("input-selector")?;
        for selector in [&video_selector, &audio_selector] {
            selector.set_property_from_str("sync-mode", "clock");
            selector.set_property("sync-streams", true);
        }
        // A alternância não deve esvaziar a superfície anterior nem aceitar
        // um buffer atrasado da fonte que acabou de sair do ar.
        video_selector.set_property("cache-buffers", true);
        video_selector.set_property("drop-backwards", true);
        let next_video = make("intervideosrc")?;
        next_video.set_property("channel", format!("{video_channel}-1"));
        retain_last_video_frame(&next_video);
        let next_audio = make("interaudiosrc")?;
        next_audio.set_property("channel", format!("{audio_channel}-1"));
        aplicar_latencia_de_audio(&next_audio);
        // Both slots always use the house numbered format, including empty
        // silence. Do not let an inactive source negotiate default S16/stereo
        // through the selector and change the shared bus on its next TAKE.
        let slot_audio_caps=make("capsfilter")?;
        slot_audio_caps.set_property("caps",&audio_caps);
        let next_audio_caps=make("capsfilter")?;
        next_audio_caps.set_property("caps",&audio_caps);
        pipeline.add_many([&video_selector, &audio_selector, &next_video, &next_audio, &slot_audio_caps, &next_audio_caps])?;

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
        crate::audio_bus::numbered_channels(&aconv, config.audio_channels)?;
        let ares = make("audioresample")?;
        let aout_caps = make("capsfilter")?;
        aout_caps.set_property("caps", &program_audio_out);

        // Rede de proteção da saída, não ferramenta de mixagem: quem põe o
        // programa no alvo é o nivelamento por item. Se este elemento estiver
        // trabalhando o tempo todo, o problema está no nivelamento -- e é por
        // isso que a redução de ganho aparece no medidor.
        let limiter = make_named(limiter_element::FACTORY, "limiter")?;
        let program_hold_volume=make_named("volume","program-hold-volume")?;
        limiter.set_property("ceiling-dbtp", config.ceiling_dbtp);
        limiter.set_property("pair-linked", config.audio_channels > 2);

        let tee_audio = make_named("tee", "tee-audio")?;

        // Ramo de medição: o mix cru sai por aqui e a conta de loudness é
        // feita em Rust. O `level` do GStreamer entrega RMS, e RMS não é
        // loudness -- sem ponderação K e sem gate, dois programas com o mesmo
        // RMS soam com volumes diferentes.
        let (meter_queue, meter_convert, meter_caps, meter_sink) = meter_branch()?;
        let detector_queue = fila("fila-black-detector")?;
        let detector_scale = make("videoscale")?;
        let detector_convert = make("videoconvert")?;
        let detector_caps = make("capsfilter")?;
        detector_caps.set_property("caps", gst::Caps::builder("video/x-raw")
            .field("format", "RGB").field("width", 160i32).field("height", 90i32).build());
        let detector_sink = make("appsink")?;
        detector_sink.set_property("sync", false);
        detector_sink.set_property("max-buffers", 2u32);
        detector_sink.set_property("drop", true);

        pipeline.add_many([
            &black,
            &black_caps,
            &black_queue,
            &program_video_queue,
            &program_audio_queue,
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
            &program_hold_volume,
            &tee_audio,
            &meter_queue,
            &meter_convert,
            &meter_caps,
            &meter_sink,
            &detector_queue,
            &detector_scale,
            &detector_convert,
            &detector_caps,
            &detector_sink,
        ])?;
        if config.audio_channels == 2 { pipeline.add_many([&silence, &silence_caps, &silence_queue, &mixer])?; }

        gst::Element::link_many([&black, &black_caps, &black_queue])?;
        if config.audio_channels == 2 { gst::Element::link_many([&silence, &silence_caps, &silence_queue]).context("silêncio do barramento")?; }
        gst::Element::link_many([
            &program_video,
            &video_selector,
            &program_video_convert,
            &program_video_scale,
            &program_video_rate,
            &program_video_caps,
            &program_video_queue,
        ])?;
        gst::Element::link_many([
            &program_audio,
            &slot_audio_caps,
            &audio_selector,
            &program_audio_convert,
            &program_audio_resample,
            &program_audio_caps,
            &program_audio_queue,
        ])?;
        next_video.link(&video_selector)?;
        gst::Element::link_many([&next_audio,&next_audio_caps,&audio_selector])?;
        // Reserved capacity for same-occurrence live replacement, not a third
        // editorial item. Keep house audio caps even while this slot is idle.
        let replacement_video = make("intervideosrc")?;
        replacement_video.set_property("channel", format!("{video_channel}-2"));
        retain_last_video_frame(&replacement_video);
        let replacement_audio = make("interaudiosrc")?;
        replacement_audio.set_property("channel", format!("{audio_channel}-2"));
        aplicar_latencia_de_audio(&replacement_audio);
        let replacement_audio_caps = make("capsfilter")?;
        replacement_audio_caps.set_property("caps", &audio_caps);
        pipeline.add_many([&replacement_video, &replacement_audio, &replacement_audio_caps])?;
        replacement_video.link(&video_selector)?;
        gst::Element::link_many([&replacement_audio, &replacement_audio_caps, &audio_selector])?;
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
        // interaudiosrc already supplies correctly sized silence when empty.
        // Numbered buses need no second, independently timed silence producer.
        let bus_input=if config.audio_channels==2 {&mixer} else {&program_audio_queue};
        gst::Element::link_many([bus_input, &aconv, &ares, &aout_caps, &limiter, &program_hold_volume, &tee_audio]).context("mix de saída do barramento")?;
        gst::Element::link_many([&meter_queue, &meter_convert, &meter_caps, &meter_sink])?;
        tee_audio
            .request_pad_simple("src_%u")
            .ok_or_else(|| anyhow!("tee de áudio recusou o medidor"))?
            .link(
                &meter_queue
                    .static_pad("sink")
                        .ok_or_else(|| anyhow!("queue do medidor sem sink"))?,
            ).context("entrada do medidor master")?;
        gst::Element::link_many([&detector_queue, &detector_scale, &detector_convert, &detector_caps, &detector_sink])?;
        tee_video
            .request_pad_simple("src_%u")
            .ok_or_else(|| anyhow!("tee de vídeo recusou o detector de preto"))?
            .link(&detector_queue.static_pad("sink").ok_or_else(|| anyhow!("fila do detector sem sink"))?)?;

        let background_pad = compositor
            .request_pad_simple("sink_%u")
            .ok_or_else(|| anyhow!("compositor recusou o pad do fundo"))?;
        background_pad.set_property("zorder", 0u32);
        black_queue
            .static_pad("src")
            .ok_or_else(|| anyhow!("fila do fundo sem src"))?
            .link(&background_pad)?;

        let program_pad = compositor
            .request_pad_simple("sink_%u")
            .ok_or_else(|| anyhow!("compositor recusou o pad do programa"))?;
        program_pad.set_property("zorder", 1u32);
        program_video_queue
            .static_pad("src")
            .ok_or_else(|| anyhow!("fila do programa sem src"))?
            .link(&program_pad)?;

        if config.audio_channels == 2 {
        let silence_pad = mixer
            .request_pad_simple("sink_%u")
            .ok_or_else(|| anyhow!("audiomixer recusou o pad do silêncio"))?;
        silence_queue
            .static_pad("src")
            .ok_or_else(|| anyhow!("fila do silêncio sem src"))?
            .link(&silence_pad)?;

        let program_audio_pad = mixer
            .request_pad_simple("sink_%u")
            .ok_or_else(|| anyhow!("audiomixer recusou o áudio do programa"))?;
        program_audio_queue
            .static_pad("src")
            .ok_or_else(|| anyhow!("fila do áudio do programa sem src"))?
            .link(&program_audio_pad)?;
        }

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
            generation_id: gst::glib::uuid_string_random().to_string(),
            pipeline,
            config,
            video_channel,
            audio_channel,
            video_selector,
            audio_selector,
            program_hold_volume,
            program_hold_cursor:None,
            program_hold_unconfirmed:false,
            on_air: None,
            armed: None,
            live_replacement: None,
            replacement_journal: ReplacementJournal::default(),
            replacement_events: Vec::new(),
            replacement_selection_uncertain: false,
            pending_live_take: false,
            pending_live_take_started: None,
            live_program_clock: None,
            armed_live_clock: None,
            frames_out,
            publishers: Vec::new(),
            program_outputs_held,
            sdi_devices: Vec::new(),
            preview_channels: None,
            held_qc_preview: None,
            qc_video_channel: None,
            qc_deadline: None,
            qc_item: None,
            qc_reopen_at: None,
            previewing: None,
            meter: Meter::new(48_000, 2),
            meter_sink: meter_sink
                .dynamic_cast::<gst_app::AppSink>()
                .map_err(|_| anyhow!("appsink do medidor não é appsink"))?,
            video_sink: detector_sink
                .dynamic_cast::<gst_app::AppSink>()
                .map_err(|_| anyhow!("appsink do detector não é appsink"))?,
            video_luma: 255.0,
            video_signature: None,
            video_freeze_since: None,
            video_sampled_at: None,
            black_since: None,
            black_announced: false,
            preview_meter: Meter::new(48_000, 2),
            limiter,
            graphics,
            gfx: Graphic::default(),
            meter_scratch: Vec::with_capacity(16_384),
        };

        if program_outputs_held { channel.attach_output(0,&Output::Null,&tee_video,&tee_audio)?; }
        else { for (index, output) in channel.config.outputs.clone().iter().enumerate() { channel.attach_output(index, output, &tee_video, &tee_audio)?; } }

        if let Some(output) = channel.config.preview.clone().filter(|_| !program_outputs_held) {
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
            // Este é o último ponto ainda dentro do PGM. `leaky=downstream`
            // descartava quadros aqui antes de chegarem ao inter, criando uma
            // cadência quebrada que nenhuma configuração do encoder consegue
            // reparar. O publisher já vive em pipeline separado, portanto a
            // sua lentidão não deve causar descarte neste ponto.
            queue.set_property_from_str("leaky", "no");
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
            Output::Sdi { device } => {
                self.attach_sdi(*device, &vqueue, &aqueue)?;
                self.sdi_devices.push(*device);
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

    /// Saída por placa SDI.
    ///
    /// Ao contrário das saídas de rede, esta fica **dentro** do pipeline do
    /// canal: não há codificador, não há muxer e não há reconexão -- o sinal
    /// sai cru e quem faz o relógio é a placa. Pôr isso num pipeline à parte
    /// só acrescentaria uma travessia de `inter` entre o compositor e o
    /// conector, com o jitter que vem junto.
    ///
    /// Vídeo e áudio vão para o mesmo `device-number`: é assim que a placa
    /// entende que são o mesmo sinal e embute o áudio no SDI. Numa Duo 2 os
    /// quatro conectores são sub-dispositivos 0 a 3, e cada um precisa estar
    /// configurado como saída no Desktop Video -- a placa é meio-duplex, e um
    /// conector configurado como entrada não vira saída por software.
    fn attach_sdi(
        &mut self,
        device: i32,
        vqueue: &gst::Element,
        aqueue: &gst::Element,
    ) -> Result<()> {
        let modo = crate::output::decklink_mode(
            self.config.width,
            self.config.height,
            self.config.fps_n,
            self.config.fps_d,
            self.config.scan == Scan::Interlaced,
        )
        .ok_or_else(|| {
            anyhow!(
                "a placa não tem modo para {}x{} a {}/{}{}: escolha um formato de canal que \
                 a SDI aceite",
                self.config.width,
                self.config.height,
                self.config.fps_n,
                self.config.fps_d,
                if self.config.scan == Scan::Interlaced {
                    " entrelaçado"
                } else {
                    ""
                }
            )
        })?;

        let vconv = make("videoconvert")?;
        // A placa quer UYVY ou v210; UYVY é 8 bits e é o que todo modo aceita.
        let vcaps = make("capsfilter")?;
        vcaps.set_property(
            "caps",
            gst::Caps::builder("video/x-raw")
                .field("format", "UYVY")
                .build(),
        );
        let vsink = make("decklinkvideosink").context(
            "a saída por SDI precisa do plugin `decklinkvideosink`, que não está nesta \
             instalação do GStreamer",
        )?;
        vsink.set_property("device-number", device);
        vsink.set_property_from_str("mode", modo);
        // Sem isto o sink recusa o primeiro buffer que chega adiantado, e a
        // saída fica esperando um relógio que nunca combina.
        vsink.set_property("sync", true);

        let aconv = make("audioconvert")?;
        let ares = make("audioresample")?;
        let acaps = make("capsfilter")?;
        crate::audio_bus::numbered_channels(&aconv, self.config.audio_channels)?;
        // Numbered 48 kHz channels, 32-bit integer accepted by the DeckLink
        // plugin. Retain auxiliary positions instead of speaker downmixing.
        let mut sdi_caps = crate::audio_bus::caps(self.config.audio_channels);
        sdi_caps.make_mut().structure_mut(0).ok_or_else(||anyhow!("caps SDI ausentes"))?.set("format", "S32LE");
        acaps.set_property("caps", sdi_caps);
        let asink = make("decklinkaudiosink").context(
            "a saída por SDI precisa do plugin `decklinkaudiosink`, que não está nesta \
             instalação do GStreamer",
        )?;
        asink.set_property("device-number", device);
        asink.set_property("sync", true);

        self.pipeline
            .add_many([&vconv, &vcaps, &vsink, &aconv, &ares, &acaps, &asink])?;
        gst::Element::link_many([vqueue, &vconv, &vcaps, &vsink])?;
        gst::Element::link_many([aqueue, &aconv, &ares, &acaps, &asink])?;

        eprintln!("[engine] saída SDI no dispositivo {device}, modo {modo}");
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
            output_id: spec.id.clone().unwrap_or_else(|| format!("slot-{index}")),
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
            // O programa é o que vai ao ar: se há placa, é dele. Monitor sai
            // em software para não gastar sessão de placa, que é contada.
            prefer_software: spec.role.as_deref() == Some("mon"),
            // A primeira saída é o programa; as outras são destinos extras --
            // menos o monitor, que se identifica no perfil.
            role: spec.role.clone().unwrap_or_else(|| {
                if index == 0 {
                    "pgm".to_string()
                } else {
                    format!("saida{index}")
                }
            }),
            // Saída de verdade sobe junto com o canal e fica: quem publica
            // para o mundo não pode depender de alguém estar olhando. Monitor
            // é o contrário: só existe enquanto alguém olha.
            on_demand: spec.role.as_deref() == Some("mon"),
            // Só o monitor troca de codec de áudio: quem vai para o mundo sai
            // em AAC, que é o que destino de RTMP e de SRT espera receber.
            // Todo fluxo SRT gerenciado pelo MediaMTX precisa de Opus para
            // WHEP; RTMP continua em AAC para destinos externos.
            opus: spec.kind == Kind::Srt && spec.role.as_deref() == Some("mon"),
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

        // Monitor não passa de 240p, e o bitrate acompanha.
        //
        // Quem olha o preview está numa janela de trezentos pixels dentro de
        // um navegador: 1080p ali é banda e CPU jogadas fora nas duas pontas
        // -- e com quatro canais abertos era o navegador que engasgava,
        // decodificando quatro fluxos grandes ao mesmo tempo.
        let (width, height) = monitor_size(self.config.width, self.config.height);
        self.publishers.push(Publisher::new(PublisherSpec {
            output_id: spec.id.clone().unwrap_or_else(|| "preview".to_string()),
            kind: spec.kind,
            url: spec.target.clone(),
            video_channel: video_channel.clone(),
            audio_channel: audio_channel.clone(),
            width: width - width % 2,
            height: height - height % 2,
            fps_n: self.config.fps_n,
            fps_d: self.config.fps_d,
            // 240p tem 1/20 dos pixels de 1080p. O teto evita que um perfil
            // de programa muito alto transforme monitor em segunda saída.
            bitrate_kbps: (self.config.bitrate_kbps / 16).clamp(180, 450),
            // Monitor é sempre progressivo: quem olha o preview está num
            // navegador, não num monitor de referência.
            interlaced: false,
            top_field_first: self.config.top_field_first,
            // O preview sai pequeno e não gasta sessão de placa: com quatro
            // canais no ar, é a diferença entre caber e não caber.
            prefer_software: true,
            role: "pvw".to_string(),
            // Só existe enquanto alguém está com a janela aberta.
            on_demand: true,
            // Quem olha isto é um navegador, e navegador não fala AAC.
            opus: som_de_monitor(spec.kind),
        }));

        self.preview_channels = Some((video_channel, audio_channel));
        Ok(())
    }
    /// Owning server only, after program admission. Destination is frozen in
    /// private startup data, never supplied by a later browser command.
    pub fn release_preview_output(&mut self)->Result<()> {
        if self.program_outputs_held || self.preview_channels.is_some() { return Err(anyhow!("Preview não está retido após admissão de PGM.")); }
        let output=self.config.preview.clone().ok_or_else(||anyhow!("Nenhum destino local de preview configurado."))?;
        self.attach_preview(&output)?;
        if let Some(qc)=self.held_qc_preview.take() { self.attach_qc_preview(&qc)?; }
        Ok(())
    }

    /// Caps do preview: mesma cadência do canal, tamanho de monitor.
    fn preview_caps(&self) -> gst::Caps {
        let (width, height) = monitor_size(self.config.width, self.config.height);
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
        self.invalidate_live_replacement();
        // The QC decoder is independent: a Master CUE no longer closes it.
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
            self.build_item(&spec, &video_channel, &audio_channel, &self.preview_caps(), true, false)?;
        item.pipeline
            .set_state(gst::State::Paused)
            .with_context(|| open_failure(&spec, " no preview"))?;
        // Fonte viva pode ficar em ASYNC até chegar seu primeiro quadro. Não
        // espere esse quadro na thread de comandos: uma NDI/SRT sem sinal não
        // pode bloquear todos os previews seguintes nem o TAKE.
        if !spec.is_live() {
            let (result, _, _) = item.pipeline.state(gst::ClockTime::from_seconds(10));
            result.with_context(|| open_failure(&spec, " no preview"))?;
        }

        if !spec.is_live() { item.pipeline
            .seek(
                1.0,
                gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                gst::SeekType::Set,
                self.frame_to_time(spec.start_frame()),
                gst::SeekType::Set,
                self.frame_to_time(spec.trim_out),
            )
            .context("o preview não aceitou o ponto de entrada")?; }

        item.pipeline.set_state(gst::State::Playing)?;
        item.on_air = true;
        self.previewing = Some(item);
        Ok(())
    }

    /// Bus do que está no preview, para captar fim e erro sem confundir com o ar.
    pub fn preview_bus(&self) -> Option<gst::Bus> {
        self.previewing.as_ref().and_then(|item| item.pipeline.bus())
    }

    #[cfg(test)]
    pub fn preview_decoder_diagnostic(&self) -> Vec<String> {
        self.previewing.as_ref().map(|item| item.pipeline.children().iter().map(|element| {
            let queue = if element.factory().is_some_and(|f| f.name()=="queue") {
                format!(" buffers={} time={}",element.property::<u32>("current-level-buffers"),element.property::<u64>("current-level-time"))
            } else { String::new() };
            format!("{} {:?}{queue}", element.name(), element.state(gst::ClockTime::ZERO))
        }).collect()).unwrap_or_default()
    }

    pub fn preview_id(&self) -> Option<String> {
        self.previewing.as_ref().map(|item| item.spec.item_id.clone())
    }

    pub fn decoder_id(&self, bus: &str) -> Option<u64> {
        match bus {
            "pgm" => self.on_air.as_ref(),
            "pvw" => self.previewing.as_ref(),
            "armed" => self.armed.as_ref(),
            _ => None,
        }.map(|item| item.decoder_id)
    }

    /// Return metadata from the decoder actually mounted on this bus, never
    /// from a pending command or the mutable server-side catalog.
    pub fn configured_source_id(&self, bus: &str) -> Option<String> {
        match bus {
            "pgm" => self.on_air.as_ref(),
            "pvw" => self.previewing.as_ref(),
            _ => None,
        }.and_then(|item| if item.spec.is_live() { item.spec.configured_source_id.clone() } else { None })
    }

    /// Uma live no PVW só está pronta enquanto entrega quadros recentes.
    pub fn preview_live_ready(&self) -> Option<String> {
        self.previewing.as_ref().and_then(|item| {
            item.live_ready()
                .then(|| item.spec.item_id.clone())
        })
    }

    pub fn preview_live_ready_identity(&self) -> Option<(String, u64)> {
        self.previewing.as_ref().and_then(|item| item.live_ready()
            .then(|| (item.spec.item_id.clone(), item.decoder_id)))
    }

    /// Consome o áudio que chegou desde a última volta e devolve a medição.
    ///
    /// Roda no laço principal, sem thread nem trava: o `appsink` descarta
    /// quando enche, então uma volta lenta custa uma medição, nunca o programa.
    pub fn measure(&mut self) -> (Reading, Reading, VideoProbeReading) {
        let program = self.meter_sink.clone();
        drain(&program, &mut self.meter_scratch, &mut self.meter);
        while let Some(sample) = self.video_sink.try_pull_sample(gst::ClockTime::ZERO) {
            let Some(buffer) = sample.buffer() else { continue };
            let Ok(map) = buffer.map_readable() else { continue };
            let bytes = map.as_slice();
            if bytes.len() < 3 { continue }
            let mut total = 0.0;
            let mut count = 0usize;
            let mut signature = 0u64;
            for rgb in bytes.chunks_exact(3) {
                total += 0.2126 * f64::from(rgb[0]) + 0.7152 * f64::from(rgb[1]) + 0.0722 * f64::from(rgb[2]);
                signature = signature
                    .wrapping_mul(1_099_511_628_211)
                    .wrapping_add(u64::from(rgb[0]) << 16 | u64::from(rgb[1]) << 8 | u64::from(rgb[2]));
                count += 1;
            }
            if count > 0 {
                self.video_sampled_at = Some(Instant::now());
                self.video_luma = total / count as f64;
                if self.on_air.is_some() && self.video_luma > 8.0 && self.video_signature == Some(signature) {
                    self.video_freeze_since.get_or_insert_with(Instant::now);
                } else {
                    self.video_freeze_since = None;
                }
                self.video_signature = Some(signature);
            }
        }

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

        let black = self.on_air.is_some() && self.video_luma <= 8.0;
        let freeze_duration_ms = self.video_freeze_since.map(|started| started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64).unwrap_or(0);
        let freeze = freeze_duration_ms >= 2000;
        let sample_age_ms = self.video_sampled_at.map(|sampled| sampled.elapsed().as_millis().min(u128::from(u64::MAX)) as u64);
        (program, preview, VideoProbeReading { luma: self.video_luma, black, freeze, freeze_duration_ms, sample_age_ms })
    }

    /// Retorna uma transição de preto sustentado no PGM. O fundo preto sem
    /// item não é alerta: só um item efetivamente no ar pode dispará-lo.
    pub fn black_transition(&mut self) -> Option<bool> {
        if self.on_air.is_none() || self.video_luma > 8.0 {
            self.black_since = None;
            if self.black_announced {
                self.black_announced = false;
                return Some(false);
            }
            return None;
        }
        let started = *self.black_since.get_or_insert_with(Instant::now);
        if !self.black_announced && started.elapsed() >= Duration::from_secs(5) {
            self.black_announced = true;
            return Some(true);
        }
        None
    }

    /// Sobe o canal e só volta quando ele está de fato no ar.
    pub fn start(&self) -> Result<()> {
        crate::fencing::guard_pipeline(&self.pipeline)?;
        // A latência do canal não é ditada.
        //
        // Tentei fixar 100 ms e o próprio GStreamer recusou: "Configured
        // latency is lower than detected minimum latency: 0:00:00.100 <
        // 0:00:00.151". O mínimo do canal depende do que está montado nele --
        // compositor, camada de grafismo, filas -- e escrever um número abaixo
        // dele não fixa nada: só imprime aviso a cada recálculo. Quem promete
        // latência aqui é a saída, que é onde a promessa vale alguma coisa.

        // A dica vale nas duas falhas: a placa pode recusar já na mudança de
        // estado, e foi o que aconteceu -- pôr a explicação só no segundo
        // ponto deixava a mensagem útil fora justamente do caso comum.
        self.pipeline
            .set_state(gst::State::Playing)
            .with_context(|| self.porque_nao_subiu())?;
        let (result, _, _) = self.pipeline.state(gst::ClockTime::from_seconds(10));
        result.with_context(|| self.porque_nao_subiu())?;
        Ok(())
    }

    /// O que dizer quando o canal não sobe.
    fn porque_nao_subiu(&self) -> String {
        {
            // Placa é a causa mais comum, e a mais difícil de adivinhar: o
            // conector precisa estar configurado como saída no Desktop Video,
            // e numa Duo 2 eles vêm em pares meio-duplex. Sem esta dica, o que
            // sobra é "não entrou em execução" e uma tarde de procura.
            match self.sdi_devices.as_slice() {
                [] => "o canal não chegou a entrar em execução".to_string(),
                devices => format!(
                    "o canal não chegou a entrar em execução — há saída SDI configurada \
                     (conector {}). Confira no Desktop Video se ele está como saída: numa \
                     Duo 2 os conectores vêm em pares meio-duplex, e um configurado como \
                     entrada não vira saída por software",
                    devices
                        .iter()
                        .map(i32::to_string)
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            }
        }
    }

    /// Dá uma volta nas saídas de rede: colhe falha, reconecta o que caiu e
    /// devolve só o que mudou de estado.
    /// Liga ou desliga um monitor pelo nome. Devolve `false` se não existe.
    pub fn attach_qc_preview(&mut self, output: &Output) -> Result<()> {
        let Output::Encoded(spec) = output else { return Err(anyhow!("inspeção requer saída SRT")); };
        if spec.kind != Kind::Srt || self.qc_video_channel.is_some() || self.held_qc_preview.is_some() {
            return Err(anyhow!("inspeção requer uma única saída SRT"));
        }
        if self.preview_channels.is_none() && self.program_outputs_held && self.config.preview.is_some() {
            // PGM/PVW are deliberately absent while preparing a restored
            // channel. Keep only the validated private destination; create HQ
            // alongside PVW after the owning server's native admission, not at
            // bootstrap and never merely because a QC URL was supplied.
            self.held_qc_preview=Some(output.clone());
            return Ok(());
        }
        if self.preview_channels.is_none(){return Err(anyhow!("inspeção requer barramento de preview"));}
        // interaudiosrc removes samples from its surface's shared adapter.
        // Two publishers must not compete for the PVW FIFO while overlapping.
        let audio_channel=format!("{}-qc-audio",self.config.channel_id);
        let video_channel = format!("{}-qc-video", self.config.channel_id);
        let scale = (1920.0 / self.config.width as f64).min(1080.0 / self.config.height as f64).min(1.0);
        let width = ((self.config.width as f64 * scale).floor() as i32 / 2 * 2).max(2);
        let height = ((self.config.height as f64 * scale).floor() as i32 / 2 * 2).max(2);
        let (fps_n,fps_d) = if self.config.fps_n as f64 / self.config.fps_d as f64 > 30.0 {(30,1)} else {(self.config.fps_n,self.config.fps_d)};
        self.publishers.push(Publisher::new(PublisherSpec {
            output_id: "qc-inspection".into(), kind: Kind::Srt, url: spec.target.clone(),
            video_channel: video_channel.clone(), audio_channel, width, height, fps_n, fps_d,
            bitrate_kbps: 6000, interlaced: false, top_field_first: self.config.top_field_first,
            prefer_software: true, role: "qc".into(), on_demand: true, opus: true,
        }));
        self.qc_video_channel = Some(video_channel);
        Ok(())
    }

    /// Open (or close) the QC's own decoder for a live source. Its program
    /// sinks go to private, unconsumed surfaces; only the gated HQ branch is
    /// published, and only while a QC viewer holds the native lease.
    pub fn qc_source(&mut self, spec: Option<ItemSpec>) -> Result<()> {
        self.qc_deadline = None;
        for publisher in &mut self.publishers {
            if publisher.role() == "qc" { publisher.set_wanted(false); }
        }
        if let Some(previous) = self.qc_item.take() { discard(previous); }
        let Some(spec) = spec else { return Ok(()) };
        if !spec.is_live() { return Err(anyhow!("o decodificador do QC aceita somente fonte ao vivo")); }
        if self.qc_video_channel.is_none() { return Err(anyhow!("inspeção ao vivo indisponível nesta instalação")); }
        let video_channel = format!("{}-qcsrc-video", self.config.channel_id);
        let audio_channel = format!("{}-qcsrc-audio", self.config.channel_id);
        let mut item = self.build_item(&spec, &video_channel, &audio_channel, &self.preview_caps(), true, true)?;
        item.pipeline.set_state(gst::State::Paused).with_context(|| open_failure(&spec, " no QC"))?;
        item.pipeline.set_state(gst::State::Playing)?;
        item.on_air = true;
        self.qc_item = Some(item);
        Ok(())
    }

    pub fn qc_source_id(&self) -> Option<String> {
        self.qc_item.as_ref().map(|item| item.spec.item_id.clone())
    }

    pub fn qc_live_ready(&self) -> bool {
        self.qc_item.as_ref().is_some_and(Item::live_ready)
    }

    pub fn set_qc_monitor(&mut self, item_id: &str, on: bool) -> Result<()> {
        let item = self.qc_item.as_ref().filter(|item| item.spec.item_id == item_id && item.spec.is_live())
            .ok_or_else(|| anyhow!("a fonte do QC não está aberta no decodificador do QC"))?;
        let valve = item.qc_valve.as_ref().ok_or_else(|| anyhow!("inspeção ao vivo indisponível nesta instalação"))?;
        if on && !item.source_statistics.lock().map_err(|_| anyhow!("estado de sinal indisponível"))?
            .report(item.video_ready.load(Ordering::Acquire)).video_present {
            return Err(anyhow!("aguardando quadro válido da fonte no preview"));
        }
        if on {
            let caps=valve.static_pad("sink").and_then(|pad|pad.current_caps())
                .ok_or_else(|| anyhow!("formato real da inspeção ainda indisponível"))?;
            let profile=inspection_profile(&caps)?;
            for publisher in &mut self.publishers {
                if publisher.role()=="qc" && publisher.inspection_profile(profile.0,profile.1,profile.2,profile.3,profile.4)? {
                    item.qc_ready.store(false, Ordering::Release);
                }
            }
        }
        // Only an explicit request opens the raw branch. Queues are bounded
        // and leaky; encoder/network backpressure cannot reach the decoder.
        if on && self.qc_deadline.is_none() { item.qc_ready.store(false, Ordering::Release); }
        valve.set_property("drop", !on);
        self.qc_deadline = if on { Some(Instant::now() + Duration::from_secs(15)) } else { None };
        for publisher in &mut self.publishers {
            if publisher.role() == "qc" && !on { publisher.set_wanted(false); }
        }
        Ok(())
    }

    pub fn set_monitor(&mut self, bus: &str, on: bool) -> bool {
        // Generic monitor traffic must not bypass source-bound inspection.
        if bus == "qc" { return false; }
        let mut achou = false;
        for publisher in &mut self.publishers {
            if publisher.role() == bus {
                publisher.set_wanted(on);
                achou = true;
            }
        }
        achou
    }

    /// Troca somente o pipeline consumidor de uma saída codificada existente.
    /// Os canais `inter` do PGM ficam intactos, portanto não há reinício nem
    /// corte do programa. Criar/remover ramo do `tee` não é suportado aqui.
    pub fn replace_output(&mut self, output_id: &str, mut output: OutputSpec) -> Result<()> {
        if self.program_outputs_held { return Err(anyhow!("Saídas de programa retidas; hot-switch não concede admissão.")); }
        if !matches!(output.kind, Kind::Rtmp | Kind::Srt | Kind::File | Kind::Ndi | Kind::Omt) {
            return Err(anyhow!("reconfiguração ao vivo só suporta RTMP, SRT ou arquivo"));
        }
        let publisher = self.publishers.iter_mut()
            .find(|publisher| publisher.output_id() == output_id)
            .ok_or_else(|| anyhow!("não existe saída de rede com id {output_id}"))?;
        output.id = Some(output_id.to_string());
        publisher.replace(output, &self.config)
    }

    pub fn program_outputs_held(&self)->bool { self.program_outputs_held }
    /// Decoder evidence, not a cached Node position or a destination receipt.
    /// Check both before opening outputs and after potentially slow setup.
    pub fn program_admission_cursor(&self)->Result<crate::protocol::ProgramAdmissionCursor> {
        if self.program_hold_unconfirmed{return Err(anyhow!("pausa inconclusiva não autoriza admissão"));}
        if self.pending_live_take {return Err(anyhow!("TAKE live ainda pendente; admissão não confirma o PGM anterior/idle."));}
        let Some(item)=self.on_air.as_ref() else {
            return Ok(crate::protocol::ProgramAdmissionCursor {paused:false,elapsed:0,first_video_confirmed:false,trim:None});
        };
        if !item.on_air || !item.video_ready.load(Ordering::Acquire) || !item.routing_ready()? {
            return Err(anyhow!("Decoder PGM ainda sem quadro/roteamento confirmados."));
        }
        let paused=self.program_hold_cursor.is_some();
        if paused {
            let native=item.pipeline.query_position::<gst::ClockTime>().ok_or_else(||anyhow!("pausa sem posição nativa"))?;
            if item.spec.is_live()||item.pipeline.current_state()!=gst::State::Paused||!self.program_hold_volume.property::<bool>("mute")||Some(item.spec.program_frames(self.time_to_frames(native)).max(0))!=self.program_hold_cursor||!item.source_statistics.lock().is_ok_and(|state|state.last_delivered_video.is_some()){
                return Err(anyhow!("pausa/quadro/cursor/silêncio não confirmados para admissão"));
            }
        }else if item.spec.is_live() {
            if !item.live_ready() {return Err(anyhow!("Sinal live expirou durante a admissão."));}
        }else if !item.source_statistics.lock().is_ok_and(|state|SourceStatistics::recent(state.last_delivered_video)) {
            return Err(anyhow!("Decoder do VT sem quadro recente durante a admissão."));
        }
        let (id,elapsed,duration)=self.position().ok_or_else(||anyhow!("Decoder não confirmou posição nativa para admissão."))?;
        if id!=item.spec.item_id || elapsed<item.spec.start_offset_frames.max(0) || !item.spec.is_live()&&elapsed>=duration {
            return Err(anyhow!("Posição nativa diverge da retomada ou ultrapassou o corte."));
        }
        Ok(crate::protocol::ProgramAdmissionCursor {paused,elapsed,first_video_confirmed:true,
            trim:if item.spec.is_live(){None}else{Some(crate::protocol::ProgramAdmissionTrim {r#in:item.spec.trim_in,out:item.spec.trim_out})}})
    }
    /// Only called after native owner/term validation. Build no external PGM
    /// consumer while held. Any partial topology failure terminates this OWNED
    /// process rather than letting the service loop publish half a configuration.
    pub fn release_program_outputs(&mut self,item_id:Option<&str>,decoder_id:Option<u64>)->Result<()> {
        if self.on_air_id().as_deref()!=item_id || self.decoder_id("pgm")!=decoder_id { return Err(anyhow!("PGM/decoder mudaram antes da admissão.")); }
        if self.on_air.as_ref().is_some_and(|item| !item.video_ready.load(Ordering::Acquire) || item.spec.is_live() && !item.live_ready()) { return Err(anyhow!("PGM ainda sem primeiro quadro válido; saídas retidas.")); }
        if !self.program_outputs_held { return Err(anyhow!("Saídas já liberadas; admissão não será repetida.")); }
        self.program_admission_cursor()?;
        let completed=Arc::new(AtomicBool::new(false));let timer=completed.clone();
        std::thread::spawn(move||{
            let deadline=Instant::now()+std::time::Duration::from_secs(12);
            while !timer.load(Ordering::Acquire) { if Instant::now()>=deadline { std::process::exit(76); } std::thread::sleep(std::time::Duration::from_millis(25)); }
        });
        let result=(||->Result<()> {
            let mut before=Vec::new();for element in self.pipeline.iterate_elements() { before.push(element.map_err(|_|anyhow!("Inventário de saída indisponível."))?); }
            let video=self.pipeline.by_name("tee-video").ok_or_else(||anyhow!("Barramento de vídeo ausente."))?;
            let audio=self.pipeline.by_name("tee-audio").ok_or_else(||anyhow!("Barramento de áudio ausente."))?;
            for (index,output) in self.config.outputs.clone().iter().enumerate() { self.attach_output(index,output,&video,&audio)?; }
            crate::fencing::guard_pipeline(&self.pipeline)?;
            for element in self.pipeline.iterate_elements() {
                let element=element.map_err(|_|anyhow!("Saída não enumerável."))?;
                if !before.contains(&element) { element.sync_state_with_parent()?; }
            }
            self.program_outputs_held=false;Ok(())
        })();
        if result.is_err() { std::process::exit(76); }
        completed.store(true,Ordering::Release);result
    }

    /// The QC decoder has no command-loop bus reader: drain it here so state
    /// and QoS messages cannot accumulate, and reopen the same source (at
    /// most every 2 s) when it reports an error, like the live PGM recovery.
    fn service_qc_decoder(&mut self) {
        let Some(bus) = self.qc_item.as_ref().and_then(|item| item.pipeline.bus()) else { return };
        let mut failed = false;
        while let Some(message) = bus.pop() {
            if matches!(message.view(), gst::MessageView::Error(_) | gst::MessageView::Eos(_)) { failed = true; }
        }
        if !failed { return; }
        let now = Instant::now();
        if self.qc_reopen_at.is_some_and(|at| now < at) { return; }
        self.qc_reopen_at = Some(now + Duration::from_secs(2));
        let spec = self.qc_item.as_ref().map(|item| item.spec.clone());
        let monitoring = self.qc_deadline.is_some();
        if self.qc_source(spec).is_ok() && monitoring {
            eprintln!("[engine] decodificador do QC reaberto após erro da fonte");
        }
    }

    pub fn service_outputs(&mut self) -> Vec<Report> {
        self.service_qc_decoder();
        if self.qc_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            self.qc_deadline = None;
            if let Some(valve) = self.qc_item.as_ref().and_then(|item| item.qc_valve.as_ref()) { valve.set_property("drop", true); }
            for publisher in &mut self.publishers { if publisher.role() == "qc" { publisher.set_wanted(false); } }
        }
        // Do not start encoding the black default surface before the gated
        // branch has actually delivered a fresh original-size buffer.
        if self.qc_deadline.is_some() && self.qc_item.as_ref().is_some_and(|item| item.qc_ready.load(Ordering::Acquire)) {
            for publisher in &mut self.publishers { if publisher.role() == "qc" { publisher.set_wanted(true); } }
        }
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

    pub fn live_signal_reports(&self) -> Vec<(String, &'static str, SourceSignalReport)> {
        [(self.on_air.as_ref(), "pgm"), (self.previewing.as_ref(), "pvw")]
            .into_iter().filter_map(|(item, bus)| {
                let item = item.filter(|item| item.spec.is_live())?;
                let statistics = item.source_statistics.lock().ok()?;
                Some((item.spec.item_id.clone(), bus, statistics.report(item.video_ready.load(Ordering::Acquire))))
            }).collect()
    }

    /// Confirmação equivalente para a fonte que já está no PGM.
    pub fn on_air_live_ready(&self) -> Option<String> {
        self.on_air.as_ref().and_then(|item| {
            item.live_ready()
                .then(|| item.spec.item_id.clone())
        })
    }

    pub fn on_air_live_ready_identity(&self) -> Option<(String, u64)> {
        self.on_air.as_ref().and_then(|item| item.live_ready()
            .then(|| (item.spec.item_id.clone(), item.decoder_id)))
    }

    /// Reabre a fonte ao vivo que está no ar.
    ///
    /// Fonte ao vivo que cai não é fim de item: o estúdio pode voltar, e a hora
    /// de sair continua sendo a que a grade marcou. Enquanto não volta, o
    /// programa fica no preto do canal -- que é o comportamento certo, e é
    /// melhor do que pular para o item seguinte antes da hora.
    pub fn restart_on_air(&mut self) -> Result<()> {
        let clock=self.live_program_clock;
        let spec = self
            .on_air
            .as_ref()
            .map(|item| item.spec.clone())
            .ok_or_else(|| anyhow!("nada no ar para reabrir"))?;

        self.load(spec)?;
        if let (Some(clock),Some(decoder))=(clock,self.decoder_id("armed")) {
            self.armed_live_clock=Some((decoder,clock));
        }
        self.take()?;
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

    /// Never prepare on a selected surface, even after STOP or an uncertain
    /// selector rollback. A/B arithmetic is invalid once PGM can occupy slot2.
    fn unused_program_slot(&self, preserve_armed: bool) -> Result<usize> {
        let occupied = [
            self.on_air.as_ref().map(|item| item.slot),
            self.armed.as_ref().filter(|_| preserve_armed).map(|item| item.slot),
            self.video_selector.property::<Option<gst::Pad>>("active-pad")
                .and_then(|pad| pad.name().strip_prefix("sink_").and_then(|index| index.parse::<usize>().ok())),
            self.audio_selector.property::<Option<gst::Pad>>("active-pad")
                .and_then(|pad| pad.name().strip_prefix("sink_").and_then(|index| index.parse::<usize>().ok())),
        ];
        free_program_slot(&occupied)
            .ok_or_else(|| anyhow!("nenhuma superfície não selecionada disponível"))
    }

    fn replacement_context_matches(&self, request: &ReplacementRequest) -> bool {
        !self.pending_live_take && !self.program_hold_unconfirmed && !self.replacement_selection_uncertain
            && self.program_hold_cursor.is_none() && !self.program_outputs_held
            && self.pipeline.current_state() == gst::State::Playing
            && request.engine_generation == self.generation_id
            && self.live_program_clock.is_some()
            && self.on_air.as_ref().is_some_and(|item| item.spec.is_live()
                && item.spec.item_id == request.item_id && item.decoder_id == request.expected_decoder_id
                && item.spec.configured_source_id.as_deref() == Some(request.expected_source_id.as_str())
                && item.spec.source.as_deref() != Some(request.target_source.as_str()))
    }

    fn finish_live_replacement(&mut self, phase: ReplacementPhase, frames: Option<i64>) -> Result<ReplacementReceipt> {
        let receipt = self.replacement_journal.finish(phase, frames)?;
        if phase == ReplacementPhase::Uncertain {
            // Neither receipt nor queued active-pad property can establish
            // which surface is now selected. Retain BOTH decoder pipelines;
            // require an explicit STOP before any subsequent load/take.
            self.replacement_selection_uncertain = true;
        } else if let Some(candidate) = self.live_replacement.take() { discard(candidate); }
        self.replacement_events.push(receipt.clone());
        Ok(receipt)
    }

    fn invalidate_live_replacement(&mut self) {
        if self.replacement_journal.pending_request().is_some() {
            // The journal and candidate are owned by this command thread.
            let _ = self.finish_live_replacement(ReplacementPhase::Invalidated, None);
        }
    }

    pub fn live_replacement_events(&mut self) -> Vec<ReplacementReceipt> {
        std::mem::take(&mut self.replacement_events)
    }

    pub fn generation_id(&self) -> &str { &self.generation_id }

    pub fn live_replacement_receipt(&self, engine_generation: &str, transaction_id: &str) -> Result<ReplacementReceipt> {
        if engine_generation != self.generation_id { return Err(anyhow!("pedido pertence a outra geração do engine")); }
        self.replacement_journal.receipt(transaction_id)
    }

    pub fn program_selection_uncertain(&self) -> bool { self.replacement_selection_uncertain }

    pub fn has_pending_live_replacement(&self) -> bool { self.replacement_journal.pending_request().is_some() }

    /// PREPARE never modifies the occurrence clock, PGM, armed item or CUE.
    /// A duplicate returns its original receipt, including terminal failures.
    pub fn prepare_live_replacement(&mut self, request: ReplacementRequest) -> Result<ReplacementReceipt> {
        self.service_live_replacement();
        request.validate()?;
        if request.engine_generation != self.generation_id { return Err(anyhow!("preparação pertence a outra geração do engine")); }
        if self.replacement_journal.receipt(&request.transaction_id).is_ok() {
            return self.replacement_journal.begin(request, Instant::now()).map(|(receipt, _)| receipt);
        }
        if !self.replacement_context_matches(&request) {
            return Err(anyhow!("PGM/geração/fonte mudou ou não permite troca da mesma live"));
        }
        let slot = self.unused_program_slot(true)?;
        let mut spec = self.on_air.as_ref().ok_or_else(|| anyhow!("PGM ausente"))?.spec.clone();
        // Copy all occurrence/audio/gain/fit policy from actual PGM. The
        // request may select a source, not silently edit channel policy.
        spec.source = Some(request.target_source.clone());
        spec.configured_source_id = Some(request.target_source_id.clone());
        spec.source_type = Some(request.target_source_type.clone());
        self.replacement_journal.begin(request.clone(), Instant::now())?;
        let prepared = (|| -> Result<Item> {
            let mut item = self.build_item(&spec, &format!("{}-{slot}", self.video_channel),
                &format!("{}-{slot}", self.audio_channel), &self.video_caps(), false, false)?;
            item.slot = slot;
            if item.pipeline.set_state(gst::State::Playing).is_err() {
                discard(item);
                return Err(anyhow!("fonte alternativa não iniciou"));
            }
            Ok(item)
        })();
        match prepared {
            Ok(item) => {
                if self.replacement_journal.prepared(item.decoder_id).is_err() {
                    discard(item);
                    self.finish_live_replacement(ReplacementPhase::Failed, None)?;
                    return Err(anyhow!("identidade preparada não foi registrada"));
                }
                self.live_replacement = Some(item);
                self.service_live_replacement();
                self.replacement_journal.receipt(&request.transaction_id)
            }
            Err(_) => {
                self.finish_live_replacement(ReplacementPhase::Failed, None)?;
                // Decoder errors may include a private network URI.
                Err(anyhow!("preparação da fonte alternativa falhou; PGM e CUE preservados"))
            }
        }
    }

    /// Poll readiness/expiry only. No delayed/autonomous commit is allowed.
    pub fn service_live_replacement(&mut self) {
        let Some(request) = self.replacement_journal.pending_request().cloned() else { return; };
        let terminal = if !self.replacement_context_matches(&request) { Some(ReplacementPhase::Invalidated) }
            else if self.replacement_journal.expired(Instant::now()) { Some(ReplacementPhase::Expired) }
            else {
                self.live_replacement.as_ref().and_then(|item| {
                    let bus_fault = item.pipeline.bus().is_some_and(|bus|
                        bus.pop_filtered(&[gst::MessageType::Error, gst::MessageType::Eos]).is_some());
                    (bus_fault || item.routing_ready().is_err()
                        || item.dynamic_source && item.pads_complete.load(Ordering::Acquire)
                            && !item.video_pad_found.load(Ordering::Acquire))
                        .then_some(ReplacementPhase::Failed)
                })
            };
        if let Some(phase) = terminal {
            let _ = self.finish_live_replacement(phase, None);
        } else if let Some(receipt) = self.replacement_journal.observe_ready(
            self.live_replacement.as_ref().is_some_and(|item| item.live_ready())) {
            self.replacement_events.push(receipt);
        }
    }

    pub fn cancel_live_replacement(&mut self, engine_generation: &str, transaction_id: &str) -> Result<ReplacementReceipt> {
        self.service_live_replacement();
        let receipt = self.live_replacement_receipt(engine_generation, transaction_id)?;
        if receipt.phase.terminal() { return Ok(receipt); }
        self.finish_live_replacement(ReplacementPhase::Cancelled, None)
    }

    /// Explicit COMMIT only. A committed receipt may be replayed even after
    /// a later TAKE, but it is historical evidence, not current PGM status.
    pub fn commit_live_replacement(&mut self, engine_generation: &str, transaction_id: &str, prepared_decoder_id: u64) -> Result<ReplacementReceipt> {
        self.service_live_replacement();
        let receipt = self.live_replacement_receipt(engine_generation, transaction_id)?;
        if receipt.prepared_decoder_id != Some(prepared_decoder_id) {
            return Err(anyhow!("geração alternativa não corresponde à preparação"));
        }
        if receipt.phase.terminal() { return Ok(receipt); }
        if receipt.phase != ReplacementPhase::Ready {
            return Err(anyhow!("fonte alternativa ainda sem quadro/áudio exigido recente"));
        }
        let clock = self.live_program_clock.ok_or_else(|| anyhow!("relógio da ocorrência ausente"))?;
        let item = self.live_replacement.as_ref().ok_or_else(|| anyhow!("decoder alternativo ausente"))?;
        if item.decoder_id != prepared_decoder_id { return Err(anyhow!("decoder preparado diverge do recibo")); }
        let selectors = [&self.video_selector, &self.audio_selector];
        let [video_pad, audio_pad] = selectors.map(|selector| selector.static_pad(&format!("sink_{}", item.slot))
            .ok_or_else(|| anyhow!("superfície alternativa ausente")));
        let pads = [video_pad?, audio_pad?];
        let previous = selectors.map(|selector| selector.property::<Option<gst::Pad>>("active-pad"));
        for (selector, pad) in selectors.iter().zip(&pads) { selector.set_property("active-pad", pad); }
        let frame_ms = 1000 * self.config.fps_d.max(1) as u64 / self.config.fps_n.max(1) as u64;
        let deadline = Instant::now() + Duration::from_millis((3 * frame_ms).clamp(250, 1500));
        loop {
            let selected = selectors.iter().zip(&pads).all(|(selector, pad)|
                selector.property::<Option<gst::Pad>>("active-pad").as_ref() == Some(pad));
            if self.replacement_journal.expired(Instant::now()) || !item.live_ready() || Instant::now() >= deadline {
                for (selector, pad) in selectors.iter().zip(&previous) { selector.set_property("active-pad", pad); }
                let rollback_deadline = Instant::now() + Duration::from_millis(500);
                let rolled_back = loop {
                    if selectors.iter().zip(&previous).all(|(selector, pad)|
                        selector.property::<Option<gst::Pad>>("active-pad") == *pad) { break true; }
                    if Instant::now() >= rollback_deadline { break false; }
                    std::thread::sleep(Duration::from_millis(1));
                };
                self.finish_live_replacement(if rolled_back { ReplacementPhase::Failed } else { ReplacementPhase::Uncertain }, None)?;
                return Err(anyhow!(if rolled_back { "troca recusada; seletores retornaram ao PGM anterior" }
                    else { "seleção de PGM inconclusiva; ambos decoders mantidos, STOP explícito necessário" }));
            }
            if selected { break; }
            std::thread::sleep(Duration::from_millis(1));
        }
        let frames = clock.frames(Instant::now(), self.config.fps_n, self.config.fps_d);
        // Journal transition is validated before releasing the old decoder.
        let receipt = self.replacement_journal.finish(ReplacementPhase::Committed, Some(frames))?;
        let mut candidate = self.live_replacement.take().expect("candidate confirmed on command thread");
        candidate.on_air = true;
        if let Some(previous) = self.on_air.replace(candidate) { discard(previous); }
        // Do not reset meter, live_program_clock, CUE/QC, armed or gain/mute.
        self.replacement_events.push(receipt.clone());
        Ok(receipt)
    }

    /// Files preroll at their entry point; live receivers keep consuming now.
    ///
    /// Enquanto está armado, publica num canal `inter` que ninguém escuta --
    /// é isso que o mantém pronto sem aparecer no programa.
    pub fn load(&mut self, spec: ItemSpec) -> Result<()> {
        if self.replacement_selection_uncertain { return Err(anyhow!("troca inconclusiva exige STOP antes de LOAD")); }
        spec.audio_routing.validate()?;
        crate::audio_bus::validate_pairs(&spec.auxiliary_pairs, self.config.audio_channels)?;
        self.invalidate_live_replacement();
        self.armed_live_clock=None;
        self.pending_live_take = false;
        self.pending_live_take_started=None;
        if let Some(previous) = self.armed.take() {
            discard(previous);
        }

        // STOP leaves the permanent selector on its last slot. A logical empty
        // PGM does not make that slot inactive: preroll there would flash during
        // LOAD/seek before TAKE. Prepare on the opposite selected surface.
        let slot = self.unused_program_slot(false)?;
        let mut item = self.build_item(
            &spec,
            &format!("{}-{slot}", self.video_channel),
            &format!("{}-{slot}", self.audio_channel),
            &self.video_caps(),
            false,
            false,
        )?;
        item.slot = slot;

        // A paused appsrc receiver can accumulate old network frames. On TAKE
        // those frames would acquire a fresh delivery time and incorrectly
        // authorize a source that disappeared while armed. Keep live ingest
        // flowing on its unselected inter slot; this never switches PGM.
        item.pipeline
            .set_state(if spec.is_live() { gst::State::Playing } else { gst::State::Paused })
            .with_context(|| open_failure(&spec, ""))?;

        // Item ao vivo não tem ponto de entrada nem de saída: ele já está
        // acontecendo. Quem decide quando ele sai é a grade. Não há preroll
        // obrigatório para uma fonte viva: aguardar sinal aqui por até dez
        // segundos trava a fila de Preview/TAKE quando o sinal está ausente.
        if spec.is_live() {
            self.armed = Some(item);
            return Ok(());
        }

        let prepared = (|| -> Result<()> {
            item.wait_for_preroll("no preroll")?;

            // Um quadro antes do seek não comprova o Mark In escolhido.
            item.video_ready.store(false, Ordering::Release);
            item.audio_ready.store(false,Ordering::Release);
            item.pipeline
                .seek(
                    1.0,
                    gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                    gst::SeekType::Set,
                    self.frame_to_time(spec.start_frame()),
                    gst::SeekType::Set,
                    self.frame_to_time(spec.trim_out),
                )
                .context("o item não aceitou o ponto de entrada")?;

            item.wait_for_preroll("no ponto de entrada")?;
            Ok(())
        })();
        if let Err(error) = prepared {
            discard(item);
            return Err(error);
        }

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
        qc_tap: bool,
    ) -> Result<Item> {
        spec.audio_routing.validate()?;
        crate::audio_bus::validate_pairs(&spec.auxiliary_pairs, self.config.audio_channels)?;
        let pipeline = gst::Pipeline::with_name(&format!("item-{}", spec.item_id));

        let src = source_for(spec)?;

        let vconv = make("videoconvert")?;
        // Fonte entrelaçada vira progressiva aqui. O compositor não trabalha em
        // campos -- e sem compositor não há grafismo nem escala --, então o
        // caminho é desentrelaçar na entrada e entrelaçar de novo na saída que
        // pedir. Em `auto` o elemento deixa material progressivo passar.
        let vdeint = make("deinterlace")?;
        vdeint.set_property_from_str("mode", "auto");
        let _ = vdeint.set_property_from_str("method", "yadif");
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
        vrate.set_property("drop-only", false);
        vrate.set_property("skip-to-first", true);
        let vcaps = make("capsfilter")?;
        vcaps.set_property("caps", caps);
        let vqueue = make("queue")?;
        let video_sink = make("intervideosink")?;
        video_sink.set_property("channel", video_channel);
        if spec.is_live() {
            // Dynamic live branches join an already PLAYING pipeline. Do not
            // re-enter global preroll while the demux still owes the other
            // pad its first buffer. TAKE remains gated by real delivered data.
            video_sink.set_property("async", false);
        }

        let crate::audio_bus::ItemAudioBranches{mut main,volume,raw_tee,auxiliary,auxiliary_routing}=crate::audio_bus::item_audio_branches(self.config.audio_channels,linear_gain(spec.gain_db),&spec.auxiliary_pairs)?;
        let aqueue = make("queue")?;
        let audio_sink = make("interaudiosink")?;
        audio_sink.set_property("channel", audio_channel);
        if spec.is_live() { audio_sink.set_property("async", false); }

        pipeline.add(&src.video)?;
        if let Some(extra) = src.audio.as_ref() {
            pipeline.add(extra)?;
            // No NDI o segundo elemento é o demux, e ele vem depois da fonte.
            // Na placa é uma segunda fonte, que não se liga a nada.
            if src.dynamic {
                gst::Element::link(&src.video, extra)?;
            }
        }

        // A combined live demux emits audio/video on the same streaming thread.
        // Isolate BEFORE conversion/rate/preroll: a tail queue cannot prevent
        // upstream processing from blocking the next pad's first buffer.
        let mut video_elements = vec![vqueue, vconv, vdeint];
        let qc_ready = Arc::new(AtomicBool::new(false));
        let (qc_branch, qc_valve) = if qc_tap && spec.is_live() {
            if let Some(channel) = &self.qc_video_channel {
                let tee = make("tee")?;
                let main_queue = make("queue")?;
                let queue = make("queue")?;
                queue.set_property_from_str("leaky", "downstream");
                queue.set_property("max-size-buffers", 2u32);
                queue.set_property("max-size-bytes", 0u32);
                queue.set_property("max-size-time", 0u64);
                let valve = make("valve")?;
                valve.set_property("drop", true);
                valve.set_property_from_str("drop-mode", "transform-to-gap");
                let sink = make("intervideosink")?;
                sink.set_property("channel", channel);
                sink.set_property("async", false);
                sink.set_property("sync", false);
                let delivered = Arc::clone(&qc_ready);
                sink.static_pad("sink").ok_or_else(|| anyhow!("inspeção sem sink"))?
                    .add_probe(gst::PadProbeType::BUFFER, move |_, info| {
                        if info.buffer().is_some_and(|buffer| received_video_frame(buffer)) { delivered.store(true, Ordering::Release); }
                        gst::PadProbeReturn::Ok
                    });
                video_elements.extend([tee.clone(), main_queue]);
                (Some((tee, vec![queue, valve.clone(), sink])), Some(valve))
            } else { (None, None) }
        } else { (None, None) };
        if let Some(crop) = vcrop {
            video_elements.push(crop);
        }
        video_elements.extend([vscale, vrate, vcaps, video_sink]);
        let qc_audio_enabled=qc_branch.is_some();
        let video = VideoChain {
            elements: video_elements,
            qc_branch,
            allow_still: !spec.is_live(),
            still_frames: still_frames(
                spec.trim_out - spec.trim_in,
                (self.config.fps_n, self.config.fps_d),
                caps,
            ),
        };

        // O áudio do item sai do `acaps` já nivelado. Sem medição, vai direto
        // para o `inter`; com medição, um `tee` abre a segunda saída.
        let (meter, tee, meter_sink) = if metered {
            let tee = make("tee")?;
            let (queue, convert, caps_filter, sink) = meter_branch()?;
            let appsink = sink
                .clone()
                .dynamic_cast::<gst_app::AppSink>()
                .map_err(|_| anyhow!("appsink do medidor não é appsink"))?;
            (
                vec![queue, convert, caps_filter, sink],
                Some(tee),
                Some(appsink),
            )
        } else {
            (
                Vec::new(),
                None,
                None,
            )
        };
        if let Some(tee) = &tee { main.push(tee.clone()); }
        main.extend([aqueue, audio_sink]);
        let inspection=if qc_audio_enabled{
            let queue=make("queue")?;
            // Preserve every PCM sample. A leaky queue ahead of a clocked
            // audio sink discards future buffers when file/live decoding runs
            // ahead; unlike video, dropping these blocks creates audible gaps.
            queue.set_property("max-size-buffers",16u32);
            queue.set_property("max-size-bytes",0u32);
            queue.set_property("max-size-time",200_000_000u64);
            let sink=make("interaudiosink")?;
            sink.set_property("channel",format!("{}-qc-audio",self.config.channel_id));
            sink.set_property("async",false);
            vec![queue,sink]
        }else{Vec::new()};
        let chain = AudioChain { main, meter, inspection, tee, raw_tee, auxiliary, auxiliary_routing };

        // O vídeo só entra no pipeline se o arquivo tiver vídeo.
        let pending_video = std::sync::Mutex::new(Some(video));
        let video_ready = Arc::new(AtomicBool::new(false));
        let audio_ready=Arc::new(AtomicBool::new(false));
        let audio_error=Arc::new(std::sync::Mutex::new(None));
        let ready_audio=Arc::clone(&audio_ready);let error_audio=Arc::clone(&audio_error);
        let audio_routing=spec.audio_routing.clone();
        let source_statistics = Arc::new(std::sync::Mutex::new(SourceStatistics::default()));
        let statistics_for_pads = Arc::clone(&source_statistics);
        let inspect_live = spec.is_live();
        let ready_for_chain = Arc::clone(&video_ready);
        let video_pad_found = Arc::new(AtomicBool::new(false));
        let video_found_for_pads=Arc::clone(&video_pad_found);
        let pads_complete=Arc::new(AtomicBool::new(!src.dynamic));
        let item_owner = pipeline.downgrade();
        let closing=Arc::new(AtomicBool::new(false));
        let mounting=Arc::new(std::sync::Mutex::new(()));
        let closing_for_pads=Arc::clone(&closing);
        let mounting_for_pads=Arc::clone(&mounting);
        // O áudio só entra no pipeline se o arquivo tiver áudio.
        //
        // Montar a cadeia de áudio à toa parece inofensivo e não é: o sink
        // fica esperando um fluxo que nunca chega, o pipeline não chega a
        // PAUSED e o item nunca carrega. Vinheta muda, slate e exportação de
        // grafismo são material corriqueiro -- e antes disto nenhum deles
        // entrava no ar. Sem áudio, quem segura o canal é o silêncio do
        // `interaudiosrc`, que já existe.
        let pending = std::sync::Mutex::new(Some(chain));
        let seen_audio = Arc::new(AtomicUsize::new(0));
        let audio_tracks_seen=Arc::clone(&seen_audio);
        let wanted_track = spec.audio_track;
        // Quem entrega os pads: o demux quando existe, senão a própria fonte.
        let porta = src.audio.clone().filter(|_| src.dynamic).unwrap_or_else(|| src.video.clone());
        if src.dynamic {let complete=Arc::clone(&pads_complete);porta.connect_no_more_pads(move |_|complete.store(true,Ordering::Release));}
        // A montagem é compartilhada entre os dois caminhos -- o pad que
        // aparece depois e o que já existe --, e por isso mora num `Arc`.
        let montar: Arc<dyn Fn(&gst::Pad, Option<&str>) + Send + Sync> = Arc::new(move |pad: &gst::Pad, static_kind: Option<&str>| {
            let Ok(_mounting)=mounting_for_pads.lock() else {return;};
            if closing_for_pads.load(Ordering::Acquire) {return;}
            let Some(owner)=item_owner.upgrade() else {return;};
            // Pad recém-nascido nem sempre traz caps prontas; perguntar ao pad
            // evita descartar o fluxo em silêncio e deixar o item sem áudio.
            let caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
            // OMT appsrc has no negotiated caps before its first received
            // frame. Static video/audio ports already declare their role in
            // Source; connect their chains now without inventing dimensions
            // or pushing placeholder caps. Otherwise the first frame reaches
            // an unlinked appsrc and reception terminates with NotLinked.
            let name = static_kind.or_else(|| caps.structure(0).map(|structure| structure.name().as_str()));
            let Some(name) = name else { return; };

            if name.starts_with("video/") {
                // Só a primeira trilha de vídeo: arquivo com duas é raro e
                // compor as duas não é o que ninguém espera.
                let Ok(mut slot) = pending_video.lock() else {
                    return;
                };
                let Some(chain) = slot.take() else {
                    return;
                };
                video_found_for_pads.store(true,Ordering::Release);
                if inspect_live {
                    let statistics = Arc::clone(&statistics_for_pads);
                    pad.add_probe(gst::PadProbeType::BUFFER, move |pad, data| {
                        if let Some(buffer)=data.buffer(){if let Ok(mut statistics) = statistics.lock() { statistics.video(pad,buffer); }}
                        gst::PadProbeReturn::Ok
                    });
                }
                if let Err(error) = chain.attach(&owner, pad, Arc::clone(&ready_for_chain), Arc::clone(&statistics_for_pads)) {
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
            if inspect_live {
                let statistics = Arc::clone(&statistics_for_pads);
                pad.add_probe(gst::PadProbeType::BUFFER, move |pad, _| {
                    if let Ok(mut statistics) = statistics.lock() {
                        statistics.audio_caps = pad.current_caps();
                        statistics.last_audio = Some(Instant::now());
                    }
                    gst::PadProbeReturn::Ok
                });
            }
            if let Err(error) = chain.attach(&owner, pad,audio_routing.clone(),Arc::clone(&ready_audio),Arc::clone(&error_audio),Arc::clone(&statistics_for_pads)) {
                if let Ok(mut failure)=error_audio.lock(){*failure=Some(error.to_string());}
                eprintln!("[engine] não montei o áudio do item: {error}");
            }
        });

        let dinamico = Arc::clone(&montar);
        porta.connect_pad_added(move |_, pad| dinamico(pad, None));

        // Fonte de pad estático nunca dispara `pad-added`: a placa entrega o
        // pad já pronto, e uma montagem que só espera pelo sinal deixava a
        // entrada SDI sem imagem e sem som. Aqui os pads que já existem são
        // montados na hora.
        if !src.dynamic {
            for (elemento,kind) in [(Some(&src.video),"video/x-raw"),(src.audio.as_ref(),"audio/x-raw")].into_iter().filter_map(|(element,kind)|element.map(|element|(element,kind))) {
                if let Some(pad) = elemento.static_pad("src") {
                    montar(&pad,Some(kind));
                }
            }
        }

        Ok(Item {
            decoder_id: NEXT_DECODER_ID.fetch_update(Ordering::Relaxed, Ordering::Relaxed,
                |value| value.checked_add(1)).map_err(|_| anyhow!("identidades de decoder esgotadas"))?,
            dynamic_source: src.dynamic,
            slot: 0,
            spec: spec.clone(),
            pipeline,
            volume,
            on_air: false,
            video_ready,
            audio_ready,
            audio_error,
            video_pad_found,
            pads_complete,
            audio_tracks_seen,
            source_statistics,
            closing,
            mounting,
            meter_sink,
            qc_valve,
            qc_ready,
        })
    }

    /// Efetiva uma comutação já pronta. O pipeline do novo item já está em
    /// PLAYING quando a fonte é ao vivo; para arquivo ele é iniciado aqui.
    fn activate_armed(&mut self, start_pipeline: bool) -> Result<String> {
        self.activate_armed_with_audio(start_pipeline,true)
    }

    fn activate_armed_with_audio(&mut self,start_pipeline:bool,unmute:bool)->Result<String>{
        if self.armed.as_ref().is_some_and(|item| item.spec.is_live() && !item.live_ready()) {
            return Err(anyhow!("fonte ao vivo sem quadro/áudio exigido recente; PGM anterior preservado"));
        }
        if self.program_hold_unconfirmed{return Err(anyhow!("PGM inconclusivo: confirme/libere explicitamente antes de trocar o item"));}
        // A confirmed frozen program remains valid PGM. Explicit TAKE may
        // replace it, but must not release/play that previous decoder merely
        // to prepare another source. Keep its cursor/audio mute through every
        // failure and clear hold only AFTER both selectors confirm the cut.
        if self.program_hold_cursor.is_some() && self.armed.as_ref().is_some_and(|item|!item.spec.is_live()&&!item.video_ready.load(Ordering::Acquire)){
            return Err(anyhow!("arquivo ainda sem quadro preparado; PGM mantido preservado"));
        }
        let item = self.armed.as_ref()
            .ok_or_else(|| anyhow!("nada armado para entrar no ar"))?;
        if start_pipeline {
            item.pipeline.set_state(gst::State::Playing)?;
        }
        let selectors=[&self.video_selector,&self.audio_selector];
        let pads=selectors.map(|selector|selector.static_pad(&format!("sink_{}",item.slot))
            .ok_or_else(||anyhow!("barramento preparado não existe")));
        let [video_pad,audio_pad]=pads;
        let pads=[video_pad?,audio_pad?];
        let previous=selectors.map(|selector|selector.property::<Option<gst::Pad>>("active-pad"));
        for (selector,pad) in selectors.iter().zip(&pads) {
            selector.set_property("active-pad", &pad);
        }
        // Newer input-selector versions queue active-pad and commit on a
        // streaming event/buffer. Property acceptance is not a completed TAKE.
        // Keep the previous decoder alive until BOTH buses confirm the switch.
        if self.pipeline.current_state()==gst::State::Playing {
            let frame_ms=(1000*self.config.fps_d as u64)/self.config.fps_n.max(1) as u64;
            let deadline=Instant::now()+Duration::from_millis((3*frame_ms).clamp(250,1500));
            loop {
                let selected=selectors.iter().zip(&pads).all(|(selector,pad)|selector.property::<Option<gst::Pad>>("active-pad").as_ref()==Some(pad));
                if selected && (!item.spec.is_live() || item.live_ready()) {break;}
                if Instant::now()>=deadline {
                    for (selector,pad) in selectors.iter().zip(&previous) {selector.set_property("active-pad",pad);}
                    return Err(anyhow!("seletores de vídeo/áudio não confirmaram TAKE; PGM anterior preservado"));
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        let mut item=self.armed.take().expect("item armado confirmado");
        if let Some(previous) = self.on_air.take() {
            discard(previous);
        }
        item.on_air = true;

        // Item novo no ar, medida nova: a integrada do item anterior não diz
        // nada sobre este.
        self.meter.reset();

        let item_id = item.spec.item_id.clone();
        self.live_program_clock=if item.spec.is_live() {
            Some(self.armed_live_clock.take().filter(|(decoder,_)|*decoder==item.decoder_id)
                .map(|(_,clock)|clock).unwrap_or(LiveProgramClock{started:Instant::now(),offset:item.spec.start_offset_frames}))
        }else{self.armed_live_clock=None;None};
        self.on_air = Some(item);
        self.program_hold_cursor=None;
        self.program_hold_unconfirmed=false;
        self.program_hold_volume.set_property("mute",!unmute);
        Ok(item_id)
    }

    /// Fresh/idle channel only. Decoder stays PAUSED through selector activation.
    /// Not admitted for automatic server recovery until target pixels are verified.
    pub(crate) fn restore_program_hold(&mut self,spec:ItemSpec)->Result<i64>{
        if self.on_air.is_some()||self.armed.is_some()||self.pending_live_take||self.program_hold_unconfirmed||self.program_hold_cursor.is_some(){return Err(anyhow!("restauração pausada exige PGM vazio e nenhuma preparação pendente"));}
        if spec.is_live()||spec.trim_in<0||spec.trim_out<=spec.trim_in||spec.start_offset_frames<0||spec.start_offset_frames>=spec.trim_out-spec.trim_in{return Err(anyhow!("restauração pausada exige corte de arquivo e cursor dentro do corte"));}
        let expected=spec.start_offset_frames;
        self.program_hold_volume.set_property("mute",true);
        self.load(spec)?;
        let prepared=(||->Result<i64>{
        let item=self.armed.as_ref().ok_or_else(||anyhow!("decoder pausado não preparado"))?;
        let (result,state,_)=item.pipeline.state(gst::ClockTime::from_seconds(3));
        result.context("decoder restaurado não confirmou pausa")?;
        if state!=gst::State::Paused||!item.video_ready.load(Ordering::Acquire)||!item.routing_ready()?{return Err(anyhow!("decoder restaurado sem pausa/quadro/áudio preparados"));}
        let position=item.pipeline.query_position::<gst::ClockTime>().ok_or_else(||anyhow!("cursor restaurado indisponível"))?;
        let frame=item.spec.program_frames(self.time_to_frames(position)).max(0);
        if frame!=expected{return Err(anyhow!("cursor pausado restaurado diverge: {frame}, esperado {expected}"));}
        self.program_hold_volume.set_property("mute",true);
        self.activate_armed_with_audio(false,false)?;
        self.program_hold_cursor=Some(frame);
        Ok(frame)
        })();
        if prepared.is_err(){if let Some(item)=self.armed.take(){discard(item);}}
        prepared
    }

    /// Coloca no ar o item armado sem trocar o PGM por uma fonte que ainda
    /// não produziu imagem. Para live, o TAKE inicia o decoder e fica armado;
    /// `service_pending_take` efetiva a troca no primeiro buffer válido.
    pub fn take(&mut self) -> Result<String> {
        if self.replacement_selection_uncertain { return Err(anyhow!("troca inconclusiva exige STOP antes de TAKE")); }
        self.invalidate_live_replacement();
        if self.program_hold_unconfirmed{return Err(anyhow!("PGM inconclusivo: confirme/libere explicitamente antes de TAKE"));}
        if let Some(item)=self.armed.as_ref(){if !item.routing_ready()? && !item.spec.is_live(){return Err(anyhow!("roteamento sem áudio preparado; PGM anterior preservado"));}}
        let live_needing_frame = self.armed.as_ref().is_some_and(|item| {
            waits_for_live_frame(item.spec.is_live(), item.live_ready())
        });
        if live_needing_frame {
            let item = self.armed.as_ref().expect("item armado foi verificado");
            item.pipeline.set_state(gst::State::Playing)?;
            self.pending_live_take = true;
            self.pending_live_take_started.get_or_insert_with(Instant::now);
            return Ok(item.spec.item_id.clone());
        }
        self.pending_live_take = false;
        self.pending_live_take_started=None;
        self.activate_armed(true)
    }

    /// Desiste de um TAKE ao vivo que ainda não confirmou vídeo.
    ///
    /// Selecionar outra fonte no PVW precisa vencer a que está sem sinal;
    /// caso contrário ela poderia completar o preroll e cortar o PGM depois.
    pub fn cancel_pending_take(&mut self) {
        self.invalidate_live_replacement();
        self.armed_live_clock=None;
        self.pending_live_take_started=None;
        if !self.pending_live_take {
            return;
        }
        self.pending_live_take = false;
        if let Some(item) = self.armed.take() {
            discard(item);
        }
    }

    /// Deve ser chamado pelo laço do engine. Não bloqueia esperando rede: só
    /// comuta depois que o pad de vídeo confirmou o primeiro frame válido.
    pub fn service_pending_take(&mut self) -> Result<Option<String>> {
        if !self.pending_live_take {
            return Ok(None);
        }
        // Subscription lifetime is not command lifetime. Check the absolute
        // TAKE deadline BEFORE readiness: a late frame cannot resurrect intent.
        if live_take_expired(self.pending_live_take_started,Instant::now()) {
            self.pending_live_take=false;
            self.pending_live_take_started=None;
            self.armed_live_clock=None;
            if let Some(item)=self.armed.take(){discard(item);}
            return Err(anyhow!("entrada não confirmou quadro/áudio exigido em 10 segundos; TAKE cancelado; PGM anterior preservado"));
        }
        // Decoder failures before first video belong to the pending item, not
        // the PGM bus. Waiting forever hides a known failure from the operator.
        let source_fault = self.armed.as_ref().and_then(|item| {
            if let Some(message)=item.pipeline.bus().and_then(|bus|bus.pop_filtered(&[gst::MessageType::Error,gst::MessageType::Eos])) {
                return match message.view() {
                    gst::MessageView::Error(error)=>Some(format!("decoder da entrada recusou o sinal: {}",error.error())),
                    gst::MessageView::Eos(_)=>Some("entrada encerrou antes de confirmar vídeo para TAKE".into()),
                    _=>None,
                };
            }
            (item.dynamic_source && item.pads_complete.load(Ordering::Acquire) && !item.video_pad_found.load(Ordering::Acquire))
                .then(|| "entrada aberta não contém vídeo para TAKE".into())
        });
        if let Some(reason)=source_fault {
            self.pending_live_take=false;
            self.pending_live_take_started=None;
            self.armed_live_clock=None;
            if let Some(failed)=self.armed.take(){discard(failed);}
            return Err(anyhow!("{reason}; PGM anterior preservado"));
        }
        if let Some(item)=self.armed.as_ref(){if let Err(error)=item.routing_ready(){
            self.pending_live_take=false;
            self.pending_live_take_started=None;
            self.armed_live_clock=None;
            if let Some(failed)=self.armed.take(){discard(failed);}
            return Err(error);
        }}
        let ready = self.armed.as_ref()
            .is_some_and(|item| item.live_ready());
        if !ready {
            return Ok(None);
        }
        self.pending_live_take = false;
        self.pending_live_take_started=None;
        self.activate_armed(false).map(Some)
    }

    pub fn stop(&mut self) -> Result<()> {
        self.invalidate_live_replacement();
        if let Some(candidate) = self.live_replacement.take() { discard(candidate); }
        self.replacement_selection_uncertain = false;
        self.live_program_clock=None;
        self.armed_live_clock=None;
        self.program_hold_cursor=None;
        self.program_hold_unconfirmed=false;
        self.pending_live_take = false;
        self.pending_live_take_started=None;
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
        self.invalidate_live_replacement();
        let item = self
            .on_air
            .as_mut()
            .ok_or_else(|| anyhow!("nada no ar para nivelar"))?;
        item.volume.set_property("volume", linear_gain(gain_db));
        item.spec.gain_db = gain_db;
        Ok(())
    }

    /// Move o arquivo do programa ou do preview sem reconstruir o pipeline.
    pub fn seek(&mut self, bus: &str, frames: i64) -> Result<()> {
        if bus=="pgm" && (self.program_hold_cursor.is_some() || self.program_hold_unconfirmed){return Err(anyhow!("PGM mantido ou inconclusivo não permite seek implícito"));}
        let fps_n = self.config.fps_n as u128;
        let fps_d = self.config.fps_d as u128;
        let item = match bus {
            "pgm" => self.on_air.as_mut(),
            "pvw" => self.previewing.as_mut(),
            _ => return Err(anyhow!("barramento de seek desconhecido: {bus}")),
        }
        .ok_or_else(|| anyhow!("nada aberto em {bus} para posicionar"))?;
        if item.spec.is_live() {
            return Err(anyhow!("fonte ao vivo não permite seek"));
        }
        let duration = (item.spec.trim_out - item.spec.trim_in).max(0);
        let relative = frames.clamp(0, duration);
        let absolute = item.spec.trim_in + relative;
        let nanos = absolute as u128 * 1_000_000_000u128 * fps_d / fps_n;
        item.pipeline
            .seek_simple(
                gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                gst::ClockTime::from_nseconds(nanos as u64),
            )
            .with_context(|| format!("{bus} não aceitou o seek"))?;
        Ok(())
    }

    /// Posição do item no ar, em frames desde o ponto de entrada.
    pub fn position(&self) -> Option<(String, i64, i64)> {
        if self.program_hold_unconfirmed{return None;}
        let item = self.on_air.as_ref()?;
        if !item.on_air {
            return None;
        }
        if let Some(frames)=self.program_hold_cursor{return Some((item.spec.item_id.clone(),frames,item.spec.trim_out-item.spec.trim_in));}
        if item.spec.is_live() {
            let clock=self.live_program_clock.as_ref()?;
            return Some((item.spec.item_id.clone(),clock.frames(Instant::now(),self.config.fps_n,self.config.fps_d),item.spec.trim_out-item.spec.trim_in));
        }
        let position = item.pipeline.query_position::<gst::ClockTime>()?;
        let frames = item.spec.program_frames(self.time_to_frames(position));
        let duration = item.spec.trim_out - item.spec.trim_in;
        Some((item.spec.item_id.clone(), frames.max(0), duration))
    }

    /// Native control foundation; not exposed by server UI or restored admission yet.
    /// A decoder generation binding prevents an old request holding a new PGM.
    pub(crate) fn set_program_hold(&mut self,item_id:&str,decoder_id:u64,on:bool)->Result<i64>{
        let item=self.on_air.as_ref().ok_or_else(||anyhow!("nada no PGM para manter"))?;
        validate_program_hold(item_id,decoder_id,&item.spec.item_id,item.decoder_id,item.spec.is_live(),self.pending_live_take)?;
        let cursor=if self.program_hold_unconfirmed{
            let position=item.pipeline.query_position::<gst::ClockTime>().ok_or_else(||anyhow!("cursor nativo indisponível; áudio permanece silenciado"))?;
            item.spec.program_frames(self.time_to_frames(position)).max(0)
        }else{self.position().ok_or_else(||anyhow!("cursor nativo indisponível"))?.1};
        if on && cursor>=item.spec.trim_out-item.spec.trim_in-1{return Err(anyhow!("item no fim; quadro mantido recusado"));}
        if !self.program_hold_unconfirmed && on==self.program_hold_cursor.is_some(){return Ok(cursor);}
        self.program_hold_volume.set_property("mute",true);
        // Any failed transition remains explicitly uncertain, never a confirmed cursor.
        self.program_hold_unconfirmed=true;
        item.pipeline.set_state(if on{gst::State::Paused}else{gst::State::Playing})?;
        let (result,state,_)=item.pipeline.state(gst::ClockTime::from_seconds(3));
        result.context("estado do decoder não confirmado para quadro mantido")?;
        if state!=if on{gst::State::Paused}else{gst::State::Playing}{return Err(anyhow!("estado do decoder inconclusivo; áudio permanece silenciado"));}
        if on{
            let position=item.pipeline.query_position::<gst::ClockTime>().ok_or_else(||anyhow!("posição pausada não confirmada"))?;
            let frame=item.spec.program_frames(self.time_to_frames(position)).max(0);
            self.program_hold_cursor=Some(frame);
            self.program_hold_unconfirmed=false;
            Ok(frame)
        }else{
            self.program_hold_cursor=None;self.program_hold_unconfirmed=false;self.program_hold_volume.set_property("mute",false);Ok(cursor)
        }
    }

    pub(crate) fn program_hold_state(&self)->Option<crate::protocol::ProgramHoldState>{
        let item=self.on_air.as_ref()?;
        Some(crate::protocol::ProgramHoldState{item_id:item.spec.item_id.clone(),decoder_id:item.decoder_id,
            status:if self.program_hold_unconfirmed{"UNCONFIRMED"}else if self.program_hold_cursor.is_some(){"HELD"}else{"RUNNING"},
            frames:if self.program_hold_unconfirmed{None}else{self.program_hold_cursor}})
    }

    pub fn preview_position(&self) -> Option<(String, i64, i64)> {
        let item = self.previewing.as_ref()?;
        if item.spec.is_live() {
            return None;
        }
        let position = item.pipeline.query_position::<gst::ClockTime>()?;
        let frames = self.time_to_frames(position) - item.spec.trim_in;
        let duration = item.spec.trim_out - item.spec.trim_in;
        Some((item.spec.item_id.clone(), frames.max(0), duration))
    }

    /// Decoder delivery, not publisher connection or command acceptance.
    /// A paused file's preroll remains intentionally inspectable; age is
    /// reported separately and is never relabelled as a recent live frame.
    pub fn preview_frame_observation(&self) -> Option<(String,u64,bool,Option<u64>,bool)> {
        let item=self.previewing.as_ref()?;
        let statistics=item.source_statistics.lock().ok()?;
        let delivered=statistics.last_delivered_video;
        Some((item.spec.item_id.clone(),item.decoder_id,
            item.video_ready.load(Ordering::Acquire)&&delivered.is_some(),
            delivered.map(|last|last.elapsed().as_millis().min(u128::from(u64::MAX))as u64),
            !item.spec.is_live()&&item.pipeline.current_state()==gst::State::Paused))
    }

    /// Encerra o canal fechando os arquivos que estiver gravando.
    ///
    /// Ir direto para NULL deixa o container sem índice e a gravação as-run
    /// inútil justamente no dia em que alguém precisar dela.
    pub fn shutdown(&mut self) {
        self.invalidate_live_replacement();
        if let Some(candidate) = self.live_replacement.take() { discard(candidate); }
        if let Some(item) = self.previewing.take() {
            discard(item);
        }
        if let Some(item) = self.qc_item.take() {
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

#[cfg(test)]
mod tests_take_live {
    use super::{waits_for_live_frame,validate_program_hold,LiveProgramClock,live_take_expired,free_program_slot};
    use std::time::{Instant,Duration};

    #[test]
    fn third_slot_keeps_preloaded_item_and_selected_surfaces_independent() {
        for program in 0..3 { for armed in 0..3 {
            if program == armed { continue; }
            let slot = free_program_slot(&[Some(program), Some(armed), Some(program)]).unwrap();
            assert_ne!(slot, program); assert_ne!(slot, armed);
        } }
        assert_eq!(free_program_slot(&[Some(0), Some(1), Some(2)]), None);
        assert_eq!(free_program_slot(&[Some(2)]), Some(0));
    }

    #[test]
    fn live_take_deadline_is_absolute_and_monotonic(){
        let now=Instant::now();
        assert!(!live_take_expired(None,now));
        assert!(!live_take_expired(Some(now),now+Duration::from_millis(9999)));
        assert!(live_take_expired(Some(now),now+Duration::from_secs(10)));
        assert!(!live_take_expired(Some(now),now-Duration::from_millis(1)));
    }

    #[test]
    fn live_program_clock_is_monotonic_rational_and_offset_bounded(){
        let now=Instant::now();
        let clock=LiveProgramClock{started:now,offset:84};
        assert_eq!(clock.frames(now,25,1),84);
        assert_eq!(clock.frames(now+Duration::from_secs(3),25,1),159);
        assert_eq!(clock.frames(now+Duration::from_millis(1001),30000,1001),114);
        assert_eq!(clock.frames(now-Duration::from_millis(1),25,1),84);
        assert_eq!(LiveProgramClock{started:now,offset:i64::MAX}.frames(now+Duration::from_secs(1),25,1),i64::MAX);
        assert_eq!(LiveProgramClock{started:now,offset:-1}.frames(now,25,1),0);
    }

    #[test]
    fn take_live_nao_comuta_antes_do_primeiro_frame() {
        assert!(waits_for_live_frame(true, false));
    }
    #[test]
    fn program_hold_requires_current_file_decoder_and_no_pending_take(){
        assert!(validate_program_hold("vt",7,"vt",7,false,false).is_ok());
        assert!(validate_program_hold("vt",7,"next",7,false,false).is_err());
        assert!(validate_program_hold("vt",7,"vt",8,false,false).is_err());
        assert!(validate_program_hold("vt",7,"vt",7,true,false).is_err());
        assert!(validate_program_hold("vt",7,"vt",7,false,true).is_err());
    }

    #[test]
    fn take_live_comuta_assim_que_houver_frame_e_arquivo_nao_espera() {
        assert!(!waits_for_live_frame(true, true));
        assert!(!waits_for_live_frame(false, false));
    }
}

#[cfg(test)]
mod file_preroll_tests {
    use super::*;

    #[test]
    fn program_hold_native_cursor_output_and_silence() {
        verify_program_hold_native(2);
    }

    #[test]
    fn program_hold_native_sixteen_channels_including_auxiliary_pair() {
        verify_program_hold_native(16);
    }

    fn verify_program_hold_native(channels:usize) {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none(){crate::limiter_element::register().unwrap();}
        let unique=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let directory=FixtureDirectory(std::env::temp_dir().join(format!("rplayout-hold-{}-{unique}",std::process::id())));
        std::fs::create_dir(&directory.0).unwrap();
        let file=directory.0.join("hold.mkv");
        let location=serde_json::to_string(&file.to_string_lossy().replace('\\',"/")).unwrap();
        let producer=gst::parse::launch(&format!("matroskamux name=m ! filesink location={location} videotestsrc pattern=ball num-buffers=250 ! video/x-raw,width=160,height=90,framerate=25/1 ! videoconvert ! vp8enc deadline=1 ! queue ! m.video_0 audiotestsrc num-buffers=470 volume=0.4 ! audio/x-raw,channels=2 ! audioconvert ! vorbisenc ! queue ! m.audio_0")).unwrap();
        producer.set_state(gst::State::Playing).unwrap();
        let result=producer.bus().unwrap().timed_pop_filtered(gst::ClockTime::from_seconds(15),&[gst::MessageType::Eos,gst::MessageType::Error]);
        producer.set_state(gst::State::Null).unwrap();
        assert!(matches!(result.as_ref().map(|m|m.view()),Some(gst::MessageView::Eos(_))),"hold fixture: {result:?}");
        let mut channel=RunningChannel(Channel::new(Config{channel_id:format!("hold-{unique}"),width:320,height:180,fps_n:25,fps_d:1,bitrate_kbps:450,ceiling_dbtp:-1.,audio_channels:channels,scan:Scan::Progressive,top_field_first:true,outputs:vec![Output::Null],preview:None}).unwrap());
        let capture=|name:&str|{
            let queue=make("queue").unwrap();
            let sink=make("appsink").unwrap().downcast::<gst_app::AppSink>().unwrap();
            sink.set_sync(false);sink.set_property("async",false);sink.set_max_buffers(2);sink.set_drop(true);
            channel.0.pipeline.add_many([&queue,sink.upcast_ref()]).unwrap();
            gst::Element::link_many([&queue,sink.upcast_ref()]).unwrap();
            channel.0.pipeline.by_name(name).unwrap().link(&queue).unwrap();sink
        };
        let video=capture("tee-video");let audio=capture("tee-audio");
        channel.0.start().unwrap();
        let mut spec:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"hold-vt","path":file.to_string_lossy(),"trimIn":25,"trimOut":200,"gainDb":0})).unwrap();
        if channels>2{spec.auxiliary_pairs=vec![crate::audio_bus::AuxiliaryPair{output_pair:channels/2,input_pair:1,gain_db:0.}];}
        channel.0.load(spec).unwrap();channel.0.take().unwrap();
        std::thread::sleep(Duration::from_millis(450));
        let decoder=channel.0.on_air.as_ref().unwrap().decoder_id;
        crate::run_command(&mut channel.0,crate::protocol::Command::ProgramHold{item_id:"hold-vt".into(),decoder_id:decoder,on:true},24).unwrap();
        let held=channel.0.position().unwrap().1;
        assert!(channel.0.take().is_err());
        std::thread::sleep(Duration::from_millis(450));
        while video.try_pull_sample(gst::ClockTime::ZERO).is_some(){}
        while audio.try_pull_sample(gst::ClockTime::ZERO).is_some(){}
        let first=video.try_pull_sample(gst::ClockTime::from_seconds(2)).expect("output keeps delivering held video");
        let first_buffer=first.buffer().unwrap();let bytes=first_buffer.map_readable().unwrap().as_slice().to_vec();
        let native_held=channel.0.on_air.as_ref().unwrap().pipeline.query_position::<gst::ClockTime>().unwrap();
        let mut last_pts=first_buffer.pts().unwrap();
        for _ in 0..6{
            let sample=video.try_pull_sample(gst::ClockTime::from_seconds(2)).expect("held output cadence");
            let pts=sample.buffer().unwrap().pts().unwrap();assert!(pts>last_pts,"output timestamps keep advancing");last_pts=pts;
            assert_eq!(sample.buffer().unwrap().map_readable().unwrap().as_slice(),bytes.as_slice(),"held pixels must not advance");
            assert_eq!(channel.0.position().unwrap().1,held);
            assert_eq!(channel.0.on_air.as_ref().unwrap().pipeline.query_position::<gst::ClockTime>().unwrap(),native_held,"decoder itself must not advance");
            let sample=audio.try_pull_sample(gst::ClockTime::from_seconds(2)).expect("audio output continues");
            assert_eq!(sample.caps().unwrap().structure(0).unwrap().get::<String>("format").unwrap(),"F32LE");
            assert_eq!(sample.caps().unwrap().structure(0).unwrap().get::<i32>("channels").unwrap(),channels as i32);
            assert!(sample.buffer().unwrap().map_readable().unwrap().as_slice().chunks_exact(4).all(|b|f32::from_le_bytes(b.try_into().unwrap()).abs()<1e-7),"held PGM must be silent");
        }
        assert_eq!(channel.0.set_program_hold("hold-vt",decoder,false).unwrap(),held);
        std::thread::sleep(Duration::from_millis(400));
        assert!(channel.0.position().unwrap().1>held,"release advances same decoder");
        assert_eq!(channel.0.on_air.as_ref().unwrap().decoder_id,decoder);
        while audio.try_pull_sample(gst::ClockTime::ZERO).is_some(){}
        let deadline=Instant::now()+Duration::from_secs(2);let mut audible=false;let mut auxiliary_audible=channels==2;
        while Instant::now()<deadline && !(audible&&auxiliary_audible){
            if let Some(sample)=audio.try_pull_sample(gst::ClockTime::from_mseconds(100)){
                let buffer=sample.buffer().unwrap().map_readable().unwrap();
                for frame in buffer.as_slice().chunks_exact(channels*4){
                    audible|=f32::from_le_bytes(frame[..4].try_into().unwrap()).abs()>0.01;
                    if channels>2{auxiliary_audible|=f32::from_le_bytes(frame[(channels-2)*4..(channels-1)*4].try_into().unwrap()).abs()>0.01;}
                }
            }
        }
        assert!(audible,"release restores audio, not merely advancing cursor");
        assert!(auxiliary_audible,"release restores final auxiliary pair as well as master");
        // Exercise recovery from an explicitly injected uncertain state.
        // This is not a simulated GStreamer timeout/failure receipt.
        channel.0.program_hold_unconfirmed=true;
        channel.0.program_hold_volume.set_property("mute",true);
        assert!(channel.0.position().is_none());
        assert!(channel.0.take().is_err());
        assert!(channel.0.seek("pgm",25).is_err());
        assert!(channel.0.set_program_hold("hold-vt",decoder+1,false).is_err());
        assert!(channel.0.program_hold_unconfirmed);
        channel.0.set_program_hold("hold-vt",decoder,false).unwrap();
        assert!(!channel.0.program_hold_unconfirmed);
        assert!(!channel.0.program_hold_volume.property::<bool>("mute"));
        assert!(channel.0.position().is_some());
        let restored_spec:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"restored-vt","path":file.to_string_lossy(),"trimIn":25,"trimOut":200,"startOffsetFrames":61,"gainDb":0})).unwrap();
        assert!(channel.0.restore_program_hold(restored_spec.clone()).is_err(),"cannot overwrite a running PGM");
        channel.0.stop().unwrap();
        std::thread::sleep(Duration::from_millis(500));
        while video.try_pull_sample(gst::ClockTime::ZERO).is_some(){}
        let idle_sample=video.try_pull_sample(gst::ClockTime::from_seconds(2)).unwrap();
        let idle_pixels=idle_sample.buffer().unwrap().map_readable().unwrap().as_slice().to_vec();
        let transition_video=Arc::new(std::sync::Mutex::new(Vec::<Vec<u8>>::new()));
        let transition_audio=Arc::new(std::sync::Mutex::new(Vec::<f32>::new()));
        let video_capture=Arc::clone(&transition_video);
        let video_pad=channel.0.pipeline.by_name("tee-video").unwrap().static_pad("sink").unwrap();
        let video_probe=video_pad.add_probe(gst::PadProbeType::BUFFER,move|_,info|{
            if let Some(buffer)=info.buffer(){if let Ok(map)=buffer.map_readable(){video_capture.lock().unwrap().push(map.as_slice().to_vec());}}
            gst::PadProbeReturn::Ok
        }).unwrap();
        let audio_capture=Arc::clone(&transition_audio);
        let audio_pad=channel.0.pipeline.by_name("tee-audio").unwrap().static_pad("sink").unwrap();
        let audio_probe=audio_pad.add_probe(gst::PadProbeType::BUFFER,move|_,info|{
            if let Some(buffer)=info.buffer(){if let Ok(map)=buffer.map_readable(){
                let peak=map.as_slice().chunks_exact(4).map(|b|f32::from_le_bytes(b.try_into().unwrap()).abs()).fold(0f32,f32::max);
                audio_capture.lock().unwrap().push(peak);
            }}
            gst::PadProbeReturn::Ok
        }).unwrap();
        crate::run_command(&mut channel.0,crate::protocol::Command::RestoreProgramHold{item:restored_spec},25).unwrap();
        assert_eq!(channel.0.position().unwrap().1,61);
        assert_eq!(channel.0.program_hold_state().unwrap().status,"HELD");
        std::thread::sleep(Duration::from_millis(450));
        while video.try_pull_sample(gst::ClockTime::ZERO).is_some(){}
        while audio.try_pull_sample(gst::ClockTime::ZERO).is_some(){}
        let sample=video.try_pull_sample(gst::ClockTime::from_seconds(2)).unwrap();
        let restored_pixels=sample.buffer().unwrap().map_readable().unwrap().as_slice().to_vec();
        assert_ne!(restored_pixels,bytes,"different cursor must not reuse old held pixels");
        // Independent decode, not the item pipeline's cached position/latch.
        let uri=gst::glib::filename_to_uri(&file,None).unwrap();
        let reference=gst::parse::launch(&format!("uridecodebin uri={} ! videoconvert ! deinterlace mode=auto ! videoscale ! videorate skip-to-first=true ! {} ! videoconvert ! video/x-raw,format=BGRA ! videoconvert ! {} ! appsink name=reference sync=false",serde_json::to_string(uri.as_str()).unwrap(),channel.0.video_caps(),channel.0.video_caps())).unwrap().downcast::<gst::Pipeline>().unwrap();
        let reference_sink=reference.by_name("reference").unwrap().downcast::<gst_app::AppSink>().unwrap();
        reference.set_state(gst::State::Paused).unwrap();
        assert!(reference_sink.try_pull_preroll(gst::ClockTime::from_seconds(5)).is_some());
        let mut differences=Vec::new();
        for absolute_frame in [85,86,87]{
            reference.seek_simple(gst::SeekFlags::FLUSH|gst::SeekFlags::ACCURATE,gst::ClockTime::from_mseconds(absolute_frame*40)).unwrap();
            let expected=reference_sink.try_pull_preroll(gst::ClockTime::from_seconds(5)).expect("reference target preroll");
            let buffer=expected.buffer().unwrap().map_readable().unwrap();
            assert_eq!(buffer.as_slice().len(),restored_pixels.len());
            let error=buffer.as_slice().iter().zip(&restored_pixels).map(|(a,b)|(i32::from(*a)-i32::from(*b)).abs() as f64).sum::<f64>()/restored_pixels.len() as f64;
            differences.push(error);
        }
        reference.set_state(gst::State::Null).unwrap();
        println!("held reference channels={channels}, absolute frames 85/86/87 mean byte errors={differences:?}");
        assert!(differences[1]<1.0&&differences[1]<differences[0]&&differences[1]<differences[2],"restored pixels must match absolute frame 86, not adjacent frames: {differences:?}");
        let native=channel.0.on_air.as_ref().unwrap().pipeline.query_position::<gst::ClockTime>().unwrap();
        for _ in 0..6{
            let sample=video.try_pull_sample(gst::ClockTime::from_seconds(2)).unwrap();
            assert_eq!(sample.buffer().unwrap().map_readable().unwrap().as_slice(),restored_pixels.as_slice());
            assert_eq!(channel.0.on_air.as_ref().unwrap().pipeline.query_position::<gst::ClockTime>().unwrap(),native);
            let sample=audio.try_pull_sample(gst::ClockTime::from_seconds(2)).unwrap();
            assert!(sample.buffer().unwrap().map_readable().unwrap().as_slice().chunks_exact(4).all(|b|f32::from_le_bytes(b.try_into().unwrap()).abs()<1e-7));
        }
        let admission=channel.0.program_admission_cursor().unwrap();
        assert!(admission.paused);assert_eq!(admission.elapsed,61);
        assert!(admission.first_video_confirmed);
        video_pad.remove_probe(video_probe);audio_pad.remove_probe(audio_probe);
        let captured=transition_video.lock().unwrap();let mut target_seen=false;
        for (index,pixels) in captured.iter().enumerate(){
            if pixels==&restored_pixels{target_seen=true;}
            else{
                let difference=|other:&Vec<u8>|pixels.iter().zip(other).map(|(a,b)|(i32::from(*a)-i32::from(*b)).abs() as f64).sum::<f64>()/pixels.len() as f64;
                assert!(!target_seen&&pixels==&idle_pixels,"transition wrong frame index={index}, after_target={target_seen}, mean byte errors idle/old/target={:?}",[difference(&idle_pixels),difference(&bytes),difference(&restored_pixels)]);
            }
        }
        assert!(target_seen&&captured.len()>=6,"continuous probe must observe restored output");
        let audio_peaks=transition_audio.lock().unwrap();
        assert!(audio_peaks.len()>=6&&audio_peaks.iter().all(|peak|*peak<1e-7),"transition leaked audio: {audio_peaks:?}");
        println!("held transition channels={channels}, video frames={}, audio buffers={}",captured.len(),audio_peaks.len());
        drop(audio_peaks);drop(captured);
        let next:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"take-from-held","path":file.to_string_lossy(),"trimIn":0,"trimOut":225,"gainDb":0})).unwrap();
        channel.0.load(next.clone()).unwrap();
        // Pending-policy fixture only, NOT NDI wire/sender qualification:
        // the real preroll file is tagged live with its readiness latch denied.
        channel.0.armed.as_mut().unwrap().spec.source=Some("ndi:QA_PENDING_POLICY_ONLY".into());
        channel.0.armed.as_ref().unwrap().video_ready.store(false,Ordering::Release);
        let held_decoder=channel.0.on_air.as_ref().unwrap().decoder_id;
        channel.0.take().unwrap();
        assert!(channel.0.pending_live_take);
        assert_eq!(channel.0.on_air.as_ref().unwrap().decoder_id,held_decoder);
        assert_eq!(channel.0.program_hold_cursor,Some(61));
        assert!(channel.0.program_hold_volume.property::<bool>("mute"));
        channel.0.cancel_pending_take();
        assert_eq!(channel.0.program_hold_cursor,Some(61),"cancel must preserve frozen PGM rather than release it");
        channel.0.load(next).unwrap();
        assert_eq!(channel.0.position().unwrap().1,61,"preroll must not resume old held PGM");
        channel.0.armed.as_ref().unwrap().video_ready.store(false,Ordering::Release);
        assert!(channel.0.take().is_err(),"held PGM cannot be cut to a file without its prepared frame");
        assert_eq!(channel.0.on_air.as_ref().unwrap().decoder_id,held_decoder);
        assert_eq!(channel.0.program_hold_cursor,Some(61));
        assert!(channel.0.program_hold_volume.property::<bool>("mute"));
        channel.0.armed.as_ref().unwrap().video_ready.store(true,Ordering::Release);
        channel.0.program_hold_unconfirmed=true;
        assert!(channel.0.take().is_err(),"unconfirmed hold still cannot authorize TAKE");
        assert_eq!(channel.0.on_air.as_ref().unwrap().decoder_id,held_decoder);
        channel.0.program_hold_unconfirmed=false;
        assert_eq!(channel.0.take().unwrap(),"take-from-held");
        assert_eq!(channel.0.program_hold_cursor,None);
        assert_eq!(channel.0.program_hold_state().unwrap().status,"RUNNING");
        assert!(!channel.0.program_hold_volume.property::<bool>("mute"));
        std::thread::sleep(Duration::from_millis(250));
        assert!(channel.0.position().unwrap().1>0,"explicit TAKE starts only the new decoder");
    }

    #[test]
    fn ndi_subscription_survives_missing_sender_without_disabling_signal_gates() {
        gst::init().unwrap();
        let spec:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"ndi-recovery","source":"ndi:Estúdio Çãó","trimIn":0,"trimOut":0,"gainDb":0})).unwrap();
        let input=source_for(&spec).expect("bundled NDI plugin required");
        assert_eq!(input.video.property::<String>("ndi-name"),"Estúdio Çãó");
        assert_eq!(input.video.property::<u32>("connect-timeout"),0);
        assert_eq!(input.video.property::<u32>("timeout"),0);
        assert!(input.dynamic);
        assert!(!SourceStatistics::default().live_ready(true,false,true));
    }

    struct RunningChannel(Channel);
    impl Drop for RunningChannel { fn drop(&mut self) { self.0.shutdown(); } }
    struct FixtureDirectory(std::path::PathBuf);
    impl Drop for FixtureDirectory { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }

    fn fixture(video: bool, path: &std::path::Path) {
        fixture_frames(video,path,75);
    }

    fn fixture_frames(video: bool, path: &std::path::Path, frames: usize) {
        let target=serde_json::to_string(&path.to_string_lossy().replace('\\',"/")).unwrap();
        let source=if video {format!("videotestsrc num-buffers={frames} ! video/x-raw,width=160,height=90,framerate=25/1 ! videoconvert ! vp8enc deadline=1")}
            else {"audiotestsrc num-buffers=130 ! audioconvert ! vorbisenc".into()};
        let pipeline=gst::parse::launch(&format!("{source} ! matroskamux ! filesink location={target}")).unwrap();
        pipeline.set_state(gst::State::Playing).unwrap();
        let result=pipeline.bus().unwrap().timed_pop_filtered(gst::ClockTime::from_seconds(15),&[gst::MessageType::Eos,gst::MessageType::Error]);
        pipeline.set_state(gst::State::Null).unwrap();
        assert!(matches!(result.as_ref().map(|message|message.view()),Some(gst::MessageView::Eos(_))),"fixture de mídia não terminou: {result:?}");
    }

    #[test]
    fn qc_restore_holds_destination_until_program_and_preview_admission() {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        let output=Output::parse("srt://127.0.0.1:19919?mode=caller").unwrap();
        let mut channel=RunningChannel(Channel::new_with_program_hold(Config{channel_id:"qc-restore-held".into(),width:320,height:180,fps_n:25,fps_d:1,bitrate_kbps:450,ceiling_dbtp:-1.,audio_channels:2,scan:Scan::Progressive,top_field_first:true,outputs:vec![Output::Null],preview:Some(output.clone())},true).unwrap());
        channel.0.attach_qc_preview(&output).unwrap();
        assert!(channel.0.held_qc_preview.is_some());assert!(channel.0.preview_channels.is_none());assert!(channel.0.qc_video_channel.is_none());assert!(channel.0.publishers.is_empty());
        assert!(channel.0.attach_qc_preview(&output).is_err(),"duplicate private QC destination must not overwrite the held one");
        assert!(channel.0.release_preview_output().is_err(),"preview/HQ cannot precede PGM admission");
        channel.0.start().unwrap();channel.0.release_program_outputs(None,None).unwrap();
        assert!(channel.0.held_qc_preview.is_some());assert!(channel.0.publishers.is_empty(),"PGM admission alone does not release PVW/HQ");
        channel.0.release_preview_output().unwrap();
        assert!(channel.0.preview_channels.is_some());assert!(channel.0.qc_video_channel.is_some());assert!(channel.0.held_qc_preview.is_none());
        assert_eq!(channel.0.publishers.iter().filter(|publisher|publisher.role()=="qc").count(),1);
        assert!(channel.0.release_preview_output().is_err(),"admission must not duplicate publishers");
    }

    #[test]
    fn qc_restore_rejects_missing_preview_and_invalid_destination_without_queueing() {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        let mut channel=RunningChannel(Channel::new_with_program_hold(Config{channel_id:"qc-restore-missing".into(),width:320,height:180,fps_n:25,fps_d:1,bitrate_kbps:450,ceiling_dbtp:-1.,audio_channels:2,scan:Scan::Progressive,top_field_first:true,outputs:vec![Output::Null],preview:None},true).unwrap());
        assert!(channel.0.attach_qc_preview(&Output::Null).is_err());
        assert!(channel.0.attach_qc_preview(&Output::parse("srt://127.0.0.1:19919?mode=caller").unwrap()).is_err());
        assert!(channel.0.held_qc_preview.is_none());assert!(channel.0.publishers.is_empty());assert!(channel.0.qc_video_channel.is_none());
    }

    #[test]
    fn qc_dedicated_decoder_lease_is_independent_of_master_pvw() {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        let unique=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let directory=FixtureDirectory(std::env::temp_dir().join(format!("rplayout-qc-lease-{}-{unique}",std::process::id())));
        std::fs::create_dir(&directory.0).unwrap();
        let file=directory.0.join("Fonte-ação.mkv");fixture(true,&file);
        let output=Output::parse("srt://127.0.0.1:19919?mode=caller").unwrap();
        let mut channel=RunningChannel(Channel::new(Config{channel_id:format!("qc-lease-{unique}"),width:320,height:180,fps_n:25,fps_d:1,bitrate_kbps:450,ceiling_dbtp:-1.,audio_channels:2,scan:Scan::Progressive,top_field_first:true,outputs:vec![Output::Null],preview:Some(output.clone())}).unwrap());
        channel.0.attach_qc_preview(&output).unwrap();channel.0.start().unwrap();
        let uri=gst::glib::filename_to_uri(&file,None).unwrap().to_string();
        let spec:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"qc-source","source":uri,"trimIn":0,"trimOut":0,"gainDb":0})).unwrap();
        channel.0.qc_source(Some(spec.clone())).unwrap();
        assert!(!channel.0.set_monitor("qc",true),"generic monitor cannot bypass source binding");
        assert!(channel.0.set_qc_monitor("wrong-source",true).is_err());
        let deadline=Instant::now()+Duration::from_secs(3);
        while !channel.0.qc_live_ready() && Instant::now()<deadline {std::thread::sleep(Duration::from_millis(5));}
        assert!(channel.0.qc_live_ready());
        assert!(channel.0.preview_id().is_none(),"the QC decoder never occupies the Master's PVW");
        let qc=channel.0.qc_item.as_ref().unwrap();
        assert!(qc.qc_valve.as_ref().unwrap().property::<bool>("drop"));
        assert!(channel.0.publishers.iter().filter(|p|p.role()=="qc").all(|p|p.report().health==crate::output::Health::Idle));
        channel.0.set_qc_monitor("qc-source",true).unwrap();
        assert!(!channel.0.qc_item.as_ref().unwrap().qc_valve.as_ref().unwrap().property::<bool>("drop"));
        // A Master CUE (PVW open/replace/close) leaves the QC decoder alone.
        let pvw:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"master-cue","source":uri,"trimIn":0,"trimOut":0,"gainDb":0})).unwrap();
        channel.0.preview(Some(pvw)).unwrap();
        assert_eq!(channel.0.preview_id().as_deref(),Some("master-cue"));
        assert!(channel.0.previewing.as_ref().unwrap().qc_valve.is_none(),"PVW decoder has no QC tap: no second writer on the QC surfaces");
        channel.0.preview(None).unwrap();
        assert_eq!(channel.0.qc_source_id().as_deref(),Some("qc-source"));
        assert!(!channel.0.qc_item.as_ref().unwrap().qc_valve.as_ref().unwrap().property::<bool>("drop"),"Master CUE must not close the QC inspection");
        // Native monotonic deadline is authoritative even with no server
        // timeout/HTTP call. Expiry closes before any publisher can start.
        channel.0.qc_deadline=Some(Instant::now()-Duration::from_millis(1));
        channel.0.service_outputs();
        assert!(channel.0.qc_deadline.is_none());
        assert!(channel.0.qc_item.as_ref().unwrap().qc_valve.as_ref().unwrap().property::<bool>("drop"));
        assert!(channel.0.publishers.iter().filter(|p|p.role()=="qc").all(|p|p.report().health==crate::output::Health::Idle));
        let discarded=channel.0.qc_item.as_ref().unwrap().pipeline.downgrade();
        channel.0.qc_source(Some(spec)).unwrap();
        assert!(discarded.upgrade().is_none(),"the prior QC decoder must actually be released");
        assert!(channel.0.on_air_id().is_none(),"QC cannot TAKE");
        channel.0.qc_source(None).unwrap();assert!(channel.0.set_qc_monitor("qc-source",true).is_err());
        assert!(channel.0.qc_source(Some(serde_json::from_value(serde_json::json!({"itemId":"file","path":"x.mkv","trimIn":0,"trimOut":25,"gainDb":0})).unwrap())).is_err(),"QC decoder is for live sources only");
    }

    #[test]
    fn valid_mark_in_is_ready_and_missing_video_preserves_program() {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        let unique=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let directory=FixtureDirectory(std::env::temp_dir().join(format!("rplayout-preroll-{}-{unique}",std::process::id())));
        std::fs::create_dir(&directory.0).unwrap();
        let video=directory.0.join("AÇÃO — vídeo.mkv");
        let audio=directory.0.join("som-sem-video.mkv");
        fixture(true,&video);fixture(false,&audio);
        let mut channel=RunningChannel(Channel::new(Config { channel_id:format!("preroll-{unique}"),width:320,height:180,fps_n:25,fps_d:1,bitrate_kbps:450,ceiling_dbtp:-1.0,audio_channels:2,scan:Scan::Progressive,top_field_first:true,outputs:vec![Output::Null],preview:None }).unwrap());
        let spec:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"good","path":video.to_string_lossy(),"trimIn":25,"trimOut":60,"gainDb":0})).unwrap();
        channel.0.load(spec.clone()).unwrap();
        assert!(channel.0.armed.as_ref().unwrap().video_ready.load(Ordering::Acquire));
        channel.0.take().unwrap();
        let no_video=ItemSpec { item_id:"audio".into(),path:audio.to_string_lossy().into_owned(),trim_in:0,trim_out:60,..spec.clone() };
        assert!(channel.0.load(no_video).unwrap_err().to_string().contains("quadro de vídeo"));
        assert_eq!(channel.0.on_air_id().as_deref(),Some("good"));
        assert!(channel.0.armed_id().is_none());
        let past_end=ItemSpec { item_id:"past-end".into(),trim_in:200,trim_out:250,..spec };
        assert!(channel.0.load(past_end).is_err(),"Mark In além do arquivo não pode herdar o quadro anterior ao seek");
        assert_eq!(channel.0.on_air_id().as_deref(),Some("good"));
    }

    #[test]
    fn preview_and_quality_receive_complete_audio_simultaneously() {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none(){crate::limiter_element::register().unwrap();}
        let unique=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let directory=FixtureDirectory(std::env::temp_dir().join(format!("rplayout-qc-audio-{}-{unique}",std::process::id())));
        std::fs::create_dir(&directory.0).unwrap();let file=directory.0.join("áudio-completo.mkv");
        let path=serde_json::to_string(&file.to_string_lossy().replace('\\',"/")).unwrap();
        let fixture=gst::parse::launch(&format!("matroskamux name=m ! filesink location={path} videotestsrc num-buffers=250 ! video/x-raw,width=160,height=90,framerate=25/1 ! videoconvert ! vp8enc deadline=1 ! queue ! m. audiotestsrc num-buffers=469 volume=0.05 freq=997 ! audio/x-raw,rate=48000,channels=2 ! audioconvert ! vorbisenc ! queue ! m.")).unwrap();
        fixture.set_state(gst::State::Playing).unwrap();
        let end=fixture.bus().unwrap().timed_pop_filtered(gst::ClockTime::from_seconds(15),&[gst::MessageType::Eos,gst::MessageType::Error]);
        fixture.set_state(gst::State::Null).unwrap();assert!(matches!(end.as_ref().map(|event|event.view()),Some(gst::MessageView::Eos(_))));
        let id=format!("qc-audio-{unique}");
        let output=Output::parse("srt://127.0.0.1:19939?mode=caller").unwrap();
        let mut channel=RunningChannel(Channel::new(Config{channel_id:id.clone(),width:320,height:180,fps_n:25,fps_d:1,bitrate_kbps:450,ceiling_dbtp:-1.,audio_channels:2,scan:Scan::Progressive,top_field_first:true,outputs:vec![Output::Null],preview:Some(output.clone())}).unwrap());
        channel.0.attach_qc_preview(&output).unwrap();channel.0.start().unwrap();
        let item:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"source","source":gst::glib::filename_to_uri(&file,None).unwrap().to_string(),"trimIn":0,"trimOut":0,"gainDb":0})).unwrap();
        channel.0.preview(Some(item.clone())).unwrap();
        // The QC opens its own decoder for the same live source.
        channel.0.qc_source(Some(ItemSpec{item_id:"qc-source".into(),..item})).unwrap();
        let pvw=channel.0.publishers.iter().find(|publisher|publisher.role()=="pvw").unwrap().audio_channel().to_owned();
        let qc=channel.0.publishers.iter().find(|publisher|publisher.role()=="qc").unwrap().audio_channel().to_owned();
        assert_ne!(pvw,qc,"independent consumers cannot drain one interaudio FIFO");
        struct Reader(gst::Pipeline,gst_app::AppSink);
        impl Drop for Reader{fn drop(&mut self){let _=self.0.set_state(gst::State::Null);}}
        let readers:Vec<_>=[pvw,qc].iter().map(|bus|{
            let pipeline=gst::parse::launch(&format!("interaudiosrc channel={bus} buffer-time=200000000 latency-time=10000000 period-time=10000000 ! audioconvert ! audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved ! appsink name=probe sync=true max-buffers=128 drop=false")).unwrap().downcast::<gst::Pipeline>().unwrap();
            let sink=pipeline.by_name("probe").unwrap().downcast::<gst_app::AppSink>().unwrap();pipeline.set_state(gst::State::Playing).unwrap();Reader(pipeline,sink)
        }).collect();
        let started=Instant::now();let mut counts=[0usize;2];let mut silent=[0usize;2];
        while started.elapsed()<Duration::from_millis(2500){
            for(index,reader)in readers.iter().enumerate(){
                if let Some(sample)=reader.1.try_pull_sample(gst::ClockTime::from_mseconds(20)){
                    let map=sample.buffer().unwrap().map_readable().unwrap();
                    let values:Vec<_>=map.as_slice().chunks_exact(4).map(|v|f32::from_le_bytes(v.try_into().unwrap())as f64).collect();
                    assert!(!values.is_empty()&&values.iter().all(|v|v.is_finite()));
                    if started.elapsed()>Duration::from_millis(500){
                        counts[index]+=1;let rms=(values.iter().map(|v|v*v).sum::<f64>()/values.len()as f64).sqrt();
                        if rms<0.02{silent[index]+=1;}
                    }
                }
            }
        }
        eprintln!("simultaneous PVW/QC audio: buffers={counts:?}, low-energy={silent:?}");
        for index in 0..2{assert!(counts[index]>=100,"each independent reader must receive continuous real samples");assert!(silent[index]*100<=counts[index]*2,"PVW and QC must each retain >=98% non-silent buffers, not divide the source");}
        assert!(channel.0.on_air_id().is_none());
    }

    #[test]
    fn live_delivery_ages_out_and_take_keeps_program_until_real_buffers_return() {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        let unique=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let directory=FixtureDirectory(std::env::temp_dir().join(format!("rplayout-live-age-{}-{unique}",std::process::id())));
        std::fs::create_dir(&directory.0).unwrap();
        let file=directory.0.join("SINAL — ação.mkv");fixture_frames(true,&file,750);
        let mut channel=RunningChannel(Channel::new(Config {channel_id:format!("live-age-{unique}"),width:320,height:180,fps_n:25,fps_d:1,bitrate_kbps:450,ceiling_dbtp:-1.,audio_channels:2,scan:Scan::Progressive,top_field_first:true,outputs:vec![Output::Null],preview:None}).unwrap());
        channel.0.start().unwrap();
        let program:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"old-pgm","path":file.to_string_lossy(),"trimIn":0,"trimOut":75,"gainDb":0})).unwrap();
        channel.0.load(program).unwrap();channel.0.take().unwrap();
        // A real decoded local URI uses the live-source path. Block the
        // decoder pad explicitly: PAUSED may be asynchronous and is not
        // evidence that streaming has stopped. No ready event is simulated.
        let source:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"live-test","source":gst::glib::filename_to_uri(&file,None).unwrap().to_string(),"trimIn":0,"trimOut":0,"gainDb":0})).unwrap();
        channel.0.load(source.clone()).unwrap();
        assert_eq!(channel.0.armed.as_ref().unwrap().pipeline.state(gst::ClockTime::from_seconds(1)).1,gst::State::Playing,
            "LOAD must consume live frames without waiting for TAKE, never queue stale appsrc data in PAUSED");
        assert_eq!(channel.0.on_air_id().as_deref(),Some("old-pgm"),"live LOAD cannot switch PGM");
        let deadline=Instant::now()+Duration::from_secs(3);
        while !channel.0.armed.as_ref().unwrap().live_ready() && Instant::now()<deadline {std::thread::sleep(Duration::from_millis(5));}
        assert!(channel.0.armed.as_ref().unwrap().live_ready());
        let decoder=channel.0.armed.as_ref().unwrap().pipeline.children().into_iter()
            .find(|element|element.factory().is_some_and(|factory|factory.name()=="uridecodebin")).unwrap();
        let pad=decoder.src_pads().into_iter().find(|pad|pad.current_caps().is_some_and(|caps|caps.structure(0).is_some_and(|structure|structure.name().starts_with("video/")))).unwrap();
        let blocked=Arc::new(AtomicBool::new(false));let observed=Arc::clone(&blocked);
        let probe=pad.add_probe(gst::PadProbeType::BLOCK_DOWNSTREAM,move|_,_|{observed.store(true,Ordering::Release);gst::PadProbeReturn::Ok}).unwrap();
        let deadline=Instant::now()+Duration::from_secs(3);
        while !blocked.load(Ordering::Acquire) && Instant::now()<deadline {std::thread::sleep(Duration::from_millis(5));}
        assert!(blocked.load(Ordering::Acquire),"loss fixture must actually block source buffers");
        std::thread::sleep(Duration::from_millis(2100));
        assert!(channel.0.armed.as_ref().unwrap().video_ready.load(Ordering::Acquire),"first-buffer latch still set");
        assert!(!channel.0.armed.as_ref().unwrap().live_ready(),"old delivered frame cannot authorize TAKE");
        assert!(channel.0.activate_armed(false).is_err());
        assert_eq!(channel.0.on_air_id().as_deref(),Some("old-pgm"));
        assert_eq!(channel.0.armed_id().as_deref(),Some("live-test"));
        channel.0.take().unwrap();
        assert!(channel.0.pending_live_take);
        assert_eq!(channel.0.on_air_id().as_deref(),Some("old-pgm"));
        assert!(channel.0.service_pending_take().unwrap().is_none());
        let deadline=channel.0.pending_live_take_started.unwrap();
        channel.0.take().unwrap();
        assert_eq!(channel.0.pending_live_take_started,Some(deadline),"repeated TAKE cannot extend original intent indefinitely");
        pad.remove_probe(probe);
        channel.0.pending_live_take_started=Some(Instant::now()-LIVE_TAKE_DEADLINE);
        let error=channel.0.service_pending_take().unwrap_err().to_string();
        assert!(error.contains("10 segundos"));
        assert_eq!(channel.0.on_air_id().as_deref(),Some("old-pgm"));
        assert!(channel.0.armed_id().is_none());
        assert!(channel.0.service_pending_take().unwrap().is_none(),"expired intent cannot TAKE when frames return late");
        channel.0.load(source).unwrap();channel.0.take().unwrap();
        let deadline=Instant::now()+Duration::from_secs(3);let mut committed=None;
        while committed.is_none() && Instant::now()<deadline {
            committed=channel.0.service_pending_take().unwrap();
            if committed.is_none(){std::thread::sleep(Duration::from_millis(5));}
        }
        assert_eq!(committed.as_deref(),Some("live-test"));
        assert_eq!(channel.0.on_air_id().as_deref(),Some("live-test"));
        assert!(channel.0.on_air_live_ready().is_some());
        let decoder=channel.0.on_air.as_ref().unwrap().pipeline.children().into_iter()
            .find(|element|element.factory().is_some_and(|factory|factory.name()=="uridecodebin")).unwrap();
        let pad=decoder.src_pads().into_iter().find(|pad|pad.current_caps().is_some_and(|caps|caps.structure(0).is_some_and(|structure|structure.name().starts_with("video/")))).unwrap();
        let clock=channel.0.live_program_clock.unwrap();
        let previous_decoder=channel.0.decoder_id("pgm").unwrap();
        // Stop actual source buffers after TAKE. Its pipeline/media clock is
        // not allowed to freeze the time this live occurrence occupies PGM.
        let blocked=Arc::new(AtomicBool::new(false));let observed=Arc::clone(&blocked);
        let probe=pad.add_probe(gst::PadProbeType::BLOCK_DOWNSTREAM,move|_,_|{observed.store(true,Ordering::Release);gst::PadProbeReturn::Ok}).unwrap();
        let deadline=Instant::now()+Duration::from_secs(3);
        while !blocked.load(Ordering::Acquire)&&Instant::now()<deadline{std::thread::sleep(Duration::from_millis(5));}
        assert!(blocked.load(Ordering::Acquire));
        let before=channel.0.position().unwrap().1;
        std::thread::sleep(Duration::from_millis(2200));
        assert!(!channel.0.on_air.as_ref().unwrap().live_ready());
        assert!(channel.0.position().unwrap().1>=before+54,"PGM occurrence time must continue while signal buffers stop");
        pad.remove_probe(probe);
        channel.0.restart_on_air().unwrap();
        let deadline=Instant::now()+Duration::from_secs(3);
        while channel.0.pending_live_take&&Instant::now()<deadline{channel.0.service_pending_take().unwrap();std::thread::sleep(Duration::from_millis(5));}
        assert_ne!(channel.0.decoder_id("pgm"),Some(previous_decoder));
        assert_eq!(channel.0.live_program_clock.unwrap().started,clock.started,"automatic decoder replacement keeps the live occurrence clock");
        assert!(channel.0.position().unwrap().1>=before+54);
        let spec=channel.0.on_air.as_ref().unwrap().spec.clone();
        channel.0.stop().unwrap();assert!(channel.0.live_program_clock.is_none());
        channel.0.load(spec).unwrap();channel.0.take().unwrap();
        let deadline=Instant::now()+Duration::from_secs(3);
        while channel.0.pending_live_take&&Instant::now()<deadline{channel.0.service_pending_take().unwrap();std::thread::sleep(Duration::from_millis(5));}
        assert!(channel.0.live_program_clock.unwrap().started>clock.started,"explicit STOP/TAKE of the same item starts a new occurrence");
    }

    #[test]
    fn real_four_channel_file_routes_selected_pair_to_program_meter_and_rejects_absent_audio() {
        gst::init().unwrap();if gst::ElementFactory::find("rplayoutlimiter").is_none(){let _=crate::limiter_element::register();}
        let unique=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let directory=FixtureDirectory(std::env::temp_dir().join(format!("rplayout-audio-matrix-{}-{unique}",std::process::id())));std::fs::create_dir(&directory.0).unwrap();
        let file=directory.0.join("ÁUDIO-4-canais.mkv");let silent=directory.0.join("sem-áudio.mkv");
        let location=serde_json::to_string(&file.to_string_lossy().replace('\\',"/")).unwrap();
        let sources=(0..4).map(|channel|format!("audiotestsrc num-buffers=300 wave=sine freq={} volume={} ! audio/x-raw,format=F32LE,rate=48000,channels=1 ! join.sink_{channel}",(channel+1)*300,(channel+1) as f64/10.)).collect::<Vec<_>>().join(" ");
        let producer=gst::parse::launch(&format!("matroskamux name=m ! filesink location={location} videotestsrc num-buffers=150 ! video/x-raw,width=160,height=90,framerate=25/1 ! videoconvert ! vp8enc deadline=1 ! queue ! m.video_0 interleave name=join channel-positions-from-input=false ! audio/x-raw,format=F32LE,rate=48000,channels=4,channel-mask=(bitmask)0x0 ! queue ! m.audio_0 {sources}")).unwrap();
        producer.set_state(gst::State::Playing).unwrap();let result=producer.bus().unwrap().timed_pop_filtered(gst::ClockTime::from_seconds(15),&[gst::MessageType::Eos,gst::MessageType::Error]);producer.set_state(gst::State::Null).unwrap();assert!(matches!(result.as_ref().map(|m|m.view()),Some(gst::MessageView::Eos(_))),"4ch fixture: {result:?}");
        fixture(true,&silent);
        let mut channel=RunningChannel(Channel::new(Config{channel_id:format!("matrix-{unique}"),width:320,height:180,fps_n:25,fps_d:1,bitrate_kbps:450,ceiling_dbtp:-1.,audio_channels:2,scan:Scan::Progressive,top_field_first:true,outputs:vec![Output::Null],preview:None}).unwrap());channel.0.start().unwrap();
        let spec:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"pair34","path":file.to_string_lossy(),"trimIn":0,"trimOut":100,"gainDb":0,"audioRouting":{"mode":"STEREO_3_4"}})).unwrap();
        channel.0.load(spec.clone()).unwrap();assert!(channel.0.armed.as_ref().unwrap().routing_ready().unwrap());channel.0.take().unwrap();
        let deadline=Instant::now()+Duration::from_secs(3);let mut peaks=[-90f64;2];while Instant::now()<deadline{let reading=channel.0.measure().0;for c in 0..2{peaks[c]=peaks[c].max(reading.peak_dbfs[c]);}std::thread::sleep(Duration::from_millis(20));}
        for c in 0..2{let expected=20.*((c+3) as f64/10.).log10();assert!((peaks[c]-expected).abs()<0.5,"PGM canal {c}: {}, esperado {expected}",peaks[c]);}
        let absent=ItemSpec{item_id:"sem-som".into(),path:silent.to_string_lossy().into_owned(),trim_out:60,..spec.clone()};assert!(channel.0.load(absent).is_err());assert_eq!(channel.0.on_air_id().as_deref(),Some("pair34"));
        let missing_track=ItemSpec{item_id:"trilha-inexistente".into(),audio_track:2,..spec};assert!(channel.0.load(missing_track).is_err());assert_eq!(channel.0.on_air_id().as_deref(),Some("pair34"));
    }
}

/// Desliga o pipeline do item. Falhar aqui não pode derrubar o canal, então o
/// erro vira log: um item mal encerrado é irrelevante perto do PGM parar.
fn discard(mut item: Item) {
    item.close();
}

#[cfg(test)]
mod embedded_audio_tests {
    use super::*;
    struct RunningChannel(Channel);
    impl Drop for RunningChannel { fn drop(&mut self) { self.0.shutdown(); } }
    struct FixtureDirectory(std::path::PathBuf);
    impl Drop for FixtureDirectory { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }
    fn capture(channel:&Channel)->gst_app::AppSink {
        let queue=make("queue").unwrap();
        let sink=make("appsink").unwrap().downcast::<gst_app::AppSink>().unwrap();
        sink.set_sync(false);sink.set_property("async",false);sink.set_max_buffers(16);sink.set_drop(true);
        channel.pipeline.add_many([&queue,sink.upcast_ref()]).unwrap();
        gst::Element::link_many([&queue,sink.upcast_ref()]).unwrap();
        channel.pipeline.by_name("tee-audio").unwrap().link(&queue).unwrap();
        sink.sync_state_with_parent().unwrap();queue.sync_state_with_parent().unwrap();sink
    }
    fn peaks(sink:&gst_app::AppSink,channels:usize,ignore_ms:u64,stage:&str)->Vec<f32> {
        while sink.try_pull_sample(gst::ClockTime::ZERO).is_some() {}
        let pipeline=sink.parent().unwrap().downcast::<gst::Pipeline>().unwrap();
        let clock_deadline=Instant::now()+Duration::from_secs(1);
        let running_time=loop {
            if let Some(time)=pipeline.current_running_time(){break time;}
            assert!(Instant::now()<clock_deadline,"pipeline has no running clock: {stage}");
            std::thread::sleep(Duration::from_millis(1));
        };
        let cutoff=running_time+gst::ClockTime::from_mseconds(ignore_ms);
        // Wall time of dequeue is not media time. A delayed capture queue can
        // return pre-TAKE samples after the wall-time ignore interval. Reject
        // them by PTS and require 500ms of actual 48kHz samples, unchanged
        // amplitude/silence assertions. The bound only permits collection.
        let deadline=Instant::now()+Duration::from_millis(ignore_ms+3000);
        let mut peaks=vec![0f32;channels];let mut count=0;
        let mut first_pts=None;let mut last_pts=None;let mut skipped=0;
        while count<24_000 && Instant::now()<deadline {
            if let Some(sample)=sink.try_pull_sample(gst::ClockTime::from_mseconds(50)) {
                assert_eq!(sample.caps().unwrap().structure(0).unwrap().get::<i32>("channels").unwrap(),channels as i32);
                let buffer=sample.buffer().unwrap();
                let pts=buffer.pts().expect("capture must preserve media timestamp");
                first_pts.get_or_insert(pts);last_pts=Some(pts);
                if pts<cutoff {skipped+=1;continue;}
                let map=buffer.map_readable().unwrap();
                for frame in map.as_slice().chunks_exact(channels*4) {
                    if count>=24_000 {break;}
                    for (index,value) in frame.chunks_exact(4).enumerate() {peaks[index]=peaks[index].max(f32::from_le_bytes(value.try_into().unwrap()).abs());}
                    count+=1;
                }
            }
        }
        if count<24_000 {
            let mut messages=Vec::new();
            while let Some(message)=pipeline.bus().unwrap().pop() {
                match message.view() {
                    gst::MessageView::Error(error)=>messages.push(format!("ERROR {} {:?}",error.error(),error.debug())),
                    gst::MessageView::Warning(warning)=>messages.push(format!("WARNING {} {:?}",warning.error(),warning.debug())),
                    gst::MessageView::Eos(_)=>messages.push("EOS".into()),
                    _=>{}
                }
            }
            panic!("sem amostras reais: etapa={stage}, canais={channels}, frames={count}, cutoff={cutoff:?}, first_pts={first_pts:?}, last_pts={last_pts:?}, skipped={skipped}, running_end={:?}, estado={:?}, mensagens={messages:?}",pipeline.current_running_time(),pipeline.current_state());
        }
        peaks
    }
    #[test]
    fn cue_take_preserves_auxiliary_identity_gain_and_silence_in_eight_and_sixteen_channels() {
        gst::init().unwrap();
        if gst::ElementFactory::find(crate::limiter_element::FACTORY).is_none() {crate::limiter_element::register().unwrap();}
        let unique=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let directory=FixtureDirectory(std::env::temp_dir().join(format!("rplayout-embedded-{}-{unique}",std::process::id())));
        std::fs::create_dir(&directory.0).unwrap();let file=directory.0.join("AÇÃO — 4 canais.mkv");
        let location=serde_json::to_string(&file.to_string_lossy().replace('\\',"/")).unwrap();
        let sources=(0..4).map(|channel|format!("audiotestsrc num-buffers=600 wave=sine freq={} volume={} ! audio/x-raw,format=F32LE,rate=48000,channels=1 ! join.sink_{channel}",(channel+1)*300,(channel+1) as f64/10.)).collect::<Vec<_>>().join(" ");
        let producer=gst::parse::launch(&format!("matroskamux name=m ! filesink location={location} videotestsrc num-buffers=300 ! video/x-raw,width=160,height=90,framerate=25/1 ! videoconvert ! vp8enc deadline=1 ! queue ! m.video_0 interleave name=join channel-positions-from-input=false ! audio/x-raw,format=F32LE,rate=48000,channels=4,channel-mask=(bitmask)0x0 ! queue ! m.audio_0 {sources}")).unwrap();
        producer.set_state(gst::State::Playing).unwrap();let result=producer.bus().unwrap().timed_pop_filtered(gst::ClockTime::from_seconds(15),&[gst::MessageType::Eos,gst::MessageType::Error]);producer.set_state(gst::State::Null).unwrap();
        assert!(matches!(result.as_ref().map(|message|message.view()),Some(gst::MessageView::Eos(_))),"fixture multicanal: {result:?}");
        for channels in [8,16] {
            let mut channel=RunningChannel(Channel::new(Config{channel_id:format!("embedded-{channels}-{unique}"),width:320,height:180,fps_n:25,fps_d:1,bitrate_kbps:450,ceiling_dbtp:-1.,audio_channels:channels,scan:Scan::Progressive,top_field_first:true,outputs:vec![Output::Null],preview:Some(Output::parse("srt://127.0.0.1:19919?mode=caller").unwrap())}).unwrap());
            let sink=capture(&channel.0);channel.0.start().unwrap();
            let spec:ItemSpec=serde_json::from_value(serde_json::json!({"itemId":"pairs","path":file.to_string_lossy(),"trimIn":0,"trimOut":250,"gainDb":-6,"audioRouting":{"mode":"STEREO_3_4"},"auxiliaryPairs":[{"outputPair":2,"inputPair":1,"gainDb":0},{"outputPair":channels/2,"inputPair":2,"gainDb":-12}]})).unwrap();
            channel.0.load(spec.clone()).unwrap();assert!(channel.0.armed.as_ref().unwrap().routing_ready().unwrap());
            let cued=peaks(&sink,channels,100,"CUE");assert!(cued.iter().all(|value|*value<0.00001),"CUE vazou no PGM: {cued:?}");
            for pad in channel.0.audio_selector.sink_pads() {
                let caps=pad.current_caps().expect("both permanent audio slots must negotiate before TAKE");
                let structure=caps.structure(0).unwrap();
                assert_eq!(structure.get::<i32>("channels").unwrap(),channels as i32);
                assert_eq!(structure.get::<String>("format").unwrap(),"F32LE");
            }
            channel.0.take().unwrap();let measured=peaks(&sink,channels,1500,"TAKE pares");
            let mut expected=vec![0f32;channels];expected[0]=0.3*10f32.powf(-6./20.);expected[1]=0.4*10f32.powf(-6./20.);expected[2]=0.1;expected[3]=0.2;expected[channels-2]=0.3*10f32.powf(-12./20.);expected[channels-1]=0.4*10f32.powf(-12./20.);
            for index in 0..channels {assert!((measured[index]-expected[index]).abs()<0.003,"bus {channels}, canal {index}: {}, esperado {}",measured[index],expected[index]);}
            let meter=channel.0.measure().0;
            assert!((meter.peak_dbfs[0]-20.*f64::from(expected[0]).log10()).abs()<0.5,"medidor master não pode medir/somar auxiliares: {:?}",meter.peak_dbfs);
            let preview_spec=ItemSpec{item_id:"pvw".into(),..spec.clone()};channel.0.preview(Some(preview_spec)).unwrap();
            std::thread::sleep(Duration::from_millis(500));let preview=channel.0.measure().1;
            assert!((preview.peak_dbfs[0]-20.*f64::from(expected[0]).log10()).abs()<0.5,"PVW deve medir somente master: {:?}",preview.peak_dbfs);
            let invalid=ItemSpec{item_id:"missing".into(),auxiliary_pairs:vec![crate::audio_bus::AuxiliaryPair{output_pair:2,input_pair:3,gain_db:0.}],..spec.clone()};
            assert!(channel.0.load(invalid).is_err());assert_eq!(channel.0.on_air_id().as_deref(),Some("pairs"));
            // Inject an asynchronous routing failure after TAKE was accepted.
            // This exercises the actual main-loop error boundary, not hardware.
            channel.0.load(ItemSpec{item_id:"pending-live".into(),..spec.clone()}).unwrap();
            let failed_pipeline=channel.0.armed.as_ref().unwrap().pipeline.downgrade();
            {let pending=channel.0.armed.as_mut().unwrap();pending.spec.source=Some("ndi:injected-error".into());pending.video_ready.store(false,Ordering::Release);}
            channel.0.take().unwrap();assert!(channel.0.pending_live_take);
            *channel.0.armed.as_ref().unwrap().audio_error.lock().unwrap()=Some("par auxiliar indisponível".into());
            let (changed,error)=crate::poll_pending_take(&mut channel.0);assert!(changed);
            let event=serde_json::to_value(error.unwrap()).unwrap();assert_eq!(event["event"],"itemError");assert_eq!(event["itemId"],"pending-live");
            assert_eq!(channel.0.on_air_id().as_deref(),Some("pairs"));assert!(channel.0.armed_id().is_none());assert!(!channel.0.pending_live_take);
            assert!(failed_pipeline.upgrade().is_none(),"failed item callbacks cannot retain their own pipeline");
            let previous_pipeline=channel.0.on_air.as_ref().unwrap().pipeline.downgrade();
            let next=ItemSpec{item_id:"master-only".into(),auxiliary_pairs:vec![],audio_routing:crate::audio_routing::AudioRouting{mode:crate::audio_routing::RoutingMode::Stereo1_2,..Default::default()},gain_db:0.,..spec};
            channel.0.load(next).unwrap();channel.0.take().unwrap();let measured=peaks(&sink,channels,1500,"A/B master-only");
            assert!(previous_pipeline.upgrade().is_none(),"A/B discard must release previous item and its route callbacks");
            let mut faults=Vec::new();
            while let Some(message)=channel.0.pipeline.bus().unwrap().pop(){if let gst::MessageView::Error(error)=message.view(){faults.push(format!("{} {:?}",error.error(),error.debug()));}}
            assert!(faults.is_empty(),"main pipeline faults during A/B: {faults:?}");
            assert!((measured[0]-0.1).abs()<0.003&&(measured[1]-0.2).abs()<0.003,"A/B master: {measured:?}; audio slot {:?}",channel.0.audio_selector.property::<Option<gst::Pad>>("active-pad").map(|pad|pad.name()));
            assert!(measured[2..].iter().all(|value|*value<0.00001),"auxiliar do item anterior vazou após TAKE: {measured:?}");
            channel.0.stop().unwrap();let stopped=peaks(&sink,channels,1500,"STOP");assert!(stopped.iter().all(|value|*value<0.00001),"STOP deixou som: {stopped:?}");
            let preview_pipeline=channel.0.previewing.as_ref().unwrap().pipeline.downgrade();
            channel.0.preview(None).unwrap();
            assert!(preview_pipeline.upgrade().is_none(),"PVW close must release its decoder");
        }
    }
}

#[cfg(test)]
mod source_statistics_tests {
    use super::*;
    #[test]
    fn only_displayable_received_video_confirms_signal_not_gap_or_corrupt_data() {
        gst::init().unwrap();
        assert!(!received_video_frame(&gst::Buffer::new()));
        for flags in [gst::BufferFlags::GAP, gst::BufferFlags::CORRUPTED, gst::BufferFlags::DECODE_ONLY] {
            let mut buffer = gst::Buffer::from_mut_slice(vec![0u8; 16]);
            buffer.get_mut().unwrap().set_flags(flags);
            assert!(!received_video_frame(&buffer));
        }
        let mut black = gst::Buffer::from_mut_slice(vec![0u8; 16]);
        assert!(received_video_frame(&black), "actual black pixels are still real signal");
        black.get_mut().unwrap().set_flags(gst::BufferFlags::DISCONT | gst::BufferFlags::RESYNC);
        assert!(received_video_frame(&black), "first received recovery frame must be accepted");
    }
    #[test]
    fn invalid_video_does_not_renew_received_age_or_content_sample() {
        gst::init().unwrap();
        let pad = gst::Pad::builder(gst::PadDirection::Src).build();
        let old = Instant::now() - Duration::from_secs(3);
        let mut stats = SourceStatistics { last_video: Some(old), frames: 7, ..Default::default() };
        let mut gap = gst::Buffer::from_mut_slice(vec![0u8; 16]);
        gap.get_mut().unwrap().set_flags(gst::BufferFlags::GAP);
        stats.video(&pad, &gap);
        stats.video(&pad, &gst::Buffer::new());
        assert_eq!(stats.last_video, Some(old));
        assert_eq!(stats.frames, 7);
        assert_eq!(stats.content_sample_frames, 0);
        assert!(!stats.report(true).video_present);
        let received = gst::Buffer::from_mut_slice(vec![0u8; 16]);
        stats.video(&pad, &received);
        assert_eq!(stats.frames, 8);
        assert!(stats.last_video.unwrap() > old);
    }
    #[test]
    fn reports_input_caps_not_scaled_preview_and_no_invented_audio() {
        gst::init().unwrap();
        let stats = SourceStatistics {
            video_caps: Some(gst::Caps::builder("video/x-raw").field("width",1920i32).field("height",1080i32).field("framerate",gst::Fraction::new(30000,1001)).field("interlace-mode","progressive").build()),
            last_video: Some(Instant::now()), last_delivered_video: Some(Instant::now()), frames:25, ..Default::default()
        };
        let report = stats.report(true);
        assert_eq!((report.width,report.height,report.rate_num,report.rate_den),(Some(1920),Some(1080),Some(30000),Some(1001)));
        assert!(report.video_present);
        assert!(!report.audio_present);
        assert_eq!(report.audio_channels,None);
        assert_eq!(report.received_frames,25);
        assert!(!stats.report(false).video_present, "raw pad buffers alone cannot confirm safe intersink delivery");
    }
    #[test]
    fn stale_buffers_do_not_mean_video_or_audio_available() {
        let stats = SourceStatistics { last_video:Some(Instant::now()-Duration::from_secs(3)),last_audio:Some(Instant::now()-Duration::from_secs(3)),..Default::default() };
        let report = stats.report(true);
        assert!(!report.video_present && !report.audio_present);
        assert!(report.video_age_ms.unwrap() >= 3000);
    }
    #[test]
    fn live_readiness_expires_at_decoder_and_delivery_but_optional_audio_does_not_block() {
        let now=Instant::now();let old=now-Duration::from_secs(3);
        let mut stats=SourceStatistics{last_video:Some(now),last_delivered_video:Some(now),..Default::default()};
        assert!(stats.live_ready(true,false,false));
        assert!(!stats.live_ready(false,false,false));
        assert!(!stats.live_ready(true,true,true),"required audio needs recent buffers, not its first-buffer latch");
        stats.last_audio=Some(now);stats.last_delivered_audio=Some(now);
        assert!(stats.live_ready(true,true,true));
        stats.last_delivered_video=Some(old);
        assert!(!stats.live_ready(true,false,false),"decoder buffers do not prove delivery to intersink");
        assert!(!stats.report(true).video_present);
        stats.last_delivered_video=Some(now);stats.last_video=Some(old);
        assert!(!stats.live_ready(true,false,false),"synthetic downstream duplication cannot refresh the actual source");
        stats.last_video=Some(now);stats.last_delivered_audio=Some(old);
        assert!(!stats.live_ready(true,true,true));assert!(stats.live_ready(true,false,true));
        assert!(!stats.report(true).audio_present);
        stats.last_delivered_audio=Some(now);stats.last_audio=Some(old);
        assert!(!stats.live_ready(true,true,true));
    }
}

#[cfg(test)]
mod decoder_policy_tests {
    use super::*;

    #[test]
    fn default_excludes_hardware_decoders_not_parsers_or_software() {
        assert!(!decoder_allowed("Codec/Decoder/Video/Hardware",false));
        assert!(!decoder_allowed("Codec/Decoder/Audio/Hardware",false));
        assert!(decoder_allowed("Codec/Decoder/Video",false));
        assert!(decoder_allowed("Codec/Parser/Video",false));
        assert!(decoder_allowed("Codec/Demuxer",false));
        assert!(decoder_allowed("Codec/Decoder/Video/Hardware",true));
    }

    #[test]
    fn real_autoplug_signal_returns_skip_with_enum_type_without_changing_registry() {
        gst::init().unwrap();
        let decoder=uri_decoder_with_policy(false).unwrap();
        let pad=gst::Pad::builder(gst::PadDirection::Src).build();
        let caps=gst::Caps::builder("video/x-vp8").build();
        let signal=gst::glib::subclass::SignalId::lookup("autoplug-select",decoder.type_()).unwrap();
        let query=signal.query();
        let hardware=gst::ElementFactory::factories_with_type(gst::ElementFactoryType::DECODER,gst::Rank::NONE)
            .into_iter().filter(|factory|!decoder_allowed(factory.klass(),false)).collect::<Vec<_>>();
        // Host-dependent factory availability is not a hardware approval. If
        // present, prove the real enum signal vetoes it before instantiation.
        for factory in hardware {
            let rank=factory.rank();
            let result=decoder.emit_with_values(signal,&[pad.to_value(),caps.to_value(),factory.to_value()]).unwrap();
            assert_eq!(result.type_(),query.return_type().type_());
            assert_eq!(gst::glib::EnumValue::from_value(&result).unwrap().1.nick(),"skip");
            assert_eq!(factory.rank(),rank,"per-source policy must not rewrite process/plugin registry ranks");
        }
        let software=gst::ElementFactory::find("vp8dec").unwrap();
        let result=decoder.emit_with_values(signal,&[pad.to_value(),caps.to_value(),software.to_value()]).unwrap();
        assert_eq!(gst::glib::EnumValue::from_value(&result).unwrap().1.nick(),"try");
    }
}

#[cfg(test)]
mod testes_monitor_size {
    use super::monitor_size;

    /// As duas contas -- esta e a do pacote `protocol` -- têm que dar o mesmo
    /// número. O servidor calcula o tamanho do perfil da saída de monitor e o
    /// engine calcula as caps do preview: divergir aqui poria uma escala no
    /// meio do caminho, que é custo de CPU por causa de um pixel de diferença.
    #[test]
    fn bate_com_o_lado_typescript() {
        assert_eq!(monitor_size(1920, 1080), (428, 240));
        assert_eq!(monitor_size(1440, 1080), (320, 240));
        assert_eq!(monitor_size(1280, 720), (428, 240));
    }

    #[test]
    fn nao_amplia_o_que_ja_cabe() {
        assert_eq!(monitor_size(320, 180), (320, 180));
    }

    #[test]
    fn sai_sempre_par() {
        for (w, h) in [(1920, 1080), (1001, 563), (4096, 2160)] {
            let (largura, altura) = monitor_size(w, h);
            assert_eq!(largura % 2, 0, "{w}x{h} deu largura ímpar");
            assert_eq!(altura % 2, 0, "{w}x{h} deu altura ímpar");
        }
    }
}
