//! Monitores do navegador: níveis de qualidade, custo e relógio de teste.
//!
//! Um monitor é a janela que o operador abre no navegador -- PGM, PVW, QC,
//! multiview. Ele não é saída de programa: nunca vai ao ar, nunca entra na
//! distribuição e nunca pode tirar recurso de quem vai. Mas também não pode
//! esconder defeito: a 15 fps não se vê quadro repetido, a 240p não se vê
//! blocagem. Por isso existem três níveis, escolhidos por quem assiste:
//!
//! | nível  | geometria                          | cadência                     | bitrate      |
//! |--------|------------------------------------|------------------------------|--------------|
//! | `ref`  | a do canal, até 1920×1080          | cheia (de campo, se couber)  | 4–8 Mbps     |
//! | `std`  | 1280×720 (até 30 fps) ou 960×540   | cheia                        | 1,5–3 Mbps   |
//! | `lite` | 240 linhas, proporção do canal     | de quadro, até 30            | 180–450 kbps |
//!
//! Cada nível é publicado num caminho próprio do servidor de mídia
//! (`canal/mon-ref`, `canal/mon-std`, `canal/mon`) e só é codificado enquanto
//! alguém o assiste; quantos espectadores houver no mesmo nível, a
//! codificação é uma só -- quem multiplica é o MediaMTX.
//!
//! O nível `lite` fica no caminho histórico (`mon`, `pvw`) de propósito: é o
//! que um cliente antigo, um espelho de HA ou um celular pedem sem saber que
//! existem níveis, e é o que eles sempre receberam.
//!
//! O desenho do pipeline que publica os níveis está em [`MonitorBus`]: uma
//! leitura do `inter`, um único codificador de Opus, e um ramo de vídeo por
//! nível ligado e desligado a quente, sem derrubar os outros.

use anyhow::{anyhow, Context, Result};
use gstreamer as gst;
use gstreamer::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::channel::make;
use crate::output::{Health, TierReport};

/// Nível de qualidade de um monitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MonitorTier {
    /// REFERÊNCIA: o que se usa para julgar a imagem.
    Ref,
    /// PADRÃO: a janela grande da operação na rede local.
    Std,
    /// LEVE: acesso remoto, celular, conexão ruim.
    Lite,
}

impl MonitorTier {
    pub const ALL: [MonitorTier; 3] = [MonitorTier::Ref, MonitorTier::Std, MonitorTier::Lite];

    pub fn name(self) -> &'static str {
        match self {
            MonitorTier::Ref => "ref",
            MonitorTier::Std => "std",
            MonitorTier::Lite => "lite",
        }
    }

    /// Sufixo do caminho no servidor de mídia. O leve fica no caminho antigo.
    pub fn path_suffix(self) -> &'static str {
        match self {
            MonitorTier::Ref => "-ref",
            MonitorTier::Std => "-std",
            MonitorTier::Lite => "",
        }
    }

    /// Qualidade constante (CRF do x264, QP-alvo das placas) com teto de
    /// bitrate: imagem parada custa pouco, imagem difícil bate no teto.
    fn quality(self) -> u32 {
        match self {
            MonitorTier::Ref => 20,
            MonitorTier::Std => 23,
            MonitorTier::Lite => 27,
        }
    }
}

/// Endereço de publicação de um nível, derivado do endereço do monitor.
///
/// O servidor manda um endereço só por monitor (`...streamid=publish:canal/mon`);
/// os outros níveis acrescentam o sufixo ao caminho. Mantém o protocolo entre
/// servidor e engine igual ao de antes e o MediaMTX declara os três caminhos.
pub fn tier_url(url: &str, tier: MonitorTier) -> String {
    let suffix = tier.path_suffix();
    if suffix.is_empty() {
        return url.to_string();
    }
    if let Some(start) = url.find("streamid=") {
        let value_start = start + "streamid=".len();
        let value_end = url[value_start..].find('&').map(|i| value_start + i).unwrap_or(url.len());
        return format!("{}{}{}", &url[..value_end], suffix, &url[value_end..]);
    }
    // RTMP/outros: o caminho é o fim da URL.
    match url.find('?') {
        Some(query) => format!("{}{}{}", &url[..query], suffix, &url[query..]),
        None => format!("{url}{suffix}"),
    }
}

/// O que chega ao monitor pelo `inter`, e o teto que o perfil impõe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorSource {
    /// Geometria no `inter` (a do canal, ou a do teto do perfil).
    pub width: i32,
    pub height: i32,
    /// Cadência no `inter`. Num canal entrelaçado é a de **campo**: a
    /// composição já roda progressiva no dobro da grade.
    pub fps_n: i32,
    pub fps_d: i32,
    /// Cadência de **quadro** (a da grade).
    pub frame_n: i32,
    pub frame_d: i32,
    /// Teto de bitrate do perfil do monitor (kbps). Nunca acima de [`MAX_KBPS`].
    pub bitrate_ceiling_kbps: u32,
    /// O `inter` traz o mosaico do multiview composto, não uma imagem de
    /// barramento: os níveis seguem [`mosaic_profile`] (um mosaico em 240
    /// linhas não se lê), e não [`tier_profile`] dos monitores de barramento.
    pub mosaic: bool,
}

/// Teto absoluto de um monitor. Acima disso já é contribuição, não monitor:
/// é a trava que impede uma janela de navegador de virar saída disfarçada.
pub const MAX_KBPS: u32 = 8_000;
/// Maior raster de monitor. Canal UHD é monitorado em 1080p: o navegador não
/// tem como mostrar mais do que isso numa janela de operação.
pub const MAX_RASTER: (i32, i32) = (1920, 1080);

/// O que de fato vai ser codificado num nível.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierProfile {
    pub width: i32,
    pub height: i32,
    pub fps_n: i32,
    pub fps_d: i32,
    pub bitrate_kbps: u32,
    /// CRF/QP-alvo; o bitrate é o teto.
    pub quality: u32,
}

impl TierProfile {
    /// Custo de codificação em megapixels por segundo.
    pub fn mpx_per_second(&self) -> f64 {
        self.width as f64 * self.height as f64 * self.fps_n as f64 / self.fps_d.max(1) as f64 / 1e6
    }
    /// Intervalo de quadros-chave: um segundo, para quem entra ver logo.
    pub fn gop(&self) -> u32 {
        ((self.fps_n as f64 / self.fps_d.max(1) as f64).round() as u32).max(1)
    }
}

fn even(value: i32) -> i32 {
    (value - value % 2).max(2)
}

/// Cabe em `max_w`×`max_h` sem aumentar e sem deformar.
fn fit(width: i32, height: i32, max_w: i32, max_h: i32) -> (i32, i32) {
    if width <= 0 || height <= 0 {
        return (2, 2);
    }
    let scale = (max_w as f64 / width as f64).min(max_h as f64 / height as f64).min(1.0);
    (even((width as f64 * scale).round() as i32), even((height as f64 * scale).round() as i32))
}

/// Mesma altura-alvo, largura pela proporção. Nunca aumenta.
fn to_height(width: i32, height: i32, target: i32) -> (i32, i32) {
    if height <= target {
        return (even(width), even(height));
    }
    let w = ((width as i64 * target as i64 + height as i64 - 1) / height as i64) as i32;
    (w + w % 2, target)
}

fn rate(n: i32, d: i32) -> f64 {
    n as f64 / d.max(1) as f64
}

/// Perfil de um nível, sem considerar custo. `field_rate` permite usar a
/// cadência de campo de um canal entrelaçado.
pub fn tier_profile(tier: MonitorTier, s: &MonitorSource, field_rate: bool) -> TierProfile {
    if s.mosaic {
        return mosaic_profile(tier, s);
    }
    let entrelacado = s.fps_n as i64 * s.frame_d as i64 != s.frame_n as i64 * s.fps_d as i64;
    let (full_n, full_d) = if entrelacado && !field_rate { (s.frame_n, s.frame_d) } else { (s.fps_n, s.fps_d) };
    let ceiling = s.bitrate_ceiling_kbps.clamp(300, MAX_KBPS);
    let (width, height, fps_n, fps_d, floor, top, bpp) = match tier {
        MonitorTier::Ref => {
            let (w, h) = fit(s.width, s.height, MAX_RASTER.0, MAX_RASTER.1);
            (w, h, full_n, full_d, 4_000, 8_000, 0.08)
        }
        MonitorTier::Std => {
            let alvo = if s.height >= 720 && rate(full_n, full_d) <= 30.5 { 720 } else { 540 };
            let (w, h) = to_height(s.width, s.height, alvo);
            let (w, h) = fit(w, h, 1280, 720);
            (w, h, full_n, full_d, 1_500, 3_000, 0.06)
        }
        MonitorTier::Lite => {
            let (w, h) = crate::channel::monitor_size(s.width, s.height);
            // Quadro, nunca campo; acima de 30 fica na metade (50p → 25).
            let (n, d) = if rate(s.frame_n, s.frame_d) > 30.5 { (s.frame_n, s.frame_d * 2) } else { (s.frame_n, s.frame_d) };
            (w, h, n, d, 180, 450, 0.12)
        }
    };
    let natural = (width as f64 * height as f64 * rate(fps_n, fps_d) * bpp / 1000.0).round() as u32;
    let bitrate_kbps = natural.clamp(floor, top).min(ceiling).max(floor.min(ceiling));
    TierProfile { width, height, fps_n, fps_d, bitrate_kbps, quality: tier.quality() }
}

/// Perfil de um nível do multiview composto (`docs/MULTIVIEW.md`).
///
/// O mosaico é conferência de várias fontes: o LEVE precisa de 960×540 para
/// as células de um 3×3 continuarem legíveis, e o PADRÃO fica na metade da
/// cadência acima de 30 q/s. A fonte é o raster em que o mosaico foi composto
/// (o teto escolhido pelo Supervisor); nenhum nível passa dele.
///
/// | nível | geometria (teto) | cadência | bitrate |
/// |---|---|---|---|
/// | REFERÊNCIA | 1920×1080 | a do mosaico | 8 Mbps |
/// | PADRÃO | 1280×720 | metade acima de 30 q/s | 3 Mbps |
/// | LEVE | 960×540 | 15 q/s | 1,2 Mbps |
pub fn mosaic_profile(tier: MonitorTier, s: &MonitorSource) -> TierProfile {
    let (n, d) = (s.fps_n, s.fps_d.max(1));
    let ceiling = s.bitrate_ceiling_kbps.clamp(300, MAX_KBPS);
    let (max_w, max_h, fps_n, fps_d, kbps) = match tier {
        MonitorTier::Ref => (1920, 1080, n, d, 8_000),
        MonitorTier::Std => {
            let (hn, hd) = if rate(n, d) > 30.5 { (n, d * 2) } else { (n, d) };
            (1280, 720, hn, hd, 3_000)
        }
        MonitorTier::Lite => {
            let (ln, ld) = if rate(n, d) > 15.0 { (15, 1) } else { (n, d) };
            (960, 540, ln, ld, 1_200)
        }
    };
    let (width, height) = fit(s.width, s.height, max_w, max_h);
    TierProfile { width, height, fps_n, fps_d, bitrate_kbps: kbps.min(ceiling), quality: tier.quality() }
}

/// Ordem de qualidade: `Ref` > `Std` > `Lite`. `true` se `tier` passa do teto.
pub fn above(tier: MonitorTier, ceiling: MonitorTier) -> bool {
    (tier as u8) < (ceiling as u8)
}

/// Orçamento de CPU para monitores codificados em software, em Mpx/s.
///
/// É a trava que impede uma janela de navegador de tirar CPU do programa:
/// passou do orçamento, o nível pedido é servido mais barato (primeiro sem a
/// cadência de campo, depois na geometria de baixo) e o relatório diz por quê.
/// Codificação por placa não entra na conta. `RPLAYOUT_MONITOR_SW_MPX` ajusta;
/// o padrão é 30 Mpx/s por núcleo lógico -- o x264 veryfast/zerolatency faz
/// cerca de 60 Mpx/s por núcleo, então metade fica para o resto da máquina.
pub fn software_budget_mpx() -> f64 {
    if let Some(value) = std::env::var("RPLAYOUT_MONITOR_SW_MPX").ok().and_then(|v| v.parse::<f64>().ok()) {
        return value.max(0.0);
    }
    let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2) as f64;
    (cpus * 30.0).max(30.0)
}

/// Custo, em milésimos de Mpx/s, das codificações de monitor em software
/// abertas neste processo. Compartilhado por todos os monitores do canal.
static SOFTWARE_LOAD_MILLI: AtomicU64 = AtomicU64::new(0);
/// Sessões de placa ocupadas por monitores neste processo.
pub static MONITOR_HW_SESSIONS: AtomicU32 = AtomicU32::new(0);
/// Sobe quando o programa precisa de volta as sessões de placa dos monitores.
pub static MONITOR_HW_REVOKE: AtomicU64 = AtomicU64::new(0);

/// Pede as sessões de placa dos monitores de volta para o programa.
/// Devolve `true` se havia alguma para devolver.
pub fn revoke_monitor_hardware() -> bool {
    if MONITOR_HW_SESSIONS.load(Ordering::Acquire) == 0 {
        return false;
    }
    MONITOR_HW_REVOKE.fetch_add(1, Ordering::AcqRel);
    eprintln!("[monitor] programa pediu a placa: monitores passam a x264");
    true
}

fn software_load() -> f64 {
    SOFTWARE_LOAD_MILLI.load(Ordering::Acquire) as f64 / 1000.0
}

/// Decide o perfil efetivo de um nível considerando o custo.
///
/// Em placa, o nível sai inteiro (com cadência de campo). Em software, cabe
/// no orçamento ou desce um degrau por vez; o `lite` sempre cabe. Função pura
/// para poder ser testada sem GStreamer.
pub fn resolve_profile(
    tier: MonitorTier,
    source: &MonitorSource,
    hardware: bool,
    load_mpx: f64,
    budget_mpx: f64,
) -> (TierProfile, Option<String>) {
    if hardware {
        return (tier_profile(tier, source, true), None);
    }
    let fits = |p: &TierProfile| load_mpx + p.mpx_per_second() <= budget_mpx;
    let mut steps: Vec<(TierProfile, Option<&str>)> = Vec::new();
    match tier {
        MonitorTier::Ref => {
            steps.push((tier_profile(MonitorTier::Ref, source, true), None));
            steps.push((tier_profile(MonitorTier::Ref, source, false), Some("cadência de quadro (CPU)")));
            steps.push((tier_profile(MonitorTier::Std, source, true), Some("geometria do PADRÃO (CPU)")));
            steps.push((tier_profile(MonitorTier::Std, source, false), Some("PADRÃO em cadência de quadro (CPU)")));
        }
        MonitorTier::Std => {
            steps.push((tier_profile(MonitorTier::Std, source, true), None));
            steps.push((tier_profile(MonitorTier::Std, source, false), Some("cadência de quadro (CPU)")));
        }
        MonitorTier::Lite => {}
    }
    steps.dedup_by(|a, b| a.0 == b.0);
    for (profile, reason) in steps {
        if fits(&profile) {
            return (profile, reason.map(str::to_string));
        }
    }
    let lite = tier_profile(MonitorTier::Lite, source, false);
    let reason = (tier != MonitorTier::Lite).then(|| "geometria do LEVE (CPU no limite)".to_string());
    (lite, reason)
}

// ---------------------------------------------------------------------------
// Relógio de teste: o horário de parede gravado na imagem do monitor.
// ---------------------------------------------------------------------------

/// Liga o relógio gravado em todos os monitores deste processo.
pub static TEST_CLOCK: AtomicBool = AtomicBool::new(false);

/// Bits do horário (ms desde a época, módulo 2^42 -- 139 anos).
pub const CLOCK_BITS: u32 = 42;
/// Blocos na faixa: branco, preto, 42 bits, preto, branco.
pub const CLOCK_BLOCKS: i32 = CLOCK_BITS as i32 + 4;

/// Lado de cada bloco, em pixels, para a imagem caber e sobreviver à compressão.
pub fn clock_block(width: i32, height: i32) -> i32 {
    let b = (width / (CLOCK_BLOCKS + 2)).min(height / 10);
    (b - b % 2).max(4)
}

pub fn wall_clock_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) & ((1u64 << CLOCK_BITS) - 1)
}

/// Desenha `ms` numa faixa no alto da imagem I420, com croma neutro.
pub fn stamp_i420(data: &mut [u8], width: i32, height: i32, ms: u64) {
    let block = clock_block(width, height) as usize;
    let (w, h) = (width as usize, height as usize);
    let y_stride = (w + 3) & !3;
    let c_stride = (((w + 1) / 2) + 3) & !3;
    let y_size = y_stride * ((h + 1) & !1);
    let c_size = c_stride * (((h + 1) & !1) / 2);
    if data.len() < y_size + 2 * c_size || block * CLOCK_BLOCKS as usize > w || block > h {
        return;
    }
    for index in 0..CLOCK_BLOCKS as usize {
        let white = match index {
            0 => true,
            1 => false,
            i if i == CLOCK_BLOCKS as usize - 2 => false,
            i if i == CLOCK_BLOCKS as usize - 1 => true,
            i => (ms >> (CLOCK_BITS as usize - 1 - (i - 2))) & 1 == 1,
        };
        let luma = if white { 235u8 } else { 16u8 };
        for row in 0..block {
            let start = row * y_stride + index * block;
            data[start..start + block].fill(luma);
        }
        for row in 0..block / 2 {
            for plane in 0..2 {
                let start = y_size + plane * c_size + row * c_stride + index * block / 2;
                data[start..start + block / 2].fill(128);
            }
        }
    }
}

/// Lê a faixa de volta de um plano de luma. `None` quando não há relógio.
pub fn read_luma(luma: &[u8], stride: usize, width: i32, height: i32) -> Option<u64> {
    let block = clock_block(width, height) as usize;
    let sample = |index: usize| -> Option<bool> {
        let x = index * block + block / 2;
        let y = block / 2;
        luma.get(y * stride + x).map(|value| *value > 126)
    };
    let last = CLOCK_BLOCKS as usize - 1;
    if sample(0)? != true || sample(1)? != false || sample(last - 1)? != false || sample(last)? != true {
        return None;
    }
    let mut ms = 0u64;
    for bit in 0..CLOCK_BITS as usize {
        ms = (ms << 1) | sample(bit + 2)? as u64;
    }
    Some(ms)
}

// ---------------------------------------------------------------------------
// O pipeline de monitor com níveis.
// ---------------------------------------------------------------------------

/// Um nível ativo: o ramo de vídeo dele, ligado aos `tee` do monitor.
struct Branch {
    bin: gst::Bin,
    video_pad: gst::Pad,
    audio_pad: gst::Pad,
    delivered: Arc<AtomicU64>,
    encoder: String,
    profile: TierProfile,
    hardware: bool,
    load_milli: u64,
    opened_at: Instant,
}

/// Estado de um nível, ativo ou não.
struct TierState {
    wanted: bool,
    /// O servidor concedeu sessão de placa para este nível.
    hardware_granted: bool,
    /// A placa falhou neste nível (ou foi devolvida ao programa); até o
    /// próximo pedido, só software.
    hardware_failed: bool,
    /// Motivo de a placa ter **falhado** num ramo aberto nela (não a
    /// devolução ao programa). Vai no relatório em campo próprio, que nada
    /// sobrescreve até um pedido novo: é por ele que o servidor aprende a
    /// capacidade real da placa.
    hardware_failure: Option<String>,
    health: Health,
    attempts: u32,
    retry_at: Option<Instant>,
    error: Option<String>,
    degraded: Option<String>,
    branch: Option<Branch>,
    last_encoder: Option<String>,
    last_profile: Option<TierProfile>,
}

impl TierState {
    fn new() -> Self {
        Self {
            wanted: false,
            hardware_granted: false,
            hardware_failed: false,
            hardware_failure: None,
            health: Health::Idle,
            attempts: 0,
            retry_at: None,
            error: None,
            degraded: None,
            branch: None,
            last_encoder: None,
            last_profile: None,
        }
    }
}

/// Configuração de um monitor com níveis.
#[derive(Clone, Debug)]
pub struct MonitorBusSpec {
    pub video_channel: String,
    pub audio_channel: String,
    /// Endereço do nível `lite`; os outros derivam dele ([`tier_url`]).
    pub url: String,
    pub source: MonitorSource,
    /// Sai com som em Opus (WHEP). Sem `opusenc`, o monitor sai mudo.
    pub opus: bool,
    /// Endereço explícito por nível (testes e bancada); vazio = [`tier_url`].
    pub url_overrides: BTreeMap<MonitorTier, String>,
}

impl MonitorBusSpec {
    pub fn url_for(&self, tier: MonitorTier) -> String {
        self.url_overrides.get(&tier).cloned().unwrap_or_else(|| tier_url(&self.url, tier))
    }
}

/// Publica um monitor em até três níveis, cada um só enquanto é pedido.
///
/// ```text
/// intervideosrc ─ capsfilter(cadência) ─ tee ─┬─ [ref]  queue ─ scale ─ rate ─ conv ─ (relógio) ─ enc ─ parse ─┐
///                                             ├─ [std]  ...                                                   ├─ mpegtsmux ─ srtsink
///                                             └─ [lite] ...                                                   │
/// interaudiosrc ─ conv ─ resample ─ opusenc ─ parse ─ tee ─────────── queue ─────────────────────────────────┘ (um por nível)
/// ```
///
/// O Opus é codificado uma vez só. O ramo de cada nível nasce e morre com o
/// pipeline rodando; os outros níveis não piscam. Erro dentro de um ramo
/// derruba só aquele ramo; erro na leitura do `inter` derruba o monitor.
pub struct MonitorBus {
    spec: MonitorBusSpec,
    pipeline: Option<gst::Pipeline>,
    bus: Option<gst::Bus>,
    video_tee: Option<gst::Element>,
    audio_tee: Option<gst::Element>,
    tiers: BTreeMap<MonitorTier, TierState>,
    retired: Arc<Mutex<Vec<gst::Bin>>>,
    revoke_seen: u64,
    shared_error: Option<String>,
    shared_retry_at: Option<Instant>,
    shared_attempts: u32,
    /// Geração dos ramos: cada ramo nasce com nome próprio (`tier-ref-7`).
    /// O ramo retirado continua no pipeline até a sonda IDLE soltá-lo; com o
    /// mesmo nome, reabrir o nível na mesma volta dava "Failed to add element"
    /// e mais um backoff -- era o que atrasava a troca a quente placa → x264.
    branch_generation: u64,
    /// Codificador que faz o papel de "placa" (testes); sem ele, o de
    /// `RPLAYOUT_MONITOR_ENCODER` ou a lista de placas conhecidas.
    hardware_encoder: Option<String>,
}

const RETRY_CAP: Duration = Duration::from_secs(15);
/// Folga do muxer: o áudio só entra depois do primeiro quadro de vídeo (veja
/// `abrir_ramo`), então a folga não precisa cobrir a partida do encoder.
const MONITOR_MUX_LATENCY: u64 = 60_000_000;
/// Latência do SRT no loopback. 20 ms dá quatro voltas de retransmissão num
/// enlace sem perda; o padrão (120 ms) só fazia sentido em rede de verdade.
pub const MONITOR_SRT_LATENCY_MS: i32 = 20;

impl MonitorBus {
    pub fn new(spec: MonitorBusSpec) -> Self {
        let tiers = MonitorTier::ALL.iter().map(|tier| (*tier, TierState::new())).collect();
        Self {
            spec,
            pipeline: None,
            bus: None,
            video_tee: None,
            audio_tee: None,
            tiers,
            retired: Arc::new(Mutex::new(Vec::new())),
            revoke_seen: MONITOR_HW_REVOKE.load(Ordering::Acquire),
            shared_error: None,
            shared_retry_at: None,
            shared_attempts: 0,
            branch_generation: 0,
            hardware_encoder: None,
        }
    }

    /// Injeta o codificador que faz o papel de placa (testes e diagnóstico).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn set_hardware_encoder(&mut self, name: Option<&str>) {
        self.hardware_encoder = name.map(str::to_string);
    }

    pub fn spec(&self) -> &MonitorBusSpec {
        &self.spec
    }

    /// Algum nível pedido?
    pub fn any_wanted(&self) -> bool {
        self.tiers.values().any(|state| state.wanted)
    }

    pub fn wanted_tiers(&self) -> Vec<(MonitorTier, bool)> {
        self.tiers.iter().filter(|(_, s)| s.wanted).map(|(t, s)| (*t, s.hardware_granted)).collect()
    }

    /// Liga ou desliga um nível. `hardware` é a concessão de sessão de placa
    /// feita pelo servidor, que conta as sessões de todos os canais.
    pub fn set_tier(&mut self, tier: MonitorTier, on: bool, hardware: bool) {
        let state = self.tiers.get_mut(&tier).expect("todos os níveis existem");
        if on {
            let grant_changed = state.hardware_granted != hardware;
            state.hardware_granted = hardware;
            if state.wanted && !grant_changed {
                return;
            }
            if state.wanted && grant_changed {
                // Concessão retirada: troca para software a quente. Concessão
                // nova não derruba um ramo que já funciona em software.
                if !hardware && state.branch.as_ref().is_some_and(|b| b.hardware) {
                    state.retry_at = Some(Instant::now());
                    self.drop_branch(tier);
                }
                return;
            }
            state.wanted = true;
            state.hardware_failed = false;
            state.hardware_failure = None;
            state.health = Health::Retrying;
            state.attempts = 0;
            state.error = None;
            state.retry_at = Some(Instant::now());
        } else {
            state.wanted = false;
            state.retry_at = None;
            state.health = Health::Idle;
            state.error = None;
            state.degraded = None;
            self.drop_branch(tier);
            if !self.any_wanted() {
                self.close();
            }
        }
    }

    /// Para tudo (reconfiguração ou fim do canal).
    pub fn shutdown(&mut self) {
        for tier in MonitorTier::ALL {
            self.drop_branch(tier);
            if let Some(state) = self.tiers.get_mut(&tier) {
                state.retry_at = None;
            }
        }
        self.close();
    }

    /// Troca endereço e teto mantendo os níveis pedidos.
    pub fn replace(&mut self, spec: MonitorBusSpec) {
        let wanted = self.wanted_tiers();
        self.shutdown();
        self.spec = spec;
        for (tier, hw) in wanted {
            if let Some(state) = self.tiers.get_mut(&tier) {
                state.wanted = false;
            }
            self.set_tier(tier, true, hw);
        }
    }

    fn close(&mut self) {
        for tier in MonitorTier::ALL {
            self.drop_branch(tier);
        }
        self.bus = None;
        self.video_tee = None;
        self.audio_tee = None;
        if let Some(pipeline) = self.pipeline.take() {
            let _ = pipeline.set_state(gst::State::Null);
        }
        self.dispose_retired();
    }

    fn drop_branch(&mut self, tier: MonitorTier) {
        let Some(state) = self.tiers.get_mut(&tier) else { return };
        let Some(branch) = state.branch.take() else { return };
        if branch.hardware {
            MONITOR_HW_SESSIONS.fetch_sub(1, Ordering::AcqRel);
        } else {
            SOFTWARE_LOAD_MILLI.fetch_sub(branch.load_milli, Ordering::AcqRel);
        }
        let retired = Arc::clone(&self.retired);
        let pipeline = self.pipeline.clone();
        // Desliga dos `tee` sem corrida com um push em andamento: a sonda
        // IDLE roda quando o pad está parado. Só depois o ramo vai a NULL --
        // pôr a NULL antes faria o tee receber FLUSHING e parar o monitor.
        for (tee, tee_pad) in [(self.video_tee.clone(), branch.video_pad.clone()), (self.audio_tee.clone(), branch.audio_pad.clone())] {
            let Some(tee) = tee else { continue };
            let peer = tee_pad.peer();
            let tee_clone = tee.clone();
            tee_pad.add_probe(gst::PadProbeType::IDLE, move |pad, _| {
                if let Some(peer) = &peer {
                    let _ = pad.unlink(peer);
                }
                tee_clone.release_request_pad(pad);
                gst::PadProbeReturn::Remove
            });
        }
        if let Some(pipeline) = pipeline {
            // A remoção do bin acontece no próximo `service`, fora da thread
            // de streaming.
            let _ = &pipeline;
            if let Ok(mut list) = retired.lock() {
                list.push(branch.bin);
            }
        } else {
            let _ = branch.bin.set_state(gst::State::Null);
        }
    }

    fn dispose_retired(&mut self) {
        let bins: Vec<gst::Bin> = self.retired.lock().map(|mut list| std::mem::take(&mut *list)).unwrap_or_default();
        for bin in bins {
            let still_linked = bin.static_pad("video").and_then(|p| p.peer()).is_some()
                || bin.static_pad("audio").and_then(|p| p.peer()).is_some();
            if still_linked && self.pipeline.is_some() {
                // A sonda IDLE ainda não rodou; tenta de novo na próxima volta.
                if let Ok(mut list) = self.retired.lock() {
                    list.push(bin);
                }
                continue;
            }
            let _ = bin.set_state(gst::State::Null);
            if let Some(parent) = bin.parent().and_then(|p| p.downcast::<gst::Bin>().ok()) {
                let _ = parent.remove(&bin);
            }
        }
    }

    /// Monta a parte compartilhada: leitura do inter e Opus.
    fn open_shared(&mut self) -> Result<()> {
        let pipeline = gst::Pipeline::with_name(&format!("monitor-{}", self.spec.video_channel));
        let vsrc = make("intervideosrc")?;
        vsrc.set_property("channel", &self.spec.video_channel);
        crate::output::retain_last_video_frame(&vsrc);
        let vrate_caps = make("capsfilter")?;
        vrate_caps.set_property(
            "caps",
            gst::Caps::builder("video/x-raw")
                .field("framerate", gst::Fraction::new(self.spec.source.fps_n, self.spec.source.fps_d))
                .build(),
        );
        let vtee = make("tee")?;
        vtee.set_property("allow-not-linked", true);

        let asrc = make("interaudiosrc")?;
        asrc.set_property("channel", &self.spec.audio_channel);
        crate::channel::aplicar_latencia_de_audio(&asrc);
        let aconv = make("audioconvert")?;
        crate::audio_bus::numbered_channels(&aconv, 2)?;
        let ares = make("audioresample")?;
        let acaps = make("capsfilter")?;
        acaps.set_property("caps", gst::Caps::builder("audio/x-raw").field("rate", 48_000i32).field("channels", 2i32).build());
        let tem_opus = gst::ElementFactory::find("opusenc").is_some();
        let (aenc, aparse) = if self.spec.opus && tem_opus {
            let aenc = make("opusenc")?;
            aenc.set_property("bitrate", 96_000i32);
            // Pacote de 10 ms: metade do atraso de áudio do padrão (20 ms).
            aenc.set_property_from_str("frame-size", "10");
            (aenc, make("opusparse")?)
        } else {
            let aenc = make("avenc_aac")?;
            crate::output::set_if_exists(&aenc, "bitrate", 128_000i32);
            (aenc, make("aacparse")?)
        };
        let atee = make("tee")?;
        atee.set_property("allow-not-linked", true);

        pipeline.add_many([&vsrc, &vrate_caps, &vtee, &asrc, &aconv, &ares, &acaps, &aenc, &aparse, &atee])?;
        gst::Element::link_many([&vsrc, &vrate_caps, &vtee])?;
        gst::Element::link_many([&asrc, &aconv, &ares, &acaps, &aenc, &aparse, &atee])?;
        crate::fencing::guard_pipeline(&pipeline)?;
        pipeline.set_latency(gst::ClockTime::from_mseconds(100));
        pipeline.set_state(gst::State::Playing).context("o monitor não entrou em execução")?;
        self.bus = pipeline.bus();
        self.video_tee = Some(vtee);
        self.audio_tee = Some(atee);
        self.pipeline = Some(pipeline);
        Ok(())
    }

    /// Monta e liga o ramo de um nível ao pipeline em execução.
    fn open_branch(&mut self, tier: MonitorTier) -> Result<()> {
        let (Some(pipeline), Some(vtee), Some(atee)) = (self.pipeline.clone(), self.video_tee.clone(), self.audio_tee.clone()) else {
            return Err(anyhow!("monitor sem pipeline compartilhado"));
        };
        let state = self.tiers.get(&tier).ok_or_else(|| anyhow!("nível desconhecido"))?;
        let forced = self.hardware_encoder.clone().or_else(|| std::env::var("RPLAYOUT_MONITOR_ENCODER").ok());
        let hardware = state.hardware_granted && !state.hardware_failed && (forced.is_some() || crate::output::hardware_available());
        let (profile, degraded) = resolve_profile(tier, &self.spec.source, hardware, software_load(), software_budget_mpx());
        let (venc, encoder) = crate::output::monitor_encoder_with(&profile, hardware, forced.as_deref())?;
        let hardware = encoder != "x264enc";

        // Antes de reabrir, solta o que já pode ser solto; e o nome é único por
        // geração, então um ramo retirado que ainda não saiu não atrapalha.
        self.dispose_retired();
        self.branch_generation += 1;
        let bin = gst::Bin::with_name(&format!("tier-{}-{}", tier.name(), self.branch_generation));
        let queue = make("queue")?;
        // Ramo lento perde quadro, não segura os outros níveis.
        queue.set_property_from_str("leaky", "downstream");
        queue.set_property("max-size-buffers", 3u32);
        queue.set_property("max-size-time", 0u64);
        queue.set_property("max-size-bytes", 0u32);
        let scale = make("videoscale")?;
        let vrate = make("videorate")?;
        vrate.set_property("drop-only", true);
        let conv = make("videoconvert")?;
        let i420 = make("capsfilter")?;
        i420.set_property(
            "caps",
            gst::Caps::builder("video/x-raw")
                .field("format", "I420")
                .field("width", profile.width)
                .field("height", profile.height)
                .field("framerate", gst::Fraction::new(profile.fps_n, profile.fps_d))
                .field("pixel-aspect-ratio", gst::Fraction::new(1, 1))
                .build(),
        );
        let conv2 = make("videoconvert")?;
        let enc_caps = make("capsfilter")?;
        enc_caps.set_property(
            "caps",
            gst::Caps::builder("video/x-raw")
                .field("format", crate::output::encoder_format(&venc))
                .field("colorimetry", if profile.height >= 720 { "bt709" } else { "bt601" })
                .build(),
        );
        let parse = make("h264parse")?;
        parse.set_property("config-interval", -1i32);
        let h264caps = make("capsfilter")?;
        h264caps.set_property(
            "caps",
            gst::Caps::builder("video/x-h264").field("stream-format", "byte-stream").field("alignment", "au").build(),
        );
        let aqueue = make("queue")?;
        aqueue.set_property("max-size-time", 1_000_000_000u64);
        aqueue.set_property_from_str("leaky", "downstream");
        // Válvula fechada até o primeiro quadro de vídeo, deixando passar os
        // eventos fixos (caps): a PMT já nasce com as duas trilhas.
        let audio_gate = make("valve")?;
        audio_gate.set_property_from_str("drop-mode", "forward-sticky-events");
        audio_gate.set_property("drop", true);
        let mux = make("mpegtsmux")?;
        mux.set_property("alignment", 7i32);
        crate::output::set_if_exists(&mux, "latency", MONITOR_MUX_LATENCY);
        let sink = make("srtsink")?;
        sink.set_property("uri", self.spec.url_for(tier));
        sink.set_property("async", false);
        sink.set_property("sync", false);
        crate::output::set_if_exists(&sink, "auto-reconnect", false);
        crate::output::set_if_exists(&sink, "latency", MONITOR_SRT_LATENCY_MS);
        crate::output::set_if_exists(&sink, "wait-for-connection", false);

        bin.add_many([&queue, &scale, &vrate, &conv, &i420, &conv2, &enc_caps, &venc, &parse, &h264caps, &aqueue, &audio_gate, &mux, &sink])?;
        gst::Element::link_many([&queue, &scale, &vrate, &conv, &i420, &conv2, &enc_caps, &venc, &parse, &h264caps])?;
        h264caps.link(&mux)?;
        aqueue.link(&audio_gate)?;
        audio_gate.link(&mux)?;
        mux.link(&sink)?;

        // Relógio de teste: depois da geometria final, antes do encoder.
        if let Some(pad) = i420.static_pad("src") {
            let (w, h) = (profile.width, profile.height);
            pad.add_probe(gst::PadProbeType::BUFFER, move |_, info| {
                if !TEST_CLOCK.load(Ordering::Relaxed) {
                    return gst::PadProbeReturn::Ok;
                }
                if let Some(gst::PadProbeData::Buffer(buffer)) = info.data.as_mut() {
                    let buffer = buffer.make_mut();
                    if let Ok(mut map) = buffer.map_writable() {
                        stamp_i420(map.as_mut_slice(), w, h, wall_clock_ms());
                    }
                }
                gst::PadProbeReturn::Ok
            });
        }

        // O áudio só entra depois do primeiro quadro codificado: assim a
        // primeira PMT já tem as duas trilhas sem o muxer precisar esperar
        // meio segundo por elas (o que virava meio segundo de atraso).
        if let Some(pad) = h264caps.static_pad("src") {
            let gate = audio_gate.clone();
            pad.add_probe(gst::PadProbeType::BUFFER, move |_, _| {
                gate.set_property("drop", false);
                gst::PadProbeReturn::Remove
            });
        }

        let delivered = Arc::new(AtomicU64::new(0));
        if let Some(pad) = sink.static_pad("sink") {
            let counter = Arc::clone(&delivered);
            pad.add_probe(gst::PadProbeType::BUFFER | gst::PadProbeType::BUFFER_LIST, move |_, info| {
                let count = match &info.data {
                    Some(gst::PadProbeData::BufferList(list)) => list.len() as u64,
                    _ => 1,
                };
                counter.fetch_add(count, Ordering::Relaxed);
                gst::PadProbeReturn::Ok
            });
        }

        let video_ghost = gst::GhostPad::with_target(&queue.static_pad("sink").ok_or_else(|| anyhow!("fila sem pad"))?)?;
        video_ghost.set_property("name", "video");
        let audio_ghost = gst::GhostPad::with_target(&aqueue.static_pad("sink").ok_or_else(|| anyhow!("fila sem pad"))?)?;
        audio_ghost.set_property("name", "audio");
        bin.add_pad(&video_ghost)?;
        bin.add_pad(&audio_ghost)?;
        crate::fencing::guard_pipeline(&bin)?;

        pipeline.add(&bin)?;
        // PLAYING antes de ligar: ligar um ramo parado faria o tee receber
        // FLUSHING desse pad e parar os níveis que estão no ar.
        if let Err(error) = bin.sync_state_with_parent() {
            let _ = bin.set_state(gst::State::Null);
            let _ = pipeline.remove(&bin);
            return Err(anyhow!("o ramo {} não entrou em execução: {error}", tier.name()));
        }
        let video_pad = vtee.request_pad_simple("src_%u").ok_or_else(|| anyhow!("tee de vídeo recusou o nível"))?;
        let audio_pad = atee.request_pad_simple("src_%u").ok_or_else(|| anyhow!("tee de áudio recusou o nível"))?;
        video_pad.link(&video_ghost)?;
        audio_pad.link(&audio_ghost)?;

        let load_milli = if hardware { 0 } else { (profile.mpx_per_second() * 1000.0) as u64 };
        if hardware {
            MONITOR_HW_SESSIONS.fetch_add(1, Ordering::AcqRel);
        } else {
            SOFTWARE_LOAD_MILLI.fetch_add(load_milli, Ordering::AcqRel);
        }
        eprintln!(
            "[monitor] {} {} em {}x{} {}/{} {} kbps com {encoder}{}",
            self.spec.video_channel,
            tier.name(),
            profile.width,
            profile.height,
            profile.fps_n,
            profile.fps_d,
            profile.bitrate_kbps,
            degraded.as_deref().map(|d| format!(" ({d})")).unwrap_or_default()
        );
        let state = self.tiers.get_mut(&tier).expect("nível existe");
        state.degraded = degraded;
        state.last_encoder = Some(encoder.clone());
        state.last_profile = Some(profile);
        state.branch = Some(Branch { bin, video_pad, audio_pad, delivered, encoder, profile, hardware, load_milli, opened_at: Instant::now() });
        Ok(())
    }

    fn fall_tier(&mut self, tier: MonitorTier, reason: String) {
        let was_hardware = self.tiers.get(&tier).and_then(|s| s.branch.as_ref()).is_some_and(|b| b.hardware);
        self.drop_branch(tier);
        let state = self.tiers.get_mut(&tier).expect("nível existe");
        if !state.wanted {
            return;
        }
        state.health = Health::Retrying;
        state.error = Some(crate::output::short_error(&reason));
        if was_hardware {
            // Troca a quente: a placa falhou, o mesmo nível volta já em x264.
            state.hardware_failed = true;
            state.hardware_failure = Some(crate::output::short_error(&reason));
            state.retry_at = Some(Instant::now());
            eprintln!("[monitor] {} {}: placa falhou ({reason}); trocando para x264", self.spec.video_channel, tier.name());
            return;
        }
        let wait = Duration::from_secs(1 << state.attempts.min(4)).min(RETRY_CAP);
        state.retry_at = Some(Instant::now() + wait);
    }

    fn fall_shared(&mut self, reason: String) {
        self.close();
        self.shared_error = Some(crate::output::short_error(&reason));
        self.shared_attempts += 1;
        let wait = Duration::from_secs(1 << self.shared_attempts.min(4)).min(RETRY_CAP);
        self.shared_retry_at = Some(Instant::now() + wait);
        for state in self.tiers.values_mut() {
            if state.wanted {
                state.health = Health::Retrying;
                state.error = self.shared_error.clone();
                state.retry_at = self.shared_retry_at;
            }
        }
    }

    /// Qual nível contém este elemento, se algum, e se o ramo é o atual.
    ///
    /// `Some(None)`: o elemento é de um ramo retirado (geração antiga) -- o
    /// erro dele não pode derrubar o ramo novo do mesmo nível.
    fn tier_of(&self, object: &gst::Object) -> Option<Option<MonitorTier>> {
        let mut current = Some(object.clone());
        while let Some(item) = current {
            let name = item.name();
            if name.starts_with("tier-") {
                for (tier, state) in &self.tiers {
                    if state.branch.as_ref().is_some_and(|b| b.bin.name() == name) {
                        return Some(Some(*tier));
                    }
                }
                return Some(None);
            }
            current = item.parent();
        }
        None
    }

    /// Uma volta: colhe erro, abre o que foi pedido, devolve se mudou algo.
    pub fn service(&mut self) -> bool {
        let before = self.fingerprint();
        self.dispose_retired();

        // O programa pediu a placa de volta.
        let revoke = MONITOR_HW_REVOKE.load(Ordering::Acquire);
        if revoke != self.revoke_seen {
            self.revoke_seen = revoke;
            for tier in MonitorTier::ALL {
                let hw = self.tiers.get(&tier).and_then(|s| s.branch.as_ref()).is_some_and(|b| b.hardware);
                if hw {
                    let state = self.tiers.get_mut(&tier).expect("nível existe");
                    state.hardware_failed = true;
                    state.degraded = Some("placa devolvida ao programa".into());
                    state.retry_at = Some(Instant::now());
                    self.drop_branch(tier);
                }
            }
        }

        if let Some(bus) = self.bus.clone() {
            while let Some(message) = bus.pop() {
                match message.view() {
                    gst::MessageView::Error(error) => {
                        let text = format!("{} ({})", error.error(), error.debug().unwrap_or_else(|| "sem detalhe".into()));
                        match message.src().and_then(|src| self.tier_of(src)) {
                            Some(Some(tier)) => self.fall_tier(tier, text),
                            Some(None) => eprintln!("[monitor] {}: erro de ramo retirado ignorado: {}", self.spec.video_channel, crate::output::short_error(&text)),
                            None => {
                                self.fall_shared(text);
                                break;
                            }
                        }
                    }
                    gst::MessageView::Eos(_) => {
                        match message.src().and_then(|src| self.tier_of(src)) {
                            Some(Some(tier)) => self.fall_tier(tier, "o destino encerrou o fluxo".into()),
                            Some(None) => {}
                            None => {
                                self.fall_shared("o destino encerrou o fluxo".into());
                                break;
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        // Entrega confirmada.
        for state in self.tiers.values_mut() {
            if state.health == Health::Connecting && state.branch.as_ref().is_some_and(|b| b.delivered.load(Ordering::Relaxed) > 0) {
                state.health = Health::OnAir;
                state.error = None;
                state.attempts = 0;
            }
        }

        let now = Instant::now();
        let due: Vec<MonitorTier> = self
            .tiers
            .iter()
            .filter(|(_, s)| s.wanted && s.branch.is_none() && s.retry_at.is_some_and(|at| now >= at))
            .map(|(t, _)| *t)
            .collect();
        if !due.is_empty() && self.pipeline.is_none() {
            if self.shared_retry_at.is_some_and(|at| now < at) {
                return before != self.fingerprint();
            }
            if let Err(error) = self.open_shared() {
                self.fall_shared(error.to_string());
                return before != self.fingerprint();
            }
            self.shared_retry_at = None;
            self.shared_error = None;
        }
        // REF primeiro: é ele quem fica com a placa quando ela é disputada.
        for tier in due {
            {
                let state = self.tiers.get_mut(&tier).expect("nível existe");
                state.retry_at = None;
                state.attempts += 1;
            }
            match self.open_branch(tier) {
                Ok(()) => {
                    let state = self.tiers.get_mut(&tier).expect("nível existe");
                    state.health = Health::Connecting;
                    state.error = None;
                }
                Err(error) => self.fall_tier(tier, error.to_string()),
            }
        }
        if self.pipeline.is_some() && self.shared_attempts > 0 && self.tiers.values().any(|s| s.health == Health::OnAir) {
            self.shared_attempts = 0;
        }
        before != self.fingerprint()
    }

    fn fingerprint(&self) -> Vec<(Health, Option<String>, Option<String>)> {
        self.tiers
            .values()
            .map(|s| (s.health, s.branch.as_ref().map(|b| b.encoder.clone()), s.degraded.clone()))
            .collect()
    }

    /// Saúde do monitor como um todo, para quem não conhece níveis.
    pub fn health(&self) -> Health {
        let wanted: Vec<&TierState> = self.tiers.values().filter(|s| s.wanted).collect();
        if wanted.is_empty() {
            Health::Idle
        } else if wanted.iter().any(|s| s.health == Health::OnAir) {
            Health::OnAir
        } else if wanted.iter().any(|s| s.health == Health::Connecting) {
            Health::Connecting
        } else {
            Health::Retrying
        }
    }

    pub fn delivered(&self) -> u64 {
        self.tiers.values().filter_map(|s| s.branch.as_ref()).map(|b| b.delivered.load(Ordering::Relaxed)).sum()
    }

    pub fn error(&self) -> Option<String> {
        self.shared_error.clone().or_else(|| self.tiers.values().find_map(|s| if s.wanted { s.error.clone() } else { None }))
    }

    pub fn tier_reports(&self) -> Vec<TierReport> {
        self.tiers
            .iter()
            .filter(|(_, s)| s.wanted || s.branch.is_some())
            .map(|(tier, s)| {
                let profile = s.branch.as_ref().map(|b| b.profile).or(s.last_profile);
                TierReport {
                    tier: *tier,
                    health: s.health,
                    encoder: s.branch.as_ref().map(|b| b.encoder.clone()).or_else(|| s.last_encoder.clone()),
                    hardware: s.branch.as_ref().is_some_and(|b| b.hardware),
                    profile,
                    delivered: s.branch.as_ref().map(|b| b.delivered.load(Ordering::Relaxed)).unwrap_or(0),
                    uptime_ms: s.branch.as_ref().map(|b| b.opened_at.elapsed().as_millis() as u64).unwrap_or(0),
                    degraded: s.degraded.clone(),
                    error: s.error.clone(),
                    hardware_failed: s.hardware_failure.clone(),
                }
            })
            .collect()
    }
}

#[cfg(test)]
impl MonitorBus {
    /// O elemento codificador do ramo aberto de um nível (para simular falha).
    pub fn branch_encoder(&self, tier: MonitorTier) -> Option<gst::Element> {
        let branch = self.tiers.get(&tier)?.branch.as_ref()?;
        branch.bin.iterate_recurse().into_iter().flatten().find(|element| {
            element.factory().is_some_and(|factory| factory.name() == branch.encoder.as_str())
        })
    }
}

impl Drop for MonitorBus {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(w: i32, h: i32, n: i32, d: i32, fn_: i32, fd: i32) -> MonitorSource {
        MonitorSource { width: w, height: h, fps_n: n, fps_d: d, frame_n: fn_, frame_d: fd, bitrate_ceiling_kbps: MAX_KBPS, mosaic: false }
    }

    #[test]
    fn referencia_segue_o_canal_ate_1080_e_cadencia_cheia() {
        let p = tier_profile(MonitorTier::Ref, &src(1920, 1080, 50, 1, 50, 1), true);
        assert_eq!((p.width, p.height, p.fps_n, p.fps_d), (1920, 1080, 50, 1));
        assert_eq!(p.bitrate_kbps, 8000);
        let p = tier_profile(MonitorTier::Ref, &src(1920, 1080, 25, 1, 25, 1), true);
        assert_eq!(p.bitrate_kbps, 4147);
        let uhd = tier_profile(MonitorTier::Ref, &src(3840, 2160, 50, 1, 50, 1), true);
        assert_eq!((uhd.width, uhd.height), (1920, 1080));
        let p = tier_profile(MonitorTier::Ref, &src(1280, 720, 60000, 1001, 60000, 1001), true);
        assert_eq!((p.width, p.height, p.fps_n, p.fps_d), (1280, 720, 60000, 1001));
        assert!((4000..=8000).contains(&p.bitrate_kbps));
    }

    #[test]
    fn entrelacado_usa_campo_so_quando_permitido() {
        let i = src(1920, 1080, 50, 1, 25, 1);
        assert_eq!(tier_profile(MonitorTier::Ref, &i, true).fps_n, 50);
        assert_eq!(tier_profile(MonitorTier::Ref, &i, false).fps_n, 25);
        let ntsc = src(1920, 1080, 60000, 1001, 30000, 1001);
        assert_eq!(tier_profile(MonitorTier::Ref, &ntsc, true).fps_n, 60000);
        let lite = tier_profile(MonitorTier::Lite, &i, true);
        assert_eq!((lite.fps_n, lite.fps_d), (25, 1), "leve é sempre de quadro");
    }

    #[test]
    fn padrao_e_leve() {
        let p = tier_profile(MonitorTier::Std, &src(1920, 1080, 25, 1, 25, 1), true);
        assert_eq!((p.width, p.height), (1280, 720));
        assert!((1500..=3000).contains(&p.bitrate_kbps));
        let p = tier_profile(MonitorTier::Std, &src(1920, 1080, 50, 1, 50, 1), true);
        assert_eq!((p.width, p.height, p.fps_n), (960, 540, 50));
        let l = tier_profile(MonitorTier::Lite, &src(1920, 1080, 50, 1, 50, 1), true);
        assert_eq!((l.width, l.height, l.fps_n, l.fps_d), (428, 240, 50, 2));
        assert!((180..=450).contains(&l.bitrate_kbps));
        let sd = tier_profile(MonitorTier::Std, &src(720, 480, 60000, 1001, 30000, 1001), true);
        assert_eq!((sd.width, sd.height), (720, 480), "nunca aumenta");
    }

    #[test]
    fn teto_do_perfil_limita_e_nunca_passa_de_8_mbps() {
        let mut s = src(1920, 1080, 50, 1, 50, 1);
        s.bitrate_ceiling_kbps = 50_000;
        assert_eq!(tier_profile(MonitorTier::Ref, &s, true).bitrate_kbps, 8000);
        s.bitrate_ceiling_kbps = 2500;
        assert_eq!(tier_profile(MonitorTier::Ref, &s, true).bitrate_kbps, 2500);
        assert_eq!(tier_profile(MonitorTier::Lite, &s, true).bitrate_kbps, 308);
    }

    #[test]
    fn software_desce_um_degrau_por_vez_e_placa_nao_entra_na_conta() {
        let s = src(1920, 1080, 50, 1, 25, 1);
        let (p, why) = resolve_profile(MonitorTier::Ref, &s, true, 1000.0, 10.0);
        assert_eq!((p.height, p.fps_n, why), (1080, 50, None));
        let (p, why) = resolve_profile(MonitorTier::Ref, &s, false, 0.0, 200.0);
        assert_eq!((p.height, p.fps_n, why), (1080, 50, None));
        let (p, why) = resolve_profile(MonitorTier::Ref, &s, false, 0.0, 60.0);
        assert_eq!((p.height, p.fps_n), (1080, 25));
        assert!(why.unwrap().contains("quadro"));
        let (p, why) = resolve_profile(MonitorTier::Ref, &s, false, 20.0, 60.0);
        assert_eq!((p.height, p.fps_n), (540, 50));
        assert!(why.unwrap().contains("PADRÃO"));
        let (p, why) = resolve_profile(MonitorTier::Std, &s, false, 59.0, 60.0);
        assert_eq!(p.height, 240);
        assert!(why.is_some());
        let (p, why) = resolve_profile(MonitorTier::Lite, &s, false, 1e9, 0.0);
        assert_eq!((p.height, why), (240, None), "leve sempre cabe");
    }

    #[test]
    fn endereco_de_cada_nivel() {
        let url = "srt://127.0.0.1:8890?streamid=publish:canal-1/mon";
        assert_eq!(tier_url(url, MonitorTier::Lite), url);
        assert_eq!(tier_url(url, MonitorTier::Ref), "srt://127.0.0.1:8890?streamid=publish:canal-1/mon-ref");
        assert_eq!(
            tier_url("srt://h:1?streamid=publish:a/pvw&latency=20", MonitorTier::Std),
            "srt://h:1?streamid=publish:a/pvw-std&latency=20"
        );
        assert_eq!(tier_url("rtmp://h/a/mon", MonitorTier::Std), "rtmp://h/a/mon-std");
    }

    #[test]
    fn relogio_ida_e_volta() {
        for (w, h) in [(428, 240), (1280, 720), (1920, 1080), (960, 540)] {
            let y_stride = ((w + 3) & !3) as usize;
            let c_stride = ((((w + 1) / 2) + 3) & !3) as usize;
            let size = y_stride * h as usize + 2 * c_stride * (h as usize / 2);
            let mut frame = vec![100u8; size];
            let ms = 0x2AB_CDEF_1234u64 & ((1 << CLOCK_BITS) - 1);
            stamp_i420(&mut frame, w, h, ms);
            assert_eq!(read_luma(&frame, y_stride, w, h), Some(ms), "{w}x{h}");
            assert!(frame[y_stride * h as usize..].iter().take(4).all(|v| *v == 128));
        }
        let blank = vec![100u8; 428 * 240 * 2];
        assert_eq!(read_luma(&blank, 428, 428, 240), None);
    }
}
