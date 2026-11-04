//! Multiview composto no engine, como um multiviewer de hardware.
//!
//! Antes, cada célula do multiview do navegador era um fluxo WHEP próprio: N
//! codificações no engine, N decodificações no navegador, N conexões e imagens
//! fora de sincronia entre si. Aqui o engine compõe PGM, PVW, NEXT, QC, a
//! reserva de contingência e as entradas ao vivo abertas numa só imagem,
//! codifica uma vez e publica como mais um monitor (`mv`).
//!
//! Desenho (ver docs/MULTIVIEW.md):
//!
//! ```text
//!  pipeline do canal / itens (intocados)        pipeline do multiview (próprio)
//!  tee-video ──┐                                 appsrc 0 ─ videoconvertscale ─┐
//!  item PVW ───┤  sonda de pad (try_lock,        appsrc 1 ─ videoconvertscale ─┤ compositor ─ intervideosink
//!  item NEXT ──┤  só guarda a referência do      ...                          ─┘     │
//!  item QC ────┘  último quadro: O(1))           ^ thread de cadência empurra o      └─ Publisher "mv" (output.rs)
//!                                                  último quadro de cada sonda
//! ```
//!
//! Garantias:
//! - O PGM nunca espera pelo multiview. A sonda só faz `try_lock` e troca uma
//!   referência de buffer; se o multiview estiver ocupado, aquele quadro não
//!   entra no multiview, e só isso. O `appsrc` de cada célula é `leaky`: se a
//!   composição atrasar, o multiview descarta quadros dele mesmo.
//! - Escala de cada célula num passo só, do tamanho da fonte direto para o
//!   tamanho da célula (`videoconvertscale`).
//! - Fonte congelada continua mostrando o último quadro (o compositor repete o
//!   buffer sem duração). Fonte que para de entregar quadros por mais de
//!   [`NO_SIGNAL_AFTER`] vira a célula "sem sinal".
//! - Rótulos, tally, VU e relógio NÃO são queimados na imagem: o navegador os
//!   desenha em HTML a partir de [`MultiviewState`] e da geometria do layout.
//! - Só existe enquanto alguém olha: sem espectador não há sonda instalada,
//!   pipeline nem thread.

use super::*;
use crate::monitor::{MonitorSource, MonitorTier};
use crate::output::{Kind, Publisher, PublisherSpec, Report};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::thread::JoinHandle;

/// Nome do monitor para `monitor`/`watching`.
pub const BUS: &str = "mv";
/// Sem quadro novo por mais que isto, a célula vira "sem sinal". Mesmo prazo da
/// checagem de frescor de 2 s do engine para fontes ao vivo.
pub const NO_SIGNAL_AFTER: Duration = Duration::from_millis(2000);
/// Grade de 12 unidades: divide por 2, 3 e 4, que é o que os layouts usam.
const UNITS: i32 = 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Layout {
    #[serde(rename = "MV_2X2")]
    Grid2x2,
    #[serde(rename = "MV_3X3")]
    Grid3x3,
    #[serde(rename = "MV_4X4")]
    Grid4x4,
    /// Uma célula grande (2/3) e cinco pequenas em L.
    #[serde(rename = "MV_1_PLUS_5")]
    OnePlus5,
    /// PGM e PVW grandes em cima, oito fontes embaixo (duas fileiras de 4).
    #[serde(rename = "MV_PGM_PVW")]
    PgmPvw,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Rect { pub x: i32, pub y: i32, pub w: i32, pub h: i32 }

impl Layout {
    /// Células em unidades de 1/12 da largura e da altura. A mesma tabela está
    /// em packages/protocol/src/multiview-layout.ts; o teste das duas confere.
    pub fn units(self) -> Vec<(i32, i32, i32, i32)> {
        let grid = |n: i32| -> Vec<(i32, i32, i32, i32)> {
            let s = UNITS / n;
            (0..n * n).map(|i| ((i % n) * s, (i / n) * s, s, s)).collect()
        };
        match self {
            Layout::Grid2x2 => grid(2),
            Layout::Grid3x3 => grid(3),
            Layout::Grid4x4 => grid(4),
            Layout::OnePlus5 => vec![(0, 0, 8, 8), (8, 0, 4, 4), (8, 4, 4, 4), (0, 8, 4, 4), (4, 8, 4, 4), (8, 8, 4, 4)],
            Layout::PgmPvw => {
                let mut cells = vec![(0, 0, 6, 6), (6, 0, 6, 6)];
                for row in 0..2 { for col in 0..4 { cells.push((col * 3, 6 + row * 3, 3, 3)); } }
                cells
            }
        }
    }

    pub fn cells(self) -> usize { self.units().len() }

    /// Retângulos em pixels, alinhados em par (croma 4:2:0) e com uma borda de
    /// 2 px entre células, que é onde o navegador desenha o tally.
    pub fn rects(self, width: i32, height: i32) -> Vec<Rect> {
        let even = |value: i32| value - value.rem_euclid(2);
        let gutter = if width >= 640 { 2 } else { 0 };
        self.units().into_iter().map(|(x, y, w, h)| {
            let x0 = even(x * width / UNITS) + gutter / 2;
            let y0 = even(y * height / UNITS) + gutter / 2;
            let x1 = even((x + w) * width / UNITS) - gutter / 2;
            let y1 = even((y + h) * height / UNITS) - gutter / 2;
            Rect { x: even(x0), y: even(y0), w: even(x1 - even(x0)).max(2), h: even(y1 - even(y0)).max(2) }
        }).collect()
    }
}

/// Teto de nível do multiview, nos mesmos nomes dos monitores
/// (REFERÊNCIA/PADRÃO/LEVE): é o [`MonitorTier`] em que o mosaico é composto.
/// Quem assiste escolhe o próprio nível (seletor e troca automática do
/// `Whep`) entre os que não passam deste teto; cada nível é um ramo do mesmo
/// [`crate::monitor::MonitorBus`] dos monitores de barramento. Só o
/// Supervisor troca o teto (custo de composição e de codificação no ar).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Quality {
    Referencia,
    #[default]
    Padrao,
    Leve,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile { pub width: i32, pub height: i32, pub fps_n: i32, pub fps_d: i32, pub bitrate_kbps: u32 }

impl Quality {
    pub fn tier(self) -> MonitorTier {
        match self { Quality::Referencia => MonitorTier::Ref, Quality::Padrao => MonitorTier::Std, Quality::Leve => MonitorTier::Lite }
    }

    /// Raster e cadência em que o mosaico é composto com este teto. A tabela
    /// é uma só: [`crate::monitor::mosaic_profile`].
    pub fn profile(self, fps_n: i32, fps_d: i32) -> Profile {
        let full = MonitorSource { width: 1920, height: 1080, fps_n, fps_d, frame_n: fps_n, frame_d: fps_d, bitrate_ceiling_kbps: crate::monitor::MAX_KBPS, mosaic: true };
        let p = crate::monitor::mosaic_profile(self.tier(), &full);
        Profile { width: p.width, height: p.height, fps_n: p.fps_n, fps_d: p.fps_d, bitrate_kbps: p.bitrate_kbps }
    }

    /// O que chega ao `MonitorBus` pelo `inter`: o mosaico neste teto.
    fn monitor_source(self, fps_n: i32, fps_d: i32) -> MonitorSource {
        let p = self.profile(fps_n, fps_d);
        MonitorSource { width: p.width, height: p.height, fps_n: p.fps_n, fps_d: p.fps_d, frame_n: p.fps_n, frame_d: p.fps_d, bitrate_ceiling_kbps: p.bitrate_kbps, mosaic: true }
    }
}

/// O que cada célula mostra. Sempre algo que o engine já decodifica: o
/// multiview não sintoniza fonte nem abre segunda conexão (SDI e SRT listener
/// não aceitam duas, e o Monitor nunca muda o que está aberto).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum CellSource {
    Pgm,
    Pvw,
    Next,
    Qc,
    /// Reserva de contingência preparada para a troca ao vivo.
    Contingency,
    /// Entrada ao vivo cadastrada. Com `endpoint` (o servidor manda o do
    /// cadastro), a célula lê o receptor compartilhado da entrada (ingest
    /// único): aparece sempre, esteja ou não em algum barramento. Sem ele,
    /// só onde o engine a tiver aberta (comportamento da r88-36).
    Source {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,
    },
    Empty,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Composition {
    pub layout: Layout,
    pub cells: Vec<CellSource>,
    #[serde(default)]
    pub quality: Quality,
}

impl Composition {
    pub fn validate(&self) -> Result<()> {
        if self.cells.len() > self.layout.cells() {
            return Err(anyhow!("o layout tem {} células e vieram {}", self.layout.cells(), self.cells.len()));
        }
        for cell in &self.cells {
            if let CellSource::Source { id, endpoint } = cell {
                if id.is_empty() || id.len() > 256 { return Err(anyhow!("identificador de fonte inválido no multiview")); }
                if endpoint.as_ref().is_some_and(|endpoint| endpoint.trim().is_empty() || endpoint.len() > 2048) { return Err(anyhow!("endereço de fonte inválido no multiview")); }
            }
        }
        Ok(())
    }
}

impl Default for Composition {
    fn default() -> Self {
        Composition { layout: Layout::Grid2x2, cells: vec![CellSource::Pgm, CellSource::Pvw, CellSource::Next, CellSource::Qc], quality: Quality::Padrao }
    }
}

/// Estado de uma célula, para o navegador desenhar a indicação certa.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CellSignal {
    /// Quadros chegando.
    Live,
    /// Sem quadro novo há menos de [`NO_SIGNAL_AFTER`]: mostra o último.
    Held,
    /// Aberta, mas sem quadro há mais de [`NO_SIGNAL_AFTER`].
    NoSignal,
    /// Ninguém no engine está com esta fonte aberta.
    Unavailable,
    Empty,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellState {
    pub source: CellSource,
    pub signal: CellSignal,
    pub age_ms: Option<u64>,
    /// Quadros por segundo que chegaram à sonda (não os que saíram no mosaico).
    pub fps: f64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    /// Barramento onde a fonte foi encontrada (pgm, pvw, next, qc, contingency).
    pub bus: Option<&'static str>,
    /// Quadros que a sonda deixou de guardar porque o multiview estava ocupado
    /// (o PGM seguiu sem esperar).
    pub skipped: u64,
    /// Receptor compartilhado que alimenta a célula (ingest único), quando há.
    pub receiver: Option<u64>,
    /// Imagem parada há tanto tempo, pela medição da entrada no receptor
    /// (impressão do conteúdo ou grade de luma, as mesmas do watchdog).
    pub frozen_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiviewState {
    pub running: bool,
    pub layout: Layout,
    pub quality: Quality,
    pub profile: Profile,
    pub cells: Vec<CellState>,
    /// Quadros compostos desde que subiu.
    pub frames: u64,
}

// ---------------------------------------------------------------------------
// Sonda: o único ponto de contato com o pipeline do programa.
// ---------------------------------------------------------------------------

#[derive(Default)]
pub(crate) struct Frame {
    caps: Option<gst::Caps>,
    buffer: Option<gst::Buffer>,
    seq: u64,
    at: Option<Instant>,
    /// Quando a sonda foi posta no ponto atual (conta como "último sinal" até
    /// o primeiro quadro chegar).
    attached: Option<Instant>,
}

/// Último quadro de um ponto do engine. A sonda nunca espera: `try_lock`.
#[derive(Default)]
pub struct Tap {
    pub(crate) frame: Mutex<Frame>,
    /// Há um ponto do engine ligado a esta sonda agora.
    resolved: AtomicBool,
    /// Quadros que a sonda deixou passar sem guardar (multiview ocupado).
    skipped: AtomicU64,
}

impl Tap {
    fn attach(self: &Arc<Self>, pad: &gst::Pad) -> Option<gst::PadProbeId> {
        if let Ok(mut frame) = self.frame.lock() {
            *frame = Frame { caps: pad.current_caps(), attached: Some(Instant::now()), ..Frame::default() };
        }
        self.resolved.store(true, Ordering::Release);
        let tap = Arc::clone(self);
        pad.add_probe(gst::PadProbeType::BUFFER | gst::PadProbeType::EVENT_DOWNSTREAM, move |_, info| {
            if let Some(buffer) = info.buffer() {
                if buffer.size() == 0 || buffer.flags().contains(gst::BufferFlags::GAP) { return gst::PadProbeReturn::Ok; }
                // Nunca bloquear a thread de streaming de quem está no ar.
                match tap.frame.try_lock() {
                    Ok(mut frame) => {
                        frame.buffer = Some(buffer.to_owned());
                        frame.seq = frame.seq.wrapping_add(1);
                        frame.at = Some(Instant::now());
                    }
                    Err(_) => { tap.skipped.fetch_add(1, Ordering::Relaxed); }
                }
            } else if let Some(event) = info.event() {
                if let gst::EventView::Caps(caps) = event.view() {
                    // Caps são raras e não podem se perder; o outro lado só
                    // segura o mutex para clonar duas referências.
                    if let Ok(mut frame) = tap.frame.lock() { frame.caps = Some(caps.caps_owned()); }
                }
            }
            gst::PadProbeReturn::Ok
        })
    }

    fn clear(&self) {
        self.resolved.store(false, Ordering::Release);
        if let Ok(mut frame) = self.frame.lock() { *frame = Frame::default(); }
    }

    /// (caps, buffer, seq, último sinal, já chegou quadro)
    fn snapshot(&self) -> (Option<gst::Caps>, Option<gst::Buffer>, u64, Option<Instant>) {
        match self.frame.lock() {
            Ok(frame) => (frame.caps.clone(), frame.buffer.clone(), frame.seq, frame.at.or(frame.attached)),
            Err(_) => (None, None, 0, None),
        }
    }

    pub fn skipped(&self) -> u64 { self.skipped.load(Ordering::Relaxed) }
}

/// Um ponto do engine que pode alimentar uma célula.
#[derive(Clone)]
pub struct TapPoint {
    pub pad: gst::Pad,
    /// Identidade do decodificador (ou 0 para o PGM). Muda quando o item muda.
    pub identity: u64,
    pub bus: &'static str,
}

/// Onde cada coisa está agora. Montado pelo canal a cada volta do serviço.
#[derive(Default, Clone)]
pub struct TapPoints {
    pub pgm: Option<TapPoint>,
    pub pvw: Option<TapPoint>,
    pub next: Option<TapPoint>,
    pub qc: Option<TapPoint>,
    pub contingency: Option<TapPoint>,
    /// Fonte cadastrada -> primeiro barramento em que está aberta.
    pub sources: Vec<(String, TapPoint)>,
}

impl TapPoints {
    fn find(&self, source: &CellSource) -> Option<TapPoint> {
        match source {
            CellSource::Pgm => self.pgm.clone(),
            CellSource::Pvw => self.pvw.clone(),
            CellSource::Next => self.next.clone(),
            CellSource::Qc => self.qc.clone(),
            CellSource::Contingency => self.contingency.clone(),
            CellSource::Source { id, .. } => self.sources.iter().find(|(key, _)| key == id).map(|(_, point)| point.clone()),
            CellSource::Empty => None,
        }
    }
}

struct Installed {
    pad: gst::glib::WeakRef<gst::Pad>,
    probe: Option<gst::PadProbeId>,
    identity: u64,
    bus: &'static str,
}

impl Installed {
    fn remove(mut self) {
        if let (Some(pad), Some(probe)) = (self.pad.upgrade(), self.probe.take()) { pad.remove_probe(probe); }
    }
}

struct Cell {
    source: CellSource,
    tap: Arc<Tap>,
    installed: Option<Installed>,
}

// ---------------------------------------------------------------------------
// Composição: pipeline e thread próprios, criados só com espectador.
// ---------------------------------------------------------------------------

/// Desvio para testes: troca o destino ou atrasa a composição de propósito.
#[derive(Clone, Default)]
pub struct Hooks {
    /// Atraso artificial por quadro composto (prova de que o PGM não sente).
    pub slow_per_frame: Option<Duration>,
    /// Atraso artificial em cada volta da thread de cadência (prova de que
    /// desmontar o multiview não segura o laço principal do engine).
    pub cadence_stall: Option<Duration>,
}

struct Runner {
    pipeline: gst::Pipeline,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    signals: Arc<Mutex<Vec<(CellSignal, Option<u64>, f64)>>>,
    frames: Arc<AtomicU64>,
}

/// Quanto a desmontagem espera a thread de cadência antes de soltar o
/// pipeline mesmo assim (ela só empurra em `appsrc` que não bloqueia).
const RUNNER_STOP_TIMEOUT: Duration = Duration::from_secs(2);

impl Drop for Runner {
    /// Desmonta sem segurar quem chama (o laço principal do engine, que serve
    /// o programa): sinaliza a thread de cadência e entrega a espera, com
    /// tempo limite, e o pipeline indo a NULL a uma thread própria.
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let thread = self.thread.take();
        let pipeline = self.pipeline.clone();
        let reap = move || {
            if let Some(thread) = thread {
                let until = Instant::now() + RUNNER_STOP_TIMEOUT;
                while !thread.is_finished() && Instant::now() < until { std::thread::sleep(Duration::from_millis(5)); }
                if thread.is_finished() { let _ = thread.join(); } else { eprintln!("[engine] multiview: a thread de cadência não parou em {RUNNER_STOP_TIMEOUT:?}; pipeline solto mesmo assim"); }
            }
            let _ = pipeline.set_state(gst::State::Null);
        };
        if std::thread::Builder::new().name("multiview-fim".into()).spawn(reap).is_err() {
            // Sem thread nova (recurso esgotado): pelo menos solta o pipeline.
            let _ = self.pipeline.set_state(gst::State::Null);
        }
    }
}

fn convert_scale() -> Result<gst::Element> {
    // Converter e escalar num passo só; instalações antigas caem no par.
    make("videoconvertscale").or_else(|_| make("videoscale"))
}

/// Quadro de célula: "sem sinal" é cinza escuro com listras diagonais,
/// "indisponível" é cinza liso e célula vazia é preta. Pequenos de propósito:
/// a célula os amplia, e o texto fica no navegador.
fn slate(kind: CellSignal) -> (gst::Caps, gst::Buffer) {
    let (w, h) = (64usize, 36usize);
    let mut data = vec![0u8; w * h * 3 / 2];
    for y in 0..h { for x in 0..w {
        data[y * w + x] = match kind {
            CellSignal::NoSignal => if ((x + y) / 6) % 2 == 0 { 72 } else { 34 },
            CellSignal::Unavailable => 34,
            _ => 16,
        };
    } }
    for value in &mut data[w * h..] { *value = 128; }
    let caps = gst::Caps::builder("video/x-raw").field("format", "I420").field("width", w as i32).field("height", h as i32)
        .field("framerate", gst::Fraction::new(0, 1)).field("pixel-aspect-ratio", gst::Fraction::new(1, 1)).build();
    (caps, gst::Buffer::from_mut_slice(data))
}

fn push(src: &gst_app::AppSrc, caps: &gst::Caps, buffer: &gst::Buffer) {
    // Cópia rasa: mesma memória, carimbos novos. Sem duração, o compositor
    // repete o buffer até o próximo -- é o que segura o último quadro de uma
    // fonte congelada sem reescalar nada.
    let mut copy = buffer.copy();
    if let Some(meta) = copy.get_mut() {
        meta.set_pts(gst::ClockTime::NONE);
        meta.set_dts(gst::ClockTime::NONE);
        meta.set_duration(gst::ClockTime::NONE);
        meta.unset_flags(gst::BufferFlags::DISCONT);
    }
    let sample = gst::Sample::builder().buffer(&copy).caps(caps).build();
    let _ = src.push_sample(&sample);
}

impl Runner {
    fn start(video_channel: &str, layout: Layout, profile: Profile, taps: Vec<Option<Arc<Tap>>>, hooks: &Hooks) -> Result<Self> {
        let pipeline = gst::Pipeline::with_name(&format!("multiview-{video_channel}"));
        let compositor = make("compositor")?;
        compositor.set_property_from_str("background", "black");
        // Uma volta de folga para a escala das células.
        let period = 1_000_000_000u64 * profile.fps_d as u64 / profile.fps_n.max(1) as u64;
        crate::output::set_if_exists(&compositor, "latency", period);
        let caps = make("capsfilter")?;
        caps.set_property("caps", gst::Caps::builder("video/x-raw").field("format", "I420")
            .field("width", profile.width).field("height", profile.height)
            .field("framerate", gst::Fraction::new(profile.fps_n, profile.fps_d))
            .field("pixel-aspect-ratio", gst::Fraction::new(1, 1)).build());
        let queue = make("queue")?;
        queue.set_property_from_str("leaky", "downstream");
        queue.set_property("max-size-buffers", 2u32);
        queue.set_property("max-size-bytes", 0u32);
        queue.set_property("max-size-time", 0u64);
        let sink = make("intervideosink")?;
        sink.set_property("channel", video_channel);
        sink.set_property("sync", false);
        pipeline.add_many([&compositor, &caps, &queue, &sink])?;
        let mut tail: Vec<gst::Element> = vec![compositor.clone(), caps.clone()];
        if let Some(delay) = hooks.slow_per_frame {
            let slow = make("identity")?;
            slow.set_property("sleep-time", delay.as_micros() as u32);
            pipeline.add(&slow)?;
            tail.push(slow);
        }
        tail.extend([queue.clone(), sink.clone()]);
        gst::Element::link_many(&tail)?;

        let frames = Arc::new(AtomicU64::new(0));
        let counter = Arc::clone(&frames);
        sink.static_pad("sink").ok_or_else(|| anyhow!("multiview sem sink"))?
            .add_probe(gst::PadProbeType::BUFFER, move |_, _| { counter.fetch_add(1, Ordering::Relaxed); gst::PadProbeReturn::Ok });

        let rects = layout.rects(profile.width, profile.height);
        let mut sources = Vec::new();
        for (index, rect) in rects.iter().enumerate() {
            let src = gst_app::AppSrc::builder().name(format!("celula-{index}")).is_live(true)
                .format(gst::Format::Time).do_timestamp(true).block(false).build();
            crate::output::set_if_exists(src.upcast_ref(), "max-buffers", 1u64);
            src.set_property_from_str("leaky-type", "downstream");
            crate::output::set_if_exists(src.upcast_ref(), "min-latency", 0i64);
            let scale = convert_scale()?;
            // Fonte 4:3 ou vertical ganha barra, não deformação.
            scale.set_property("add-borders", true);
            let cell_caps = make("capsfilter")?;
            cell_caps.set_property("caps", gst::Caps::builder("video/x-raw").field("format", "I420")
                .field("width", rect.w).field("height", rect.h).field("pixel-aspect-ratio", gst::Fraction::new(1, 1)).build());
            pipeline.add_many([src.upcast_ref::<gst::Element>(), &scale, &cell_caps])?;
            gst::Element::link_many([src.upcast_ref::<gst::Element>(), &scale, &cell_caps])?;
            let pad = compositor.request_pad_simple("sink_%u").ok_or_else(|| anyhow!("compositor recusou célula"))?;
            pad.set_property("xpos", rect.x);
            pad.set_property("ypos", rect.y);
            pad.set_property("width", rect.w);
            pad.set_property("height", rect.h);
            cell_caps.static_pad("src").ok_or_else(|| anyhow!("célula sem saída"))?.link(&pad)?;
            sources.push(src);
        }
        crate::fencing::guard_pipeline(&pipeline)?;
        pipeline.set_state(gst::State::Playing).context("o multiview não entrou em execução")?;

        let stop = Arc::new(AtomicBool::new(false));
        let signals = Arc::new(Mutex::new(vec![(CellSignal::Empty, None, 0.0); rects.len()]));
        let thread = {
            let stop = Arc::clone(&stop);
            let signals = Arc::clone(&signals);
            let period = Duration::from_nanos(period);
            let stall = hooks.cadence_stall;
            std::thread::Builder::new().name("multiview".into()).spawn(move || {
                if let Some(stall) = stall { while !stop.load(Ordering::Acquire) { std::thread::sleep(stall); } }
                cadence(sources, taps, stop, signals, period)
            })?
        };
        Ok(Runner { pipeline, stop, thread: Some(thread), signals, frames })
    }
}

/// Thread de cadência: a cada período, leva às células o quadro mais novo de
/// cada sonda. Nunca bloqueia: `appsrc` com `block=false` e fila de um quadro
/// que descarta o mais velho.
fn cadence(sources: Vec<gst_app::AppSrc>, taps: Vec<Option<Arc<Tap>>>, stop: Arc<AtomicBool>, signals: Arc<Mutex<Vec<(CellSignal, Option<u64>, f64)>>>, period: Duration) {
    #[derive(Clone, Copy, PartialEq)]
    enum Shown { Nothing, Frame(u64), Slate(CellSignal) }
    let slates: Vec<(CellSignal, (gst::Caps, gst::Buffer))> = [CellSignal::NoSignal, CellSignal::Unavailable, CellSignal::Empty]
        .into_iter().map(|kind| (kind, slate(kind))).collect();
    let mut shown = vec![Shown::Nothing; sources.len()];
    let mut rate: Vec<(Instant, u64, f64)> = vec![(Instant::now(), 0, 0.0); sources.len()];
    // Fonte "parada" na tela: sem quadro novo por mais que isto, mas ainda
    // dentro do prazo de sinal. Só informa; a imagem é a mesma.
    let held_after = (period * 3).max(Duration::from_millis(200));
    let mut next = Instant::now();
    while !stop.load(Ordering::Acquire) {
        let now = Instant::now();
        let mut report = Vec::with_capacity(sources.len());
        for (index, src) in sources.iter().enumerate() {
            let tap = taps.get(index).cloned().flatten();
            let (signal, age, frame) = match tap.as_ref() {
                None => (CellSignal::Empty, None, None),
                Some(tap) if !tap.resolved.load(Ordering::Acquire) => (CellSignal::Unavailable, None, None),
                Some(tap) => {
                    let (caps, buffer, seq, at) = tap.snapshot();
                    let (since, first, _) = rate[index];
                    let window = now.saturating_duration_since(since);
                    if window >= Duration::from_secs(1) {
                        rate[index] = (now, seq, seq.wrapping_sub(first) as f64 / window.as_secs_f64());
                    }
                    let age = at.map(|at| now.saturating_duration_since(at));
                    match (caps, buffer, age) {
                        (Some(caps), Some(buffer), Some(age)) if age <= NO_SIGNAL_AFTER =>
                            (if age > held_after { CellSignal::Held } else { CellSignal::Live }, Some(age), Some((caps, buffer, seq))),
                        // Ponto novo ainda sem o primeiro quadro: espera o prazo.
                        (_, None, Some(age)) if age <= NO_SIGNAL_AFTER => (CellSignal::Held, Some(age), None),
                        (_, _, age) => (CellSignal::NoSignal, age, None),
                    }
                }
            };
            match (signal, frame) {
                (CellSignal::Live | CellSignal::Held, Some((caps, buffer, seq))) => if shown[index] != Shown::Frame(seq) {
                    push(src, &caps, &buffer);
                    shown[index] = Shown::Frame(seq);
                },
                (CellSignal::Held, None) => {}
                (kind, _) => if shown[index] != Shown::Slate(kind) {
                    if let Some((_, (caps, buffer))) = slates.iter().find(|(slate, _)| *slate == kind) { push(src, caps, buffer); }
                    shown[index] = Shown::Slate(kind);
                },
            }
            let fps = if matches!(signal, CellSignal::Live | CellSignal::Held) { rate[index].2 } else { 0.0 };
            report.push((signal, age.map(|age| age.as_millis() as u64), fps));
        }
        if let Ok(mut current) = signals.try_lock() { *current = report; }
        next += period;
        let now = Instant::now();
        if next > now { std::thread::sleep(next - now); } else { next = now; }
    }
}

// ---------------------------------------------------------------------------
// O multiview do canal.
// ---------------------------------------------------------------------------

pub struct Multiview {
    video_channel: String,
    audio_channel: String,
    fps: (i32, i32),
    composition: Composition,
    cells: Vec<Cell>,
    runner: Option<Runner>,
    publisher: Option<Publisher>,
    publisher_spec: Option<PublisherSpec>,
    /// Níveis pedidos agora (e a concessão de placa de cada um). O mosaico só
    /// é composto enquanto houver algum.
    tiers: std::collections::BTreeMap<MonitorTier, bool>,
    /// Orçamento de CPU concedido pelo servidor a cada nível (Mpx/s); volta a
    /// ser aplicado quando o publicador é recriado (troca de teto).
    budgets: std::collections::BTreeMap<MonitorTier, f64>,
    hooks: Hooks,
    /// Receptores compartilhados das entradas nas células (por endereço). Só
    /// existem enquanto alguém assiste ao mosaico.
    leases: std::collections::BTreeMap<String, super::ingest::Lease>,
    /// Entrada que não abriu: próxima tentativa (não tentar a 50 Hz).
    lease_retry: std::collections::BTreeMap<String, Instant>,
}

impl Multiview {
    /// `destination`: para onde o monitor codificado sai (SRT do servidor de
    /// mídia). `None` só em teste: a composição fica no canal `inter`.
    pub fn new(channel_id: &str, fps_n: i32, fps_d: i32, destination: Option<(Kind, String)>) -> Self {
        let video_channel = format!("{channel_id}-mv-video");
        let audio_channel = format!("{channel_id}-mv-audio");
        let composition = Composition::default();
        let publisher_spec = destination.map(|(kind, url)| {
            let profile = composition.quality.profile(fps_n, fps_d);
            PublisherSpec {
                output_id: "multiview".into(), kind, url,
                video_channel: video_channel.clone(), audio_channel: audio_channel.clone(),
                width: profile.width, height: profile.height, fps_n: profile.fps_n, fps_d: profile.fps_d,
                bitrate_kbps: profile.bitrate_kbps, interlaced: false, top_field_first: true,
                // Classe monitor: placa só com concessão do servidor
                // (EncoderSessions), e a CPU entra no orçamento de monitores em
                // software (RPLAYOUT_MONITOR_SW_MPX), como PGM e PVW.
                prefer_software: true,
                role: BUS.into(), on_demand: true,
                // Ninguém escreve áudio no canal do multiview: sai silêncio, e
                // em Opus para o WHEP aceitar a trilha.
                opus: kind == Kind::Srt,
                // Mesmo publicador com níveis dos monitores: `canal/mv-ref`,
                // `canal/mv-std` e `canal/mv` (LEVE, o caminho histórico).
                monitor: (kind == Kind::Srt).then(|| composition.quality.monitor_source(fps_n, fps_d)),
            }
        });
        let mut multiview = Multiview {
            video_channel, audio_channel, fps: (fps_n, fps_d), composition: composition.clone(), cells: Vec::new(),
            runner: None, publisher: publisher_spec.clone().map(Publisher::new), publisher_spec, tiers: Default::default(), budgets: Default::default(), hooks: Hooks::default(),
            leases: Default::default(), lease_retry: Default::default(),
        };
        multiview.set_cells(&composition);
        multiview
    }

    pub fn video_channel(&self) -> &str { &self.video_channel }
    pub fn composition(&self) -> &Composition { &self.composition }
    #[cfg(test)]
    pub fn set_hooks(&mut self, hooks: Hooks) { self.hooks = hooks; }

    fn set_cells(&mut self, composition: &Composition) {
        let old = std::mem::take(&mut self.cells);
        let mut old: Vec<Option<Cell>> = old.into_iter().map(Some).collect();
        for index in 0..composition.layout.cells() {
            let source = composition.cells.get(index).cloned().unwrap_or(CellSource::Empty);
            // A mesma fonte que já estava numa célula leva a sonda junto: troca
            // de layout não pisca a imagem dela.
            let reuse = old.iter_mut().find(|cell| cell.as_ref().is_some_and(|cell| cell.source == source && source != CellSource::Empty)).and_then(Option::take);
            self.cells.push(reuse.unwrap_or_else(|| Cell { source, tap: Arc::new(Tap::default()), installed: None }));
        }
        for cell in old.into_iter().flatten() { if let Some(installed) = cell.installed { installed.remove(); } }
    }

    /// Troca layout, células ou qualidade. Só o pipeline do multiview é
    /// recriado; PGM, saídas e sondas continuam onde estão.
    pub fn configure(&mut self, composition: Composition) -> Result<()> {
        composition.validate()?;
        let quality_changed = composition.quality != self.composition.quality;
        self.set_cells(&composition);
        self.composition = composition;
        if quality_changed {
            // Teto novo: os níveis acima dele deixam de existir (o servidor
            // também rebaixa os pedidos); os outros voltam no publicador novo.
            let ceiling = self.composition.quality.tier();
            self.tiers.retain(|tier, _| !crate::monitor::above(*tier, ceiling));
            if let Some(spec) = self.publisher_spec.as_mut() {
                let profile = self.composition.quality.profile(self.fps.0, self.fps.1);
                spec.width = profile.width; spec.height = profile.height; spec.fps_n = profile.fps_n; spec.fps_d = profile.fps_d; spec.bitrate_kbps = profile.bitrate_kbps;
                if spec.monitor.is_some() { spec.monitor = Some(self.composition.quality.monitor_source(self.fps.0, self.fps.1)); }
                if let Some(mut old) = self.publisher.take() { old.shutdown(); }
                let mut publisher = Publisher::new(spec.clone());
                for (tier, budget) in &self.budgets { publisher.set_tier_budget(*tier, Some(*budget)); }
                for (tier, hardware) in &self.tiers { Self::apply_tier(&mut publisher, *tier, true, *hardware); }
                self.publisher = Some(publisher);
            }
        }
        if self.runner.is_some() { self.runner = None; self.start()?; }
        Ok(())
    }

    fn wanted(&self) -> bool { !self.tiers.is_empty() }

    fn apply_tier(publisher: &mut Publisher, tier: MonitorTier, on: bool, hardware: bool) {
        // Destino sem níveis (RTMP/arquivo em teste): só o legado liga/desliga.
        if !publisher.set_tier(tier, on, hardware) && tier == MonitorTier::Lite { publisher.set_wanted(on); }
    }

    /// Legado (HA, clientes sem nível): o LEVE, no caminho histórico.
    pub fn set_wanted(&mut self, on: bool) { self.set_tier(MonitorTier::Lite, on, false); }

    /// Liga/desliga um nível do mosaico. Nível acima do teto não é composto
    /// nem codificado: devolve `false` e o servidor rebaixa o pedido.
    pub fn set_tier(&mut self, tier: MonitorTier, on: bool, hardware: bool) -> bool {
        if on && crate::monitor::above(tier, self.composition.quality.tier()) { return false; }
        if on { self.tiers.insert(tier, hardware); } else { self.tiers.remove(&tier); }
        if let Some(publisher) = self.publisher.as_mut() { Self::apply_tier(publisher, tier, on, hardware); }
        true
    }

    /// Orçamento de CPU concedido pelo servidor a um nível do mosaico.
    pub fn set_tier_budget(&mut self, tier: MonitorTier, budget: Option<f64>) {
        match budget { Some(value) => { self.budgets.insert(tier, value); } None => { self.budgets.remove(&tier); } }
        if let Some(publisher) = self.publisher.as_mut() { publisher.set_tier_budget(tier, budget); }
    }

    /// Teto do mosaico (o nível em que ele é composto).
    pub fn ceiling(&self) -> MonitorTier { self.composition.quality.tier() }

    fn start(&mut self) -> Result<()> {
        let profile = self.composition.quality.profile(self.fps.0, self.fps.1);
        let taps = self.cells.iter().map(|cell| (cell.source != CellSource::Empty).then(|| Arc::clone(&cell.tap))).collect();
        self.runner = Some(Runner::start(&self.video_channel, self.composition.layout, profile, taps, &self.hooks)?);
        Ok(())
    }

    fn stop(&mut self) {
        self.runner = None;
        // Sem espectador o mosaico não segura entrada nenhuma aberta.
        self.leases.clear();
        for cell in &mut self.cells {
            if let Some(installed) = cell.installed.take() { installed.remove(); }
            cell.tap.clear();
        }
    }

    /// Uma volta do laço principal: liga/desliga conforme alguém olha e
    /// reaponta cada sonda para onde a fonte está agora.
    pub fn service(&mut self, points: &TapPoints) -> Option<Report> {
        let report = self.publisher.as_mut().and_then(Publisher::service);
        if !self.wanted() {
            if self.runner.is_some() { self.stop(); }
            return report;
        }
        for cell in &mut self.cells {
            let wanted = points.find(&cell.source);
            let same = match (&cell.installed, &wanted) {
                (Some(installed), Some(point)) => installed.identity == point.identity
                    && installed.pad.upgrade().is_some_and(|pad| pad == point.pad),
                (None, None) => true,
                _ => false,
            };
            if same {
                // Mesma fonte no mesmo ponto (receptor compartilhado) que mudou
                // de barramento (PVW → PGM): só o tally muda, a sonda fica.
                if let (Some(installed), Some(point)) = (cell.installed.as_mut(), wanted.as_ref()) { installed.bus = point.bus; }
                continue;
            }
            if let Some(installed) = cell.installed.take() { installed.remove(); }
            // Fonte nova na célula começa limpa: nada do item anterior.
            cell.tap.clear();
            if let Some(point) = wanted {
                let probe = cell.tap.attach(&point.pad);
                cell.installed = Some(Installed { pad: point.pad.downgrade(), probe, identity: point.identity, bus: point.bus });
            }
        }
        if self.runner.is_none() {
            if let Err(error) = self.start() { eprintln!("[engine] multiview não subiu: {error:#}"); }
        }
        report
    }

    pub fn report(&self) -> Option<Report> { self.publisher.as_ref().map(Publisher::report) }

    /// Células com entrada cadastrada (e endereço): segura o receptor
    /// compartilhado de cada uma enquanto alguém assiste. Abrir é coisa do
    /// receptor, fora do laço (monitoramento sobe numa thread própria).
    fn sync_leases(&mut self, hub: &super::ingest::Hub) {
        if !hub.enabled() || !self.wanted() { self.leases.clear(); return; }
        let wanted: std::collections::BTreeMap<String, String> = self.composition.cells.iter().filter_map(|cell| match cell {
            CellSource::Source { id, endpoint: Some(endpoint) } => Some((endpoint.clone(), id.clone())),
            _ => None,
        }).collect();
        self.leases.retain(|endpoint, _| wanted.contains_key(endpoint));
        self.lease_retry.retain(|endpoint, _| wanted.contains_key(endpoint));
        let now = Instant::now();
        for (endpoint, id) in wanted {
            if self.leases.contains_key(&endpoint) || self.lease_retry.get(&endpoint).is_some_and(|at| now < *at) { continue; }
            match hub.monitor(&super::ingest::Hub::monitor_spec(&id, &endpoint), super::ingest::Consumer::Multiview) {
                Ok(lease) => { self.lease_retry.remove(&endpoint); self.leases.insert(endpoint, lease); }
                Err(error) => {
                    eprintln!("[engine] multiview: entrada {id} não abriu: {error:#}");
                    self.lease_retry.insert(endpoint, now + super::ingest::MONITOR_RETRY);
                }
            }
        }
    }

    /// Pontos de sonda dos receptores das células (id da entrada → ponto).
    fn receiver_points(&self, bus_of: impl Fn(&str) -> Option<&'static str>) -> Vec<(String, TapPoint)> {
        self.composition.cells.iter().filter_map(|cell| {
            let CellSource::Source { id, endpoint: Some(endpoint) } = cell else { return None };
            let (pad, identity) = self.leases.get(endpoint)?.receiver().tap()?;
            Some((id.clone(), TapPoint { pad, identity, bus: bus_of(id).unwrap_or("in") }))
        }).collect()
    }

    pub fn state(&self) -> MultiviewState {
        let profile = self.composition.quality.profile(self.fps.0, self.fps.1);
        let signals = self.runner.as_ref().and_then(|runner| runner.signals.lock().ok().map(|signals| signals.clone())).unwrap_or_default();
        let cells = self.cells.iter().enumerate().map(|(index, cell)| {
            let (caps, _, _, _) = cell.tap.snapshot();
            let structure = caps.as_ref().and_then(|caps| caps.structure(0).map(|s| (s.get::<i32>("width").ok(), s.get::<i32>("height").ok())));
            let (signal, age_ms, fps) = signals.get(index).copied().unwrap_or((
                if cell.source == CellSource::Empty { CellSignal::Empty } else if cell.installed.is_some() { CellSignal::NoSignal } else { CellSignal::Unavailable }, None, 0.0));
            let signal = if cell.installed.is_none() && cell.source != CellSource::Empty { CellSignal::Unavailable } else { signal };
            let receiver = match &cell.source {
                CellSource::Source { endpoint: Some(endpoint), .. } => self.leases.get(endpoint).map(|lease| Arc::clone(lease.receiver())),
                _ => None,
            };
            // O endereço não volta para o navegador: pode levar senha (SRT).
            let source = match &cell.source { CellSource::Source { id, .. } => CellSource::Source { id: id.clone(), endpoint: None }, other => other.clone() };
            CellState {
                source, signal, age_ms, fps: (fps * 10.0).round() / 10.0,
                width: structure.and_then(|s| s.0), height: structure.and_then(|s| s.1),
                bus: cell.installed.as_ref().map(|installed| installed.bus),
                skipped: cell.tap.skipped(),
                receiver: receiver.as_ref().map(|receiver| receiver.id()),
                frozen_ms: receiver.as_ref().and_then(|receiver| receiver.frozen_ms()),
            }
        }).collect();
        MultiviewState {
            running: self.runner.is_some(), layout: self.composition.layout, quality: self.composition.quality, profile, cells,
            frames: self.runner.as_ref().map(|runner| runner.frames.load(Ordering::Relaxed)).unwrap_or(0),
        }
    }

    pub fn shutdown(&mut self) {
        self.tiers.clear();
        self.stop();
        if let Some(publisher) = self.publisher.as_mut() { publisher.shutdown(); }
    }
}

impl Drop for Multiview {
    fn drop(&mut self) { self.stop(); }
}

#[allow(dead_code)]
impl Multiview { pub fn audio_channel(&self) -> &str { &self.audio_channel } }

// ---------------------------------------------------------------------------
// Pontos de ligação com o canal. Vivem aqui (módulo filho de `channel`) para
// channel.rs só ganhar as chamadas.
// ---------------------------------------------------------------------------

/// Pad de entrada do `intervideosink` principal de um item: é o quadro que o
/// item entrega ao barramento dele, já na cadência do canal.
fn item_point(item: Option<&Item>, bus: &'static str, qc_channel: Option<&str>) -> Option<TapPoint> {
    let item = item?;
    if item.closing.load(Ordering::Acquire) { return None; }
    let sink = item.pipeline.iterate_elements().into_iter().flatten().find(|element| {
        element.factory().is_some_and(|factory| factory.name() == "intervideosink")
            && qc_channel.map_or(true, |qc| element.property::<Option<String>>("channel").as_deref() != Some(qc))
    })?;
    Some(TapPoint { pad: sink.static_pad("sink")?, identity: item.decoder_id, bus })
}

impl Channel {
    /// Liga o multiview composto a um destino codificado (SRT do servidor de
    /// mídia). Como o QC, o destino vem da configuração privada.
    pub fn attach_multiview(&mut self, output: &Output) -> Result<()> {
        let Output::Encoded(spec) = output else { return Err(anyhow!("multiview só sai por rede")); };
        if spec.kind != Kind::Srt { return Err(anyhow!("multiview requer saída SRT")); }
        if self.multiview.is_some() || self.held_multiview.is_some() { return Err(anyhow!("multiview já ligado")); }
        if self.preview_channels.is_none() && self.program_outputs_held && self.config.preview.is_some() {
            // Mesma regra do QC: canal restaurado/HA em preparação não publica
            // monitor nenhum antes da admissão do preview.
            self.held_multiview = Some((output.clone(), None));
            return Ok(());
        }
        self.multiview = Some(Multiview::new(&self.config.channel_id, self.config.fps_n, self.config.fps_d, Some((spec.kind, spec.target.clone()))));
        Ok(())
    }

    #[cfg(test)]
    pub fn attach_multiview_for_test(&mut self) -> &mut Multiview {
        self.multiview.get_or_insert_with(|| Multiview::new(&self.config.channel_id, self.config.fps_n, self.config.fps_d, None))
    }

    pub fn configure_multiview(&mut self, composition: Composition) -> Result<()> {
        if let Some((_, pending)) = self.held_multiview.as_mut() {
            composition.validate()?;
            *pending = Some(composition);
            return Ok(());
        }
        self.multiview.as_mut().ok_or_else(|| anyhow!("este canal não tem multiview composto"))?.configure(composition)
    }

    pub fn multiview_state(&self) -> Option<MultiviewState> {
        self.multiview.as_ref().map(Multiview::state)
    }

    pub(crate) fn set_multiview_wanted(&mut self, on: bool) -> bool {
        match self.multiview.as_mut() { Some(multiview) => { multiview.set_wanted(on); true } None => false }
    }

    pub(crate) fn set_multiview_budget(&mut self, tier: MonitorTier, budget: Option<f64>) {
        if let Some(multiview) = self.multiview.as_mut() { multiview.set_tier_budget(tier, budget); }
    }

    pub(crate) fn set_multiview_tier(&mut self, tier: MonitorTier, on: bool, hardware: bool) -> bool {
        self.multiview.as_mut().is_some_and(|multiview| multiview.set_tier(tier, on, hardware))
    }

    /// Teto do mosaico, se o canal tem multiview publicando.
    pub fn multiview_ceiling(&self) -> Option<MonitorTier> { self.multiview.as_ref().map(Multiview::ceiling) }

    /// Destino do multiview retido até a admissão (HA/restauração).
    pub fn multiview_held(&self) -> bool { self.held_multiview.is_some() }

    pub fn multiview_tap_points(&self) -> TapPoints {
        #[cfg(test)]
        TAP_POINTS_BUILT.with(|count| count.set(count.get() + 1));
        let qc = self.qc_video_channel.as_deref();
        let pgm = self.pipeline.by_name("tee-video").and_then(|tee| tee.static_pad("sink"))
            .map(|pad| TapPoint { pad, identity: 0, bus: "pgm" });
        let mut points = TapPoints {
            pgm,
            pvw: item_point(self.previewing.as_ref(), "pvw", qc),
            next: item_point(self.armed.as_ref(), "next", qc),
            qc: item_point(self.qc_item.as_ref(), "qc", qc),
            contingency: item_point(self.live_replacement.as_ref(), "contingency", qc),
            sources: Vec::new(),
        };
        // Fonte cadastrada: onde estiver aberta, na ordem PGM, PVW, NEXT, QC,
        // contingência. No PGM a célula mostra o item (sem grafismo), que é o
        // que a entrada entrega.
        // Entrada com receptor compartilhado: a célula lê o receptor (a
        // entrada crua, sempre visível); o barramento só pinta o tally.
        if let Some(multiview) = self.multiview.as_ref() {
            points.sources = multiview.receiver_points(|id| self.bus_of_source(id));
        }
        for (item, bus) in [(self.on_air.as_ref(), "pgm"), (self.previewing.as_ref(), "pvw"), (self.armed.as_ref(), "next"),
                            (self.qc_item.as_ref(), "qc"), (self.live_replacement.as_ref(), "contingency")] {
            let Some(item) = item.filter(|item| item.spec.is_live()) else { continue };
            let Some(id) = item.spec.configured_source_id.clone() else { continue };
            if points.sources.iter().any(|(known, _)| *known == id) { continue; }
            if let Some(point) = item_point(Some(item), bus, qc) { points.sources.push((id, point)); }
        }
        points
    }

    /// Primeiro barramento em que a entrada cadastrada está aberta.
    fn bus_of_source(&self, id: &str) -> Option<&'static str> {
        [(self.on_air.as_ref(), "pgm"), (self.previewing.as_ref(), "pvw"), (self.armed.as_ref(), "next"),
         (self.qc_item.as_ref(), "qc"), (self.live_replacement.as_ref(), "contingency")].into_iter()
            .find(|(item, _)| item.is_some_and(|item| item.spec.is_live() && item.spec.configured_source_id.as_deref() == Some(id)))
            .map(|(_, bus)| bus)
    }

    pub(crate) fn service_multiview(&mut self) -> Option<Report> {
        let multiview = self.multiview.as_mut()?;
        multiview.sync_leases(&self.ingest);
        // Sem espectador não há o que sondar: o laço roda a ~50 Hz e montar os
        // pontos (procurar o tee, os itens e as fontes) era trabalho jogado fora.
        // O serviço ainda roda, com pontos vazios, para desligar o que sobrou.
        if !multiview.wanted() { return multiview.service(&TapPoints::default()); }
        let points = self.multiview_tap_points();
        self.multiview.as_mut().and_then(|multiview| multiview.service(&points))
    }

    pub(crate) fn multiview_report(&self) -> Option<Report> {
        self.multiview.as_ref().and_then(Multiview::report)
    }
}


#[cfg(test)]
thread_local! {
    /// Quantas vezes o canal montou os pontos de sonda nesta thread (teste).
    static TAP_POINTS_BUILT: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
impl Multiview {
    pub(crate) fn cell_tap(&self, index: usize) -> Arc<Tap> { Arc::clone(&self.cells[index].tap) }
    fn set_tier_urls(&mut self, urls: std::collections::BTreeMap<MonitorTier, String>) {
        if let Some(publisher) = self.publisher.as_mut() { publisher.set_tier_urls(urls); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layouts_fill_the_frame_without_overlap_and_on_even_pixels() {
        for layout in [Layout::Grid2x2, Layout::Grid3x3, Layout::Grid4x4, Layout::OnePlus5, Layout::PgmPvw] {
            // Unidades cobrem a grade inteira, sem sobreposição.
            let mut covered = [[0u8; 12]; 12];
            for (x, y, w, h) in layout.units() { for row in y..y + h { for col in x..x + w { covered[row as usize][col as usize] += 1; } } }
            assert!(covered.iter().flatten().all(|count| *count == 1), "{layout:?} não cobre a grade exatamente uma vez");
            for (width, height) in [(1920, 1080), (1280, 720), (960, 540)] {
                let rects = layout.rects(width, height);
                assert_eq!(rects.len(), layout.cells());
                for (index, rect) in rects.iter().enumerate() {
                    assert!(rect.x % 2 == 0 && rect.y % 2 == 0 && rect.w % 2 == 0 && rect.h % 2 == 0, "{layout:?} {rect:?} fora do par");
                    assert!(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= width && rect.y + rect.h <= height, "{layout:?} {rect:?} fora do quadro");
                    for other in &rects[index + 1..] {
                        let apart = rect.x + rect.w <= other.x || other.x + other.w <= rect.x || rect.y + rect.h <= other.y || other.y + other.h <= rect.y;
                        assert!(apart, "{layout:?}: {rect:?} sobrepõe {other:?}");
                    }
                }
            }
        }
        assert_eq!(Layout::OnePlus5.cells(), 6);
        assert_eq!(Layout::PgmPvw.cells(), 10);
        assert_eq!(Layout::PgmPvw.rects(1920, 1080)[..2], [Rect { x: 0, y: 0, w: 958, h: 538 }, Rect { x: 960, y: 0, w: 958, h: 538 }]);
    }

    #[test]
    fn wire_names_match_the_server_contract() {
        let composition: Composition = serde_json::from_value(serde_json::json!({
            "layout": "MV_1_PLUS_5", "quality": "LEVE",
            "cells": [{"kind":"pgm"},{"kind":"pvw"},{"kind":"source","id":"cam-1"},{"kind":"contingency"},{"kind":"empty"}]
        })).unwrap();
        assert_eq!(composition.layout, Layout::OnePlus5);
        assert_eq!(composition.quality, Quality::Leve);
        assert_eq!(composition.cells[2], CellSource::Source { id: "cam-1".into(), endpoint: None });
        composition.validate().unwrap();
        let too_many = Composition { layout: Layout::Grid2x2, cells: vec![CellSource::Pgm; 5], quality: Quality::Padrao };
        assert!(too_many.validate().is_err());
        assert!(serde_json::from_value::<Composition>(serde_json::json!({"layout":"MV_2X2","cells":[{"kind":"file","path":"/etc/passwd"}]})).is_err());
        let profile = Quality::Padrao.profile(50, 1);
        assert_eq!((profile.width, profile.height, profile.fps_n, profile.fps_d), (1280, 720, 50, 2));
        assert_eq!(Quality::Referencia.profile(30000, 1001).fps_n, 30000);
    }

    /// Integração com os monitores (r88-36): `Quality` é o teto e mapeia nos
    /// níveis; os perfis vêm de uma tabela só; o orçamento de CPU dos
    /// monitores em software vale para o mosaico.
    #[test]
    fn quality_is_the_monitor_tier_ceiling_with_one_profile_table() {
        use crate::monitor::{mosaic_profile, resolve_profile, tier_profile, above};
        assert_eq!(Quality::Referencia.tier(), MonitorTier::Ref);
        assert_eq!(Quality::Padrao.tier(), MonitorTier::Std);
        assert_eq!(Quality::Leve.tier(), MonitorTier::Lite);
        assert!(above(MonitorTier::Ref, MonitorTier::Std) && !above(MonitorTier::Lite, MonitorTier::Std) && !above(MonitorTier::Std, MonitorTier::Std));
        // Mosaico composto no teto PADRÃO de um canal 50p: 1280x720 a 25.
        let source = Quality::Padrao.monitor_source(50, 1);
        assert!(source.mosaic);
        assert_eq!((source.width, source.height, source.fps_n, source.fps_d), (1280, 720, 50, 2));
        let std = tier_profile(MonitorTier::Std, &source, true);
        assert_eq!((std.width, std.height, std.fps_n, std.fps_d, std.bitrate_kbps), (1280, 720, 50, 2, 3000));
        // LEVE do mosaico é 960x540 a 15 (240 linhas não se leem num 3x3).
        let lite = tier_profile(MonitorTier::Lite, &source, false);
        assert_eq!((lite.width, lite.height, lite.fps_n, lite.fps_d, lite.bitrate_kbps), (960, 540, 15, 1, 1200));
        assert_eq!(lite, mosaic_profile(MonitorTier::Lite, &source));
        // Orçamento de CPU de monitores em software: PADRÃO do mosaico sem
        // folga desce para a geometria do LEVE, com o motivo no relatório.
        let (fits, reason) = resolve_profile(MonitorTier::Std, &source, false, 0.0, 60.0);
        assert_eq!((fits, reason), (std, None));
        let (cheap, reason) = resolve_profile(MonitorTier::Std, &source, false, 50.0, 60.0);
        assert_eq!((cheap.width, cheap.height), (960, 540));
        assert!(reason.is_some_and(|r| r.contains("CPU")));
        // Na placa não conta.
        assert_eq!(resolve_profile(MonitorTier::Std, &source, true, 1000.0, 60.0).0, std);
        // Nível acima do teto não é composto nem codificado.
        let mut multiview = Multiview::new("mv-teto", 25, 1, None);
        assert!(!multiview.set_tier(MonitorTier::Ref, true, false), "REF acima do teto PADRÃO");
        assert!(multiview.set_tier(MonitorTier::Std, true, false));
        assert!(multiview.wanted());
        // Teto baixa para LEVE: o PADRÃO pedido some, o mosaico para.
        multiview.configure(Composition { quality: Quality::Leve, ..Composition::default() }).unwrap();
        assert!(!multiview.wanted());
        assert!(!multiview.set_tier(MonitorTier::Std, true, false));
        assert!(multiview.set_tier(MonitorTier::Lite, true, false));
    }

    /// HA/restauração: como o QC, o multiview não publica antes da admissão
    /// do preview. A composição pedida nesse meio tempo não se perde.
    #[test]
    fn multiview_is_held_until_ha_admission_like_qc() {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        struct Running(Channel);
        impl Drop for Running { fn drop(&mut self) { self.0.shutdown(); } }
        let preview = Output::parse("srt://127.0.0.1:19917?mode=caller").unwrap();
        let mv = Output::parse("srt://127.0.0.1:19918?mode=caller&streamid=publish:c/mv").unwrap();
        let mut channel = Running(Channel::new_with_program_hold(Config { channel_id: "mv-held".into(), width: 320, height: 180, fps_n: 25, fps_d: 1, bitrate_kbps: 450,
            ceiling_dbtp: -1.0, audio_channels: 2, scan: Scan::Progressive, top_field_first: true, outputs: vec![Output::Null], preview: Some(preview) }, true).unwrap());
        channel.0.attach_multiview(&mv).unwrap();
        assert!(channel.0.multiview_held());
        assert!(channel.0.multiview_state().is_none(), "nada de multiview antes da admissão");
        assert!(channel.0.attach_multiview(&mv).is_err(), "destino retido não é sobrescrito");
        assert!(!channel.0.set_monitor(BUS, true), "mv não liga antes da admissão");
        assert!(!channel.0.set_monitor_tier(BUS, Some(MonitorTier::Std), true, false));
        channel.0.configure_multiview(Composition { layout: Layout::Grid3x3, cells: vec![CellSource::Pgm], quality: Quality::Leve }).unwrap();
        channel.0.start().unwrap();
        channel.0.release_program_outputs(None, None).unwrap();
        assert!(channel.0.multiview_held(), "admissão do PGM sozinha não libera o mosaico");
        channel.0.release_preview_output().unwrap();
        assert!(!channel.0.multiview_held());
        let state = channel.0.multiview_state().expect("multiview depois da admissão");
        assert_eq!((state.layout, state.quality), (Layout::Grid3x3, Quality::Leve), "composição pedida durante a retenção aplicada");
        assert!(channel.0.set_monitor(BUS, true));
        assert_eq!(channel.0.multiview_ceiling(), Some(MonitorTier::Lite));
    }

    /// Achado 8: sem espectador, o serviço do multiview não monta os pontos de
    /// sonda a cada volta do laço (~50 Hz).
    #[test]
    fn sem_espectador_nao_monta_pontos_de_sonda() {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        struct Running(Channel);
        impl Drop for Running { fn drop(&mut self) { self.0.shutdown(); } }
        let mut channel = Running(Channel::new_with_program_hold(Config { channel_id: "mv-idle".into(), width: 320, height: 180, fps_n: 25, fps_d: 1, bitrate_kbps: 450,
            ceiling_dbtp: -1.0, audio_channels: 2, scan: Scan::Progressive, top_field_first: true, outputs: vec![Output::Null], preview: None }, false).unwrap());
        channel.0.attach_multiview_for_test();
        let built = || TAP_POINTS_BUILT.with(|count| count.get());
        let before = built();
        for _ in 0..50 { channel.0.service_multiview(); }
        assert_eq!(built(), before, "sem espectador, nenhum ponto montado");
        assert!(channel.0.set_monitor(BUS, true));
        channel.0.service_multiview();
        assert_eq!(built(), before + 1, "com espectador, um por volta");
        assert!(channel.0.set_monitor(BUS, false));
        channel.0.service_multiview();
        assert_eq!(built(), before + 1);
    }

    /// Item 11: desmontar o multiview não faz join no laço principal. Com a
    /// thread de cadência atrasada 1 s, o drop volta na hora; a thread e o
    /// pipeline terminam sozinhos logo depois.
    #[test]
    fn desmontar_o_multiview_nao_segura_o_laco_principal() {
        gst::init().unwrap();
        let profile = Quality::Leve.profile(25, 1);
        let hooks = Hooks { cadence_stall: Some(Duration::from_millis(1000)), ..Hooks::default() };
        let runner = Runner::start("mv-drop-test", Layout::Grid2x2, profile, vec![None; 4], &hooks).unwrap();
        let pipeline = runner.pipeline.clone();
        std::thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        drop(runner);
        assert!(started.elapsed() < Duration::from_millis(100), "drop levou {:?}", started.elapsed());
        let until = Instant::now() + Duration::from_secs(4);
        while pipeline.current_state() != gst::State::Null && Instant::now() < until { std::thread::sleep(Duration::from_millis(20)); }
        assert_eq!(pipeline.current_state(), gst::State::Null, "o pipeline foi solto pela thread de desmontagem");
    }

    // ---- GStreamer --------------------------------------------------------

    struct Source { pipeline: gst::Pipeline, pad: gst::Pad }
    impl Drop for Source { fn drop(&mut self) { let _ = self.pipeline.set_state(gst::State::Null); } }

    /// Fonte ao vivo de cor chapada, com o mesmo formato que um item entrega.
    fn source(pattern: &str, width: i32, height: i32) -> Source {
        let pipeline = gst::parse::launch(&format!(
            "videotestsrc is-live=true pattern={pattern} ! video/x-raw,format=I420,width={width},height={height},framerate=25/1 ! identity name=ponto ! fakesink sync=true"
        )).unwrap().downcast::<gst::Pipeline>().unwrap();
        let pad = pipeline.by_name("ponto").unwrap().static_pad("sink").unwrap();
        pipeline.set_state(gst::State::Playing).unwrap();
        Source { pipeline, pad }
    }

    fn point(source: &Source, identity: u64, bus: &'static str) -> TapPoint { TapPoint { pad: source.pad.clone(), identity, bus } }

    struct Reader { pipeline: gst::Pipeline, sink: gst_app::AppSink, width: usize, height: usize }
    impl Drop for Reader { fn drop(&mut self) { let _ = self.pipeline.set_state(gst::State::Null); } }

    fn reader(channel: &str, profile: Profile) -> Reader {
        let pipeline = gst::parse::launch(&format!(
            "intervideosrc channel={channel} timeout=10000000000 ! video/x-raw,format=I420,width={},height={} ! appsink name=out sync=false max-buffers=2 drop=true",
            profile.width, profile.height
        )).unwrap().downcast::<gst::Pipeline>().unwrap();
        let sink = pipeline.by_name("out").unwrap().downcast::<gst_app::AppSink>().unwrap();
        pipeline.set_state(gst::State::Playing).unwrap();
        Reader { pipeline, sink, width: profile.width as usize, height: profile.height as usize }
    }

    impl Reader {
        /// Luma média de uma janela 8x8 no ponto (fração do quadro).
        fn luma(&self, fx: f64, fy: f64) -> f64 {
            while self.sink.try_pull_sample(gst::ClockTime::ZERO).is_some() {}
            let sample = self.sink.pull_sample().unwrap();
            let buffer = sample.buffer().unwrap();
            let map = buffer.map_readable().unwrap();
            let (cx, cy) = ((fx * self.width as f64) as usize, (fy * self.height as f64) as usize);
            let mut sum = 0f64;
            for y in cy - 4..cy + 4 { for x in cx - 4..cx + 4 { sum += map[y * self.width + x] as f64; } }
            sum / 64.0
        }
    }

    fn near(value: f64, expected: f64) -> bool { (value - expected).abs() <= 14.0 }

    fn serve(multiview: &mut Multiview, points: &TapPoints, duration: Duration) {
        let end = Instant::now() + duration;
        while Instant::now() < end { multiview.service(points); std::thread::sleep(Duration::from_millis(40)); }
    }

    // Luma BT.601 (faixa limitada) das cores chapadas do videotestsrc.
    const RED: f64 = 81.0;
    const GREEN: f64 = 145.0;
    const BLUE: f64 = 41.0;
    const WHITE: f64 = 235.0;

    #[test]
    fn composes_each_source_in_its_cell_holds_frozen_and_marks_no_signal() {
        gst::init().unwrap();
        let red = source("red", 1920, 1080);
        let green = source("green", 428, 240);
        let blue = source("blue", 1280, 720);
        let white = source("white", 720, 576);
        let mut points = TapPoints { pgm: Some(point(&red, 0, "pgm")), pvw: Some(point(&green, 7, "pvw")), next: Some(point(&blue, 8, "next")),
            qc: Some(point(&white, 9, "qc")), ..TapPoints::default() };
        let mut multiview = Multiview::new("mv-teste-composicao", 25, 1, None);
        multiview.configure(Composition { layout: Layout::Grid2x2, cells: vec![CellSource::Pgm, CellSource::Pvw, CellSource::Next, CellSource::Qc], quality: Quality::Leve }).unwrap();
        multiview.set_wanted(true);
        let profile = Quality::Leve.profile(25, 1);
        let out = reader("mv-teste-composicao-mv-video", profile);
        serve(&mut multiview, &points, Duration::from_millis(1500));
        let lumas = [out.luma(0.25, 0.25), out.luma(0.75, 0.25), out.luma(0.25, 0.75), out.luma(0.75, 0.75)];
        eprintln!("[teste] lumas das células: {lumas:?}");
        assert!(near(lumas[0], RED) && near(lumas[1], GREEN) && near(lumas[2], BLUE) && near(lumas[3], WHITE), "células fora do lugar: {lumas:?}");
        let state = multiview.state();
        assert!(state.running && state.frames > 10, "multiview não compôs: {state:?}");
        assert!(state.cells.iter().all(|cell| matches!(cell.signal, CellSignal::Live)), "{state:?}");
        assert_eq!((state.cells[0].width, state.cells[0].height), (Some(1920), Some(1080)));
        // A fonte 720x576 (4:3) entra com barra lateral, não esticada.
        let edge = out.luma(0.52, 0.75);
        assert!(near(edge, 16.0), "4:3 deveria ter barra preta na borda esquerda da célula: {edge}");

        // Fonte que para: primeiro mantém o último quadro, depois "sem sinal".
        red.pipeline.set_state(gst::State::Paused).unwrap();
        serve(&mut multiview, &points, Duration::from_millis(800));
        let held = multiview.state().cells[0].clone();
        assert_eq!(held.signal, CellSignal::Held, "{held:?}");
        assert!(near(out.luma(0.25, 0.25), RED), "último quadro deveria continuar na tela");
        serve(&mut multiview, &points, Duration::from_millis(1800));
        let lost = multiview.state().cells[0].clone();
        assert_eq!(lost.signal, CellSignal::NoSignal, "{lost:?}");
        let slate = out.luma(0.25, 0.25);
        assert!((25.0..80.0).contains(&slate), "célula sem sinal deveria mostrar o quadro de sem sinal: {slate}");
        assert!(near(out.luma(0.75, 0.25), GREEN), "as outras células não podem ser afetadas");

        // Item que sai do barramento: célula indisponível, sem resto do anterior.
        points.pvw = None;
        serve(&mut multiview, &points, Duration::from_millis(400));
        assert_eq!(multiview.state().cells[1].signal, CellSignal::Unavailable);
        assert!(near(out.luma(0.75, 0.25), 34.0), "célula indisponível deveria ser cinza liso");

        // Sem espectador: nada de sonda, pipeline ou thread.
        multiview.set_wanted(false);
        multiview.service(&points);
        assert!(!multiview.state().running);
        assert!(multiview.cells.iter().all(|cell| cell.installed.is_none()), "sondas deveriam sair junto com o espectador");
    }

    /// Mede o intervalo máximo entre quadros num pad e conta os quadros.
    fn cadence_meter(pad: &gst::Pad) -> (Arc<AtomicU64>, Arc<Mutex<(Option<Instant>, Duration)>>) {
        let frames = Arc::new(AtomicU64::new(0));
        let gap = Arc::new(Mutex::new((None::<Instant>, Duration::ZERO)));
        let (count, worst) = (Arc::clone(&frames), Arc::clone(&gap));
        pad.add_probe(gst::PadProbeType::BUFFER, move |_, _| {
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
    fn layout_change_rebuilds_only_the_multiview() {
        gst::init().unwrap();
        let pgm = source("red", 1280, 720);
        let (frames, gap) = cadence_meter(&pgm.pad);
        let points = TapPoints { pgm: Some(point(&pgm, 0, "pgm")), ..TapPoints::default() };
        let mut multiview = Multiview::new("mv-teste-layout", 25, 1, None);
        multiview.configure(Composition { layout: Layout::Grid2x2, cells: vec![CellSource::Pgm], quality: Quality::Leve }).unwrap();
        multiview.set_wanted(true);
        let out = reader("mv-teste-layout-mv-video", Quality::Leve.profile(25, 1));
        serve(&mut multiview, &points, Duration::from_millis(1200));
        assert!(near(out.luma(0.25, 0.25), RED));
        *gap.lock().unwrap() = (None, Duration::ZERO);
        let before = frames.load(Ordering::Relaxed);
        let started = Instant::now();
        for layout in [Layout::Grid3x3, Layout::Grid4x4, Layout::OnePlus5, Layout::PgmPvw, Layout::Grid3x3] {
            multiview.configure(Composition { layout, cells: vec![CellSource::Pgm, CellSource::Empty], quality: Quality::Leve }).unwrap();
            serve(&mut multiview, &points, Duration::from_millis(300));
        }
        let elapsed = started.elapsed().as_secs_f64();
        let delivered = frames.load(Ordering::Relaxed) - before;
        let worst = gap.lock().unwrap().1;
        eprintln!("[teste] trocas de layout: PGM entregou {delivered} quadros em {elapsed:.2} s; maior intervalo {worst:?}");
        assert!(worst < Duration::from_millis(100), "troca de layout atrasou o PGM: {worst:?}");
        assert!(delivered as f64 >= elapsed * 25.0 - 3.0, "PGM perdeu quadros: {delivered} em {elapsed:.2}s");
        // 3x3: a fonte ocupa o terço de cima à esquerda; o resto é preto.
        assert!(near(out.luma(1.0 / 6.0, 1.0 / 6.0), RED), "célula do 3x3 fora do lugar");
        assert!(near(out.luma(0.5, 1.0 / 6.0), 16.0), "célula vazia deveria ser preta");
    }

    /// Saída de verdade: o mosaico sai codificado uma vez pelo Publisher (SRT,
    /// H.264) e um leitor externo (ffprobe) o reconhece no tamanho do nível.
    #[test]
    fn composed_multiview_is_encoded_once_and_readable_over_srt() {
        gst::init().unwrap();
        if gst::ElementFactory::find("srtsink").is_none() || std::process::Command::new("ffprobe").arg("-version").output().is_err() {
            eprintln!("sem srtsink/ffprobe; teste pulado"); return;
        }
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        struct Running(Channel);
        impl Drop for Running { fn drop(&mut self) { self.0.shutdown(); } }
        let port = 19_900 + (std::process::id() % 90) as u16;
        let mut channel = Running(Channel::new(Config { channel_id: "mv-srt".into(), width: 1280, height: 720, fps_n: 25, fps_d: 1, bitrate_kbps: 450,
            ceiling_dbtp: -1.0, audio_channels: 2, scan: Scan::Progressive, top_field_first: true, outputs: vec![Output::Null], preview: None }).unwrap());
        channel.0.start().unwrap();
        channel.0.attach_multiview(&Output::parse(&format!("srt://127.0.0.1:{port}?mode=listener")).unwrap()).unwrap();
        assert!(channel.0.attach_multiview(&Output::parse("rtmp://127.0.0.1/x/y").unwrap()).is_err());
        channel.0.configure_multiview(Composition { layout: Layout::PgmPvw, cells: vec![CellSource::Pgm, CellSource::Pvw], quality: Quality::Leve }).unwrap();
        assert!(channel.0.set_monitor(BUS, true));
        let probe = std::thread::spawn(move || std::process::Command::new("ffprobe")
            .args(["-v", "error", "-rw_timeout", "15000000", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate", "-of", "json",
                   &format!("srt://127.0.0.1:{port}?mode=caller")]).output());
        let started = Instant::now();
        while !probe.is_finished() && started.elapsed() < Duration::from_secs(25) { channel.0.service_outputs(); std::thread::sleep(Duration::from_millis(40)); }
        let output = probe.join().unwrap().unwrap();
        let text = String::from_utf8_lossy(&output.stdout);
        eprintln!("[teste] ffprobe do multiview: {text}");
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        let video = json["streams"].as_array().unwrap().iter().find(|stream| stream["codec_type"] == "video").expect("sem vídeo no SRT do multiview").clone();
        assert_eq!(video["codec_name"], "h264");
        assert_eq!((video["width"].as_i64(), video["height"].as_i64()), (Some(960), Some(540)));
        let reports = channel.0.outputs_report();
        assert!(reports.iter().any(|report| report.output_id == "multiview"), "relatório do monitor mv ausente");
        let state = channel.0.multiview_state().unwrap();
        assert_eq!(state.cells[0].signal, CellSignal::Live);
        assert_eq!(state.cells[1].signal, CellSignal::Unavailable, "sem PVW aberto a célula é indisponível");
    }

    /// Os níveis do mosaico saem pelo mesmo publicador dos monitores, cada um
    /// no seu caminho, lidos por ffprobe. Com `RPLAYOUT_QA_MV_TIERS=ref` o
    /// teto é REFERÊNCIA e saem os três (pede CPU: rode sozinho, com
    /// `RPLAYOUT_MONITOR_SW_MPX` alto); sem ele, teto PADRÃO: PADRÃO e LEVE.
    #[test]
    fn multiview_tiers_publish_each_on_its_path_over_srt() {
        gst::init().unwrap();
        if gst::ElementFactory::find("srtsink").is_none() || std::process::Command::new("ffprobe").arg("-version").output().is_err() {
            eprintln!("sem srtsink/ffprobe; teste pulado"); return;
        }
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        struct Running(Channel);
        impl Drop for Running { fn drop(&mut self) { self.0.shutdown(); } }
        let all = std::env::var("RPLAYOUT_QA_MV_TIERS").is_ok_and(|v| v == "ref");
        let (quality, tiers) = if all { (Quality::Referencia, vec![MonitorTier::Ref, MonitorTier::Std, MonitorTier::Lite]) } else { (Quality::Padrao, vec![MonitorTier::Std, MonitorTier::Lite]) };
        let free = || std::net::UdpSocket::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let ports: Vec<(MonitorTier, u16)> = tiers.iter().map(|tier| (*tier, free())).collect();
        let mut channel = Running(Channel::new(Config { channel_id: "mv-niveis".into(), width: 1280, height: 720, fps_n: 25, fps_d: 1, bitrate_kbps: 450,
            ceiling_dbtp: -1.0, audio_channels: 2, scan: Scan::Progressive, top_field_first: true, outputs: vec![Output::Null], preview: None }).unwrap());
        channel.0.start().unwrap();
        channel.0.attach_multiview(&Output::parse("srt://127.0.0.1:9?mode=caller&streamid=publish:mv-niveis/mv").unwrap()).unwrap();
        channel.0.configure_multiview(Composition { layout: Layout::Grid2x2, cells: vec![CellSource::Pgm], quality }).unwrap();
        channel.0.multiview.as_mut().unwrap().set_tier_urls(ports.iter().map(|(tier, port)| (*tier, format!("srt://127.0.0.1:{port}?mode=listener"))).collect());
        if !all { assert!(!channel.0.set_monitor_tier(BUS, Some(MonitorTier::Ref), true, false), "REF acima do teto PADRÃO"); }
        for tier in &tiers { assert!(channel.0.set_monitor_tier(BUS, Some(*tier), true, false)); }
        let probes: Vec<_> = ports.iter().map(|(tier, port)| {
            let (tier, port) = (*tier, *port);
            (tier, std::thread::spawn(move || std::process::Command::new("ffprobe")
                .args(["-v", "error", "-rw_timeout", "20000000", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate", "-of", "json",
                       &format!("srt://127.0.0.1:{port}?mode=caller")]).output()))
        }).collect();
        let started = Instant::now();
        while probes.iter().any(|(_, probe)| !probe.is_finished()) && started.elapsed() < Duration::from_secs(40) { channel.0.service_outputs(); std::thread::sleep(Duration::from_millis(40)); }
        let reports = channel.0.outputs_report();
        let report = reports.iter().find(|report| report.output_id == "multiview").expect("relatório do mv");
        eprintln!("[teste] níveis do mv: {}", serde_json::to_string(&report.tiers).unwrap());
        for (tier, probe) in probes {
            let output = probe.join().unwrap().unwrap();
            let text = String::from_utf8_lossy(&output.stdout);
            eprintln!("[teste] ffprobe mv {}: {text}", tier.name());
            let json: serde_json::Value = serde_json::from_str(&text).unwrap();
            let streams = json["streams"].as_array().unwrap();
            let video = streams.iter().find(|stream| stream["codec_type"] == "video").expect("sem vídeo").clone();
            assert_eq!(video["codec_name"], "h264");
            assert!(streams.iter().any(|stream| stream["codec_name"] == "opus"), "sem Opus no nível {}", tier.name());
            let size = (video["width"].as_i64().unwrap(), video["height"].as_i64().unwrap());
            let tier_report = report.tiers.iter().find(|r| r.tier == tier).expect("nível sem relatório");
            let profile = tier_report.profile.unwrap();
            assert_eq!(size, (profile.width as i64, profile.height as i64), "o que saiu no SRT é o perfil relatado");
            let expected = match tier { MonitorTier::Ref => (1920, 1080), MonitorTier::Std => (1280, 720), MonitorTier::Lite => (960, 540) };
            // O orçamento de CPU pode servir um nível mais barato, sempre dizendo por quê.
            assert!(size == expected || tier_report.degraded.is_some(), "nível {} saiu {size:?} sem motivo", tier.name());
            assert!(!tier_report.hardware && tier_report.encoder.as_deref() == Some("x264enc"));
        }
        assert_eq!(report.tiers.len(), tiers.len());
    }

    /// Medição de custo (docs/MULTIVIEW.md). Não roda na suíte: é lenta e
    /// depende da máquina. `cargo test --release medir_custo_multiview -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn medir_custo_multiview() {
        gst::init().unwrap();
        fn ticks() -> u64 {
            let stat = std::fs::read_to_string("/proc/self/stat").unwrap();
            let fields: Vec<&str> = stat.rsplit_once(')').unwrap().1.split_whitespace().collect();
            fields[11].parse::<u64>().unwrap() + fields[12].parse::<u64>().unwrap()
        }
        fn cpu(seconds: f64, work: &mut dyn FnMut()) -> f64 {
            let (start, at) = (ticks(), Instant::now());
            while at.elapsed().as_secs_f64() < seconds { work(); std::thread::sleep(Duration::from_millis(40)); }
            (ticks() - start) as f64 / at.elapsed().as_secs_f64() // 100 ticks/s = 1 núcleo
        }
        struct Receiver { pipeline: gst::Pipeline, sink: gst_app::AppSink, width: usize }
        impl Drop for Receiver { fn drop(&mut self) { let _ = self.pipeline.set_state(gst::State::Null); } }
        fn receiver(port: u16, decode: bool) -> Receiver {
            let tail = if decode { "tsdemux ! h264parse ! avdec_h264 ! videoconvert ! video/x-raw,format=I420 ! appsink name=out sync=false max-buffers=2 drop=true" } else { "appsink name=out sync=false max-buffers=2 drop=true" };
            let pipeline = gst::parse::launch(&format!("srtsrc uri=srt://127.0.0.1:{port}?mode=caller latency=120 ! {tail}")).unwrap().downcast::<gst::Pipeline>().unwrap();
            let sink = pipeline.by_name("out").unwrap().downcast::<gst_app::AppSink>().unwrap();
            pipeline.set_state(gst::State::Playing).unwrap();
            Receiver { pipeline, sink, width: 0 }
        }
        /// Tempo entre a fonte virar branca e o receptor decodificado ver branco
        /// no ponto (fx, fy).
        fn flip(source: &gst::Element, receiver: &mut Receiver, fx: f64, fy: f64, service: &mut dyn FnMut()) -> Option<Duration> {
            let mut luma = |sample: &gst::Sample| -> f64 {
                let caps = sample.caps().unwrap().structure(0).unwrap().to_owned();
                let (w, h) = (caps.get::<i32>("width").unwrap() as usize, caps.get::<i32>("height").unwrap() as usize);
                receiver.width = w;
                let map = sample.buffer().unwrap().map_readable().unwrap();
                map[(fy * h as f64) as usize * w + (fx * w as f64) as usize] as f64
            };
            source.set_property_from_str("pattern", "black");
            let settle = Instant::now();
            while settle.elapsed() < Duration::from_secs(3) { service(); if let Some(sample) = receiver.sink.try_pull_sample(gst::ClockTime::from_mseconds(20)) { let _ = luma(&sample); } }
            source.set_property_from_str("pattern", "white");
            let at = Instant::now();
            while at.elapsed() < Duration::from_secs(5) {
                service();
                if let Some(sample) = receiver.sink.try_pull_sample(gst::ClockTime::from_mseconds(5)) { if luma(&sample) > 180.0 { return Some(at.elapsed()); } }
            }
            None
        }
        let profile = Quality::Padrao.profile(25, 1);
        for n in [4usize, 9] {
            let sources: Vec<Source> = (0..n).map(|_| source("ball", 1280, 720)).collect();
            let baseline = cpu(4.0, &mut || {});
            // --- Composto: um mosaico, uma codificação.
            let port = 20_100 + n as u16;
            let mut multiview = Multiview::new(&format!("bench-{n}"), 25, 1, Some((Kind::Srt, format!("srt://127.0.0.1:{port}?mode=listener"))));
            let layout = if n == 4 { Layout::Grid2x2 } else { Layout::Grid3x3 };
            let cells: Vec<CellSource> = (0..n).map(|i| CellSource::Source { id: format!("s{i}"), endpoint: None }).collect();
            multiview.configure(Composition { layout, cells, quality: Quality::Padrao }).unwrap();
            let points = TapPoints { sources: sources.iter().enumerate().map(|(i, s)| (format!("s{i}"), point(s, i as u64 + 1, "pvw"))).collect(), ..TapPoints::default() };
            multiview.set_wanted(true);
            let rx = receiver(port, false);
            serve(&mut multiview, &points, Duration::from_secs(3));
            let composite = cpu(8.0, &mut || { multiview.service(&points); });
            drop(rx);
            let mut rx = receiver(port, true);
            serve(&mut multiview, &points, Duration::from_secs(2));
            let source0 = sources[0].pipeline.by_name("videotestsrc0").or_else(|| sources[0].pipeline.iterate_elements().into_iter().flatten().find(|e| e.factory().is_some_and(|f| f.name() == "videotestsrc"))).unwrap();
            let fx = if n == 4 { 0.25 } else { 1.0 / 6.0 };
            let composite_latency = flip(&source0, &mut rx, fx, fx, &mut || { multiview.service(&points); });
            drop(rx); multiview.shutdown(); drop(multiview);
            std::thread::sleep(Duration::from_millis(500));
            // --- Individual: um monitor 240p por fonte (o modelo WHEP por fonte).
            let (mw, mh) = crate::channel::monitor_size(1280, 720);
            let mut feeds = Vec::new();
            let mut publishers = Vec::new();
            for (i, s) in sources.iter().enumerate() {
                let video = format!("bench-ind-{n}-{i}-video");
                // O item de PVW já entrega 240p ao barramento: escala no item, depois intervideosink.
                let scale = gst::parse::launch(&format!("appsrc name=in is-live=true format=time do-timestamp=true ! videoscale ! video/x-raw,width={mw},height={mh} ! intervideosink channel={video}")).unwrap().downcast::<gst::Pipeline>().unwrap();
                let appsrc = scale.by_name("in").unwrap().downcast::<gst_app::AppSrc>().unwrap();
                scale.set_state(gst::State::Playing).unwrap();
                let forward = appsrc.clone();
                let probe = s.pad.add_probe(gst::PadProbeType::BUFFER, move |pad, info| {
                    if let (Some(buffer), Some(caps)) = (info.buffer(), pad.current_caps()) { push(&forward, &caps, &buffer.to_owned()); }
                    gst::PadProbeReturn::Ok
                }).unwrap();
                feeds.push((scale, s.pad.clone(), probe));
                let mut publisher = Publisher::new(PublisherSpec { output_id: format!("ind{i}"), kind: Kind::Srt, url: format!("srt://127.0.0.1:{}?mode=listener", 20_200 + (n * 10 + i) as u16),
                    video_channel: video, audio_channel: format!("bench-ind-{n}-{i}-audio"), width: mw, height: mh, fps_n: 25, fps_d: 1,
                    bitrate_kbps: (4000 / 16u32).clamp(180, 450), interlaced: false, top_field_first: true, prefer_software: true, role: "pvw".into(), on_demand: true, opus: true, monitor: None });
                publisher.set_wanted(true);
                publishers.push(publisher);
            }
            let receivers: Vec<Receiver> = (0..n).map(|i| receiver(20_200 + (n * 10 + i) as u16, false)).collect();
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(3) { for p in &mut publishers { p.service(); } std::thread::sleep(Duration::from_millis(40)); }
            let individual = cpu(8.0, &mut || { for p in &mut publishers { p.service(); } });
            drop(receivers);
            let mut rx = receiver(20_200 + (n * 10) as u16, true);
            let individual_latency = flip(&source0, &mut rx, 0.5, 0.5, &mut || { for p in &mut publishers { p.service(); } });
            drop(rx);
            for p in &mut publishers { p.shutdown(); }
            for (pipeline, pad, probe) in feeds { pad.remove_probe(probe); let _ = pipeline.set_state(gst::State::Null); }
            eprintln!("[medida] N={n}: fontes sozinhas {baseline:.0}% de um núcleo; composto {:.0}% (+{:.0}); individual {:.0}% (+{:.0}); latência fonte→decodificado: composto {:?}, individual {:?}; mosaico {}x{}@{}/{}",
                composite, composite - baseline, individual, individual - baseline, composite_latency, individual_latency, profile.width, profile.height, profile.fps_n, profile.fps_d);
        }
    }

    /// Prova pedida: multiview lento ou travado nunca atrasa o programa. O
    /// teste usa o canal de verdade (tee do PGM) e um multiview 12x mais lento
    /// que a cadência, depois trava a sonda por 1 s.
    #[test]
    fn slow_or_stuck_multiview_never_delays_the_program() {
        gst::init().unwrap();
        if gst::ElementFactory::find("rplayoutlimiter").is_none() { crate::limiter_element::register().unwrap(); }
        struct Running(Channel);
        impl Drop for Running { fn drop(&mut self) { self.0.shutdown(); } }
        let mut channel = Running(Channel::new(Config { channel_id: "mv-isolamento".into(), width: 1280, height: 720, fps_n: 25, fps_d: 1, bitrate_kbps: 450,
            ceiling_dbtp: -1.0, audio_channels: 2, scan: Scan::Progressive, top_field_first: true, outputs: vec![Output::Null], preview: None }).unwrap());
        channel.0.start().unwrap();
        let tee = channel.0.pipeline.by_name("tee-video").unwrap().static_pad("sink").unwrap();
        let (frames, gap) = cadence_meter(&tee);
        let measure = |channel: &mut Running, seconds: f64| -> (f64, Duration) {
            *gap.lock().unwrap() = (None, Duration::ZERO);
            let before = frames.load(Ordering::Relaxed);
            let started = Instant::now();
            while started.elapsed().as_secs_f64() < seconds { channel.0.service_outputs(); std::thread::sleep(Duration::from_millis(40)); }
            let rate = (frames.load(Ordering::Relaxed) - before) as f64 / started.elapsed().as_secs_f64();
            (rate, gap.lock().unwrap().1)
        };
        std::thread::sleep(Duration::from_millis(500));
        let (baseline, baseline_gap) = measure(&mut channel, 2.0);

        let multiview = channel.0.attach_multiview_for_test();
        multiview.set_hooks(Hooks { slow_per_frame: Some(Duration::from_millis(500)), ..Hooks::default() });
        multiview.configure(Composition { layout: Layout::Grid2x2, cells: vec![CellSource::Pgm; 4], quality: Quality::Padrao }).unwrap();
        assert!(channel.0.set_monitor(BUS, true), "monitor mv deveria existir");
        let (slow, slow_gap) = measure(&mut channel, 3.0);
        let state = channel.0.multiview_state().unwrap();
        assert!(state.running && state.cells.iter().all(|cell| cell.bus == Some("pgm")), "{state:?}");
        let composed = state.frames;

        // Thread do multiview "travada" segurando a sonda: o PGM não espera.
        let tap = channel.0.multiview.as_ref().unwrap().cell_tap(0);
        let skipped_before = tap.skipped();
        let stuck = { let tap = Arc::clone(&tap); std::thread::spawn(move || { let _guard = tap.frame.lock().unwrap(); std::thread::sleep(Duration::from_millis(1000)); }) };
        let (stuck_rate, stuck_gap) = measure(&mut channel, 1.5);
        stuck.join().unwrap();
        let skipped = tap.skipped() - skipped_before;
        eprintln!("[teste] PGM sem multiview {baseline:.1} q/s (maior intervalo {baseline_gap:?}); com multiview lento {slow:.1} q/s ({slow_gap:?}), multiview compôs {composed} quadros em 3 s; sonda travada {stuck_rate:.1} q/s ({stuck_gap:?}), {skipped} quadros não guardados");
        for (label, rate, worst) in [("lento", slow, slow_gap), ("travado", stuck_rate, stuck_gap)] {
            assert!(rate >= 23.5, "multiview {label} reduziu a cadência do PGM: {rate:.1} q/s");
            assert!(worst < Duration::from_millis(120), "multiview {label} atrasou um quadro do PGM: {worst:?}");
        }
        assert!(composed < 3 * 25 / 2, "o multiview lento deveria descartar os próprios quadros: compôs {composed}");
        assert!(skipped >= 20, "a sonda deveria seguir sem esperar a trava: {skipped} quadros não guardados");
        assert!(channel.0.set_monitor(BUS, false));
        channel.0.service_outputs();
        assert!(!channel.0.multiview_state().unwrap().running);
    }
}
