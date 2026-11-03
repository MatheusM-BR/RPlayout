//! Matemática única dos scopes do RPlayout.
//!
//! Este crate é a **única** implementação dos scopes: o `rplayout-probe` o usa
//! em código nativo e a interface o usa compilado para `wasm32-unknown-unknown`
//! (ver [`ffi`]). Antes a mesma conta existia em Rust e em TypeScript e podia
//! divergir; agora o número que o servidor mede e o número que o QC desenha
//! saem da mesma função.
//!
//! Não depende do GStreamer nem de nada fora da `std`, para compilar igual nos
//! dois alvos. Toda a conta por pixel é em `f32` sem FMA nem funções
//! transcendentais: o resultado nativo e o WASM são idênticos bit a bit (o
//! teste de paridade cobra isso).
//!
//! # Convenções (as mesmas do QC desde a r80)
//! - Y' normalizado: 0 = preto nominal, 1 = branco nominal. Em 8 bits faixa
//!   limitada, código 16 → 0 e 235 → 1; código 0 → −7,31% e 255 → +109,13%.
//! - Cb/Cr normalizados em −0,5..+0,5 (códigos 16..240, 128 no centro).
//! - R'G'B' normalizados: 0..1 é o gamut legal; fora disso é ilegal.
//! - Nível em %: 0% = preto, 100% = branco (SMPTE RP 219); 700 mV = 100%.
//! - Vectorscope: magnitude 1 = |Cb,Cr| de 0,5; +Cb para a direita, +Cr para
//!   cima (convenção dos vectorscopes de componente).

pub mod ffi;

/// Matriz Y'CbCr, numerada como na ITU-T H.273 (`matrix_coefficients`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Matrix {
    /// ITU-R BT.709 (Kr 0,2126, Kb 0,0722).
    Bt709 = 1,
    /// ITU-R BT.2020/2100 luminância não constante (Kr 0,2627, Kb 0,0593).
    Bt2020 = 9,
}

impl Matrix {
    pub fn from_code(code: u8) -> Option<Matrix> {
        match code {
            1 => Some(Matrix::Bt709),
            9 => Some(Matrix::Bt2020),
            _ => None,
        }
    }
    /// (Kr, Kb) da matriz.
    pub fn kr_kb(self) -> (f32, f32) {
        match self {
            Matrix::Bt709 => (0.2126, 0.0722),
            Matrix::Bt2020 => (0.2627, 0.0593),
        }
    }
}

/// Faixa de quantização dos códigos.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Range {
    /// "TV"/narrow: Y' 16–235, C 16–240 (×4 em 10 bits).
    Limited = 0,
    /// "PC"/full: Y' 0–255, C 0–255 com 128 no centro.
    Full = 1,
}

impl Range {
    pub fn from_code(code: u8) -> Option<Range> {
        match code {
            0 => Some(Range::Limited),
            1 => Some(Range::Full),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ycc {
    pub y: f32,
    pub cb: f32,
    pub cr: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rgb {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

/// Coeficientes de conversão já em `f32`, calculados uma vez por matriz.
///
/// A ordem das operações aqui é a mesma dos shaders (WGSL/GLSL) para que a
/// diferença entre CPU e GPU fique só no arredondamento do próprio hardware.
#[derive(Clone, Copy, Debug)]
pub struct Coefficients {
    pub kr: f32,
    pub kg: f32,
    pub kb: f32,
    /// 2(1−Kr): Cr → R'−Y'.
    pub cr_to_r: f32,
    /// 2(1−Kb): Cb → B'−Y'.
    pub cb_to_b: f32,
}

impl Coefficients {
    pub fn new(matrix: Matrix) -> Coefficients {
        let (kr, kb) = matrix.kr_kb();
        let kg = 1.0 - kr - kb;
        Coefficients { kr, kg, kb, cr_to_r: 2.0 * (1.0 - kr), cb_to_b: 2.0 * (1.0 - kb) }
    }

    /// Y'CbCr normalizado → R'G'B' normalizado, **sem recortar**: o gamut
    /// fora de 0..1 é exatamente o que os avisos e o diamante precisam ver.
    #[inline]
    pub fn rgb(&self, p: Ycc) -> Rgb {
        let r = p.y + self.cr_to_r * p.cr;
        let b = p.y + self.cb_to_b * p.cb;
        let g = (p.y - self.kr * r - self.kb * b) / self.kg;
        Rgb { r, g, b }
    }

    /// R'G'B' normalizado → Y'CbCr normalizado.
    #[inline]
    pub fn ycc(&self, c: Rgb) -> Ycc {
        let y = self.kr * c.r + self.kg * c.g + self.kb * c.b;
        Ycc { y, cb: (c.b - y) / self.cb_to_b, cr: (c.r - y) / self.cr_to_r }
    }
}

/// Código inteiro → valor normalizado, para qualquer profundidade (8–16 bits).
pub fn ycc_from_codes(y: u16, cb: u16, cr: u16, bits: u8, range: Range) -> Ycc {
    let scale = (1u32 << (bits.clamp(8, 16) - 8)) as f32;
    match range {
        Range::Limited => Ycc {
            y: (y as f32 - 16.0 * scale) / (219.0 * scale),
            cb: (cb as f32 - 128.0 * scale) / (224.0 * scale),
            cr: (cr as f32 - 128.0 * scale) / (224.0 * scale),
        },
        Range::Full => {
            let max = ((1u32 << bits.clamp(8, 16)) - 1) as f32;
            Ycc { y: y as f32 / max, cb: (cb as f32 - 128.0 * scale) / max, cr: (cr as f32 - 128.0 * scale) / max }
        }
    }
}

/// Valor normalizado → códigos de 8 bits, como um codificador faria.
pub fn codes8_from_ycc(p: Ycc, range: Range) -> [u8; 3] {
    let q = |v: f32| (v + 0.5).floor().clamp(0.0, 255.0) as u8;
    match range {
        Range::Limited => [q(16.0 + 219.0 * p.y), q(128.0 + 224.0 * p.cb), q(128.0 + 224.0 * p.cr)],
        Range::Full => [q(255.0 * p.y), q(128.0 + 255.0 * p.cb), q(128.0 + 255.0 * p.cr)],
    }
}

/// Canais do waveform/parade/histograma, na ordem dos buffers.
pub const CHANNELS: [&str; 6] = ["Y", "Cb", "Cr", "R", "G", "B"];
pub const CH_Y: u32 = 1;
pub const CH_CB: u32 = 2;
pub const CH_CR: u32 = 4;
pub const CH_R: u32 = 8;
pub const CH_G: u32 = 16;
pub const CH_B: u32 = 32;
pub const CH_ALL: u32 = 63;

/// Faixa vertical padrão do waveform: inclui código 0 (−7,3%) e 255 (109,1%).
pub const LEVEL_MIN: f32 = -8.0;
pub const LEVEL_MAX: f32 = 110.0;
/// Magnitude máxima visível do vectorscope sem zoom (magenta 100% = 1,19).
pub const VECTOR_FULL_SCALE: f32 = 1.3;
/// Meia largura do diamante: B'−G' (ou R'−G') vai de −1 a 1; a margem mostra o ilegal.
pub const DIAMOND_EXTENT: f32 = 1.25;

/// EBU R103: luma −1%..103%; R'G'B' −5%..105% com até 1% da área tolerada.
pub const R103_LUMA_MIN: f32 = -1.0;
pub const R103_LUMA_MAX: f32 = 103.0;
pub const R103_RGB_MIN: f32 = -5.0;
pub const R103_RGB_MAX: f32 = 105.0;
pub const R103_AREA: f64 = 0.01;
/// Folga para "abaixo de 0% / acima de 100%": meio código de 8 bits é 0,23%;
/// 0,05% evita contar o arredondamento de RGB 255 → Y' 1,0000001 como super-white.
pub const LEVEL_EPSILON: f32 = 0.05;
/// Croma ilegal: |Cb| ou |Cr| além de 0,5 (código fora de 16–240), com a mesma folga.
pub const CHROMA_EPSILON: f32 = 0.0005;

/// Parâmetros de acumulação. Os mesmos campos (e a mesma conta) estão nos
/// shaders de `apps/web/src/scopes`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Config {
    pub wave_columns: u32,
    pub wave_rows: u32,
    /// Máscara de canais acumulados (`CH_*`). Canal fora da máscara fica zerado.
    pub channels: u32,
    /// Faixa vertical (em %) do waveform e do histograma. Zoom = faixa menor.
    pub level_min: f32,
    pub level_max: f32,
    pub vector_size: u32,
    /// Magnitude no raio do vectorscope (1,3 sem zoom; 0,65 = zoom 2×).
    pub vector_scale: f32,
    pub hist_bins: u32,
    /// Diamante: `diamond_size` colunas × `2·diamond_size` linhas (duas metades).
    pub diamond_size: u32,
    /// Região de interesse normalizada (x0, y0, x1, y1). A lupa usa isto.
    pub roi: [f32; 4],
}

impl Default for Config {
    fn default() -> Config {
        Config {
            wave_columns: 480,
            wave_rows: 256,
            channels: CH_ALL,
            level_min: LEVEL_MIN,
            level_max: LEVEL_MAX,
            vector_size: 256,
            vector_scale: VECTOR_FULL_SCALE,
            hist_bins: 256,
            diamond_size: 128,
            roi: [0.0, 0.0, 1.0, 1.0],
        }
    }
}

impl Config {
    /// Limites sãos: nada de buffer gigante nem divisão por zero vindo do JS.
    pub fn sanitized(mut self) -> Config {
        self.wave_columns = self.wave_columns.clamp(16, 4096);
        self.wave_rows = self.wave_rows.clamp(16, 2048);
        self.vector_size = self.vector_size.clamp(32, 1024);
        self.hist_bins = self.hist_bins.clamp(16, 4096);
        self.diamond_size = self.diamond_size.clamp(32, 1024);
        self.channels &= CH_ALL;
        if !(self.level_max - self.level_min > 0.5) || !self.level_min.is_finite() || !self.level_max.is_finite() {
            self.level_min = LEVEL_MIN;
            self.level_max = LEVEL_MAX;
        }
        if !(self.vector_scale > 0.01) || !self.vector_scale.is_finite() {
            self.vector_scale = VECTOR_FULL_SCALE;
        }
        let mut roi = self.roi.map(|v| if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 });
        if roi[2] <= roi[0] || roi[3] <= roi[1] {
            roi = [0.0, 0.0, 1.0, 1.0];
        }
        self.roi = roi;
        self
    }

    /// ROI em pixels inteiros (x0, y0, x1, y1), sempre com ao menos 1 pixel.
    pub fn roi_pixels(&self, width: u32, height: u32) -> [u32; 4] {
        let x0 = ((self.roi[0] * width as f32).floor() as u32).min(width.saturating_sub(1));
        let y0 = ((self.roi[1] * height as f32).floor() as u32).min(height.saturating_sub(1));
        let x1 = ((self.roi[2] * width as f32).ceil() as u32).clamp(x0 + 1, width.max(1));
        let y1 = ((self.roi[3] * height as f32).ceil() as u32).clamp(y0 + 1, height.max(1));
        [x0, y0, x1, y1]
    }
}

/// Linha (0 = topo) de um nível em %. `floor(v+0,5)` em vez de `round`, porque
/// o `round` do WGSL arredonda metade para par e o do Rust para longe do zero.
#[inline]
pub fn level_row(percent: f32, min: f32, max: f32, rows: u32) -> u32 {
    let scale = (rows - 1) as f32 / (max - min);
    let row = ((max - percent) * scale + 0.5).floor();
    row.clamp(0.0, (rows - 1) as f32) as u32
}

/// Faixa (bin) do histograma de um nível em %.
#[inline]
pub fn hist_bin(percent: f32, min: f32, max: f32, bins: u32) -> u32 {
    let bin = ((percent - min) / (max - min) * bins as f32).floor();
    bin.clamp(0.0, (bins - 1) as f32) as u32
}

/// Célula do vectorscope para (Cb, Cr), ou `None` fora da tela.
#[inline]
pub fn vector_cell(cb: f32, cr: f32, size: u32, scale: f32) -> Option<(u32, u32)> {
    let half = (size - 1) as f32 * 0.5;
    let radius = half / scale;
    let x = (half + cb * 2.0 * radius + 0.5).floor();
    let y = (half - cr * 2.0 * radius + 0.5).floor();
    if x < 0.0 || y < 0.0 || x >= size as f32 || y >= size as f32 {
        return None;
    }
    Some((x as u32, y as u32))
}

/// Células do diamante (Tektronix) para um R'G'B'.
///
/// Metade de cima: horizontal B'−G', vertical B'+G' (0 no centro, 2 no
/// topo). Metade de baixo: horizontal R'−G', vertical R'+G' para baixo.
/// Sinal dentro do gamut fica dentro dos dois losangos; a margem até
/// [`DIAMOND_EXTENT`] mostra quanto passou. Fora disso o ponto cola na borda.
#[inline]
pub fn diamond_cells(c: Rgb, size: u32) -> (u32, u32) {
    let last = (size - 1) as f32;
    let span = 2.0 * DIAMOND_EXTENT;
    let col = |d: f32| ((d + DIAMOND_EXTENT) / span * last + 0.5).floor().clamp(0.0, last) as u32;
    // Metade de cima: linha 0 = soma 2,5 (topo), linha size−1 = soma 0 (centro).
    let upper_row = ((span - (c.b + c.g)) / span * last + 0.5).floor().clamp(0.0, last) as u32;
    // Metade de baixo: linha size = soma 0 (centro), linha 2·size−1 = soma 2,5.
    let lower_row = size + ((c.r + c.g) / span * last + 0.5).floor().clamp(0.0, last) as u32;
    (upper_row * size + col(c.b - c.g), lower_row * size + col(c.r - c.g))
}

/// Medições numéricas do quadro (ou da ROI).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stats {
    pub count: u64,
    pub luma_min: f32,
    pub luma_max: f32,
    pub luma_sum: f64,
    /// Amostras abaixo de 0% / acima de 100% (com [`LEVEL_EPSILON`]).
    pub below_black: u64,
    pub above_white: u64,
    /// Amostras fora de EBU R103 para luma (−1%..103%).
    pub luma_r103: u64,
    pub rgb_min: f32,
    pub rgb_max: f32,
    /// Amostras com R', G' ou B' fora de −5%..105% (EBU R103).
    pub gamut_r103: u64,
    /// Amostras com R', G' ou B' fora de 0..100% (diamante, sem tolerância de área).
    pub gamut_strict: u64,
    /// Maior magnitude de croma (1 = |Cb,Cr| de 0,5).
    pub chroma_max: f32,
    /// Amostras com |Cb| ou |Cr| > 0,5 (código fora de 16–240).
    pub chroma_illegal: u64,
}

impl Default for Stats {
    fn default() -> Stats {
        Stats {
            count: 0,
            luma_min: f32::INFINITY,
            luma_max: f32::NEG_INFINITY,
            luma_sum: 0.0,
            below_black: 0,
            above_white: 0,
            luma_r103: 0,
            rgb_min: f32::INFINITY,
            rgb_max: f32::NEG_INFINITY,
            gamut_r103: 0,
            gamut_strict: 0,
            chroma_max: 0.0,
            chroma_illegal: 0,
        }
    }
}

impl Stats {
    pub fn luma_avg(&self) -> f64 {
        if self.count == 0 { 0.0 } else { self.luma_sum / self.count as f64 }
    }
    pub fn fraction(&self, value: u64) -> f64 {
        if self.count == 0 { 0.0 } else { value as f64 / self.count as f64 }
    }
    /// EBU R103 para luma: algum ponto fora de −1%..103%.
    pub fn luma_illegal(&self) -> bool {
        self.count > 0 && (self.luma_min < R103_LUMA_MIN || self.luma_max > R103_LUMA_MAX)
    }
    /// EBU R103 para gamut: mais de 1% da área com R'G'B' fora de −5%..105%.
    pub fn gamut_illegal(&self) -> bool {
        self.fraction(self.gamut_r103) > R103_AREA
    }

    /// Layout fixo de 16 `f64` exportado ao WASM (e documentado no loader TS).
    pub fn to_array(&self) -> [f64; 16] {
        let finite = |v: f32| if v.is_finite() { v as f64 } else { 0.0 };
        [
            self.count as f64,
            finite(self.luma_min),
            finite(self.luma_max),
            self.luma_avg(),
            self.below_black as f64,
            self.above_white as f64,
            self.luma_r103 as f64,
            finite(self.rgb_min),
            finite(self.rgb_max),
            self.gamut_r103 as f64,
            self.gamut_strict as f64,
            self.chroma_max as f64,
            self.chroma_illegal as f64,
            if self.luma_illegal() { 1.0 } else { 0.0 },
            if self.gamut_illegal() { 1.0 } else { 0.0 },
            if self.chroma_illegal > 0 { 1.0 } else { 0.0 },
        ]
    }

    /// JSON curto para o recibo da sonda (sem dependência de serde aqui).
    pub fn to_json(&self) -> String {
        let a = self.to_array();
        format!(
            "{{\"count\":{},\"lumaMin\":{:.4},\"lumaMax\":{:.4},\"lumaAvg\":{:.4},\"belowBlack\":{},\"aboveWhite\":{},\"lumaR103\":{},\"rgbMin\":{:.4},\"rgbMax\":{:.4},\"gamutR103\":{},\"gamutStrict\":{},\"chromaMax\":{:.5},\"chromaIllegal\":{}}}",
            a[0] as u64, a[1], a[2], a[3], a[4] as u64, a[5] as u64, a[6] as u64, a[7], a[8], a[9] as u64, a[10] as u64, a[11], a[12] as u64
        )
    }

    #[inline]
    fn add(&mut self, p: Ycc, c: Rgb) {
        let luma = p.y * 100.0;
        self.count += 1;
        if luma < self.luma_min { self.luma_min = luma; }
        if luma > self.luma_max { self.luma_max = luma; }
        self.luma_sum += luma as f64;
        if luma < -LEVEL_EPSILON { self.below_black += 1; }
        if luma > 100.0 + LEVEL_EPSILON { self.above_white += 1; }
        if luma < R103_LUMA_MIN || luma > R103_LUMA_MAX { self.luma_r103 += 1; }
        let low = c.r.min(c.g).min(c.b) * 100.0;
        let high = c.r.max(c.g).max(c.b) * 100.0;
        if low < self.rgb_min { self.rgb_min = low; }
        if high > self.rgb_max { self.rgb_max = high; }
        if low < R103_RGB_MIN || high > R103_RGB_MAX { self.gamut_r103 += 1; }
        if low < -LEVEL_EPSILON || high > 100.0 + LEVEL_EPSILON { self.gamut_strict += 1; }
        let magnitude = (p.cb * p.cb + p.cr * p.cr).sqrt() * 2.0;
        if magnitude > self.chroma_max { self.chroma_max = magnitude; }
        if p.cb.abs() > 0.5 + CHROMA_EPSILON || p.cr.abs() > 0.5 + CHROMA_EPSILON { self.chroma_illegal += 1; }
    }
}

/// Origem dos pixels.
pub enum Pixels<'a> {
    /// Planos Y', Cb, Cr completos (4:4:4) de 8 bits, como o `.ycc` da sonda.
    Ycc8 { y: &'a [u8], cb: &'a [u8], cr: &'a [u8], range: Range, matrix: Matrix },
    /// RGBA de 8 bits em faixa cheia (canvas do navegador). Reconvertido para
    /// Y'CbCr pela `matrix`: é o caminho INDICATIVO.
    Rgba8 { data: &'a [u8], matrix: Matrix },
}

pub struct Frame<'a> {
    pub width: u32,
    pub height: u32,
    pub pixels: Pixels<'a>,
}

impl<'a> Frame<'a> {
    pub fn validate(&self) -> Result<(), &'static str> {
        let count = self.width as usize * self.height as usize;
        if count == 0 { return Err("quadro vazio"); }
        match &self.pixels {
            Pixels::Ycc8 { y, cb, cr, .. } => {
                if y.len() < count || cb.len() < count || cr.len() < count { return Err("planos menores que o quadro"); }
            }
            Pixels::Rgba8 { data, .. } => {
                if data.len() < count * 4 { return Err("RGBA menor que o quadro"); }
            }
        }
        Ok(())
    }
}

/// Tabela código → valor normalizado para 8 bits (determinística e rápida).
struct Lut {
    y: [f32; 256],
    c: [f32; 256],
}

impl Lut {
    fn new(range: Range) -> Lut {
        let mut lut = Lut { y: [0.0; 256], c: [0.0; 256] };
        for code in 0..256u16 {
            let v = ycc_from_codes(code, code, code, 8, range);
            lut.y[code as usize] = v.y;
            lut.c[code as usize] = v.cb;
        }
        lut
    }
}

/// Acumuladores de todos os scopes de um quadro.
pub struct Scopes {
    pub config: Config,
    /// 6 canais × `wave_rows` × `wave_columns`, ordem [`CHANNELS`].
    pub wave: Vec<u32>,
    /// `vector_size`²: linha 0 = topo (+Cr).
    pub vector: Vec<u32>,
    /// 6 canais × `hist_bins`.
    pub hist: Vec<u32>,
    /// `diamond_size` × `2·diamond_size`.
    pub diamond: Vec<u32>,
    pub stats: Stats,
    /// Dimensões do último quadro (para o loader saber o tamanho da falsa cor).
    pub frame_width: u32,
    pub frame_height: u32,
}

impl Scopes {
    pub fn new(config: Config) -> Scopes {
        let mut scopes = Scopes {
            config: Config::default(),
            wave: Vec::new(),
            vector: Vec::new(),
            hist: Vec::new(),
            diamond: Vec::new(),
            stats: Stats::default(),
            frame_width: 0,
            frame_height: 0,
        };
        scopes.configure(config);
        scopes
    }

    pub fn configure(&mut self, config: Config) {
        let c = config.sanitized();
        self.config = c;
        self.wave = vec![0; 6 * (c.wave_rows * c.wave_columns) as usize];
        self.vector = vec![0; (c.vector_size * c.vector_size) as usize];
        self.hist = vec![0; 6 * c.hist_bins as usize];
        self.diamond = vec![0; (c.diamond_size * c.diamond_size * 2) as usize];
        self.stats = Stats::default();
    }

    fn clear(&mut self) {
        self.wave.iter_mut().for_each(|v| *v = 0);
        self.vector.iter_mut().for_each(|v| *v = 0);
        self.hist.iter_mut().for_each(|v| *v = 0);
        self.diamond.iter_mut().for_each(|v| *v = 0);
        self.stats = Stats::default();
    }

    /// Zera e acumula um quadro inteiro (ou a ROI).
    pub fn accumulate(&mut self, frame: &Frame) -> Result<(), &'static str> {
        frame.validate()?;
        self.clear();
        self.frame_width = frame.width;
        self.frame_height = frame.height;
        let c = self.config;
        let [x0, y0, x1, y1] = c.roi_pixels(frame.width, frame.height);
        let roi_width = x1 - x0;
        let width = frame.width as usize;
        match frame.pixels {
            Pixels::Ycc8 { y, cb, cr, range, matrix } => {
                let lut = Lut::new(range);
                let k = Coefficients::new(matrix);
                for row in y0..y1 {
                    let base = row as usize * width;
                    for x in x0..x1 {
                        let i = base + x as usize;
                        let p = Ycc { y: lut.y[y[i] as usize], cb: lut.c[cb[i] as usize], cr: lut.c[cr[i] as usize] };
                        let column = (x - x0) * c.wave_columns / roi_width;
                        self.add(column, p, k.rgb(p));
                    }
                }
            }
            Pixels::Rgba8 { data, matrix } => {
                let k = Coefficients::new(matrix);
                for row in y0..y1 {
                    let base = row as usize * width;
                    for x in x0..x1 {
                        let i = (base + x as usize) * 4;
                        let rgb = Rgb { r: data[i] as f32 / 255.0, g: data[i + 1] as f32 / 255.0, b: data[i + 2] as f32 / 255.0 };
                        let column = (x - x0) * c.wave_columns / roi_width;
                        self.add(column, k.ycc(rgb), rgb);
                    }
                }
            }
        }
        Ok(())
    }

    #[inline]
    fn add(&mut self, column: u32, p: Ycc, rgb: Rgb) {
        let c = self.config;
        let levels = [p.y * 100.0, (p.cb + 0.5) * 100.0, (p.cr + 0.5) * 100.0, rgb.r * 100.0, rgb.g * 100.0, rgb.b * 100.0];
        let plane = (c.wave_rows * c.wave_columns) as usize;
        for (channel, level) in levels.iter().enumerate() {
            if c.channels & (1 << channel) == 0 { continue; }
            let row = level_row(*level, c.level_min, c.level_max, c.wave_rows);
            self.wave[channel * plane + (row * c.wave_columns + column) as usize] += 1;
            let bin = hist_bin(*level, c.level_min, c.level_max, c.hist_bins);
            self.hist[channel * c.hist_bins as usize + bin as usize] += 1;
        }
        if let Some((vx, vy)) = vector_cell(p.cb, p.cr, c.vector_size, c.vector_scale) {
            self.vector[(vy * c.vector_size + vx) as usize] += 1;
        }
        let (upper, lower) = diamond_cells(rgb, c.diamond_size);
        self.diamond[upper as usize] += 1;
        self.diamond[lower as usize] += 1;
        self.stats.add(p, rgb);
    }
}

/// Modos de falsa cor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum FalseColor {
    /// Exposição por faixas de Y' (tabela [`EXPOSURE_BANDS`]).
    Exposure = 0,
    /// Gamut: o que viola EBU R103 (luma ou R'G'B') em vermelho/violeta, o resto em cinza.
    Gamut = 1,
}

/// Faixas de exposição da falsa cor: (limite superior em % exclusivo, RGBA).
/// O que não cai numa faixa colorida aparece em cinza com o próprio Y'.
///
/// | faixa (Y') | cor | leitura |
/// |---|---|---|
/// | < −1% | violeta | sub-black ilegal (R103) |
/// | −1..0% | roxo | abaixo do preto nominal |
/// | 0..2,5% | azul | preto esmagado |
/// | 38..44% | verde | cinza 18% (≈41% em BT.709) |
/// | 52..58% | rosa | pele clara, ~1 stop acima do cinza 18% |
/// | 97..100% | amarelo | perto do branco nominal |
/// | 100..103% | laranja | super-white tolerado (R103) |
/// | > 103% | vermelho | super-white ilegal (R103) |
pub const EXPOSURE_BANDS: [(f32, f32, [u8; 4]); 8] = [
    (f32::NEG_INFINITY, -1.0, [148, 0, 211, 255]),
    (-1.0, 0.0, [96, 32, 160, 255]),
    (0.0, 2.5, [0, 70, 255, 255]),
    (38.0, 44.0, [40, 200, 64, 255]),
    (52.0, 58.0, [255, 120, 170, 255]),
    (97.0, 100.0, [255, 230, 0, 255]),
    (100.0, 103.0, [255, 140, 0, 255]),
    (103.0, f32::INFINITY, [255, 0, 0, 255]),
];

/// Cor de um pixel na falsa cor.
#[inline]
pub fn false_color(p: Ycc, rgb: Rgb, mode: FalseColor) -> [u8; 4] {
    let luma = p.y * 100.0;
    let grey = |v: f32| {
        let g = ((v * 0.85).clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u8;
        [g, g, g, 255]
    };
    match mode {
        FalseColor::Exposure => {
            for (low, high, color) in EXPOSURE_BANDS.iter() {
                if luma >= *low && luma < *high { return *color; }
            }
            grey(p.y)
        }
        FalseColor::Gamut => {
            let low = rgb.r.min(rgb.g).min(rgb.b) * 100.0;
            let high = rgb.r.max(rgb.g).max(rgb.b) * 100.0;
            if luma < R103_LUMA_MIN || luma > R103_LUMA_MAX { return [255, 0, 0, 255]; }
            if low < R103_RGB_MIN || high > R103_RGB_MAX { return [255, 0, 255, 255]; }
            if low < -LEVEL_EPSILON || high > 100.0 + LEVEL_EPSILON { return [255, 200, 0, 255]; }
            grey(p.y * 0.6)
        }
    }
}

/// Falsa cor de um quadro inteiro em RGBA (`width·height·4` bytes).
pub fn false_color_frame(frame: &Frame, mode: FalseColor, out: &mut [u8]) -> Result<(), &'static str> {
    frame.validate()?;
    let count = frame.width as usize * frame.height as usize;
    if out.len() < count * 4 { return Err("saída menor que o quadro"); }
    match frame.pixels {
        Pixels::Ycc8 { y, cb, cr, range, matrix } => {
            let lut = Lut::new(range);
            let k = Coefficients::new(matrix);
            for i in 0..count {
                let p = Ycc { y: lut.y[y[i] as usize], cb: lut.c[cb[i] as usize], cr: lut.c[cr[i] as usize] };
                out[i * 4..i * 4 + 4].copy_from_slice(&false_color(p, k.rgb(p), mode));
            }
        }
        Pixels::Rgba8 { data, matrix } => {
            let k = Coefficients::new(matrix);
            for i in 0..count {
                let rgb = Rgb { r: data[i * 4] as f32 / 255.0, g: data[i * 4 + 1] as f32 / 255.0, b: data[i * 4 + 2] as f32 / 255.0 };
                out[i * 4..i * 4 + 4].copy_from_slice(&false_color(k.ycc(rgb), rgb, mode));
            }
        }
    }
    Ok(())
}

/// Alvo do vectorscope de uma barra (75% ou 100%).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VectorTarget {
    pub name: &'static str,
    pub cb: f32,
    pub cr: f32,
}

/// Alvos Yl, Cy, G, Mg, R, B no nível pedido, calculados pela matriz.
pub fn vector_targets(matrix: Matrix, level: f32) -> [VectorTarget; 6] {
    let k = Coefficients::new(matrix);
    let bars: [(&str, [f32; 3]); 6] = [
        ("Yl", [1.0, 1.0, 0.0]),
        ("Cy", [0.0, 1.0, 1.0]),
        ("G", [0.0, 1.0, 0.0]),
        ("Mg", [1.0, 0.0, 1.0]),
        ("R", [1.0, 0.0, 0.0]),
        ("B", [0.0, 0.0, 1.0]),
    ];
    bars.map(|(name, [r, g, b])| {
        let p = k.ycc(Rgb { r: r * level, g: g * level, b: b * level });
        VectorTarget { name, cb: p.cb, cr: p.cr }
    })
}

// --- Arquivo `.ycc` -------------------------------------------------------

/// Cabeçalho do `.ycc` (16 bytes): `RPYC`, versão 1, matriz (H.273: 1 = BT.709,
/// 9 = BT.2020), faixa (0 = limitada, 1 = cheia), bits (8), largura e altura
/// em u16 LE e 4 bytes reservados. Seguem os planos Y, Cb, Cr completos.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct YccHeader {
    pub width: u16,
    pub height: u16,
    pub matrix: Matrix,
    pub range: Range,
}

pub const YCC_HEADER_LEN: usize = 16;

pub fn ycc_header(h: YccHeader) -> [u8; YCC_HEADER_LEN] {
    let mut header = [0u8; YCC_HEADER_LEN];
    header[0..4].copy_from_slice(b"RPYC");
    header[4] = 1;
    header[5] = h.matrix as u8;
    header[6] = h.range as u8;
    header[7] = 8;
    header[8..10].copy_from_slice(&h.width.to_le_bytes());
    header[10..12].copy_from_slice(&h.height.to_le_bytes());
    header
}

/// Lê um `.ycc` e devolve o quadro pronto para [`Scopes::accumulate`].
pub fn parse_ycc(bytes: &[u8]) -> Result<(YccHeader, Frame<'_>), &'static str> {
    if bytes.len() < YCC_HEADER_LEN || &bytes[0..4] != b"RPYC" { return Err("não é um .ycc"); }
    if bytes[4] != 1 || bytes[7] != 8 { return Err("versão ou profundidade não suportada"); }
    let matrix = Matrix::from_code(bytes[5]).ok_or("matriz não suportada")?;
    let range = Range::from_code(bytes[6]).ok_or("faixa não suportada")?;
    let width = u16::from_le_bytes([bytes[8], bytes[9]]);
    let height = u16::from_le_bytes([bytes[10], bytes[11]]);
    let count = width as usize * height as usize;
    if count == 0 || bytes.len() < YCC_HEADER_LEN + 3 * count { return Err(".ycc truncado"); }
    let planes = &bytes[YCC_HEADER_LEN..];
    let header = YccHeader { width, height, matrix, range };
    Ok((header, Frame {
        width: width as u32,
        height: height as u32,
        pixels: Pixels::Ycc8 { y: &planes[..count], cb: &planes[count..2 * count], cr: &planes[2 * count..3 * count], range, matrix },
    }))
}

/// Hash FNV-1a de 64 bits de um buffer de contagens (testes de paridade).
pub fn fnv1a_u32(values: &[u32]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for v in values {
        for byte in v.to_le_bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}

#[cfg(test)]
mod tests;
