//! O limiter como elemento de GStreamer.
//!
//! Podia ter sido um `appsink` alimentando um `appsrc`, mas isso põe o áudio do
//! programa dentro do laço principal do processo: uma volta lenta, e o programa
//! fica sem som. Como elemento, o processamento roda na thread de streaming do
//! próprio pipeline, como qualquer outro filtro -- que é onde áudio ao vivo
//! tem que rodar.

use gstreamer as gst;
use gstreamer::glib;
use gstreamer::prelude::*;
use gstreamer::subclass::prelude::*;
use gstreamer_base as gst_base;
use gstreamer_base::subclass::prelude::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use crate::limiter::BusLimiter;

/// Nome com que o elemento é registrado. Prefixo próprio para nunca colidir
/// com nada que a instalação do GStreamer traga.
pub const FACTORY: &str = "rplayoutlimiter";

glib::wrapper! {
    pub struct LimiterElement(ObjectSubclass<imp::LimiterImpl>)
        @extends gst_base::BaseTransform, gst::Element, gst::Object;
}

/// Registra o elemento. Chamado uma vez, na subida do processo.
pub fn register() -> Result<(), glib::BoolError> {
    gst::Element::register(None, FACTORY, gst::Rank::NONE, LimiterElement::static_type())
}

mod imp {
use super::*;

pub(super) const DEFAULT_CEILING: f64 = -1.0;
/// Estado que depende das caps, então só existe depois da negociação.
struct Running {
    bus: BusLimiter,
}

#[derive(Default)]
pub struct LimiterImpl {
    running: Mutex<Option<Running>>,
    ceiling: Mutex<f64>,
    pair_linked: Mutex<bool>,
    /// Maior redução desde a última leitura, em milésimos de dB.
    ///
    /// Atômico porque quem lê é o laço principal e quem escreve é a thread de
    /// streaming: trava aqui seria trava no caminho do áudio ao vivo.
    reduction: AtomicU64,
}

#[glib::object_subclass]
impl ObjectSubclass for LimiterImpl {
    const NAME: &'static str = "RPlayoutLimiter";
    type Type = super::LimiterElement;
    type ParentType = gst_base::BaseTransform;
}

impl ObjectImpl for LimiterImpl {
    fn properties() -> &'static [glib::ParamSpec] {
        static PROPERTIES: LazyLock<Vec<glib::ParamSpec>> = LazyLock::new(|| {
            vec![
                glib::ParamSpecDouble::builder("ceiling-dbtp")
                    .nick("Teto de pico verdadeiro")
                    .blurb("Nada sai acima disto, em dBTP")
                    .minimum(-30.0)
                    .maximum(0.0)
                    .default_value(DEFAULT_CEILING)
                    .build(),
                glib::ParamSpecDouble::builder("gain-reduction-db")
                    .nick("Redução de ganho")
                    .blurb("Maior redução desde a leitura anterior; ler zera")
                    .read_only()
                    .build(),
                glib::ParamSpecBoolean::builder("pair-linked")
                    .nick("Limitação independente por par")
                    .blurb("No barramento multicanal, vincula somente L/R de cada par; configuração antes da negociação")
                    .default_value(false)
                    .build(),
            ]
        });
        PROPERTIES.as_ref()
    }

    fn set_property(&self, _id: usize, value: &glib::Value, spec: &glib::ParamSpec) {
        if spec.name() == "ceiling-dbtp" {
            let ceiling = value.get().unwrap_or(DEFAULT_CEILING);
            *self.ceiling.lock().unwrap() = ceiling;
            if let Some(running) = self.running.lock().unwrap().as_mut() {
                running.bus.set_ceiling(ceiling);
            }
        } else if spec.name() == "pair-linked" {
            *self.pair_linked.lock().unwrap() = value.get().unwrap_or(false);
        }
    }

    fn property(&self, _id: usize, spec: &glib::ParamSpec) -> glib::Value {
        match spec.name() {
            "ceiling-dbtp" => self.ceiling.lock().unwrap().to_value(),
            "pair-linked" => self.pair_linked.lock().unwrap().to_value(),
            "gain-reduction-db" => {
                // Ler zera: a interface quer o pico do intervalo que passou,
                // não o pico de quando o canal subiu.
                let raw = self.reduction.swap(0, Ordering::Relaxed);
                (raw as f64 / 1000.0).to_value()
            }
            _ => 0f64.to_value(),
        }
    }
}

impl GstObjectImpl for LimiterImpl {}

impl ElementImpl for LimiterImpl {
    fn metadata() -> Option<&'static gst::subclass::ElementMetadata> {
        static METADATA: LazyLock<gst::subclass::ElementMetadata> = LazyLock::new(|| {
            gst::subclass::ElementMetadata::new(
                "RPlayout true-peak limiter",
                "Filter/Effect/Audio",
                "Limiter de pico verdadeiro com lookahead, para a saída de programa",
                "RPlayout",
            )
        });
        Some(&*METADATA)
    }

    fn pad_templates() -> &'static [gst::PadTemplate] {
        static TEMPLATES: LazyLock<Vec<gst::PadTemplate>> = LazyLock::new(|| {
            // Só F32 intercalado: é o formato em que o DSP trabalha, e deixar o
            // elemento aceitar mais formatos seria convidar conversão escondida
            // no caminho do programa.
            let caps = gst::Caps::builder("audio/x-raw")
                .field("format", "F32LE")
                .field("layout", "interleaved")
                .field("rate", gst::IntRange::new(1, i32::MAX))
                .field("channels", gst::IntRange::new(1, 16))
                .build();

            vec![
                gst::PadTemplate::new(
                    "src",
                    gst::PadDirection::Src,
                    gst::PadPresence::Always,
                    &caps,
                )
                .unwrap(),
                gst::PadTemplate::new(
                    "sink",
                    gst::PadDirection::Sink,
                    gst::PadPresence::Always,
                    &caps,
                )
                .unwrap(),
            ]
        });
        TEMPLATES.as_ref()
    }
}

impl BaseTransformImpl for LimiterImpl {
    const MODE: gst_base::subclass::BaseTransformMode =
        gst_base::subclass::BaseTransformMode::AlwaysInPlace;
    const PASSTHROUGH_ON_SAME_CAPS: bool = false;
    const TRANSFORM_IP_ON_PASSTHROUGH: bool = false;

    fn set_caps(&self, incaps: &gst::Caps, _outcaps: &gst::Caps) -> Result<(), gst::LoggableError> {
        let structure = incaps
            .structure(0)
            .ok_or_else(|| gst::loggable_error!(gst::CAT_DEFAULT, "caps sem estrutura"))?;
        let rate: i32 = structure
            .get("rate")
            .map_err(|_| gst::loggable_error!(gst::CAT_DEFAULT, "caps sem taxa"))?;
        let channels: i32 = structure
            .get("channels")
            .map_err(|_| gst::loggable_error!(gst::CAT_DEFAULT, "caps sem canais"))?;

        let ceiling = *self.ceiling.lock().unwrap();
        if rate<=0||channels<=0{return Err(gst::loggable_error!(gst::CAT_DEFAULT,"caps inválidas para limiter"));}
        let bus=BusLimiter::new(rate as u32,channels as usize,ceiling,*self.pair_linked.lock().unwrap()).map_err(|error|gst::loggable_error!(gst::CAT_DEFAULT,"{}",error))?;
        *self.running.lock().unwrap() = Some(Running {
            bus,
        });
        Ok(())
    }

    fn stop(&self) -> Result<(), gst::ErrorMessage> {
        *self.running.lock().unwrap() = None;
        Ok(())
    }

    fn transform_ip(&self, buffer: &mut gst::BufferRef) -> Result<gst::FlowSuccess, gst::FlowError> {
        let mut guard = self.running.lock().unwrap();
        let Some(running) = guard.as_mut() else {
            // Sem caps negociadas não há o que processar; deixar passar é
            // melhor do que derrubar o canal.
            return Ok(gst::FlowSuccess::Ok);
        };

        let mut map = buffer.map_writable().map_err(|_| gst::FlowError::Error)?;
        let bytes = map.as_mut_slice();
        // O `capsfilter` do ramo garante F32LE intercalado; o resto é
        // aritmética de tamanho.
        if bytes.len()%(4*running.bus.channels())!=0{return Err(gst::FlowError::Error);}
        let count = bytes.len()/4;

        let mut samples: Vec<f32> = bytes[..count * 4]
            .chunks_exact(4)
            .map(|raw| f32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]))
            .collect();
        running.bus.process(&mut samples).map_err(|_|gst::FlowError::Error)?;
        for (slot, value) in bytes.chunks_exact_mut(4).zip(samples.iter()) {
            slot.copy_from_slice(&value.to_le_bytes());
        }
        drop(map);
        // The lookahead delay emits the previous audible tail inside the next
        // buffer. If that input was flagged GAP (silence), keeping the flag
        // would make downstream `volume` skip it, so a muted/held PGM leaked
        // real audio. GAP only stays when the output is actually silent.
        if buffer.flags().contains(gst::BufferFlags::GAP) && samples.iter().any(|value| *value != 0.0) {
            buffer.unset_flags(gst::BufferFlags::GAP);
        }

        // Telemetry is the worst protection action across embedded pairs.
        let reduction = running.bus.take_reduction_db();
        if reduction > 0.0 {
            let raw = (reduction * 1000.0) as u64;
            self.reduction.fetch_max(raw, Ordering::Relaxed);
        }

        Ok(gst::FlowSuccess::Ok)
    }
}

}

#[cfg(test)]
mod gap_tests {
    use gstreamer as gst;
    use gst::prelude::*;
    use gstreamer_app as gst_app;

    /// Audible block, then GAP-flagged silence: the lookahead tail lands in the
    /// second output buffer and must lose GAP; a later fully silent one keeps it.
    #[test]
    fn lookahead_tail_inside_a_gap_buffer_is_not_left_flagged_as_silence() {
        gst::init().unwrap();
        if gst::ElementFactory::find(super::FACTORY).is_none() { super::register().unwrap(); }
        let pipeline = gst::parse::launch("appsrc name=src format=time caps=audio/x-raw,format=F32LE,layout=interleaved,rate=48000,channels=2,channel-mask=(bitmask)0x3 ! rplayoutlimiter ! appsink name=sink sync=false").unwrap().downcast::<gst::Pipeline>().unwrap();
        let src = pipeline.by_name("src").unwrap().downcast::<gst_app::AppSrc>().unwrap();
        let sink = pipeline.by_name("sink").unwrap().downcast::<gst_app::AppSink>().unwrap();
        pipeline.set_state(gst::State::Playing).unwrap();
        let block = |index: u64, value: f32, gap: bool| {
            let samples: Vec<u8> = (0..960 * 2).flat_map(|_| value.to_le_bytes()).collect();
            let mut buffer = gst::Buffer::from_mut_slice(samples);
            { let buffer = buffer.get_mut().unwrap(); buffer.set_pts(gst::ClockTime::from_mseconds(index * 20)); buffer.set_duration(gst::ClockTime::from_mseconds(20)); if gap { buffer.set_flags(gst::BufferFlags::GAP); } }
            buffer
        };
        for (index, (value, gap)) in [(0.3, false), (0.0, true), (0.0, true), (0.0, true)].into_iter().enumerate() { src.push_buffer(block(index as u64, value, gap)).unwrap(); }
        let mut outputs = Vec::new();
        for _ in 0..4 {
            let sample = sink.try_pull_sample(gst::ClockTime::from_seconds(5)).expect("limiter output");
            let buffer = sample.buffer().unwrap();
            let peak = buffer.map_readable().unwrap().as_slice().chunks_exact(4).map(|raw| f32::from_le_bytes(raw.try_into().unwrap()).abs()).fold(0f32, f32::max);
            outputs.push((peak, buffer.flags().contains(gst::BufferFlags::GAP)));
        }
        pipeline.set_state(gst::State::Null).unwrap();
        assert!(outputs[1].0 > 0.01, "fixture must place the lookahead tail in the GAP input: {outputs:?}");
        for (peak, gap) in &outputs { assert!(!(*gap && *peak > 0.0), "audible output still flagged GAP: {outputs:?}"); }
        assert!(outputs[3].1 && outputs[3].0 == 0.0, "fully silent output keeps GAP: {outputs:?}");
    }
}
