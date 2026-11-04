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
        let Ok(video) = self.video.lock() else { return };
        let Some(port) = video.as_ref() else { return };
        // Pad não ligado: empurrar faria o appsrc acusar NOT_LINKED no item.
        if port.ghost.peer().is_none() { return; }
        let Some(pts) = self.now() else { return };
        if Self::push(port, sample, pts) { self.delivered.fetch_add(1, Ordering::Relaxed); }
    }

    fn deliver_audio(&self, track: usize, sample: &gst::Sample, duration: Option<gst::ClockTime>) {
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
