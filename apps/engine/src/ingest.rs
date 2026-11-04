//! Ingest único por entrada: cada entrada ao vivo é recebida e decodificada
//! UMA vez, num receptor compartilhado, e todos os consumidores leem dele.
//!
//! ```text
//!                       receptor (pipeline próprio, um por entrada)
//!  srt/rtmp/ndi/omt/sdi ─ fonte + decodificador ─┬─ fila ─ appsink vídeo (sync) ──┬─► sub PVW  (appsrc no pipeline do item)
//!   (aberta uma vez)                             │                               ├─► sub PGM  (idem, TAKE sem reabrir)
//!                                                │                               ├─► sonda do multiview (try_lock, O(1))
//!                                                │                               └─► medições do watchdog (uma vez por entrada)
//!                                                └─ fila ─ appsink áudio N (sync) ─► subs (só a trilha que cada item pediu)
//! ```
//!
//! Regras:
//! - Ninguém abre a mesma fonte duas vezes: NDI e SDI não aceitam, e o SRT em
//!   listener tem conflito de porta. A chave do receptor é o endereço da fonte.
//! - O receptor só existe enquanto alguém o usa ([`Lease`]): item (PGM, PVW,
//!   NEXT, QC, contingência), multiview com espectador ou watchdog. Sem
//!   ninguém, fica [`Hub::linger`] (2 s) esperando -- um CUE logo seguido de
//!   TAKE não reabre -- e depois fecha numa thread própria.
//! - O PGM não espera nada daqui: o receptor entrega cada quadro, já no
//!   relógio (appsink `sync`), a um `appsrc` por consumidor que não bloqueia
//!   (`block=false`, fila curta que descarta o mais velho). O multiview só
//!   lê a referência do último quadro com `try_lock`. Um consumidor lento
//!   perde quadros dele mesmo.
//! - Receptor aberto só para monitoramento (multiview, watchdog) sobe e desce
//!   fora do laço principal: uma fonte que trava no `set_state` não segura o
//!   programa. Receptor pedido por um item sobe na hora, como antes, para o
//!   erro de abertura voltar no LOAD/CUE.
//! - Falha da fonte (erro, EOS) é repassada ao bus de cada item assinante: o
//!   caminho de recuperação de sempre (`LiveRecovery`, reabertura do QC)
//!   continua valendo. A reabertura reaproveita o receptor (nova geração do
//!   mesmo receptor), e os itens antigos voltam a receber se ainda existirem.
//! - Retomada SRT (`srt_input`), `keep-listening` e latência do `tsdemux`
//!   ficam no receptor, idênticas ao que o item fazia.
//!
//! Desligável com `RPLAYOUT_INGEST_SHARED=0`: volta cada item a abrir a fonte
//! no próprio pipeline (comportamento até a r88-36).

use super::*;
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::{Mutex, Weak};
use std::thread::JoinHandle;

/// Quanto um receptor sem consumidor espera antes de fechar.
pub const LINGER: Duration = Duration::from_secs(2);
/// Intervalo entre reaberturas de um receptor que só serve ao monitoramento.
pub const MONITOR_RETRY: Duration = Duration::from_secs(2);
/// Quanto quem precisa da porta/dispositivo espera um receptor terminar de fechar.
const CLOSE_WAIT: Duration = Duration::from_secs(3);
/// Áudio: carimbo que cai a menos disto do esperado segue a sequência
/// contínua (a chegada tem jitter de agendamento; o áudio não pode ter).
const AUDIO_SNAP: Duration = Duration::from_millis(40);

static NEXT_RECEIVER: AtomicU64 = AtomicU64::new(1);
static NEXT_LEASE: AtomicU64 = AtomicU64::new(1);

/// Quem está usando o receptor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Consumer {
    /// Um item (PGM, PVW, NEXT, QC ou contingência). Prioridade do programa.
    Item,
    Multiview,
    Watchdog,
}

/// Desvios de teste.
#[derive(Clone, Default)]
pub struct Hooks {
    /// Atraso artificial ao subir o pipeline de um receptor de monitoramento
    /// (fonte que trava no `set_state`).
    pub monitor_start_stall: Option<Duration>,
    /// Atraso artificial por quadro no receptor (decodificação lenta).
    pub slow_per_frame: Option<Duration>,
}

// ---------------------------------------------------------------------------
// Assinatura de um item: um bin com um appsrc por trilha, no pipeline do item.
// ---------------------------------------------------------------------------

struct Port { src: gst_app::AppSrc, ghost: gst::GhostPad }

struct Sub {
    bin: gst::Bin,
    pipeline: gst::glib::WeakRef<gst::Pipeline>,
    active: AtomicBool,
    video: Mutex<Option<Port>>,
    audio: Mutex<BTreeMap<usize, Port>>,
    audio_next: Mutex<Option<gst::ClockTime>>,
    statistics: Mutex<Option<Arc<std::sync::Mutex<SourceStatistics>>>>,
    /// Quadros entregues a este assinante (teste/estado).
    delivered: AtomicU64,
}

fn appsrc(name: &str, kind: &str) -> Result<gst_app::AppSrc> {
    let src = gst_app::AppSrc::builder().name(name).is_live(true).format(gst::Format::Time)
        .do_timestamp(false).block(false).caps(&gst::Caps::new_empty_simple(kind)).build();
    crate::output::set_if_exists(src.upcast_ref(), "max-buffers", if kind.starts_with("video") { 2u64 } else { 8u64 });
    src.set_property_from_str("leaky-type", "downstream");
    crate::output::set_if_exists(src.upcast_ref(), "min-latency", 0i64);
    Ok(src)
}

impl Sub {
    fn new(pipeline_name: &str) -> Arc<Self> {
        let bin = gst::Bin::with_name(&format!("ingest-{pipeline_name}-{}", NEXT_LEASE.load(Ordering::Relaxed)));
        Arc::new(Sub { bin, pipeline: gst::glib::WeakRef::new(), active: AtomicBool::new(false), video: Mutex::new(None), audio: Mutex::new(BTreeMap::new()),
            audio_next: Mutex::new(None), statistics: Mutex::new(None), delivered: AtomicU64::new(0) })
    }

    fn add_port(&self, name: &str, kind: &str) -> Result<Port> {
        let src = appsrc(name, kind)?;
        self.bin.add(&src)?;
        let target = src.static_pad("src").ok_or_else(|| anyhow!("appsrc sem saída"))?;
        let ghost = gst::GhostPad::builder_with_target(&target)?.name(name).build();
        src.sync_state_with_parent()?;
        ghost.set_active(true)?;
        // Dispara o `pad-added` do bin: a montagem do item liga a cadeia.
        self.bin.add_pad(&ghost)?;
        Ok(Port { src, ghost })
    }

    fn ensure_video(&self) {
        if !self.active.load(Ordering::Acquire) { return; }
        let Ok(mut video) = self.video.lock() else { return };
        if video.is_some() { return; }
        match self.add_port("video", "video/x-raw") { Ok(port) => *video = Some(port), Err(error) => eprintln!("[engine] ingest: trilha de vídeo não exposta: {error:#}") }
    }

    fn ensure_audio(&self, track: usize) {
        if !self.active.load(Ordering::Acquire) { return; }
        let Ok(mut audio) = self.audio.lock() else { return };
        if audio.contains_key(&track) { return; }
        match self.add_port(&format!("audio_{track}"), "audio/x-raw") { Ok(port) => { audio.insert(track, port); } Err(error) => eprintln!("[engine] ingest: trilha de áudio {track} não exposta: {error:#}") }
    }

    /// Tempo do pipeline do item agora (running time), se ele está tocando.
    fn now(&self) -> Option<gst::ClockTime> {
        let pipeline = self.pipeline.upgrade()?;
        if pipeline.current_state() != gst::State::Playing { return None; }
        let clock = pipeline.clock()?;
        clock.time()?.checked_sub(pipeline.base_time()?)
    }

    fn push(port: &Port, sample: &gst::Sample, pts: gst::ClockTime) -> bool {
        let Some(buffer) = sample.buffer() else { return false };
        let mut copy = buffer.copy();
        if let Some(meta) = copy.get_mut() { meta.set_pts(pts); meta.set_dts(gst::ClockTime::NONE); }
        let mut builder = gst::Sample::builder().buffer(&copy);
        let caps = sample.caps_owned();
        if let Some(caps) = caps.as_ref() { builder = builder.caps(caps); }
        port.src.push_sample(&builder.build()).is_ok()
    }

    fn deliver_video(&self, sample: &gst::Sample) {
        // Trilha que chegou no meio da ativação do item: expõe agora.
        if self.active.load(Ordering::Acquire) && self.video.lock().is_ok_and(|video| video.is_none()) { self.ensure_video(); }
        let Ok(video) = self.video.lock() else { return };
        let Some(port) = video.as_ref() else { return };
        // Pad não ligado: empurrar faria o appsrc acusar NOT_LINKED no item.
        if port.ghost.peer().is_none() { return; }
        let Some(pts) = self.now() else { return };
        if Self::push(port, sample, pts) { self.delivered.fetch_add(1, Ordering::Relaxed); }
    }

    fn deliver_audio(&self, track: usize, sample: &gst::Sample, duration: Option<gst::ClockTime>) {
        if self.active.load(Ordering::Acquire) && self.audio.lock().is_ok_and(|audio| !audio.contains_key(&track)) { self.ensure_audio(track); }
        let Ok(audio) = self.audio.lock() else { return };
        let Some(port) = audio.get(&track) else { return };
        if port.ghost.peer().is_none() { return; }
        let Some(now) = self.now() else { return };
        let Ok(mut next) = self.audio_next.lock() else { return };
        let pts = match *next {
            Some(expected) if now.max(expected) - now.min(expected) <= gst::ClockTime::from_nseconds(AUDIO_SNAP.as_nanos() as u64) => expected,
            _ => now,
        };
        *next = duration.map(|duration| pts + duration);
        Self::push(port, sample, pts);
    }

    fn on_bytes(&self, bytes: u64, now: Instant) {
        if let Some(statistics) = self.statistics.lock().ok().and_then(|statistics| statistics.clone()) {
            if let Ok(mut statistics) = statistics.lock() { statistics.quality.on_input_bytes(bytes, now); }
        }
    }

    fn post(&self, message: impl FnOnce(&gst::Bin) -> gst::Message) {
        if let Some(bus) = self.pipeline.upgrade().and_then(|pipeline| pipeline.bus()) { let _ = bus.post(message(&self.bin)); }
    }
}

// ---------------------------------------------------------------------------
// Receptor.
// ---------------------------------------------------------------------------

/// Uma geração do pipeline do receptor (reabrir a fonte cria outra).
struct Running {
    pipeline: gst::Pipeline,
    generation: u64,
    failed: Arc<AtomicBool>,
    tracks: Arc<GenTracks>,
}

/// Trilhas montadas nesta geração (os `pad-added` podem vir de threads diferentes).
#[derive(Default)]
struct GenTracks { video_taken: AtomicBool, audio_count: AtomicUsize, video_pad: Mutex<Option<gst::Pad>> }

#[derive(Default)]
struct Tracks { video: bool, audio: usize, complete: bool }

pub struct Receiver {
    id: u64,
    key: String,
    spec: Mutex<ItemSpec>,
    consumers: Mutex<BTreeMap<u64, Consumer>>,
    idle_since: Mutex<Option<Instant>>,
    subs: Mutex<Arc<Vec<Arc<Sub>>>>,
    tracks: Mutex<Tracks>,
    running: Mutex<Option<Running>>,
    generation: AtomicU64,
    /// Aberturas reais da fonte (prova de "uma vez só").
    openings: AtomicU64,
    /// Medições da entrada, uma vez por entrada (watchdog e multiview).
    statistics: Arc<std::sync::Mutex<SourceStatistics>>,
    frames: AtomicU64,
    last_error: Mutex<Option<String>>,
    retry_at: Mutex<Option<Instant>>,
    /// Abertura/reabertura em andamento numa thread própria.
    starting: Mutex<Option<JoinHandle<()>>>,
    source_ids: Mutex<std::collections::BTreeSet<String>>,
    hooks: Hooks,
    opened_at: Instant,
}

/// Alvo do contador de bytes de rede (`input_quality::count_network_input`).
struct Bytes { receiver: Weak<Receiver> }

fn on_bytes(target: &mut Bytes, bytes: u64) {
    let Some(receiver) = target.receiver.upgrade() else { return };
    let now = Instant::now();
    if let Ok(mut statistics) = receiver.statistics.lock() { statistics.quality.on_input_bytes(bytes, now); }
    let subs = receiver.subs.lock().map(|subs| Arc::clone(&subs)).unwrap_or_default();
    for sub in subs.iter() { sub.on_bytes(bytes, now); }
}

/// Chave do receptor: o endereço normalizado da fonte. Na placa, o
/// dispositivo (a captura de áudio é do receptor, ver [`needs_more_audio`]).
pub fn key_for(spec: &ItemSpec) -> Option<String> {
    let source = spec.source.as_deref()?.trim();
    let normalized = if let Some(rest) = source.strip_prefix("decklink://").or_else(|| source.strip_prefix("sdi://")).or_else(|| source.strip_prefix("decklink:")) { format!("sdi:{rest}") }
        else if let Some(rest) = source.strip_prefix("ndi://") { format!("ndi:{rest}") } else { source.to_string() };
    Some(normalized)
}

fn sdi_channels(spec: &ItemSpec) -> usize {
    crate::audio_bus::sdi_capture_channels(&spec.audio_routing, &spec.auxiliary_pairs).unwrap_or(2)
}

/// A placa aberta para 2 canais não serve a quem pediu 8 ou 16: o receptor é
/// reaberto com a captura maior (o monitoramento pisca, o programa recebe o
/// que precisa).
fn needs_more_audio(current: &ItemSpec, wanted: &ItemSpec) -> bool {
    key_for(wanted).is_some_and(|key| key.starts_with("sdi:")) && sdi_channels(wanted) > sdi_channels(current)
}

impl Receiver {
    fn new(key: String, spec: &ItemSpec, hooks: Hooks) -> Arc<Self> {
        let mut template = spec.clone();
        template.item_id = format!("ingest-{key_hash:x}", key_hash = fxhash(&key));
        Arc::new(Receiver {
            id: NEXT_RECEIVER.fetch_add(1, Ordering::Relaxed), key, spec: Mutex::new(template),
            consumers: Mutex::new(BTreeMap::new()), idle_since: Mutex::new(Some(Instant::now())), subs: Mutex::new(Arc::new(Vec::new())),
            tracks: Mutex::new(Tracks::default()), running: Mutex::new(None), generation: AtomicU64::new(0), openings: AtomicU64::new(0),
            statistics: Arc::new(std::sync::Mutex::new(SourceStatistics::default())), frames: AtomicU64::new(0), last_error: Mutex::new(None),
            retry_at: Mutex::new(None), starting: Mutex::new(None), source_ids: Mutex::new(Default::default()), hooks, opened_at: Instant::now(),
        })
    }

    pub fn id(&self) -> u64 { self.id }
    pub fn openings(&self) -> u64 { self.openings.load(Ordering::Relaxed) }

    fn failed(&self) -> bool {
        self.running.lock().ok().and_then(|running| running.as_ref().map(|running| running.failed.load(Ordering::Acquire))).unwrap_or(false)
    }

    fn consumer_kinds(&self) -> Vec<Consumer> {
        let mut kinds: Vec<Consumer> = self.consumers.lock().map(|consumers| consumers.values().copied().collect()).unwrap_or_default();
        kinds.sort(); kinds.dedup(); kinds
    }

    /// Monta o pipeline de uma geração. Não muda estado.
    fn build(self: &Arc<Self>) -> Result<Running> {
        let spec = self.spec.lock().map_err(|_| anyhow!("receptor envenenado"))?.clone();
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        let pipeline = gst::Pipeline::with_name(&format!("ingest-{}-{generation}", self.id));
        // Sempre o relógio do sistema: os itens carimbam pelo relógio deles e
        // a placa, se fosse o relógio aqui, empurraria o dela.
        pipeline.use_clock(Some(&gst::SystemClock::obtain()));
        let src = source_for(&spec)?;
        pipeline.add(&src.video)?;
        if let Some(extra) = src.audio.as_ref() {
            pipeline.add(extra)?;
            if src.dynamic { gst::Element::link(&src.video, extra)?; }
        }
        crate::input_quality::count_network_input(&src.video, Arc::new(std::sync::Mutex::new(Bytes { receiver: Arc::downgrade(self) })), on_bytes);
        let failed = Arc::new(AtomicBool::new(false));
        let gen_tracks = Arc::new(GenTracks::default());
        if let Ok(mut tracks) = self.tracks.lock() { tracks.complete = !src.dynamic; }

        // Erro/EOS: marca a geração como falha e repassa a cada item.
        if let Some(bus) = pipeline.bus() {
            let weak = Arc::downgrade(self);
            let failed = Arc::clone(&failed);
            bus.set_sync_handler(move |_, message| {
                let reason = match message.view() {
                    gst::MessageView::Error(error) => Some((error.error().to_string(), false)),
                    gst::MessageView::Eos(_) => Some(("a fonte encerrou o sinal".to_string(), true)),
                    _ => None,
                };
                if let (Some((reason, eos)), Some(receiver)) = (reason, weak.upgrade()) {
                    if !failed.swap(true, Ordering::AcqRel) {
                        eprintln!("[engine] ingest {}: fonte caiu: {reason}", receiver.id);
                        if let Ok(mut last) = receiver.last_error.lock() { *last = Some(reason.clone()); }
                        if let Ok(mut retry) = receiver.retry_at.lock() { *retry = Some(Instant::now() + MONITOR_RETRY); }
                        let subs = receiver.subs.lock().map(|subs| Arc::clone(&subs)).unwrap_or_default();
                        for sub in subs.iter() {
                            if eos { sub.post(|bin| gst::message::Eos::builder().src(bin).build()); }
                            else { sub.post(|bin| gst::message::Error::builder(gst::CoreError::Failed, &reason).src(bin).build()); }
                        }
                    }
                }
                gst::BusSyncReply::Drop
            });
        }

        let porta = src.audio.clone().filter(|_| src.dynamic).unwrap_or_else(|| src.video.clone());
        let mount: Arc<dyn Fn(&gst::Pad, Option<&str>) + Send + Sync> = {
            let weak = Arc::downgrade(self);
            let pipeline_weak = pipeline.downgrade();
            let gen_tracks = Arc::clone(&gen_tracks);
            let generation_failed = Arc::clone(&failed);
            Arc::new(move |pad: &gst::Pad, static_kind: Option<&str>| {
                let (Some(receiver), Some(pipeline)) = (weak.upgrade(), pipeline_weak.upgrade()) else { return };
                if generation_failed.load(Ordering::Acquire) { return; }
                let caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
                let Some(name) = static_kind.map(str::to_string).or_else(|| caps.structure(0).map(|s| s.name().to_string())) else { return };
                if let Err(error) = receiver.mount(&pipeline, pad, &name, &gen_tracks) { eprintln!("[engine] ingest {}: trilha não montada: {error:#}", receiver.id); }
            })
        };
        let dynamic = Arc::clone(&mount);
        porta.connect_pad_added(move |_, pad| dynamic(pad, None));
        if src.dynamic {
            let weak = Arc::downgrade(self);
            porta.connect_no_more_pads(move |_| { if let Some(receiver) = weak.upgrade() { receiver.complete(); } });
        } else {
            for (element, kind) in [(Some(&src.video), "video/x-raw"), (src.audio.as_ref(), "audio/x-raw")].into_iter().filter_map(|(element, kind)| element.map(|element| (element, kind))) {
                if let Some(pad) = element.static_pad("src") { mount(&pad, Some(kind)); }
            }
        }
        crate::fencing::guard_pipeline(&pipeline)?;
        self.openings.fetch_add(1, Ordering::Relaxed);
        Ok(Running { pipeline, generation, failed, tracks: gen_tracks })
    }

    fn complete(&self) {
        if let Ok(mut tracks) = self.tracks.lock() { tracks.complete = true; }
        let subs = self.subs.lock().map(|subs| Arc::clone(&subs)).unwrap_or_default();
        for sub in subs.iter() { if sub.active.load(Ordering::Acquire) { sub.bin.no_more_pads(); } }
    }

    /// Liga uma trilha decodificada a um appsink no relógio, que reparte.
    fn mount(self: &Arc<Self>, pipeline: &gst::Pipeline, pad: &gst::Pad, name: &str, gen: &GenTracks) -> Result<()> {
        let video = name.starts_with("video/");
        if !video && !name.starts_with("audio/") { return Ok(()); }
        let track = if video {
            // Só a primeira trilha de vídeo, como o item.
            if gen.video_taken.swap(true, Ordering::AcqRel) { return Ok(()); }
            0
        } else {
            // Trilhas de áudio desta geração, na ordem em que a fonte as declara.
            gen.audio_count.fetch_add(1, Ordering::AcqRel)
        };
        let queue = make("queue")?;
        let sink = gst_app::AppSink::builder().name(if video { "ingest-video".to_string() } else { format!("ingest-audio-{track}") })
            .caps(&gst::Caps::new_empty_simple(if video { "video/x-raw" } else { "audio/x-raw" }))
            .sync(true).max_buffers(2).drop(true).build();
        sink.set_property("async", false);
        sink.set_property("enable-last-sample", false);
        sink.set_property("qos", false);
        let mut chain: Vec<gst::Element> = vec![queue.clone()];
        if let (true, Some(delay)) = (video, self.hooks.slow_per_frame) {
            let slow = make("identity")?;
            slow.set_property("sleep-time", delay.as_micros() as u32);
            chain.push(slow);
        }
        chain.push(sink.clone().upcast());
        pipeline.add_many(&chain)?;
        gst::Element::link_many(&chain)?;
        let weak = Arc::downgrade(self);
        if video {
            // Medições da entrada, no pad decodificado, como no item.
            let statistics = Arc::clone(&self.statistics);
            pad.add_probe(gst::PadProbeType::BUFFER, move |pad, info| {
                if let Some(buffer) = info.buffer() { if let Ok(mut statistics) = statistics.lock() { statistics.video(pad, buffer); } }
                gst::PadProbeReturn::Ok
            });
            sink.set_callbacks(gst_app::AppSinkCallbacks::builder().new_sample(move |sink| {
                let sample = sink.pull_sample().map_err(|_| gst::FlowError::Flushing)?;
                if let Some(receiver) = weak.upgrade() {
                    receiver.frames.fetch_add(1, Ordering::Relaxed);
                    if let Ok(mut statistics) = receiver.statistics.lock() { statistics.last_delivered_video = Some(Instant::now()); }
                    let subs = receiver.subs.lock().map(|subs| Arc::clone(&subs)).unwrap_or_default();
                    for sub in subs.iter() { sub.deliver_video(&sample); }
                }
                Ok(gst::FlowSuccess::Ok)
            }).build());
        } else {
            let statistics = Arc::clone(&self.statistics);
            let first = track == 0;
            pad.add_probe(gst::PadProbeType::BUFFER, move |pad, info| {
                if !first { return gst::PadProbeReturn::Ok; }
                if let Ok(mut statistics) = statistics.lock() {
                    statistics.audio_caps = pad.current_caps();
                    statistics.last_audio = Some(Instant::now());
                    if let Some(buffer) = info.buffer() { let caps = statistics.audio_caps.clone(); statistics.quality.on_audio(caps.as_ref(), buffer, Instant::now()); }
                }
                gst::PadProbeReturn::Ok
            });
            sink.set_callbacks(gst_app::AppSinkCallbacks::builder().new_sample(move |sink| {
                let sample = sink.pull_sample().map_err(|_| gst::FlowError::Flushing)?;
                if let Some(receiver) = weak.upgrade() {
                    let duration = sample.buffer().and_then(|buffer| buffer.duration()).or_else(|| {
                        let info = gstreamer_audio::AudioInfo::from_caps(sample.caps()?).ok()?;
                        let frames = sample.buffer()?.size() as u64 / info.bpf().max(1) as u64;
                        gst::ClockTime::SECOND.mul_div_floor(frames, info.rate().max(1) as u64)
                    });
                    if first { if let Ok(mut statistics) = receiver.statistics.lock() { statistics.last_delivered_audio = Some(Instant::now()); } }
                    let subs = receiver.subs.lock().map(|subs| Arc::clone(&subs)).unwrap_or_default();
                    for sub in subs.iter() { sub.deliver_audio(track, &sample, duration); }
                }
                Ok(gst::FlowSuccess::Ok)
            }).build());
        }
        for element in &chain { element.sync_state_with_parent()?; }
        pad.link(&queue.static_pad("sink").ok_or_else(|| anyhow!("fila sem entrada"))?)?;
        if video {
            if let Ok(mut guard) = gen.video_pad.lock() { *guard = sink.static_pad("sink"); }
        }
        // Novidade de trilha: expõe nos itens que já assinam.
        let known = {
            let Ok(mut tracks) = self.tracks.lock() else { return Ok(()) };
            if video { let new = !tracks.video; tracks.video = true; new } else { let new = track >= tracks.audio; tracks.audio = tracks.audio.max(track + 1); new }
        };
        if known {
            let subs = self.subs.lock().map(|subs| Arc::clone(&subs)).unwrap_or_default();
            for sub in subs.iter() { if video { sub.ensure_video(); } else { sub.ensure_audio(track); } }
        }
        Ok(())
    }

    /// Sobe uma geração nova. `background`: a mudança de estado vai para uma
    /// thread própria (monitoramento: fonte que trava não segura ninguém).
    fn start(self: &Arc<Self>, background: bool) -> Result<()> {
        self.wait_starting();
        let running = self.build()?;
        let pipeline = running.pipeline.clone();
        let old = self.running.lock().map_err(|_| anyhow!("receptor envenenado"))?.replace(running);
        if let Ok(mut retry) = self.retry_at.lock() { *retry = None; }
        if background {
            let stall = self.hooks.monitor_start_stall;
            let failed = self.running.lock().ok().and_then(|running| running.as_ref().map(|running| Arc::clone(&running.failed)));
            let handle = std::thread::Builder::new().name("ingest-abre".into()).spawn(move || {
                if let Some(old) = old { let _ = old.pipeline.set_state(gst::State::Null); }
                if let Some(stall) = stall { std::thread::sleep(stall); }
                if pipeline.set_state(gst::State::Playing).is_err() { if let Some(failed) = failed { failed.store(true, Ordering::Release); } }
            })?;
            if let Ok(mut starting) = self.starting.lock() { *starting = Some(handle); }
            Ok(())
        } else {
            if let Some(old) = old { let _ = old.pipeline.set_state(gst::State::Null); }
            if let Err(error) = pipeline.set_state(gst::State::Playing) {
                if let Some(running) = self.running.lock().ok().and_then(|mut running| running.take()) { let _ = running.pipeline.set_state(gst::State::Null); }
                return Err(anyhow!("a entrada não abriu: {error}"));
            }
            Ok(())
        }
    }

    /// Espera (limitada) uma abertura em segundo plano terminar.
    fn wait_starting(&self) {
        let handle = self.starting.lock().ok().and_then(|mut starting| starting.take());
        if let Some(handle) = handle {
            let until = Instant::now() + CLOSE_WAIT;
            while !handle.is_finished() && Instant::now() < until { std::thread::sleep(Duration::from_millis(5)); }
            if handle.is_finished() { let _ = handle.join(); }
        }
    }

    #[cfg(test)]
    pub fn pipeline_for_test(&self) -> Option<gst::Pipeline> { self.running.lock().ok()?.as_ref().map(|running| running.pipeline.clone()) }

    /// Pad do appsink de vídeo da geração atual: ponto de sonda do multiview.
    pub fn tap(&self) -> Option<(gst::Pad, u64)> {
        let running = self.running.lock().ok()?;
        let running = running.as_ref()?;
        let pad = running.tracks.video_pad.lock().ok()?.clone()?;
        Some((pad, (self.id << 20) | (running.generation & 0xFFFFF)))
    }

    /// Imagem parada há tanto tempo (impressão do conteúdo ou grade de luma,
    /// com amostra recente), como o watchdog conta.
    pub fn frozen_ms(&self) -> Option<u64> {
        let signal = self.signal();
        let exact = signal.sampled_content_unchanged_ms.filter(|_| signal.content_sample_age_ms.is_some_and(|age| age <= 1000));
        let still = signal.quality.luma_static_ms.filter(|_| signal.quality.luma_sample_age_ms.is_some_and(|age| age <= 1000));
        match (exact, still) { (None, None) => None, (a, b) => Some(a.unwrap_or(0).max(b.unwrap_or(0))) }
    }

    pub fn signal(&self) -> SourceSignalReport {
        self.statistics.lock().map(|statistics| statistics.report(statistics.last_delivered_video.is_some())).unwrap_or_else(|_| SourceStatistics::default().report(false))
    }

    /// Fecha a geração atual numa thread própria.
    fn close(self: &Arc<Self>) -> Option<JoinHandle<()>> {
        let starting = self.starting.lock().ok().and_then(|mut starting| starting.take());
        let running = self.running.lock().ok().and_then(|mut running| running.take());
        if starting.is_none() && running.is_none() { return None; }
        std::thread::Builder::new().name("ingest-fecha".into()).spawn(move || {
            if let Some(starting) = starting { let _ = starting.join(); }
            if let Some(running) = running { let _ = running.pipeline.set_state(gst::State::Null); }
        }).ok()
    }
}

fn fxhash(text: &str) -> u64 {
    text.bytes().fold(14695981039346656037u64, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(1099511628211))
}

// ---------------------------------------------------------------------------
// Concessão: quem segura o receptor vivo.
// ---------------------------------------------------------------------------

pub struct Lease {
    receiver: Arc<Receiver>,
    id: u64,
    consumer: Consumer,
    sub: Option<Arc<Sub>>,
}

impl Lease {
    pub fn receiver(&self) -> &Arc<Receiver> { &self.receiver }
    #[allow(dead_code)]
    pub fn consumer(&self) -> Consumer { self.consumer }

    /// Item: as medições do item recebem também os bytes de rede da entrada.
    pub(super) fn set_statistics(&self, statistics: Arc<std::sync::Mutex<SourceStatistics>>) {
        if let Some(sub) = &self.sub { if let Ok(mut slot) = sub.statistics.lock() { *slot = Some(statistics); } }
    }

    /// Item: depois de ligar o `pad-added` do bin, expõe as trilhas já
    /// conhecidas e passa a receber quadros.
    pub fn activate(&self, pipeline: &gst::Pipeline) {
        let Some(sub) = &self.sub else { return };
        sub.pipeline.set(Some(pipeline));
        sub.active.store(true, Ordering::Release);
        let (video, audio, complete) = self.receiver.tracks.lock().map(|tracks| (tracks.video, tracks.audio, tracks.complete)).unwrap_or_default();
        if video { sub.ensure_video(); }
        for track in 0..audio { sub.ensure_audio(track); }
        if complete && (video || audio > 0) { sub.bin.no_more_pads(); }
    }

    /// Quadros entregues a este item (teste).
    #[allow(dead_code)]
    pub fn delivered(&self) -> u64 { self.sub.as_ref().map_or(0, |sub| sub.delivered.load(Ordering::Relaxed)) }
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(sub) = self.sub.take() {
            sub.active.store(false, Ordering::Release);
            if let Ok(mut subs) = self.receiver.subs.lock() {
                let kept: Vec<Arc<Sub>> = subs.iter().filter(|other| !Arc::ptr_eq(other, &sub)).cloned().collect();
                *subs = Arc::new(kept);
            }
        }
        if let Ok(mut consumers) = self.receiver.consumers.lock() {
            consumers.remove(&self.id);
            if consumers.is_empty() { if let Ok(mut idle) = self.receiver.idle_since.lock() { *idle = Some(Instant::now()); } }
        }
    }
}

// ---------------------------------------------------------------------------
// O conjunto de receptores do canal.
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestReport {
    pub receiver_id: u64,
    /// Esquema da fonte (srt, rtmp, ndi, omt, sdi...). O endereço não sai: pode ter senha.
    pub kind: String,
    /// Entradas cadastradas que apontam para este receptor.
    pub source_ids: Vec<String>,
    pub consumers: Vec<Consumer>,
    pub items: usize,
    pub openings: u64,
    pub generation: u64,
    pub failed: bool,
    pub error: Option<String>,
    pub frames: u64,
    pub uptime_ms: u64,
    pub signal: SourceSignalReport,
}

pub struct Hub {
    enabled: bool,
    linger: Duration,
    receivers: Mutex<Vec<Arc<Receiver>>>,
    closing: Mutex<Vec<(String, JoinHandle<()>)>>,
    /// Entradas que o watchdog pediu para acompanhar (id -> concessão).
    watched: Mutex<BTreeMap<String, (String, Lease)>>,
    hooks: Hooks,
}

impl Default for Hub { fn default() -> Self { Hub::from_env() } }

impl Hub {
    pub fn new(enabled: bool, linger: Duration) -> Self {
        Hub { enabled, linger, receivers: Mutex::new(Vec::new()), closing: Mutex::new(Vec::new()), watched: Mutex::new(BTreeMap::new()), hooks: Hooks::default() }
    }

    /// `RPLAYOUT_INGEST_SHARED=0` desliga; `RPLAYOUT_INGEST_LINGER_MS` muda a espera.
    pub fn from_env() -> Self {
        let enabled = std::env::var("RPLAYOUT_INGEST_SHARED").map_or(true, |value| value.trim() != "0");
        let linger = std::env::var("RPLAYOUT_INGEST_LINGER_MS").ok().and_then(|value| value.trim().parse::<u64>().ok())
            .map(|ms| Duration::from_millis(ms.min(60_000))).unwrap_or(LINGER);
        Hub::new(enabled, linger)
    }

    pub fn enabled(&self) -> bool { self.enabled }
    #[cfg(test)]
    pub fn set_hooks(&mut self, hooks: Hooks) { self.hooks = hooks; }
    #[cfg(test)]
    pub fn set_linger(&mut self, linger: Duration) { self.linger = linger; }

    pub fn receivers(&self) -> Vec<Arc<Receiver>> { self.receivers.lock().map(|receivers| receivers.clone()).unwrap_or_default() }

    /// Espera (limitada) um receptor da mesma chave terminar de fechar: a porta
    /// SRT e o dispositivo só ficam livres depois do NULL.
    fn wait_closed(&self, key: &str) {
        let handles: Vec<JoinHandle<()>> = match self.closing.lock() {
            Ok(mut closing) => { let (same, other): (Vec<_>, Vec<_>) = closing.drain(..).partition(|(k, _)| k == key); *closing = other; same.into_iter().map(|(_, handle)| handle).collect() }
            Err(_) => Vec::new(),
        };
        let until = Instant::now() + CLOSE_WAIT;
        for handle in handles {
            while !handle.is_finished() && Instant::now() < until { std::thread::sleep(Duration::from_millis(5)); }
            if handle.is_finished() { let _ = handle.join(); }
        }
    }

    fn lease(&self, spec: &ItemSpec, consumer: Consumer, sub: Option<Arc<Sub>>) -> Result<Lease> {
        let key = key_for(spec).ok_or_else(|| anyhow!("entrada sem endereço"))?;
        let existing = self.receivers.lock().map_err(|_| anyhow!("ingest envenenado"))?.iter().find(|receiver| receiver.key == key).cloned();
        let background = consumer != Consumer::Item;
        let receiver = match existing {
            Some(receiver) => {
                let upgrade = receiver.spec.lock().map(|current| needs_more_audio(&current, spec)).unwrap_or(false);
                if upgrade { if let Ok(mut current) = receiver.spec.lock() { current.audio_routing = spec.audio_routing.clone(); current.auxiliary_pairs = spec.auxiliary_pairs.clone(); } }
                let running = receiver.running.lock().map(|running| running.is_some()).unwrap_or(false);
                // Fonte caída: o item que pede reabre agora (a recuperação de
                // sempre); o monitoramento espera o serviço reabrir.
                if !running || upgrade || (consumer == Consumer::Item && receiver.failed()) { receiver.start(background)?; }
                receiver
            }
            None => {
                self.wait_closed(&key);
                let receiver = Receiver::new(key, spec, self.hooks.clone());
                receiver.start(background)?;
                self.receivers.lock().map_err(|_| anyhow!("ingest envenenado"))?.push(Arc::clone(&receiver));
                receiver
            }
        };
        if let Some(id) = spec.configured_source_id.as_ref() { if let Ok(mut ids) = receiver.source_ids.lock() { ids.insert(id.clone()); } }
        let id = NEXT_LEASE.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut consumers) = receiver.consumers.lock() { consumers.insert(id, consumer); }
        if let Ok(mut idle) = receiver.idle_since.lock() { *idle = None; }
        if let Some(sub) = &sub {
            if let Ok(mut subs) = receiver.subs.lock() { let mut list: Vec<Arc<Sub>> = subs.iter().cloned().collect(); list.push(Arc::clone(sub)); *subs = Arc::new(list); }
        }
        Ok(Lease { receiver, id, consumer, sub })
    }

    /// Item: devolve a fonte do item (um bin com um appsrc por trilha) e a
    /// concessão que o mantém ligado ao receptor.
    pub fn subscribe(&self, spec: &ItemSpec) -> Result<(LiveInput, Lease)> {
        let sub = Sub::new(&spec.item_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect::<String>());
        let lease = self.lease(spec, Consumer::Item, Some(Arc::clone(&sub)))?;
        Ok((LiveInput { video: sub.bin.clone().upcast(), audio: None, dynamic: true }, lease))
    }

    /// Multiview ou watchdog: só segura o receptor vivo.
    pub fn monitor(&self, spec: &ItemSpec, consumer: Consumer) -> Result<Lease> { self.lease(spec, consumer, None) }

    /// Fonte de monitoramento a partir do cadastro (multiview/watchdog).
    pub fn monitor_spec(source_id: &str, endpoint: &str) -> ItemSpec {
        ItemSpec {
            item_id: format!("monitor-{source_id}"), path: String::new(), source: Some(endpoint.to_string()), configured_source_id: Some(source_id.to_string()),
            source_type: None, fallback_path: None, trim_in: 0, trim_out: 0, start_offset_frames: 0, gain_db: 0.0, fit: Fit::Pillarbox, audio_track: 0,
            audio_routing: Default::default(), auxiliary_pairs: Vec::new(), auto_follow_on_end: false, emergency_cut_fade_ms: None,
        }
    }

    /// Entradas que o watchdog quer acompanhar (substitui a lista anterior).
    pub fn set_watched(&self, sources: Vec<(String, String)>) -> Result<()> {
        let mut watched = self.watched.lock().map_err(|_| anyhow!("ingest envenenado"))?;
        let wanted: BTreeMap<String, String> = sources.into_iter().collect();
        watched.retain(|id, (endpoint, _)| wanted.get(id) == Some(endpoint));
        for (id, endpoint) in wanted {
            if watched.contains_key(&id) { continue; }
            match self.monitor(&Self::monitor_spec(&id, &endpoint), Consumer::Watchdog) {
                Ok(lease) => { watched.insert(id, (endpoint, lease)); }
                Err(error) => eprintln!("[engine] watchdog: entrada {id} não aberta: {error:#}"),
            }
        }
        Ok(())
    }

    /// Uma volta do laço principal: fecha quem ficou sem consumidor e reabre
    /// a fonte caída que só o monitoramento usa. Nada aqui espera pipeline.
    pub fn service(&self) {
        let now = Instant::now();
        let Ok(mut receivers) = self.receivers.lock() else { return };
        let mut closed = Vec::new();
        receivers.retain(|receiver| {
            let idle = receiver.idle_since.lock().ok().and_then(|idle| *idle);
            let empty = receiver.consumers.lock().map(|consumers| consumers.is_empty()).unwrap_or(true);
            if empty && idle.is_some_and(|since| now.saturating_duration_since(since) >= self.linger) {
                if let Some(handle) = receiver.close() { closed.push((receiver.key.clone(), handle)); }
                return false;
            }
            true
        });
        for receiver in receivers.iter() {
            let kinds = receiver.consumer_kinds();
            let monitor_only = !kinds.is_empty() && !kinds.contains(&Consumer::Item);
            let due = receiver.retry_at.lock().ok().and_then(|retry| *retry).is_some_and(|at| now >= at);
            if monitor_only && receiver.failed() && due {
                if let Ok(mut retry) = receiver.retry_at.lock() { *retry = Some(now + MONITOR_RETRY); }
                if let Err(error) = receiver.start(true) { eprintln!("[engine] ingest {}: reabertura recusada: {error:#}", receiver.id); }
            }
        }
        drop(receivers);
        if !closed.is_empty() { if let Ok(mut closing) = self.closing.lock() { closing.extend(closed); closing.retain(|(_, handle)| !handle.is_finished()); } }
    }

    pub fn reports(&self) -> Vec<IngestReport> {
        self.receivers().iter().map(|receiver| {
            let spec_source = receiver.key.clone();
            IngestReport {
                receiver_id: receiver.id,
                kind: spec_source.split(':').next().unwrap_or("").to_ascii_lowercase(),
                source_ids: receiver.source_ids.lock().map(|ids| ids.iter().cloned().collect()).unwrap_or_default(),
                consumers: receiver.consumer_kinds(),
                items: receiver.subs.lock().map(|subs| subs.len()).unwrap_or(0),
                openings: receiver.openings(),
                generation: receiver.running.lock().ok().and_then(|running| running.as_ref().map(|running| running.generation)).unwrap_or(0),
                failed: receiver.failed(),
                error: receiver.last_error.lock().ok().and_then(|error| error.clone()),
                frames: receiver.frames.load(Ordering::Relaxed),
                uptime_ms: receiver.opened_at.elapsed().as_millis() as u64,
                signal: receiver.signal(),
            }
        }).collect()
    }

    /// Receptor vivo de uma entrada cadastrada (para o multiview e o estado).
    #[allow(dead_code)]
    pub fn find(&self, endpoint: &str) -> Option<Arc<Receiver>> {
        let key = key_for(&Self::monitor_spec("", endpoint))?;
        self.receivers().into_iter().find(|receiver| receiver.key == key)
    }

    pub fn shutdown(&self) {
        if let Ok(mut watched) = self.watched.lock() { watched.clear(); }
        let receivers = self.receivers.lock().map(|mut receivers| std::mem::take(&mut *receivers)).unwrap_or_default();
        for receiver in receivers {
            receiver.wait_starting();
            if let Some(running) = receiver.running.lock().ok().and_then(|mut running| running.take()) { let _ = running.pipeline.set_state(gst::State::Null); }
        }
        let closing = self.closing.lock().map(|mut closing| std::mem::take(&mut *closing)).unwrap_or_default();
        for (_, handle) in closing { let _ = handle.join(); }
    }
}

impl Drop for Hub { fn drop(&mut self) { self.shutdown(); } }

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::multiview::{CellSource, CellSignal, Composition, Hooks as MvHooks, Layout, Quality, BUS as MV_BUS};
    use std::sync::Mutex as StdMutex;

    struct Running(Channel);
    impl Drop for Running { fn drop(&mut self) { self.0.shutdown(); } }
    struct Sender(std::process::Child);
    impl Drop for Sender { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }

    fn available() -> bool {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        ["srtsrc", "srtsink", "x264enc", "avenc_aac", "mpegtsmux", "h264parse", "compositor"].iter().all(|name| gst::ElementFactory::find(name).is_some())
            && std::process::Command::new("gst-launch-1.0").arg("--version").output().is_ok()
    }

    fn port(offset: u16) -> u16 { 22_000 + (std::process::id() % 500) as u16 * 8 + offset }

    /// Gerador SRT em processo próprio (listener): a CPU dele não entra na conta do engine.
    fn sender(port: u16, width: i32, height: i32) -> Sender {
        let description = format!("videotestsrc is-live=true pattern=ball ! video/x-raw,width={width},height={height},framerate=25/1 \
            ! x264enc tune=zerolatency speed-preset=ultrafast key-int-max=25 bitrate=1500 ! h264parse ! queue ! mpegtsmux name=m alignment=7 \
            ! srtsink uri=srt://127.0.0.1:{port}?mode=listener wait-for-connection=false \
            audiotestsrc is-live=true volume=0.3 ! audio/x-raw,rate=48000,channels=2 ! avenc_aac ! queue ! m.");
        Sender(std::process::Command::new("gst-launch-1.0").arg("-q").args(description.split_whitespace())
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().expect("gst-launch-1.0"))
    }

    fn endpoint(port: u16) -> String { format!("srt://127.0.0.1:{port}?mode=caller&latency=120") }

    fn open_channel(name: &str, width: i32, height: i32) -> Running { channel(name, width, height) }
    fn channel(name: &str, width: i32, height: i32) -> Running {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let mut channel = Running(Channel::new(Config { channel_id: format!("{name}-{unique}"), width, height, fps_n: 25, fps_d: 1, bitrate_kbps: 450,
            ceiling_dbtp: -1.0, audio_channels: 2, scan: Scan::Progressive, top_field_first: true, outputs: vec![Output::Null], preview: None }).unwrap());
        channel.0.ingest.set_linger(Duration::from_millis(300));
        channel.0.start().unwrap();
        channel
    }

    fn spec(item: &str, id: &str, port: u16) -> ItemSpec {
        serde_json::from_value(serde_json::json!({"itemId": item, "source": endpoint(port), "configuredSourceId": id, "trimIn": 0, "trimOut": 0, "gainDb": 0})).unwrap()
    }

    fn serve_until(channel: &mut Running, limit: Duration, mut done: impl FnMut(&mut Running) -> bool) -> Option<Duration> {
        let started = Instant::now();
        while started.elapsed() < limit {
            channel.0.service_outputs();
            if channel.0.pending_live_take { let _ = channel.0.service_pending_take(); }
            if done(channel) { return Some(started.elapsed()); }
            std::thread::sleep(Duration::from_millis(5));
        }
        None
    }

    fn armed_ready(channel: &mut Running) -> bool { channel.0.armed.as_ref().is_some_and(|item| item.live_ready()) }

    fn take(channel: &mut Running) {
        channel.0.take().unwrap();
        serve_until(channel, Duration::from_secs(10), |channel| !channel.0.pending_live_take).expect("TAKE não confirmou");
    }

    fn watch_multiview(channel: &mut Running, cells: Vec<CellSource>, hooks: MvHooks) {
        let multiview = channel.0.attach_multiview_for_test();
        multiview.set_hooks(hooks);
        multiview.configure(Composition { layout: Layout::Grid2x2, cells, quality: Quality::Leve }).unwrap();
        assert!(channel.0.set_monitor(MV_BUS, true));
    }

    fn source_cell(id: &str, port: u16) -> CellSource { CellSource::Source { id: id.into(), endpoint: Some(endpoint(port)) } }

    /// Conta e mede a cadência dos quadros que o item entrega à superfície dele.
    fn item_cadence(channel: &Running) -> (Arc<AtomicU64>, Arc<StdMutex<(Option<Instant>, Duration)>>) {
        let sink = channel.0.on_air.as_ref().unwrap().find_element_for_test("intervideosink").unwrap();
        let frames = Arc::new(AtomicU64::new(0));
        let gap = Arc::new(StdMutex::new((None::<Instant>, Duration::ZERO)));
        let (count, worst) = (Arc::clone(&frames), Arc::clone(&gap));
        sink.static_pad("sink").unwrap().add_probe(gst::PadProbeType::BUFFER, move |_, _| {
            count.fetch_add(1, Ordering::Relaxed);
            let now = Instant::now();
            let mut state = worst.lock().unwrap();
            if let Some(last) = state.0 { state.1 = state.1.max(now - last); }
            state.0 = Some(now);
            gst::PadProbeReturn::Ok
        });
        (frames, gap)
    }

    #[test]
    fn uma_fonte_aberta_uma_vez_com_varios_consumidores() {
        if !available() { eprintln!("sem plugins SRT/x264; teste pulado"); return; }
        let port = port(0);
        let _sender = sender(port, 320, 180);
        std::thread::sleep(Duration::from_millis(500));
        let mut channel = channel("ingest-um", 320, 180);
        // Watchdog acompanhando, multiview com a entrada numa célula e o NEXT.
        channel.0.set_ingest_watched(vec![("cam-1".into(), endpoint(port))]).unwrap();
        watch_multiview(&mut channel, vec![source_cell("cam-1", port), CellSource::Pgm, CellSource::Next, CellSource::Empty], MvHooks::default());
        channel.0.load(spec("next-1", "cam-1", port)).unwrap();
        if serve_until(&mut channel, Duration::from_secs(10), armed_ready).is_none() {
            let item = channel.0.armed.as_ref().unwrap();
            let lease = item.ingest.as_ref().unwrap();
            let sub = lease.sub.as_ref().unwrap();
            eprintln!("DEBUG frames={} delivered={} video_port={} linked={:?} state={:?} video_ready={} pads={:?}", lease.receiver.frames.load(Ordering::Relaxed), lease.delivered(),
                sub.video.lock().unwrap().is_some(), sub.video.lock().unwrap().as_ref().map(|p| p.ghost.peer().is_some()), item.pipeline.current_state(), item.video_ready.load(Ordering::Relaxed),
                sub.bin.pads().iter().map(|p| p.name().to_string()).collect::<Vec<_>>());
            panic!("NEXT sem quadro pelo receptor");
        }
        let state = serve_until(&mut channel, Duration::from_secs(5), |channel| channel.0.multiview_state().is_some_and(|state| state.cells[0].signal == CellSignal::Live))
            .map(|_| channel.0.multiview_state().unwrap());
        let state = state.expect("célula da entrada sem quadro");
        let receivers = channel.0.ingest.receivers();
        assert_eq!(receivers.len(), 1, "uma entrada, um receptor");
        let receiver = &receivers[0];
        assert_eq!(receiver.openings(), 1, "a fonte foi aberta mais de uma vez");
        assert_eq!(receiver.consumer_kinds(), vec![Consumer::Item, Consumer::Multiview, Consumer::Watchdog]);
        assert_eq!(state.cells[0].receiver, Some(receiver.id()));
        assert_eq!(state.cells[0].bus, Some("next"), "o tally segue o barramento do item");
        // TAKE: o mesmo receptor vai ao ar, sem reabrir; a célula só muda o tally.
        take(&mut channel);
        assert_eq!(channel.0.on_air_id().as_deref(), Some("next-1"));
        serve_until(&mut channel, Duration::from_secs(2), |channel| channel.0.multiview_state().is_some_and(|state| state.cells[0].bus == Some("pgm"))).expect("tally não foi para o PGM");
        assert_eq!(channel.0.ingest.receivers().len(), 1);
        assert_eq!(receiver.openings(), 1, "TAKE reabriu a fonte");
        // Relatório do watchdog: medido uma vez por entrada.
        let report = channel.0.ingest_reports().pop().unwrap();
        assert_eq!(report.source_ids, vec!["cam-1".to_string()]);
        assert!(report.signal.video_present && report.signal.received_frames > 10, "{report:?}");
        assert_eq!(report.kind, "srt");
        let json = serde_json::to_string(&channel.0.multiview_state().unwrap()).unwrap();
        assert!(!json.contains("srt://"), "o endereço não pode sair no estado do multiview: {json}");
    }

    #[test]
    fn receptor_desaparece_sem_consumidores() {
        if !available() { eprintln!("sem plugins SRT/x264; teste pulado"); return; }
        let port = port(1);
        let _sender = sender(port, 320, 180);
        std::thread::sleep(Duration::from_millis(500));
        let mut channel = channel("ingest-some", 320, 180);
        channel.0.set_ingest_watched(vec![("cam-1".into(), endpoint(port))]).unwrap();
        let receiver = channel.0.ingest.receivers().pop().unwrap();
        serve_until(&mut channel, Duration::from_secs(10), |_| receiver.frames.load(Ordering::Relaxed) > 5).expect("receptor sem quadro");
        let weak = Arc::downgrade(&receiver);
        drop(receiver);
        channel.0.set_ingest_watched(Vec::new()).unwrap();
        // Ainda na espera (linger): outro consumidor reaproveitaria.
        channel.0.service_outputs();
        assert_eq!(channel.0.ingest.receivers().len(), 1);
        serve_until(&mut channel, Duration::from_secs(3), |channel| channel.0.ingest.receivers().is_empty()).expect("receptor sem consumidor não fechou");
        // O NULL corre numa thread própria; depois dele não sobra referência.
        let gone = Instant::now() + Duration::from_secs(3);
        while weak.upgrade().is_some() && Instant::now() < gone { channel.0.service_outputs(); std::thread::sleep(Duration::from_millis(20)); }
        assert!(weak.upgrade().is_none(), "receptor fechado continua vivo");
        // Item que some também solta: LOAD, depois outro LOAD de arquivo… aqui, STOP do armado.
        channel.0.load(spec("next-1", "cam-1", port)).unwrap();
        assert_eq!(channel.0.ingest.receivers().len(), 1);
        if let Some(item) = channel.0.armed.take() { discard(item); }
        serve_until(&mut channel, Duration::from_secs(3), |channel| channel.0.ingest.receivers().is_empty()).expect("item descartado não soltou o receptor");
    }

    /// Tempo do LOAD até o item ao vivo ter quadro (o que o TAKE espera).
    fn time_to_ready(channel: &mut Running, port: u16, item: &str) -> Duration {
        let started = Instant::now();
        channel.0.load(spec(item, "cam-1", port)).unwrap();
        if serve_until(channel, Duration::from_secs(10), armed_ready).is_none() {
            let item = channel.0.armed.as_ref().unwrap();
            let lease = item.ingest.as_ref();
            if let Some(sub) = lease.and_then(|l| l.sub.as_ref()) { let linked = sub.video.lock().unwrap().as_ref().map(|p| p.ghost.peer().is_some()); eprintln!("DEBUG2 active={} linked={:?} now={:?} pads={:?} tracks_video={}", sub.active.load(Ordering::Relaxed), linked, sub.now(), sub.bin.pads().iter().map(|p| p.name().to_string()).collect::<Vec<_>>(), lease.unwrap().receiver.tracks.lock().unwrap().video); }
            eprintln!("DEBUG {item_id} frames={:?} delivered={:?} state={:?} video_ready={} stats={:?}", lease.map(|l| l.receiver.frames.load(Ordering::Relaxed)), lease.map(|l| l.delivered()),
                item.pipeline.current_state(), item.video_ready.load(Ordering::Relaxed), item.source_statistics.lock().unwrap().report(true), item_id = item.spec.item_id);
            panic!("item sem quadro");
        }
        started.elapsed()
    }

    #[test]
    fn take_reaproveita_o_receptor_e_fica_mais_rapido() {
        if !available() { eprintln!("sem plugins SRT/x264; teste pulado"); return; }
        let port = port(2);
        let _sender = sender(port, 1280, 720);
        std::thread::sleep(Duration::from_millis(800));
        let median = |mut values: Vec<Duration>| { values.sort(); values[values.len() / 2] };
        let (mut direct, mut cold, mut warm) = (Vec::new(), Vec::new(), Vec::new());
        for round in 0..3 {
            // Antes: o item abre a fonte no próprio pipeline (r88-36).
            let mut channel = open_channel("ingest-antes", 1280, 720);
            channel.0.ingest = Hub::new(false, LINGER);
            direct.push(time_to_ready(&mut channel, port, &format!("antes-{round}")));
            drop(channel);
            // Receptor frio: ninguém recebia a entrada.
            let mut channel = open_channel("ingest-frio", 1280, 720);
            cold.push(time_to_ready(&mut channel, port, &format!("frio-{round}")));
            drop(channel);
            // Receptor quente: o watchdog (ou o multiview) já recebia.
            let mut channel = open_channel("ingest-quente", 1280, 720);
            channel.0.set_ingest_watched(vec![("cam-1".into(), endpoint(port))]).unwrap();
            let receiver = channel.0.ingest.receivers().pop().unwrap();
            serve_until(&mut channel, Duration::from_secs(10), |_| receiver.frames.load(Ordering::Relaxed) > 25).expect("receptor sem quadro");
            warm.push(time_to_ready(&mut channel, port, &format!("quente-{round}")));
            assert_eq!(receiver.openings(), 1, "o LOAD reabriu a fonte");
            take(&mut channel);
            assert_eq!(receiver.openings(), 1, "o TAKE reabriu a fonte");
            drop(channel);
            std::thread::sleep(Duration::from_millis(300));
        }
        let (direct, cold, warm) = (median(direct), median(cold), median(warm));
        eprintln!("[medida] LOAD→quadro pronto para TAKE (SRT 720p, mediana de 3): antes (item abre a fonte) {direct:?}; receptor frio {cold:?}; receptor já recebendo {warm:?}");
        assert!(warm < Duration::from_millis(400), "receptor quente deveria entregar no próximo quadro: {warm:?}");
        assert!(warm * 2 < direct, "reaproveitar o receptor deveria ser bem mais rápido que abrir: {warm:?} × {direct:?}");
    }

    #[test]
    fn consumidor_lento_ou_receptor_travado_nao_atrasam_o_pgm() {
        if !available() { eprintln!("sem plugins SRT/x264; teste pulado"); return; }
        let (pgm_port, other_port) = (port(3), port(4));
        let _pgm = sender(pgm_port, 640, 360);
        let _other = sender(other_port, 640, 360);
        std::thread::sleep(Duration::from_millis(600));
        let mut channel = channel("ingest-isola", 640, 360);
        channel.0.load(spec("pgm-1", "cam-1", pgm_port)).unwrap();
        serve_until(&mut channel, Duration::from_secs(10), armed_ready).expect("PGM sem quadro");
        take(&mut channel);
        let (frames, gap) = item_cadence(&channel);
        let measure = |channel: &mut Running, seconds: f64| -> (f64, Duration, Duration) {
            std::thread::sleep(Duration::from_millis(300));
            *gap.lock().unwrap() = (None, Duration::ZERO);
            let before = frames.load(Ordering::Relaxed);
            let started = Instant::now();
            let mut slowest_service = Duration::ZERO;
            while started.elapsed().as_secs_f64() < seconds {
                let at = Instant::now(); channel.0.service_outputs(); slowest_service = slowest_service.max(at.elapsed());
                std::thread::sleep(Duration::from_millis(20));
            }
            ((frames.load(Ordering::Relaxed) - before) as f64 / started.elapsed().as_secs_f64(), gap.lock().unwrap().1, slowest_service)
        };
        let (base, base_gap, _) = measure(&mut channel, 2.0);

        // Multiview 12× mais lento lendo o MESMO receptor do PGM, e uma
        // segunda entrada só de monitoramento cujo receptor trava 3 s ao subir.
        channel.0.ingest.set_hooks(Hooks { monitor_start_stall: Some(Duration::from_secs(3)), slow_per_frame: None });
        watch_multiview(&mut channel, vec![source_cell("cam-1", pgm_port), source_cell("cam-2", other_port), CellSource::Pgm, CellSource::Empty],
            MvHooks { slow_per_frame: Some(Duration::from_millis(500)), ..MvHooks::default() });
        let (slow, slow_gap, slow_service) = measure(&mut channel, 3.0);
        let state = channel.0.multiview_state().unwrap();
        assert!(state.cells[0].receiver.is_some() && state.cells[1].receiver.is_some(), "{state:?}");
        assert_eq!(channel.0.ingest.receivers().len(), 2);

        // Sonda do multiview presa por 1 s no receptor do PGM.
        let tap = channel.0.multiview.as_ref().unwrap().cell_tap(0);
        let stuck = { let tap = Arc::clone(&tap); std::thread::spawn(move || { let _guard = tap.frame.lock().unwrap(); std::thread::sleep(Duration::from_millis(1000)); }) };
        let (stuck_rate, stuck_gap, _) = measure(&mut channel, 1.5);
        stuck.join().unwrap();

        // Receptor só de monitoramento que cai (fonte morre): o PGM nem nota.
        drop(_other);
        let (fallen, fallen_gap, fallen_service) = measure(&mut channel, 3.0);
        eprintln!("[teste] PGM pelo receptor: sozinho {base:.1} q/s (maior intervalo {base_gap:?}); multiview 12× lento + receptor de monitoramento travado ao subir {slow:.1} q/s ({slow_gap:?}, serviço mais lento {slow_service:?}); sonda presa {stuck_rate:.1} q/s ({stuck_gap:?}); receptor de monitoramento caído {fallen:.1} q/s ({fallen_gap:?}, serviço {fallen_service:?})");
        // A máquina de teste é compartilhada (2 núcleos, outros processos): o
        // PGM aqui chega por SRT e já oscila sozinho. A régua é a mesma medida
        // sem consumidor nenhum, com folga para o ruído da máquina.
        let gap_limit = Duration::from_millis(200).max(base_gap * 5 / 2);
        for (label, rate, worst) in [("lento", slow, slow_gap), ("sonda presa", stuck_rate, stuck_gap), ("monitoramento caído", fallen, fallen_gap)] {
            assert!(rate >= (base - 2.5).min(22.5), "{label}: o PGM caiu para {rate:.1} q/s (sozinho {base:.1})");
            assert!(worst < gap_limit, "{label}: quadro do PGM atrasou {worst:?} (sozinho {base_gap:?})");
        }
        assert!(slow_service < Duration::from_millis(100), "abrir o receptor de monitoramento segurou o laço: {slow_service:?}");
        assert!(fallen_service < Duration::from_millis(100), "receptor caído segurou o laço: {fallen_service:?}");
        assert_eq!(channel.0.on_air_id().as_deref(), Some("pgm-1"));
    }

    fn ticks() -> u64 {
        let stat = std::fs::read_to_string("/proc/self/stat").unwrap();
        let fields: Vec<&str> = stat.rsplit_once(')').unwrap().1.split_whitespace().collect();
        fields[11].parse::<u64>().unwrap() + fields[12].parse::<u64>().unwrap()
    }
    fn rss_mb() -> f64 {
        let status = std::fs::read_to_string("/proc/self/status").unwrap();
        status.lines().find_map(|line| line.strip_prefix("VmRSS:")).and_then(|v| v.trim().trim_end_matches("kB").trim().parse::<f64>().ok()).unwrap() / 1024.0
    }

    /// Custo de manter entradas recebidas o tempo todo (receptor de
    /// monitoramento, SRT H.264 720p25 + AAC) e do mosaico lendo delas.
    /// `cargo test --release medir_custo_ingest -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn medir_custo_ingest() {
        if !available() { eprintln!("sem plugins; pulado"); return; }
        let count = 4u16;
        let senders: Vec<Sender> = (0..count).map(|i| sender(port(5) + i, 1280, 720)).collect();
        std::thread::sleep(Duration::from_millis(1500));
        let mut channel = channel("ingest-custo", 1280, 720);
        let measure = |channel: &mut Running, seconds: f64| -> f64 {
            std::thread::sleep(Duration::from_millis(1500));
            let (start, at) = (ticks(), Instant::now());
            while at.elapsed().as_secs_f64() < seconds { channel.0.service_outputs(); std::thread::sleep(Duration::from_millis(40)); }
            (ticks() - start) as f64 / at.elapsed().as_secs_f64()
        };
        let base = measure(&mut channel, 6.0);
        let base_rss = rss_mb();
        let mut rows = Vec::new();
        for n in 1..=count {
            let sources: Vec<(String, String)> = (0..n).map(|i| (format!("cam-{i}"), endpoint(port(5) + i))).collect();
            channel.0.set_ingest_watched(sources).unwrap();
            let cpu = measure(&mut channel, 6.0);
            rows.push((n, cpu - base, rss_mb() - base_rss));
        }
        // Mosaico LEVE 2×2 lendo os 4 receptores (escala por célula + composição, sem codificar).
        let cells: Vec<CellSource> = (0..4u16).map(|i| source_cell(&format!("cam-{i}"), port(5) + i)).collect();
        watch_multiview(&mut channel, cells, MvHooks::default());
        let with_mosaic = measure(&mut channel, 6.0);
        let frames = channel.0.multiview_state().unwrap().frames;
        for (n, cpu, rss) in &rows { eprintln!("[medida] {n} entrada(s) recebida(s): +{cpu:.0}% de um núcleo, +{rss:.0} MB RSS ({:.0}% e {:.0} MB por entrada)", cpu / *n as f64, rss / *n as f64); }
        eprintln!("[medida] + mosaico LEVE 2×2 sobre os 4 receptores (sem codificar): +{:.0}% de um núcleo; {frames} quadros compostos", with_mosaic - base - rows.last().unwrap().1);
        drop(senders);
    }
}
