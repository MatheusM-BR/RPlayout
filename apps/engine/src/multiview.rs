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

/// Níveis de qualidade do multiview, os mesmos nomes dos monitores
/// (REFERÊNCIA/PADRÃO/LEVE). Ficam aqui parametrizados para ligar ao seletor de
/// nível de output.rs quando os branches forem integrados.
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
    pub fn profile(self, fps_n: i32, fps_d: i32) -> Profile {
        let fps = fps_n as f64 / fps_d.max(1) as f64;
        // Multiview é conferência: acima de 30 q/s a metade da cadência basta
        // e custa metade da escala e da codificação.
        let (half_n, half_d) = if fps > 30.0 { (fps_n, fps_d * 2) } else { (fps_n, fps_d) };
        match self {
            Quality::Referencia => Profile { width: 1920, height: 1080, fps_n, fps_d, bitrate_kbps: 8000 },
            Quality::Padrao => Profile { width: 1280, height: 720, fps_n: half_n, fps_d: half_d, bitrate_kbps: 3000 },
            Quality::Leve => Profile { width: 960, height: 540, fps_n: 15, fps_d: 1, bitrate_kbps: 1200 },
        }
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
    /// Entrada ao vivo cadastrada, onde quer que o engine a tenha aberta.
    Source { id: String },
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
            if let CellSource::Source { id } = cell {
                if id.is_empty() || id.len() > 256 { return Err(anyhow!("identificador de fonte inválido no multiview")); }
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
struct Frame {
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
    frame: Mutex<Frame>,
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
            CellSource::Source { id } => self.sources.iter().find(|(key, _)| key == id).map(|(_, point)| point.clone()),
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
}

struct Runner {
    pipeline: gst::Pipeline,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    signals: Arc<Mutex<Vec<(CellSignal, Option<u64>, f64)>>>,
    frames: Arc<AtomicU64>,
}

impl Drop for Runner {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() { let _ = thread.join(); }
        let _ = self.pipeline.set_state(gst::State::Null);
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
        compositor.set_property("latency", period);
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
            src.set_property("max-buffers", 1u64);
            src.set_property_from_str("leaky-type", "downstream");
            src.set_property("min-latency", 0i64);
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
            std::thread::Builder::new().name("multiview".into()).spawn(move || cadence(sources, taps, stop, signals, period))?
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
    wanted: bool,
    hooks: Hooks,
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
                // Monitor não gasta sessão de placa.
                prefer_software: true,
                role: BUS.into(), on_demand: true,
                // Ninguém escreve áudio no canal do multiview: sai silêncio, e
                // em Opus para o WHEP aceitar a trilha.
                opus: kind == Kind::Srt,
            }
        });
        let mut multiview = Multiview {
            video_channel, audio_channel, fps: (fps_n, fps_d), composition: composition.clone(), cells: Vec::new(),
            runner: None, publisher: publisher_spec.clone().map(Publisher::new), publisher_spec, wanted: false, hooks: Hooks::default(),
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
            if let Some(spec) = self.publisher_spec.as_mut() {
                let profile = self.composition.quality.profile(self.fps.0, self.fps.1);
                spec.width = profile.width; spec.height = profile.height; spec.fps_n = profile.fps_n; spec.fps_d = profile.fps_d; spec.bitrate_kbps = profile.bitrate_kbps;
                if let Some(mut old) = self.publisher.take() { old.shutdown(); }
                let mut publisher = Publisher::new(spec.clone());
                if self.wanted { publisher.set_wanted(true); }
                self.publisher = Some(publisher);
            }
        }
        if self.runner.is_some() { self.runner = None; self.start()?; }
        Ok(())
    }

    pub fn set_wanted(&mut self, on: bool) {
        self.wanted = on;
        if let Some(publisher) = self.publisher.as_mut() { publisher.set_wanted(on); }
    }

    fn start(&mut self) -> Result<()> {
        let profile = self.composition.quality.profile(self.fps.0, self.fps.1);
        let taps = self.cells.iter().map(|cell| (cell.source != CellSource::Empty).then(|| Arc::clone(&cell.tap))).collect();
        self.runner = Some(Runner::start(&self.video_channel, self.composition.layout, profile, taps, &self.hooks)?);
        Ok(())
    }

    fn stop(&mut self) {
        self.runner = None;
        for cell in &mut self.cells {
            if let Some(installed) = cell.installed.take() { installed.remove(); }
            cell.tap.clear();
        }
    }

    /// Uma volta do laço principal: liga/desliga conforme alguém olha e
    /// reaponta cada sonda para onde a fonte está agora.
    pub fn service(&mut self, points: &TapPoints) -> Option<Report> {
        let report = self.publisher.as_mut().and_then(Publisher::service);
        if !self.wanted {
            if self.runner.is_some() { self.stop(); }
            return report;
        }
        for cell in &mut self.cells {
            let wanted = points.find(&cell.source);
            let same = match (&cell.installed, &wanted) {
                (Some(installed), Some(point)) => installed.identity == point.identity && installed.bus == point.bus
                    && installed.pad.upgrade().is_some_and(|pad| pad == point.pad),
                (None, None) => true,
                _ => false,
            };
            if same { continue; }
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

    pub fn state(&self) -> MultiviewState {
        let profile = self.composition.quality.profile(self.fps.0, self.fps.1);
        let signals = self.runner.as_ref().and_then(|runner| runner.signals.lock().ok().map(|signals| signals.clone())).unwrap_or_default();
        let cells = self.cells.iter().enumerate().map(|(index, cell)| {
            let (caps, _, _, _) = cell.tap.snapshot();
            let structure = caps.as_ref().and_then(|caps| caps.structure(0).map(|s| (s.get::<i32>("width").ok(), s.get::<i32>("height").ok())));
            let (signal, age_ms, fps) = signals.get(index).copied().unwrap_or((
                if cell.source == CellSource::Empty { CellSignal::Empty } else if cell.installed.is_some() { CellSignal::NoSignal } else { CellSignal::Unavailable }, None, 0.0));
            let signal = if cell.installed.is_none() && cell.source != CellSource::Empty { CellSignal::Unavailable } else { signal };
            CellState {
                source: cell.source.clone(), signal, age_ms, fps: (fps * 10.0).round() / 10.0,
                width: structure.and_then(|s| s.0), height: structure.and_then(|s| s.1),
                bus: cell.installed.as_ref().map(|installed| installed.bus),
            }
        }).collect();
        MultiviewState {
            running: self.runner.is_some(), layout: self.composition.layout, quality: self.composition.quality, profile, cells,
            frames: self.runner.as_ref().map(|runner| runner.frames.load(Ordering::Relaxed)).unwrap_or(0),
        }
    }

    pub fn shutdown(&mut self) {
        self.wanted = false;
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
        if self.multiview.is_some() { return Err(anyhow!("multiview já ligado")); }
        self.multiview = Some(Multiview::new(&self.config.channel_id, self.config.fps_n, self.config.fps_d, Some((spec.kind, spec.target.clone()))));
        Ok(())
    }

    #[cfg(test)]
    pub fn attach_multiview_for_test(&mut self) -> &mut Multiview {
        self.multiview.get_or_insert_with(|| Multiview::new(&self.config.channel_id, self.config.fps_n, self.config.fps_d, None))
    }

    pub fn configure_multiview(&mut self, composition: Composition) -> Result<()> {
        self.multiview.as_mut().ok_or_else(|| anyhow!("este canal não tem multiview composto"))?.configure(composition)
    }

    pub fn multiview_state(&self) -> Option<MultiviewState> {
        self.multiview.as_ref().map(Multiview::state)
    }

    pub(crate) fn set_multiview_wanted(&mut self, on: bool) -> bool {
        match self.multiview.as_mut() { Some(multiview) => { multiview.set_wanted(on); true } None => false }
    }

    pub fn multiview_tap_points(&self) -> TapPoints {
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
        for (item, bus) in [(self.on_air.as_ref(), "pgm"), (self.previewing.as_ref(), "pvw"), (self.armed.as_ref(), "next"),
                            (self.qc_item.as_ref(), "qc"), (self.live_replacement.as_ref(), "contingency")] {
            let Some(item) = item.filter(|item| item.spec.is_live()) else { continue };
            let Some(id) = item.spec.configured_source_id.clone() else { continue };
            if points.sources.iter().any(|(known, _)| *known == id) { continue; }
            if let Some(point) = item_point(Some(item), bus, qc) { points.sources.push((id, point)); }
        }
        points
    }

    pub(crate) fn service_multiview(&mut self) -> Option<Report> {
        if self.multiview.is_none() { return None; }
        let points = self.multiview_tap_points();
        self.multiview.as_mut().and_then(|multiview| multiview.service(&points))
    }

    pub(crate) fn multiview_report(&self) -> Option<Report> {
        self.multiview.as_ref().and_then(Multiview::report)
    }
}


#[cfg(test)]
impl Multiview {
    fn cell_tap(&self, index: usize) -> Arc<Tap> { Arc::clone(&self.cells[index].tap) }
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
        assert_eq!(composition.cells[2], CellSource::Source { id: "cam-1".into() });
        composition.validate().unwrap();
        let too_many = Composition { layout: Layout::Grid2x2, cells: vec![CellSource::Pgm; 5], quality: Quality::Padrao };
        assert!(too_many.validate().is_err());
        assert!(serde_json::from_value::<Composition>(serde_json::json!({"layout":"MV_2X2","cells":[{"kind":"file","path":"/etc/passwd"}]})).is_err());
        let profile = Quality::Padrao.profile(50, 1);
        assert_eq!((profile.width, profile.height, profile.fps_n, profile.fps_d), (1280, 720, 50, 2));
        assert_eq!(Quality::Referencia.profile(30000, 1001).fps_n, 30000);
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
        multiview.set_hooks(Hooks { slow_per_frame: Some(Duration::from_millis(500)) });
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
