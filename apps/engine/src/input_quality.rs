//! Medições baratas da qualidade de uma entrada ao vivo, para o watchdog.
//!
//! Tudo aqui é medido no pad que sai do decodificador (ou da placa/NDI/OMT,
//! que já entregam quadros crus) -- o mesmo ponto do pipeline para SRT, RTMP,
//! NDI, OMT e SDI. Não é análise de quadro inteiro: são amostras esparsas.
//!
//! * taxa de chegada: quadros por segundo numa janela de 2 s;
//! * taxa efetiva: quadros DIFERENTES do anterior por segundo (impressão
//!   digital de 64 bytes por quadro), que pega fonte repetindo quadro;
//! * luma: média e desvio de uma grade de 32×18 pontos do plano Y (ou do RGB),
//!   no máximo 4 vezes por segundo -- preto/fade-to-black/tela chapada;
//! * áudio: RMS por buffer (amostragem de até 1024 valores), amostras
//!   entregues por segundo contra a taxa nominal, carimbo de tempo parado e
//!   buffer idêntico repetido (áudio "travado");
//! * taxa de dados de entrada: bytes que saem do elemento de rede, quando a
//!   fonte é uma URI (SRT/RTMP/UDP...). NDI/SDI/OMT não têm esse número.
//!
//! Nenhuma destas leituras autoriza TAKE: quem decide é o servidor.

use gstreamer as gst;
use serde::Serialize;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

const FPS_WINDOW: Duration = Duration::from_secs(2);
const AUDIO_WINDOW: Duration = Duration::from_secs(1);
const LUMA_EVERY: Duration = Duration::from_millis(250);
const GRID_COLUMNS: usize = 32;
const GRID_ROWS: usize = 18;
/// Abaixo disto (diferença média da grade, em %) a imagem é tida como parada.
const STATIC_DELTA_PERCENT: f64 = 0.5;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InputQualityReport {
    /// Quadros recebidos por segundo (janela de 2 s).
    pub arrival_fps: Option<f64>,
    /// Quadros com conteúdo diferente do anterior por segundo (janela de 2 s).
    pub distinct_fps: Option<f64>,
    /// Luma média em % (0 = preto de referência, 100 = branco de referência).
    pub luma_mean_percent: Option<f64>,
    /// Desvio padrão da luma na grade amostrada, em %. Baixo = imagem chapada.
    pub luma_std_percent: Option<f64>,
    pub luma_sample_age_ms: Option<u64>,
    /// Formato de vídeo cru que a medição de luma não sabe ler.
    pub luma_unsupported_format: Option<String>,
    /// Diferença média da grade de luma entre duas amostras seguidas (%).
    pub luma_delta_percent: Option<f64>,
    /// Há quanto tempo a imagem está parada pela grade de luma (tolera a
    /// requantização dos quadros-chave, que a impressão bit a bit não tolera).
    pub luma_static_ms: Option<u64>,
    /// Maior RMS por buffer no último segundo, em dBFS.
    pub audio_rms_dbfs: Option<f64>,
    /// Amostras por canal entregues no último segundo / taxa nominal.
    pub audio_sample_ratio: Option<f64>,
    /// Há quanto tempo o áudio está "travado" (carimbo parado ou buffer
    /// idêntico repetido com som). Nulo quando está andando.
    pub audio_stalled_ms: Option<u64>,
    /// Taxa de dados na saída do elemento de rede, em kbit/s.
    pub input_kbps: Option<f64>,
}

#[derive(Default)]
pub struct InputQuality {
    arrivals: VecDeque<Instant>,
    distinct: VecDeque<Instant>,
    last_print: Option<u64>,
    luma: Option<(f64, f64)>,
    luma_at: Option<Instant>,
    luma_unsupported: Option<String>,
    luma_previous: Option<Vec<f64>>,
    luma_delta: Option<f64>,
    static_since: Option<Instant>,
    audio_levels: VecDeque<(Instant, f64)>,
    audio_samples: VecDeque<(Instant, u64)>,
    audio_rate: Option<u32>,
    audio_since: Option<Instant>,
    last_audio_pts: Option<gst::ClockTime>,
    pts_stall_since: Option<Instant>,
    last_audio_print: Option<u64>,
    repeat_since: Option<Instant>,
    input_bytes: VecDeque<(Instant, u64)>,
    input_since: Option<Instant>,
}

fn prune<T>(queue: &mut VecDeque<T>, now: Instant, window: Duration, at: impl Fn(&T) -> Instant) {
    while queue.front().is_some_and(|entry| now.duration_since(at(entry)) > window) {
        queue.pop_front();
    }
}

fn fingerprint(bytes: &[u8], points: usize) -> u64 {
    let mut hash = 14695981039346656037u64 ^ bytes.len() as u64;
    if bytes.is_empty() {
        return hash;
    }
    for index in 0..points {
        let offset = index * (bytes.len() - 1) / (points - 1).max(1);
        hash = (hash ^ u64::from(bytes[offset])).wrapping_mul(1099511628211);
    }
    hash
}

impl InputQuality {
    /// Troca de caps ou buraco grande: a janela anterior não descreve mais a
    /// entrada atual.
    pub fn reset_video(&mut self) {
        self.arrivals.clear();
        self.distinct.clear();
        self.last_print = None;
        self.luma = None;
        self.luma_at = None;
        self.luma_previous = None;
        self.luma_delta = None;
        self.static_since = None;
    }

    pub fn on_video(&mut self, caps: Option<&gst::Caps>, buffer: &gst::BufferRef, now: Instant) {
        self.arrivals.push_back(now);
        prune(&mut self.arrivals, now, FPS_WINDOW, |at| *at);
        prune(&mut self.distinct, now, FPS_WINDOW, |at| *at);
        let structure = caps.and_then(|caps| caps.structure(0)).filter(|s| s.name() == "video/x-raw");
        let Some(structure) = structure else { return };
        let Ok(map) = buffer.map_readable() else { return };
        let bytes = map.as_slice();
        if bytes.is_empty() {
            return;
        }
        let print = fingerprint(bytes, 64);
        if self.last_print != Some(print) {
            self.distinct.push_back(now);
        }
        self.last_print = Some(print);
        if self.luma_at.is_some_and(|at| now.duration_since(at) < LUMA_EVERY) {
            return;
        }
        let format = structure.get::<String>("format").unwrap_or_default();
        let width = structure.get::<i32>("width").unwrap_or(0);
        let height = structure.get::<i32>("height").unwrap_or(0);
        match luma_grid(&format, width, height, bytes) {
            Some(grid) => {
                self.luma = Some(grid_statistics(&grid));
                self.luma_unsupported = None;
                self.luma_delta = self.luma_previous.as_deref().and_then(|previous| grid_difference(previous, &grid));
                match self.luma_delta {
                    Some(delta) if delta <= STATIC_DELTA_PERCENT => { self.static_since.get_or_insert(now); }
                    _ => self.static_since = None,
                }
                self.luma_previous = Some(grid);
            }
            None => {
                self.luma = None;
                self.luma_previous = None;
                self.luma_delta = None;
                self.static_since = None;
                self.luma_unsupported = Some(format);
            }
        }
        self.luma_at = Some(now);
    }

    pub fn on_audio(&mut self, caps: Option<&gst::Caps>, buffer: &gst::BufferRef, now: Instant) {
        prune(&mut self.audio_levels, now, AUDIO_WINDOW, |entry| entry.0);
        prune(&mut self.audio_samples, now, AUDIO_WINDOW, |entry| entry.0);
        let Some(structure) = caps.and_then(|caps| caps.structure(0)).filter(|s| s.name() == "audio/x-raw") else { return };
        let format = structure.get::<String>("format").unwrap_or_default();
        let channels = structure.get::<i32>("channels").unwrap_or(0).max(1) as usize;
        self.audio_rate = structure.get::<i32>("rate").ok().filter(|rate| *rate > 0).map(|rate| rate as u32);
        self.audio_since.get_or_insert(now);
        let Ok(map) = buffer.map_readable() else { return };
        let bytes = map.as_slice();
        let Some(width) = sample_width(&format) else { return };
        let samples = bytes.len() / width;
        self.audio_samples.push_back((now, (samples / channels) as u64));
        let rms = rms_dbfs(&format, bytes);
        if let Some(rms) = rms {
            self.audio_levels.push_back((now, rms));
        }
        if let Some(pts) = buffer.pts() {
            if self.last_audio_pts.is_some_and(|last| pts <= last) {
                self.pts_stall_since.get_or_insert(now);
            } else {
                self.pts_stall_since = None;
            }
            self.last_audio_pts = Some(pts);
        }
        // Buffer idêntico com som: o sintoma clássico de áudio travado
        // (um bloco repetindo). Silêncio digital repetido não é "travado".
        let print = fingerprint(bytes, 48);
        let audible = rms.is_some_and(|rms| rms > -70.0);
        if audible && self.last_audio_print == Some(print) {
            self.repeat_since.get_or_insert(now);
        } else {
            self.repeat_since = None;
        }
        self.last_audio_print = Some(print);
    }

    pub fn on_input_bytes(&mut self, bytes: u64, now: Instant) {
        self.input_since.get_or_insert(now);
        self.input_bytes.push_back((now, bytes));
        prune(&mut self.input_bytes, now, FPS_WINDOW, |entry| entry.0);
    }

    pub fn report(&self, now: Instant) -> InputQualityReport {
        let window = FPS_WINDOW.as_secs_f64();
        let count = |queue: &VecDeque<Instant>| queue.iter().filter(|at| now.duration_since(**at) <= FPS_WINDOW).count() as f64 / window;
        let has_video = !self.arrivals.is_empty() || self.luma_at.is_some();
        let audio_recent = |entry: &&(Instant, f64)| now.duration_since(entry.0) <= AUDIO_WINDOW;
        let samples: u64 = self.audio_samples.iter().filter(|entry| now.duration_since(entry.0) <= AUDIO_WINDOW).map(|entry| entry.1).sum();
        let audio_warm = self.audio_since.is_some_and(|since| now.duration_since(since) >= Duration::from_millis(1500));
        let stalled = [self.pts_stall_since, self.repeat_since].into_iter().flatten()
            .map(|since| now.duration_since(since).as_millis().min(u128::from(u64::MAX)) as u64).max();
        let input_warm = self.input_since.is_some_and(|since| now.duration_since(since) >= FPS_WINDOW);
        let input: u64 = self.input_bytes.iter().filter(|entry| now.duration_since(entry.0) <= FPS_WINDOW).map(|entry| entry.1).sum();
        InputQualityReport {
            arrival_fps: has_video.then(|| count(&self.arrivals)),
            distinct_fps: has_video.then(|| count(&self.distinct)),
            luma_mean_percent: self.luma.map(|luma| luma.0),
            luma_std_percent: self.luma.map(|luma| luma.1),
            luma_sample_age_ms: self.luma_at.map(|at| now.duration_since(at).as_millis().min(u128::from(u64::MAX)) as u64),
            luma_unsupported_format: self.luma_unsupported.clone(),
            luma_delta_percent: self.luma_delta,
            luma_static_ms: self.static_since.map(|since| now.duration_since(since).as_millis().min(u128::from(u64::MAX)) as u64),
            audio_rms_dbfs: self.audio_levels.iter().filter(audio_recent).map(|entry| entry.1).reduce(f64::max),
            audio_sample_ratio: match (audio_warm, self.audio_rate) {
                (true, Some(rate)) => Some(samples as f64 / f64::from(rate) / AUDIO_WINDOW.as_secs_f64()),
                _ => None,
            },
            audio_stalled_ms: stalled,
            input_kbps: input_warm.then(|| input as f64 * 8.0 / window / 1000.0),
        }
    }
}

/// Conta os bytes que saem do elemento de rede de um `uridecodebin` (SRT,
/// RTMP, UDP...). Fonte de placa/NDI/OMT não passa por aqui e fica sem taxa.
pub fn count_network_input<T: Send + 'static>(element: &gst::Element, target: std::sync::Arc<std::sync::Mutex<T>>, apply: fn(&mut T, u64)) {
    use gst::prelude::*;
    if element.factory().is_none_or(|factory| factory.name() != "uridecodebin") {
        return;
    }
    element.connect("source-setup", false, move |values| {
        let Some(source) = values.get(1).and_then(|value| value.get::<gst::Element>().ok()) else { return None };
        let Some(pad) = source.static_pad("src") else { return None };
        let target = std::sync::Arc::clone(&target);
        pad.add_probe(gst::PadProbeType::BUFFER | gst::PadProbeType::BUFFER_LIST, move |_, info| {
            let bytes = match info.data.as_ref() {
                Some(gst::PadProbeData::Buffer(buffer)) => buffer.size() as u64,
                Some(gst::PadProbeData::BufferList(list)) => list.calculate_size() as u64,
                _ => 0,
            };
            if bytes > 0 {
                if let Ok(mut target) = target.lock() { apply(&mut target, bytes); }
            }
            gst::PadProbeReturn::Ok
        });
        None
    });
}

fn sample_width(format: &str) -> Option<usize> {
    Some(match format {
        "U8" | "S8" => 1,
        "S16LE" | "S16BE" | "U16LE" | "U16BE" => 2,
        "S24LE" | "S24BE" | "U24LE" | "U24BE" => 3,
        "S32LE" | "S32BE" | "U32LE" | "U32BE" | "F32LE" | "F32BE" | "S24_32LE" | "S24_32BE" => 4,
        "F64LE" | "F64BE" => 8,
        _ => return None,
    })
}

/// RMS de até 1024 amostras espalhadas pelo buffer, em dBFS. A disposição
/// (intercalada ou planar) não importa para um nível agregado.
pub fn rms_dbfs(format: &str, bytes: &[u8]) -> Option<f64> {
    let width = sample_width(format)?;
    let samples = bytes.len() / width;
    if samples == 0 {
        return None;
    }
    let step = (samples / 1024).max(1);
    let (mut sum, mut count) = (0.0f64, 0usize);
    let mut index = 0;
    while index < samples {
        let raw = &bytes[index * width..index * width + width];
        let value = match format {
            "S16LE" => f64::from(i16::from_le_bytes([raw[0], raw[1]])) / 32768.0,
            "S16BE" => f64::from(i16::from_be_bytes([raw[0], raw[1]])) / 32768.0,
            "S32LE" => f64::from(i32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]])) / 2147483648.0,
            "S32BE" => f64::from(i32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]])) / 2147483648.0,
            "S24_32LE" => f64::from(i32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) << 8 >> 8) / 8388608.0,
            "S24LE" => f64::from(i32::from_le_bytes([raw[0], raw[1], raw[2], if raw[2] & 0x80 != 0 { 0xff } else { 0 }])) / 8388608.0,
            "F32LE" => f64::from(f32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]])),
            "F32BE" => f64::from(f32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]])),
            "F64LE" => f64::from_le_bytes(raw.try_into().ok()?),
            "F64BE" => f64::from_be_bytes(raw.try_into().ok()?),
            "U8" => (f64::from(raw[0]) - 128.0) / 128.0,
            "S8" => f64::from(raw[0] as i8) / 128.0,
            _ => return None,
        };
        if value.is_finite() {
            sum += value * value;
            count += 1;
        }
        index += step;
    }
    if count == 0 {
        return None;
    }
    let rms = (sum / count as f64).sqrt();
    Some(if rms > 0.0 { (20.0 * rms.log10()).max(-120.0) } else { -120.0 })
}

fn round_up(value: usize, to: usize) -> usize {
    value.div_ceil(to) * to
}

enum Layout {
    /// Plano de luma em 8 bits: (bytes por pixel, deslocamento do Y no pixel).
    Luma8 { stride: usize, pixel: usize, offset: usize },
    /// Plano de luma em 16 bits little-endian, com deslocamento à direita até 8 bits.
    Luma16 { stride: usize, shift: u32 },
    /// RGB: bytes por pixel e posição de R, G e B.
    Rgb { stride: usize, pixel: usize, r: usize, g: usize, b: usize },
    /// v210: 6 pixels em 16 bytes, 10 bits.
    V210 { stride: usize },
}

fn layout(format: &str, width: usize) -> Option<Layout> {
    let luma8 = |pixel: usize, offset: usize, stride: usize| Some(Layout::Luma8 { stride, pixel, offset });
    match format {
        "I420" | "YV12" | "NV12" | "NV21" | "Y42B" | "Y444" | "Y41B" | "GRAY8" | "A420" | "NV16" | "NV61" | "NV24" | "YUV9" | "YVU9" => luma8(1, 0, round_up(width, 4)),
        "UYVY" | "VYUY" => luma8(2, 1, round_up(width * 2, 4)),
        "YUY2" | "YVYU" => luma8(2, 0, round_up(width * 2, 4)),
        "AYUV" => luma8(4, 1, width * 4),
        "VUYA" => luma8(4, 2, width * 4),
        "I420_10LE" | "I422_10LE" | "Y444_10LE" | "I420_12LE" | "I422_12LE" | "Y444_12LE" | "GRAY16_LE" | "P010_10LE" | "P012_LE" | "P016_LE" | "Y444_16LE" => {
            let shift = match format {
                "I420_10LE" | "I422_10LE" | "Y444_10LE" => 2,
                "I420_12LE" | "I422_12LE" | "Y444_12LE" => 4,
                _ => 8,
            };
            Some(Layout::Luma16 { stride: round_up(width * 2, 4), shift })
        }
        "v210" => Some(Layout::V210 { stride: width.div_ceil(48) * 128 }),
        "BGRA" | "BGRx" => Some(Layout::Rgb { stride: width * 4, pixel: 4, r: 2, g: 1, b: 0 }),
        "RGBA" | "RGBx" => Some(Layout::Rgb { stride: width * 4, pixel: 4, r: 0, g: 1, b: 2 }),
        "ARGB" | "xRGB" => Some(Layout::Rgb { stride: width * 4, pixel: 4, r: 1, g: 2, b: 3 }),
        "ABGR" | "xBGR" => Some(Layout::Rgb { stride: width * 4, pixel: 4, r: 3, g: 2, b: 1 }),
        "RGB" => Some(Layout::Rgb { stride: round_up(width * 3, 4), pixel: 3, r: 0, g: 1, b: 2 }),
        "BGR" => Some(Layout::Rgb { stride: round_up(width * 3, 4), pixel: 3, r: 2, g: 1, b: 0 }),
        _ => None,
    }
}

/// Luma média e desvio padrão (em %) de uma grade esparsa do quadro.
///
/// YUV é tratado como faixa limitada (16–235 = 0–100 %); RGB como faixa
/// completa com pesos BT.709. Formato desconhecido ou buffer menor que o
/// esperado devolve `None` -- melhor não medir do que medir errado.
pub fn luma_statistics(format: &str, width: i32, height: i32, bytes: &[u8]) -> Option<(f64, f64)> {
    luma_grid(format, width, height, bytes).map(|grid| grid_statistics(&grid))
}

fn grid_statistics(grid: &[f64]) -> (f64, f64) {
    let count = grid.len().max(1) as f64;
    let mean = grid.iter().sum::<f64>() / count;
    let variance = (grid.iter().map(|value| value * value).sum::<f64>() / count - mean * mean).max(0.0);
    (mean, variance.sqrt())
}

/// Diferença média absoluta entre duas grades de luma, em %. Quadro
/// "congelado" de fonte recodificada não é bit a bit igual (cada quadro-chave
/// requantiza), mas fica abaixo de meio por cento; imagem em movimento, não.
pub fn grid_difference(previous: &[f64], current: &[f64]) -> Option<f64> {
    (previous.len() == current.len() && !current.is_empty())
        .then(|| previous.iter().zip(current).map(|(a, b)| (a - b).abs()).sum::<f64>() / current.len() as f64)
}

/// Luma (em %) de uma grade esparsa 32×18 do quadro.
pub fn luma_grid(format: &str, width: i32, height: i32, bytes: &[u8]) -> Option<Vec<f64>> {
    if width <= 0 || height <= 0 {
        return None;
    }
    let (width, height) = (width as usize, height as usize);
    let layout = layout(format, width)?;
    let stride = match &layout {
        Layout::Luma8 { stride, .. } | Layout::Luma16 { stride, .. } | Layout::Rgb { stride, .. } | Layout::V210 { stride } => *stride,
    };
    if stride * height > bytes.len() {
        return None;
    }
    let mut grid = Vec::with_capacity(GRID_ROWS * GRID_COLUMNS);
    for row in 0..GRID_ROWS {
        let y = (height * (2 * row + 1)) / (2 * GRID_ROWS);
        let line = &bytes[y * stride..y * stride + stride];
        for column in 0..GRID_COLUMNS {
            let x = (width * (2 * column + 1)) / (2 * GRID_COLUMNS);
            let value = match &layout {
                Layout::Luma8 { pixel, offset, .. } => {
                    let index = if *pixel == 1 { x } else { x * pixel + offset };
                    yuv_percent(f64::from(*line.get(index)?))
                }
                Layout::Luma16 { shift, .. } => {
                    let index = x * 2;
                    let raw = u16::from_le_bytes([*line.get(index)?, *line.get(index + 1)?]);
                    yuv_percent(f64::from(raw >> shift))
                }
                Layout::Rgb { pixel, r, g, b, .. } => {
                    let base = x * pixel;
                    let (r, g, b) = (f64::from(*line.get(base + r)?), f64::from(*line.get(base + g)?), f64::from(*line.get(base + b)?));
                    (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0 * 100.0
                }
                Layout::V210 { .. } => {
                    let base = (x / 6) * 16;
                    let word = u32::from_le_bytes([*line.get(base)?, *line.get(base + 1)?, *line.get(base + 2)?, *line.get(base + 3)?]);
                    yuv_percent(f64::from((word >> 10) & 0x3ff) / 4.0)
                }
            };
            grid.push(value);
        }
    }
    Some(grid)
}

fn yuv_percent(y: f64) -> f64 {
    ((y - 16.0) / 219.0 * 100.0).clamp(0.0, 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps(format: &str, width: i32, height: i32) -> gst::Caps {
        gst::init().unwrap();
        gst::Caps::builder("video/x-raw").field("format", format).field("width", width).field("height", height)
            .field("framerate", gst::Fraction::new(30, 1)).build()
    }
    fn i420(width: usize, height: usize, luma: impl Fn(usize, usize) -> u8) -> Vec<u8> {
        let mut bytes = vec![128u8; width * height * 3 / 2];
        for y in 0..height { for x in 0..width { bytes[y * width + x] = luma(x, y); } }
        bytes
    }

    #[test]
    fn preto_de_referencia_e_chapado_em_i420_uyvy_bgra_e_v210() {
        let black = i420(64, 36, |_, _| 16);
        assert_eq!(luma_statistics("I420", 64, 36, &black), Some((0.0, 0.0)));
        let uyvy: Vec<u8> = (0..64 * 36).flat_map(|_| [128u8, 16]).collect();
        assert_eq!(luma_statistics("UYVY", 64, 36, &uyvy), Some((0.0, 0.0)));
        let bgra: Vec<u8> = (0..64 * 36).flat_map(|_| [0u8, 0, 0, 255]).collect();
        assert_eq!(luma_statistics("BGRA", 64, 36, &bgra), Some((0.0, 0.0)));
        // v210: Y0 = 64 (10 bits) = preto.
        let word = (512u32) | (64 << 10) | (512 << 20);
        let line: Vec<u8> = (0..(48usize.div_ceil(48) * 128) / 4).flat_map(|_| word.to_le_bytes()).collect();
        let v210: Vec<u8> = (0..36).flat_map(|_| line.clone()).collect();
        let (mean, std) = luma_statistics("v210", 48, 36, &v210).unwrap();
        assert!(mean < 0.5 && std < 0.5, "{mean} {std}");
    }

    #[test]
    fn barras_tem_luma_alta_e_variancia_alta() {
        let bars = i420(64, 36, |x, _| if x < 32 { 235 } else { 16 });
        let (mean, std) = luma_statistics("I420", 64, 36, &bars).unwrap();
        assert!((mean - 50.0).abs() < 1.0, "{mean}");
        assert!(std > 45.0, "{std}");
        let ten: Vec<u8> = (0..64 * 36).flat_map(|_| (940u16).to_le_bytes()).chain(std::iter::repeat(0).take(64 * 36)).collect();
        let (white, _) = luma_statistics("I420_10LE", 64, 36, &ten).unwrap();
        assert!(white > 99.0, "{white}");
    }

    #[test]
    fn formato_desconhecido_ou_buffer_curto_nao_inventa_leitura() {
        assert_eq!(luma_statistics("XYZ", 64, 36, &[0; 10000]), None);
        assert_eq!(luma_statistics("I420", 64, 36, &[0; 100]), None);
    }

    #[test]
    fn rms_de_silencio_tom_e_formatos() {
        assert_eq!(rms_dbfs("S16LE", &[0; 4096]), Some(-120.0));
        let full: Vec<u8> = (0..2048).flat_map(|i| (if i % 2 == 0 { 1.0f32 } else { -1.0 }).to_le_bytes()).collect();
        assert!(rms_dbfs("F32LE", &full).unwrap().abs() < 0.01);
        let quiet: Vec<u8> = (0..2048).flat_map(|i| (if i % 2 == 0 { 328i16 } else { -328 }).to_le_bytes()).collect();
        let level = rms_dbfs("S16LE", &quiet).unwrap();
        assert!((level + 40.0).abs() < 0.2, "{level}");
        assert_eq!(rms_dbfs("XYZ", &[1; 64]), None);
    }

    #[test]
    fn taxa_de_chegada_e_taxa_efetiva_com_quadros_repetidos() {
        let caps = caps("I420", 64, 36);
        let mut quality = InputQuality::default();
        let start = Instant::now();
        // 2 s a 30 quadros/s, mas cada imagem repetida 6 vezes: 5 quadros novos/s.
        for frame in 0..60u32 {
            let picture = i420(64, 36, |x, _| ((frame / 6) as usize * 10 + x) as u8);
            let buffer = gst::Buffer::from_slice(picture);
            quality.on_video(Some(&caps), buffer.as_ref(), start + Duration::from_millis(u64::from(frame) * 1000 / 30));
        }
        let report = quality.report(start + Duration::from_millis(1990));
        assert!((report.arrival_fps.unwrap() - 30.0).abs() <= 1.0, "{report:?}");
        assert!((report.distinct_fps.unwrap() - 5.0).abs() <= 1.0, "{report:?}");
        // Depois de 3 s sem quadro a janela esvazia: taxa zero, não a última.
        let silent = quality.report(start + Duration::from_secs(5));
        assert_eq!(silent.arrival_fps, Some(0.0));
    }

    #[test]
    fn fade_to_black_baixa_a_luma_ate_o_preto() {
        let caps = caps("I420", 64, 36);
        let mut quality = InputQuality::default();
        let start = Instant::now();
        let mut readings = Vec::new();
        for step in 0..=4u64 {
            let level = 235 - (step as usize * (235 - 16) / 4);
            let picture = i420(64, 36, |x, _| if x % 2 == 0 { level as u8 } else { (16 + (level - 16) / 2) as u8 });
            quality.on_video(Some(&caps), gst::Buffer::from_slice(picture).as_ref(), start + Duration::from_secs(step));
            readings.push(quality.report(start + Duration::from_secs(step)).luma_mean_percent.unwrap());
        }
        assert!(readings.windows(2).all(|pair| pair[1] < pair[0]), "{readings:?}");
        assert!(readings[4] < 0.5);
    }

    #[test]
    fn imagem_parada_com_requantizacao_conta_como_parada_e_movimento_nao() {
        let caps = caps("I420", 64, 36);
        let mut quality = InputQuality::default();
        let start = Instant::now();
        // Mesmo quadro com ruído de ±1 código (quadro-chave requantizado), 4 vezes por segundo por 3 s.
        for step in 0..12u64 {
            let picture = i420(64, 36, |x, y| (60 + (x * 3 + y) % 120 + ((x + y + step as usize) % 2)) as u8);
            quality.on_video(Some(&caps), gst::Buffer::from_slice(picture).as_ref(), start + Duration::from_millis(step * 260));
        }
        let frozen = quality.report(start + Duration::from_millis(11 * 260));
        assert!(frozen.luma_static_ms.unwrap() >= 2500, "{frozen:?}");
        assert!(frozen.luma_delta_percent.unwrap() < 0.5);
        let moved = i420(64, 36, |x, y| (60 + (x * 7 + y * 5) % 150) as u8);
        quality.on_video(Some(&caps), gst::Buffer::from_slice(moved).as_ref(), start + Duration::from_millis(12 * 260));
        assert_eq!(quality.report(start + Duration::from_millis(12 * 260)).luma_static_ms, None);
    }

    #[test]
    fn audio_parado_repetido_e_taxa_de_amostras() {
        gst::init().unwrap();
        let caps = gst::Caps::builder("audio/x-raw").field("format", "S16LE").field("rate", 48000).field("channels", 2)
            .field("layout", "interleaved").build();
        let mut quality = InputQuality::default();
        let start = Instant::now();
        let tone = |seed: i16| -> Vec<u8> { (0..1920).flat_map(|i| ((((i as i16).wrapping_mul(37)).wrapping_add(seed)) % 8000).to_le_bytes()).collect() };
        // 2 s de áudio normal: 960 amostras/canal a cada 20 ms, PTS andando.
        for block in 0..100u64 {
            let mut buffer = gst::Buffer::from_slice(tone(block as i16));
            buffer.get_mut().unwrap().set_pts(gst::ClockTime::from_mseconds(block * 20));
            quality.on_audio(Some(&caps), buffer.as_ref(), start + Duration::from_millis(block * 20));
        }
        let ok = quality.report(start + Duration::from_millis(1990));
        assert!((ok.audio_sample_ratio.unwrap() - 1.0).abs() < 0.05, "{ok:?}");
        assert_eq!(ok.audio_stalled_ms, None);
        assert!(ok.audio_rms_dbfs.unwrap() > -30.0);
        // O mesmo bloco com som repetido, com PTS parado: travado.
        for block in 100..150u64 {
            let mut buffer = gst::Buffer::from_slice(tone(7));
            buffer.get_mut().unwrap().set_pts(gst::ClockTime::from_mseconds(1980));
            quality.on_audio(Some(&caps), buffer.as_ref(), start + Duration::from_millis(block * 20));
        }
        let stuck = quality.report(start + Duration::from_millis(2990));
        assert!(stuck.audio_stalled_ms.unwrap() >= 900, "{stuck:?}");
        // Silêncio digital repetido com PTS andando não é travamento.
        let mut quiet = InputQuality::default();
        for block in 0..60u64 {
            let mut buffer = gst::Buffer::from_slice(vec![0u8; 3840]);
            buffer.get_mut().unwrap().set_pts(gst::ClockTime::from_mseconds(block * 20));
            quiet.on_audio(Some(&caps), buffer.as_ref(), start + Duration::from_millis(block * 20));
        }
        let report = quiet.report(start + Duration::from_millis(1190));
        assert_eq!(report.audio_stalled_ms, None);
        assert_eq!(report.audio_rms_dbfs, Some(-120.0));
    }

    #[test]
    fn taxa_de_dados_de_entrada() {
        let mut quality = InputQuality::default();
        let start = Instant::now();
        assert_eq!(quality.report(start).input_kbps, None);
        // 1316 bytes a cada 5 ms por 2 s = 2105,6 kbit/s.
        for packet in 0..=400u64 { quality.on_input_bytes(1316, start + Duration::from_millis(packet * 5)); }
        let kbps = quality.report(start + Duration::from_millis(2000)).input_kbps.unwrap();
        assert!((kbps - 2105.6).abs() < 20.0, "{kbps}");
    }
}
