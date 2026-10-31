//! Overlays 1–8, como no vMix: cada slot tem um título (SVG já preenchido pelo
//! servidor) e a animação de entrada/saída do título GT. O engine não conhece
//! template; ele só anda o relógio de cada slot e monta o SVG do quadro.
//!
//! O título importado marca cada objeto animável com `data-a="N" transform="`.
//! A animação entra prefixando esse `transform` (espaço do pai) e acrescentando
//! opacidade/recorte no mesmo elemento. Sem animação, o SVG é desenhado como veio.

use serde::Deserialize;
use std::fmt::Write as _;

pub const SLOTS: usize = 8;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ObjectBox {
    pub n: u32,
    /// Caixa no espaço do pai (Location/Dimensions do vMix).
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Origem absoluta na composição, para saber a distância até a borda.
    pub ax: f64,
    pub ay: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub n: u32,
    pub kind: String,
    #[serde(default)]
    pub delay_ms: f64,
    #[serde(default = "default_duration")]
    pub duration_ms: f64,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub easing: String,
}
fn default_duration() -> f64 { 500.0 }

/// Rolagem contínua (Ticker): anda enquanto o overlay está no ar.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Continuous {
    pub n: u32,
    #[serde(default = "default_speed")]
    pub px_per_sec: f64,
    pub width: f64,
    #[serde(default)]
    pub content_width: f64,
}
fn default_speed() -> f64 { 240.0 }

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Animation {
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub objects: Vec<ObjectBox>,
    #[serde(default)]
    pub enter: Vec<Step>,
    #[serde(default)]
    pub exit: Vec<Step>,
    #[serde(default)]
    pub continuous: Vec<Continuous>,
}

impl Animation {
    fn length(steps: &[Step]) -> f64 {
        steps.iter().map(|s| s.delay_ms.max(0.0) + s.duration_ms.max(0.0)).fold(0.0, f64::max)
    }
    pub fn enter_ms(&self) -> f64 { Self::length(&self.enter) }
    /// Sem storyboard de saída, o vMix volta a entrada ao contrário.
    pub fn exit_ms(&self) -> f64 {
        if self.exit.is_empty() { self.enter_ms() } else { Self::length(&self.exit) }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Phase {
    Enter(f64),
    Shown,
    Exit(f64),
}

#[derive(Debug, Clone)]
pub struct Slot {
    pub svg: String,
    pub anim: Option<Animation>,
    pub phase: Phase,
    /// Último estado desenhado; evita re-render quando nada anda.
    pub settled: bool,
    /// Tempo desde a entrada, para rolagens contínuas.
    pub clock_ms: f64,
}

/// Fade simples para título sem animação (arte SVG comum).
const PLAIN_FADE_MS: f64 = 300.0;

#[derive(Debug, Default)]
pub struct Overlays {
    pub slots: [Option<Slot>; SLOTS],
    dirty: bool,
}

pub enum Action { In, Out, Cut, Off }

impl Overlays {
    pub fn command(&mut self, slot: usize, action: Action, svg: Option<String>, anim: Option<Animation>) -> anyhow::Result<()> {
        if slot == 0 || slot > SLOTS { anyhow::bail!("Overlay {slot} não existe (1 a {SLOTS})."); }
        let entry = &mut self.slots[slot - 1];
        match action {
            Action::In | Action::Cut => {
                let svg = svg.ok_or_else(|| anyhow::anyhow!("Overlay {slot}: título vazio."))?;
                let phase = if matches!(action, Action::Cut) { Phase::Shown } else { Phase::Enter(0.0) };
                *entry = Some(Slot { svg, anim, phase, settled: false, clock_ms: 0.0 });
            }
            Action::Out => match entry {
                Some(current) => {
                    // Saída no meio da entrada parte do ponto em que está.
                    let start = match current.phase {
                        Phase::Enter(t) => {
                            let total = current.anim.as_ref().map_or(PLAIN_FADE_MS, |a| a.enter_ms()).max(1.0);
                            let back = current.anim.as_ref().map_or(PLAIN_FADE_MS, |a| a.exit_ms()).max(1.0);
                            back * (1.0 - (t / total).clamp(0.0, 1.0))
                        }
                        Phase::Exit(t) => t,
                        Phase::Shown => 0.0,
                    };
                    current.phase = Phase::Exit(start);
                    current.settled = false;
                }
                None => {}
            },
            Action::Off => *entry = None,
        }
        self.dirty = true;
        Ok(())
    }

    pub fn active(&self) -> Vec<u8> {
        self.slots.iter().enumerate().filter_map(|(i, s)| s.as_ref().map(|_| (i + 1) as u8)).collect()
    }

    pub fn animating(&self) -> bool {
        self.slots.iter().flatten().any(|s| !matches!(s.phase, Phase::Shown) || s.continuous()) || self.dirty
    }

    /// Anda o relógio. Devolve se é preciso redesenhar.
    pub fn advance(&mut self, elapsed_ms: f64) -> bool {
        let mut changed = std::mem::take(&mut self.dirty);
        for entry in self.slots.iter_mut() {
            let Some(slot) = entry else { continue };
            slot.clock_ms += elapsed_ms;
            if slot.continuous() { changed = true; }
            match slot.phase {
                Phase::Enter(t) => {
                    let total = slot.anim.as_ref().map_or(PLAIN_FADE_MS, |a| a.enter_ms());
                    let next = t + elapsed_ms;
                    slot.phase = if next >= total { Phase::Shown } else { Phase::Enter(next) };
                    changed = true;
                }
                Phase::Exit(t) => {
                    let total = slot.anim.as_ref().map_or(PLAIN_FADE_MS, |a| a.exit_ms());
                    let next = t + elapsed_ms;
                    if next >= total { *entry = None } else { slot.phase = Phase::Exit(next) }
                    changed = true;
                }
                Phase::Shown => {
                    if !slot.settled { slot.settled = true; changed = true }
                }
            }
        }
        changed
    }

    /// Monta os slots, do 1 (atrás) ao 8 (na frente), como grupos a serem
    /// colocados dentro do SVG do quadro.
    pub fn render(&self) -> String {
        let mut out = String::new();
        for (index, entry) in self.slots.iter().enumerate() {
            if let Some(slot) = entry { out.push_str(&render_slot(index + 1, slot)); }
        }
        out
    }
}

impl Slot {
    fn continuous(&self) -> bool { self.anim.as_ref().is_some_and(|a| !a.continuous.is_empty()) }
}

/// Deslocamento da rolagem: entra pela direita da faixa e sai pela esquerda,
/// recomeçando quando o texto inteiro passou.
pub fn scroll_offset(c: &Continuous, clock_ms: f64) -> f64 {
    let travel = c.width + c.content_width.max(1.0);
    let moved = (clock_ms / 1000.0 * c.px_per_sec.max(1.0)) % travel;
    c.width - moved
}

fn ease(kind: &str, p: f64) -> f64 {
    let p = p.clamp(0.0, 1.0);
    match kind {
        "CubicEasingIn" => p * p * p,
        "CubicEasingOut" => 1.0 - (1.0 - p).powi(3),
        "CubicEasingInOut" => if p < 0.5 { 4.0 * p * p * p } else { 1.0 - (-2.0 * p + 2.0).powi(3) / 2.0 },
        "Back" => { let c1 = 1.70158; let c3 = c1 + 1.0; 1.0 + c3 * (p - 1.0).powi(3) + c1 * (p - 1.0).powi(2) }
        _ => p,
    }
}

/// Estado visual de um objeto num instante.
#[derive(Debug, Clone, PartialEq)]
pub struct Look {
    pub opacity: f64,
    pub dx: f64,
    pub dy: f64,
    pub sx: f64,
    pub sy: f64,
    /// Âncora da escala/rotação, no espaço do pai.
    pub ox: f64,
    pub oy: f64,
    pub rotate: f64,
    /// Recorte (Reveal) em coordenadas locais do objeto: x, y, w, h.
    pub clip: Option<(f64, f64, f64, f64)>,
}
impl Look {
    fn identity(b: &ObjectBox) -> Self {
        Look { opacity: 1.0, dx: 0.0, dy: 0.0, sx: 1.0, sy: 1.0, ox: b.x + b.w / 2.0, oy: b.y + b.h / 2.0, rotate: 0.0, clip: None }
    }
    pub fn is_identity(&self) -> bool {
        self.opacity >= 1.0 && self.dx == 0.0 && self.dy == 0.0 && self.sx == 1.0 && self.sy == 1.0 && self.rotate == 0.0 && self.clip.is_none()
    }
}

fn anchor(b: &ObjectBox, direction: &str) -> (f64, f64, bool, bool) {
    // (âncora x, âncora y, escala em x, escala em y)
    let (l, r, t, bo) = (b.x, b.x + b.w, b.y, b.y + b.h);
    let (cx, cy) = (b.x + b.w / 2.0, b.y + b.h / 2.0);
    match direction {
        "Left" => (l, cy, true, false),
        "Right" => (r, cy, true, false),
        "Top" => (cx, t, false, true),
        "Bottom" => (cx, bo, false, true),
        "TopLeft" => (l, t, true, true),
        "TopRight" => (r, t, true, true),
        "BottomLeft" => (l, bo, true, true),
        "BottomRight" => (r, bo, true, true),
        _ => (cx, cy, true, true),
    }
}

/// Aplica um passo com progresso `p` (0 = escondido, 1 = no lugar).
fn apply(look: &mut Look, step: &Step, b: &ObjectBox, p: f64, canvas: (f64, f64)) {
    let kind = step.kind.as_str();
    let e = ease(if kind == "Bounce" { "Back" } else { step.easing.as_str() }, p);
    let dir = step.direction.as_str();
    match kind {
        "Fade" => look.opacity *= e,
        "Fly" | "Bounce" => {
            let gap = 20.0;
            let left = -(b.ax + b.w + gap);
            let right = canvas.0 - b.ax + gap;
            let up = -(b.ay + b.h + gap);
            let down = canvas.1 - b.ay + gap;
            let (fx, fy) = match dir {
                "Right" => (right, 0.0),
                "Top" => (0.0, up),
                "Bottom" => (0.0, down),
                "TopLeft" => (left, up),
                "TopRight" => (right, up),
                "BottomLeft" => (left, down),
                "BottomRight" => (right, down),
                _ => (left, 0.0),
            };
            look.dx += fx * (1.0 - e);
            look.dy += fy * (1.0 - e);
        }
        "Expand" => {
            let (ax, ay, scale_x, scale_y) = anchor(b, dir);
            look.ox = ax; look.oy = ay;
            if scale_x { look.sx *= e }
            if scale_y { look.sy *= e }
        }
        "Zoom" | "ZoomFade" => {
            look.ox = b.x + b.w / 2.0; look.oy = b.y + b.h / 2.0;
            let s = if kind == "ZoomFade" { 0.6 + 0.4 * e } else { e };
            look.sx *= s; look.sy *= s;
            if kind == "ZoomFade" { look.opacity *= e }
        }
        "Rotate" => {
            look.ox = b.x + b.w / 2.0; look.oy = b.y + b.h / 2.0;
            look.rotate += -90.0 * (1.0 - e);
            look.opacity *= e.min(1.0);
        }
        "Reveal" => {
            let (w, h) = (b.w, b.h);
            look.clip = Some(match dir {
                "Right" => (w * (1.0 - e), 0.0, w * e, h),
                "Top" => (0.0, 0.0, w, h * e),
                "Bottom" => (0.0, h * (1.0 - e), w, h * e),
                "Center" => (w * (1.0 - e) / 2.0, h * (1.0 - e) / 2.0, w * e, h * e),
                _ => (0.0, 0.0, w * e, h),
            });
        }
        "None" => { if p <= 0.0 { look.opacity = 0.0 } }
        "Hidden" => {}
        // Contínuas (FillOffset, Scroll, RotateContinuous...) ficam paradas.
        _ => {}
    }
}

fn progress(step: &Step, t: f64) -> f64 {
    if t < step.delay_ms { return 0.0 }
    if step.duration_ms <= 0.0 { return 1.0 }
    ((t - step.delay_ms) / step.duration_ms).clamp(0.0, 1.0)
}

/// Visual de cada objeto animado no instante da fase.
pub fn looks(anim: &Animation, phase: Phase) -> Vec<(u32, Look)> {
    let canvas = (anim.width.max(1.0), anim.height.max(1.0));
    let mut result = Vec::new();
    for b in &anim.objects {
        let mut look = Look::identity(b);
        match phase {
            Phase::Shown => {}
            Phase::Enter(t) => {
                for step in anim.enter.iter().filter(|s| s.n == b.n) { apply(&mut look, step, b, progress(step, t), canvas) }
            }
            Phase::Exit(t) => {
                if anim.exit.is_empty() {
                    // Entrada ao contrário.
                    let total = anim.enter_ms();
                    for step in anim.enter.iter().filter(|s| s.n == b.n) { apply(&mut look, step, b, progress(step, total - t), canvas) }
                } else {
                    for step in anim.exit.iter().filter(|s| s.n == b.n) { apply(&mut look, step, b, 1.0 - progress(step, t), canvas) }
                }
            }
        }
        if !look.is_identity() { result.push((b.n, look)) }
    }
    result
}

fn slot_opacity(slot: &Slot) -> f64 {
    if slot.anim.is_some() { return 1.0 }
    match slot.phase {
        Phase::Enter(t) => (t / PLAIN_FADE_MS).clamp(0.0, 1.0),
        Phase::Exit(t) => 1.0 - (t / PLAIN_FADE_MS).clamp(0.0, 1.0),
        Phase::Shown => 1.0,
    }
}

fn render_slot(number: usize, slot: &Slot) -> String {
    let mut svg = slot.svg.clone();
    let mut defs = String::new();
    if let Some(anim) = &slot.anim {
        let mut all = looks(anim, slot.phase);
        for c in &anim.continuous {
            let dx = scroll_offset(c, slot.clock_ms);
            match all.iter_mut().find(|(n, _)| *n == c.n) {
                Some((_, look)) => look.dx += dx,
                None => {
                    let b = anim.objects.iter().find(|o| o.n == c.n).cloned().unwrap_or_default();
                    let mut look = Look::identity(&b);
                    look.dx = dx;
                    all.push((c.n, look));
                }
            }
        }
        for (n, look) in all {
            let marker = format!("data-a=\"{n}\" transform=\"");
            let Some(at) = svg.find(&marker) else { continue };
            let mut extra = String::new();
            let _ = write!(extra, "data-a=\"{n}\" opacity=\"{:.3}\"", look.opacity.clamp(0.0, 1.0));
            if let Some((x, y, w, h)) = look.clip {
                let id = format!("ov{number}r{n}");
                let _ = write!(defs, "<clipPath id=\"{id}\"><rect x=\"{x:.2}\" y=\"{y:.2}\" width=\"{:.2}\" height=\"{:.2}\"/></clipPath>", w.max(0.0), h.max(0.0));
                let _ = write!(extra, " clip-path=\"url(#{id})\"");
            }
            let _ = write!(extra, " transform=\"");
            if look.dx != 0.0 || look.dy != 0.0 { let _ = write!(extra, "translate({:.2} {:.2}) ", look.dx, look.dy); }
            if look.sx != 1.0 || look.sy != 1.0 || look.rotate != 0.0 {
                let _ = write!(extra, "translate({:.2} {:.2}) ", look.ox, look.oy);
                if look.rotate != 0.0 { let _ = write!(extra, "rotate({:.2}) ", look.rotate); }
                if look.sx != 1.0 || look.sy != 1.0 { let _ = write!(extra, "scale({:.4} {:.4}) ", look.sx.max(0.0001), look.sy.max(0.0001)); }
                let _ = write!(extra, "translate({:.2} {:.2}) ", -look.ox, -look.oy);
            }
            svg.replace_range(at..at + marker.len(), &extra);
        }
    }
    format!("<g data-overlay=\"{number}\" opacity=\"{:.3}\">{}{svg}</g>", slot_opacity(slot), if defs.is_empty() { String::new() } else { format!("<defs>{defs}</defs>") })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anim() -> Animation {
        Animation {
            width: 1920.0, height: 1080.0,
            objects: vec![ObjectBox { n: 1, x: 100.0, y: 800.0, w: 400.0, h: 100.0, ax: 100.0, ay: 800.0 }],
            enter: vec![Step { n: 1, kind: "Fly".into(), delay_ms: 0.0, duration_ms: 1000.0, direction: "Left".into(), easing: String::new() }],
            exit: vec![Step { n: 1, kind: "Fade".into(), delay_ms: 0.0, duration_ms: 500.0, direction: String::new(), easing: String::new() }],
            continuous: vec![],
        }
    }
    const SVG: &str = "<svg viewBox=\"0 0 1920 1080\"><g data-a=\"1\" transform=\"translate(100 800)\"><rect/></g></svg>";

    #[test]
    fn fly_starts_offscreen_and_lands() {
        let a = anim();
        let start = looks(&a, Phase::Enter(0.0));
        assert_eq!(start[0].1.dx, -520.0);
        let half = looks(&a, Phase::Enter(500.0));
        assert_eq!(half[0].1.dx, -260.0);
        assert!(looks(&a, Phase::Enter(1000.0)).is_empty());
        assert!(looks(&a, Phase::Shown).is_empty());
    }

    #[test]
    fn exit_uses_its_own_storyboard_and_reverse_when_missing() {
        let a = anim();
        let out = looks(&a, Phase::Exit(250.0));
        assert!((out[0].1.opacity - 0.5).abs() < 1e-9);
        let mut b = anim(); b.exit.clear();
        assert_eq!(b.exit_ms(), 1000.0);
        let back = looks(&b, Phase::Exit(1000.0));
        assert_eq!(back[0].1.dx, -520.0);
    }

    #[test]
    fn render_prefixes_transform_in_parent_space() {
        let mut o = Overlays::default();
        o.command(3, Action::In, Some(SVG.into()), Some(anim())).unwrap();
        assert!(o.advance(500.0));
        let frame = o.render();
        assert!(frame.contains("data-overlay=\"3\""), "{frame}");
        assert!(frame.contains("data-a=\"1\" opacity=\"1.000\" transform=\"translate(-260.00 0.00) translate(100 800)\""), "{frame}");
        assert!(o.advance(600.0));
        assert!(matches!(o.slots[2].as_ref().unwrap().phase, Phase::Shown));
        assert!(o.render().contains("data-a=\"1\" transform=\"translate(100 800)\""));
        assert!(o.advance(10.0));
        assert!(!o.advance(10.0), "parado não redesenha");
    }

    #[test]
    fn out_during_enter_continues_from_current_point_and_clears() {
        let mut o = Overlays::default();
        o.command(1, Action::In, Some(SVG.into()), Some(anim())).unwrap();
        o.advance(800.0);
        o.command(1, Action::Out, None, None).unwrap();
        assert!(matches!(o.slots[0].as_ref().unwrap().phase, Phase::Exit(t) if (t - 100.0).abs() < 1e-9));
        o.advance(1000.0);
        assert!(o.slots[0].is_none());
        assert!(o.active().is_empty());
    }

    #[test]
    fn plain_svg_fades_and_slots_stack_in_order() {
        let mut o = Overlays::default();
        o.command(8, Action::In, Some("<svg/>".into()), None).unwrap();
        o.command(2, Action::Cut, Some("<svg id=\"b\"/>".into()), None).unwrap();
        o.advance(150.0);
        let frame = o.render();
        assert!(frame.find("data-overlay=\"2\"").unwrap() < frame.find("data-overlay=\"8\"").unwrap());
        assert!(frame.contains("data-overlay=\"8\" opacity=\"0.500\""));
        assert_eq!(o.active(), vec![2, 8]);
        assert!(o.command(9, Action::Off, None, None).is_err());
    }

    #[test]
    fn ticker_scrolls_continuously_and_keeps_redrawing() {
        let mut a = anim();
        a.enter.clear(); a.exit.clear();
        a.continuous = vec![Continuous { n: 1, px_per_sec: 100.0, width: 400.0, content_width: 600.0 }];
        assert_eq!(scroll_offset(&a.continuous[0], 0.0), 400.0);
        assert_eq!(scroll_offset(&a.continuous[0], 3000.0), 100.0);
        assert_eq!(scroll_offset(&a.continuous[0], 10_000.0), 400.0);
        let mut o = Overlays::default();
        o.command(1, Action::Cut, Some(SVG.into()), Some(a)).unwrap();
        o.advance(0.0);
        assert!(o.advance(2000.0), "rolagem continua redesenhando");
        assert!(o.animating());
        assert!(o.render().contains("transform=\"translate(200.00 0.00) translate(100 800)\""), "{}", o.render());
    }

    #[test]
    fn reveal_and_expand_shapes() {
        let mut a = anim();
        a.enter = vec![
            Step { n: 1, kind: "Reveal".into(), delay_ms: 0.0, duration_ms: 1000.0, direction: "Left".into(), easing: String::new() },
            Step { n: 1, kind: "Expand".into(), delay_ms: 0.0, duration_ms: 1000.0, direction: "BottomLeft".into(), easing: String::new() },
        ];
        let l = &looks(&a, Phase::Enter(250.0))[0].1;
        assert_eq!(l.clip, Some((0.0, 0.0, 100.0, 100.0)));
        assert_eq!((l.sx, l.sy, l.ox, l.oy), (0.25, 0.25, 100.0, 900.0));
    }
}

#[cfg(test)]
mod frames {
    /// Ferramenta de conferência: `GT_SVG=… GT_ANIM=… GT_OUT=dir cargo test dump_frames -- --ignored`.
    #[test]
    #[ignore]
    fn dump_frames() {
        let svg = std::fs::read_to_string(std::env::var("GT_SVG").unwrap()).unwrap();
        let anim: super::Animation = serde_json::from_str(&std::fs::read_to_string(std::env::var("GT_ANIM").unwrap()).unwrap()).unwrap();
        let out = std::env::var("GT_OUT").unwrap();
        let mut o = super::Overlays::default();
        o.command(1, super::Action::In, Some(svg), Some(anim)).unwrap();
        for i in 0..40 {
            o.advance(if i == 0 { 0.0 } else { 100.0 });
            if i == 30 { o.command(1, super::Action::Out, None, None).unwrap(); }
            let frame = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1920\" height=\"1080\" viewBox=\"0 0 1920 1080\">{}</svg>", o.render());
            std::fs::write(format!("{out}/f{i:02}.svg"), frame).unwrap();
        }
    }
}
