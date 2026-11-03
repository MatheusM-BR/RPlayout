//! Testes de referência dos scopes.
//!
//! Tolerâncias (documentadas também em docs/SCOPES.md):
//! - Conversão: a nossa matriz quantizada para 8 bits bate com a do ffmpeg
//!   (swscale) em ±1 código em todas as barras EBU 75%/100% (BT.709 e BT.2020).
//! - Vectorscope: o centro de cada barra cai no alvo calculado pela matriz com
//!   fase ≤ 0,5° e ganho ≤ 1,5% (1 código de croma = 0,45% da excursão).
//! - Waveform: nível de cada barra ±0,5% (meio código de luma = 0,23%).
//! - Parade/diamante: barras dentro do gamut (R103 sem nenhuma amostra fora).
//! - Paridade: o resultado de cada quadro de referência é congelado em
//!   `fixtures/golden.txt` (hash FNV-1a de cada buffer + estatísticas). O
//!   teste do WASM (vitest) cobra o mesmo arquivo; nativo == golden == WASM.

use super::*;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

pub fn rle_decode(data: &[u8]) -> Vec<u8> {
    assert_eq!(&data[0..4], b"RLE1", "fixture sem cabeçalho RLE1");
    let size = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
    let mut out = Vec::with_capacity(size);
    let mut i = 8;
    while i < data.len() {
        let value = data[i];
        i += 1;
        let (mut count, mut shift) = (0usize, 0);
        loop {
            let byte = data[i];
            i += 1;
            count |= ((byte & 0x7f) as usize) << shift;
            shift += 7;
            if byte & 0x80 == 0 { break; }
        }
        out.resize(out.len() + count, value);
    }
    assert_eq!(out.len(), size);
    out
}

fn fixture(name: &str) -> Vec<u8> {
    let path = fixtures_dir().join(format!("{name}.ycc.rle"));
    rle_decode(&std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display())))
}

const FIXTURES: [&str; 4] = ["smpte-hd-75", "ebu-75", "ebu-100", "ebu-75-bt2020"];

fn polar(cb: f32, cr: f32) -> (f32, f32) {
    let angle = cr.atan2(cb).to_degrees();
    ((angle + 360.0) % 360.0, (cb * cb + cr * cr).sqrt() * 2.0)
}

fn angle_diff(a: f32, b: f32) -> f32 {
    ((a - b + 540.0) % 360.0 - 180.0).abs()
}

/// Amostra do centro da barra `index` (de `count`) na linha do meio.
fn bar_center(bytes: &[u8], index: usize, count: usize, row: usize) -> (Ycc, Matrix) {
    let (header, frame) = parse_ycc(bytes).unwrap();
    let x = (index * 2 + 1) * header.width as usize / (count * 2);
    let i = row * header.width as usize + x;
    let Pixels::Ycc8 { y, cb, cr, range, matrix } = frame.pixels else { unreachable!() };
    (ycc_from_codes(y[i] as u16, cb[i] as u16, cr[i] as u16, 8, range), matrix)
}

#[test]
fn bt709_and_bt2020_round_trip() {
    for matrix in [Matrix::Bt709, Matrix::Bt2020] {
        let k = Coefficients::new(matrix);
        for rgb in [Rgb { r: 1.0, g: 0.5, b: 0.0 }, Rgb { r: 0.1, g: 0.9, b: 0.4 }, Rgb { r: 0.0, g: 0.0, b: 1.0 }] {
            let back = k.rgb(k.ycc(rgb));
            assert!((back.r - rgb.r).abs() < 1e-5 && (back.g - rgb.g).abs() < 1e-5 && (back.b - rgb.b).abs() < 1e-5, "{matrix:?} {rgb:?} → {back:?}");
        }
        // Branco tem Y'=1 e croma nula em qualquer matriz.
        let white = k.ycc(Rgb { r: 1.0, g: 1.0, b: 1.0 });
        assert!((white.y - 1.0).abs() < 1e-6 && white.cb.abs() < 1e-6 && white.cr.abs() < 1e-6);
    }
}

#[test]
fn code_ranges_map_to_nominal_levels() {
    let black = ycc_from_codes(16, 128, 128, 8, Range::Limited);
    let white = ycc_from_codes(235, 240, 16, 8, Range::Limited);
    assert_eq!((black.y, black.cb, black.cr), (0.0, 0.0, 0.0));
    assert_eq!((white.y, white.cb, white.cr), (1.0, 0.5, -0.5));
    let below = ycc_from_codes(0, 128, 128, 8, Range::Limited).y * 100.0;
    let above = ycc_from_codes(255, 128, 128, 8, Range::Limited).y * 100.0;
    assert!((below + 7.306).abs() < 0.01 && (above - 109.132).abs() < 0.01, "{below} {above}");
    // 10 bits: 64 → 0, 940 → 1.
    assert_eq!(ycc_from_codes(64, 512, 512, 10, Range::Limited).y, 0.0);
    assert_eq!(ycc_from_codes(940, 512, 512, 10, Range::Limited).y, 1.0);
    // Faixa cheia: 0 → 0, 255 → 1.
    assert_eq!(ycc_from_codes(255, 128, 128, 8, Range::Full).y, 1.0);
    assert_eq!(codes8_from_ycc(Ycc { y: 1.0, cb: 0.0, cr: 0.0 }, Range::Full), [255, 128, 128]);
}

#[test]
fn our_quantization_matches_ffmpeg_bars_within_one_code() {
    for (name, level, matrix) in [("ebu-75", 0.75, Matrix::Bt709), ("ebu-100", 1.0, Matrix::Bt709), ("ebu-75-bt2020", 0.75, Matrix::Bt2020)] {
        let bytes = fixture(name);
        let k = Coefficients::new(matrix);
        let bars = [[1.0, 1.0, 1.0], [level, level, 0.0], [0.0, level, level], [0.0, level, 0.0], [level, 0.0, level], [level, 0.0, 0.0], [0.0, 0.0, level], [0.0, 0.0, 0.0]];
        for (index, [r, g, b]) in bars.into_iter().enumerate() {
            // O ffmpeg recebe R'G'B' de 8 bits: arredonde igual.
            let q = |v: f32| (v * 255.0 + 0.5).floor() / 255.0;
            let ours = codes8_from_ycc(k.ycc(Rgb { r: q(r), g: q(g), b: q(b) }), Range::Limited);
            let (_, frame) = parse_ycc(&bytes).unwrap();
            let x = (index * 2 + 1) * 1920 / 16;
            let i = 540 * 1920 + x;
            let Pixels::Ycc8 { y, cb, cr, .. } = frame.pixels else { unreachable!() };
            let theirs = [y[i], cb[i], cr[i]];
            for c in 0..3 {
                assert!((ours[c] as i32 - theirs[c] as i32).abs() <= 1, "{name} barra {index}: nosso {ours:?} × ffmpeg {theirs:?}");
            }
        }
    }
}

#[test]
fn bars_land_on_vector_targets() {
    // EBU: W, Yl, Cy, G, Mg, R, B, Bk. SMPTE RP 219 (linha de cima, 7 barras de
    // 1/12 + bordas): o teste mede só as EBU, que têm geometria simples.
    for (name, level, matrix) in [("ebu-75", 0.75, Matrix::Bt709), ("ebu-100", 1.0, Matrix::Bt709), ("ebu-75-bt2020", 0.75, Matrix::Bt2020)] {
        let bytes = fixture(name);
        let targets = vector_targets(matrix, level);
        for (bar, target) in targets.iter().enumerate() {
            let (p, frame_matrix) = bar_center(&bytes, bar + 1, 8, 540);
            assert_eq!(frame_matrix, matrix);
            let (angle, magnitude) = polar(p.cb, p.cr);
            let (target_angle, target_magnitude) = polar(target.cb, target.cr);
            let phase = angle_diff(angle, target_angle);
            let gain = (magnitude / target_magnitude - 1.0).abs();
            assert!(phase <= 0.5, "{name} {}: fase {phase:.3}°", target.name);
            assert!(gain <= 0.015, "{name} {}: ganho {:.3}%", target.name, gain * 100.0);
        }
    }
}

#[test]
fn smpte_hd_bars_hit_rp219_75_percent_targets() {
    // RP 219, linha de cima: cinza 40% (1/8 da largura... a primeira coluna
    // d/2), depois 7 barras de 75% com largura 3/4·d/7·... — medimos pelos
    // códigos esperados da norma, procurando cada barra na linha 100.
    let bytes = fixture("smpte-hd-75");
    let (header, frame) = parse_ycc(&bytes).unwrap();
    let Pixels::Ycc8 { y, cb, cr, .. } = frame.pixels else { unreachable!() };
    let row = 100 * header.width as usize;
    let codes: Vec<[u8; 3]> = (0..header.width as usize).map(|x| [y[row + x], cb[row + x], cr[row + x]]).collect();
    // Códigos SMPTE RP 219-1 (8 bits) das barras de 75%.
    for (name, expected) in [("Yl", [168, 44, 136]), ("Cy", [145, 147, 44]), ("G", [133, 63, 52]), ("Mg", [63, 193, 204]), ("R", [51, 109, 212]), ("B", [28, 212, 120])] {
        assert!(codes.iter().any(|c| c.iter().zip(expected.iter()).all(|(a, b)| (*a as i32 - *b as i32).abs() <= 1)), "barra {name} {expected:?} não encontrada");
    }
}

#[test]
fn waveform_levels_and_histogram_totals() {
    let bytes = fixture("ebu-75");
    let (_, frame) = parse_ycc(&bytes).unwrap();
    let mut scopes = Scopes::new(Config::default());
    scopes.accumulate(&frame).unwrap();
    let c = scopes.config;
    let pixels = 1920u64 * 1080;
    assert_eq!(scopes.stats.count, pixels);
    for channel in 0..6 {
        let total: u64 = scopes.hist[channel * c.hist_bins as usize..(channel + 1) * c.hist_bins as usize].iter().map(|v| *v as u64).sum();
        assert_eq!(total, pixels, "histograma {}", CHANNELS[channel]);
        let plane = (c.wave_rows * c.wave_columns) as usize;
        let wave: u64 = scopes.wave[channel * plane..(channel + 1) * plane].iter().map(|v| *v as u64).sum();
        assert_eq!(wave, pixels, "waveform {}", CHANNELS[channel]);
    }
    // Luma de cada barra: o waveform tem a coluna do meio da barra no nível certo.
    let k = Coefficients::new(Matrix::Bt709);
    let levels = [[1.0, 1.0, 1.0], [0.75, 0.75, 0.0], [0.0, 0.75, 0.75], [0.0, 0.75, 0.0], [0.75, 0.0, 0.75], [0.75, 0.0, 0.0], [0.0, 0.0, 0.75], [0.0, 0.0, 0.0]];
    for (bar, [r, g, b]) in levels.into_iter().enumerate() {
        let expected = k.ycc(Rgb { r, g, b }).y * 100.0;
        let column = ((bar * 2 + 1) * c.wave_columns as usize) / 16;
        let hits: Vec<usize> = (0..c.wave_rows as usize).filter(|row| scopes.wave[row * c.wave_columns as usize + column] > 0).collect();
        assert_eq!(hits.len(), 1, "barra {bar}: a coluna deve ter um único nível");
        let step = (c.level_max - c.level_min) / (c.wave_rows - 1) as f32;
        let measured = c.level_max - hits[0] as f32 * step;
        assert!((measured - expected).abs() <= step * 0.5 + 0.5, "barra {bar}: {measured:.2}% × {expected:.2}%");
    }
    assert!(scopes.stats.gamut_r103 == 0 && scopes.stats.luma_r103 == 0 && scopes.stats.chroma_illegal == 0);
    assert!(!scopes.stats.luma_illegal() && !scopes.stats.gamut_illegal());
}

#[test]
fn bars_stay_inside_the_diamond() {
    for name in ["ebu-75", "ebu-100"] {
        let bytes = fixture(name);
        let (_, frame) = parse_ycc(&bytes).unwrap();
        let mut scopes = Scopes::new(Config::default());
        scopes.accumulate(&frame).unwrap();
        // Quantização de 8 bits põe o primário 100% até ~0,6% fora; R103 tolera 5%.
        assert_eq!(scopes.stats.gamut_r103, 0, "{name}");
        assert!(scopes.stats.rgb_min > -1.0 && scopes.stats.rgb_max < 101.0, "{name}: {:?}", scopes.stats);
        let total: u64 = scopes.diamond.iter().map(|v| *v as u64).sum();
        assert_eq!(total, 2 * 1920 * 1080);
    }
}

fn synthetic(width: usize, height: usize, f: impl Fn(usize, usize) -> [u8; 3]) -> Vec<u8> {
    let mut out = ycc_header(YccHeader { width: width as u16, height: height as u16, matrix: Matrix::Bt709, range: Range::Limited }).to_vec();
    let count = width * height;
    out.resize(16 + 3 * count, 0);
    for row in 0..height {
        for x in 0..width {
            let [y, cb, cr] = f(x, row);
            let i = row * width + x;
            out[16 + i] = y;
            out[16 + count + i] = cb;
            out[16 + 2 * count + i] = cr;
        }
    }
    out
}

#[test]
fn ramp_exposes_sub_black_and_super_white() {
    let bytes = synthetic(256, 4, |x, _| [x as u8, 128, 128]);
    let (_, frame) = parse_ycc(&bytes).unwrap();
    let mut scopes = Scopes::new(Config { wave_columns: 256, ..Config::default() });
    scopes.accumulate(&frame).unwrap();
    let s = scopes.stats;
    assert!((s.luma_min + 7.306).abs() < 0.01 && (s.luma_max - 109.132).abs() < 0.01);
    assert_eq!(s.below_black, 16 * 4);
    assert_eq!(s.above_white, 20 * 4);
    // R103: abaixo de −1% são os códigos 0..13; acima de 103% os códigos 242..255.
    assert_eq!(s.luma_r103, (14 + 14) * 4);
    assert!(s.luma_illegal());
    assert_eq!(s.chroma_illegal, 0);
    assert_eq!(s.chroma_max, 0.0);
    // Rampa linear: o waveform é uma diagonal -- uma linha por coluna.
    let c = scopes.config;
    for column in 0..c.wave_columns as usize {
        let rows = (0..c.wave_rows as usize).filter(|row| scopes.wave[row * c.wave_columns as usize + column] > 0).count();
        assert!(rows >= 1 && rows <= 2, "coluna {column}: {rows}");
    }
}

#[test]
fn flats_and_illegal_chroma() {
    for (code, level) in [(16u8, 0.0f32), (235, 100.0), (126, 50.228)] {
        let bytes = synthetic(64, 64, |_, _| [code, 128, 128]);
        let (_, frame) = parse_ycc(&bytes).unwrap();
        let mut scopes = Scopes::new(Config::default());
        scopes.accumulate(&frame).unwrap();
        assert!((scopes.stats.luma_min - level).abs() < 0.01 && (scopes.stats.luma_max - level).abs() < 0.01, "{code}");
        assert_eq!(scopes.stats.below_black + scopes.stats.above_white, 0);
        // Chapado neutro: todo o vectorscope num ponto, no centro.
        let lit: Vec<usize> = scopes.vector.iter().enumerate().filter(|(_, v)| **v > 0).map(|(i, _)| i).collect();
        let size = scopes.config.vector_size as usize;
        let center = ((size - 1) as f32 * 0.5 + 0.5).floor() as usize;
        assert_eq!(lit, vec![center * size + center]);
    }
    let bytes = synthetic(10, 10, |x, _| [126, if x < 5 { 250 } else { 128 }, 128]);
    let (_, frame) = parse_ycc(&bytes).unwrap();
    let mut scopes = Scopes::new(Config::default());
    scopes.accumulate(&frame).unwrap();
    assert_eq!(scopes.stats.chroma_illegal, 50);
    assert!(scopes.stats.gamut_r103 >= 50);
}

#[test]
fn rgba_path_reconverts_with_the_matrix() {
    // Barras 75% em RGBA faixa cheia, como o canvas entrega.
    let width = 8usize;
    let colors = [[255, 255, 255], [191, 191, 0], [0, 191, 191], [0, 191, 0], [191, 0, 191], [191, 0, 0], [0, 0, 191], [0, 0, 0]];
    let mut rgba = Vec::new();
    for c in colors.iter() { rgba.extend_from_slice(&[c[0], c[1], c[2], 255]); }
    let mut scopes = Scopes::new(Config::default());
    scopes.accumulate(&Frame { width: width as u32, height: 1, pixels: Pixels::Rgba8 { data: &rgba, matrix: Matrix::Bt709 } }).unwrap();
    for target in vector_targets(Matrix::Bt709, 191.0 / 255.0) {
        let (vx, vy) = vector_cell(target.cb, target.cr, 256, VECTOR_FULL_SCALE).unwrap();
        assert!(scopes.vector[(vy * 256 + vx) as usize] > 0, "{}", target.name);
    }
    assert!((scopes.stats.luma_max - 100.0).abs() < 0.01);
    assert_eq!(scopes.stats.above_white, 0, "RGB 255 não pode virar super-white por arredondamento");
}

#[test]
fn roi_limits_the_measurement() {
    let bytes = fixture("ebu-75");
    let (_, frame) = parse_ycc(&bytes).unwrap();
    let mut scopes = Scopes::new(Config { roi: [0.0, 0.0, 0.125, 1.0], ..Config::default() });
    scopes.accumulate(&frame).unwrap();
    // Só a barra branca: tudo em 100%, croma nula.
    assert!((scopes.stats.luma_min - 100.0).abs() < 0.01 && scopes.stats.chroma_max < 0.01);
    assert_eq!(scopes.stats.count, 240 * 1080);
}

#[test]
fn zoom_changes_scale_not_counts() {
    let bytes = fixture("ebu-75");
    let (_, frame) = parse_ycc(&bytes).unwrap();
    let mut scopes = Scopes::new(Config { level_min: 90.0, level_max: 110.0, vector_scale: 0.65, ..Config::default() });
    scopes.accumulate(&frame).unwrap();
    let plane = (scopes.config.wave_rows * scopes.config.wave_columns) as usize;
    let total: u64 = scopes.wave[..plane].iter().map(|v| *v as u64).sum();
    assert_eq!(total, 1920 * 1080);
}

#[test]
fn false_color_bands() {
    let k = Coefficients::new(Matrix::Bt709);
    let grey = |y: f32| { let p = Ycc { y, cb: 0.0, cr: 0.0 }; false_color(p, k.rgb(p), FalseColor::Exposure) };
    assert_eq!(grey(-0.05), [148, 0, 211, 255]);
    assert_eq!(grey(0.01), [0, 70, 255, 255]);
    assert_eq!(grey(0.41), [40, 200, 64, 255]);
    assert_eq!(grey(0.55), [255, 120, 170, 255]);
    assert_eq!(grey(0.98), [255, 230, 0, 255]);
    assert_eq!(grey(1.05), [255, 0, 0, 255]);
    let mid = grey(0.2);
    assert_eq!(mid[0], mid[1]);
    let p = Ycc { y: 0.5, cb: 0.5, cr: 0.0 };
    assert_eq!(false_color(p, k.rgb(p), FalseColor::Gamut), [255, 0, 255, 255]);
}

/// Resultado canônico de um quadro: hashes dos buffers + estatísticas.
pub fn golden_line(name: &str, scopes: &Scopes) -> String {
    let stats = scopes.stats.to_array().iter().map(|v| format!("{v}")).collect::<Vec<_>>().join(",");
    format!(
        "{name} wave={:016x} vector={:016x} hist={:016x} diamond={:016x} stats={stats}",
        fnv1a_u32(&scopes.wave),
        fnv1a_u32(&scopes.vector),
        fnv1a_u32(&scopes.hist),
        fnv1a_u32(&scopes.diamond)
    )
}

/// Configurações cobertas pelo golden (a mesma lista está no teste do WASM).
pub fn golden_configs() -> Vec<(&'static str, Config)> {
    vec![
        ("padrao", Config::default()),
        ("zoom-roi", Config { wave_columns: 333, wave_rows: 129, level_min: 60.0, level_max: 104.0, vector_size: 181, vector_scale: 0.65, hist_bins: 100, diamond_size: 77, roi: [0.1, 0.2, 0.7, 0.9], channels: CH_Y | CH_R | CH_B }),
    ]
}

#[test]
fn golden_parity_file() {
    let mut lines = Vec::new();
    for name in FIXTURES {
        let bytes = fixture(name);
        let (_, frame) = parse_ycc(&bytes).unwrap();
        for (label, config) in golden_configs() {
            let mut scopes = Scopes::new(config);
            scopes.accumulate(&frame).unwrap();
            lines.push(golden_line(&format!("{name}/{label}"), &scopes));
        }
        let mut colors = vec![0u8; 1920 * 1080 * 4];
        false_color_frame(&frame, FalseColor::Exposure, &mut colors).unwrap();
        lines.push(format!("{name}/falsa-cor fnv={:016x}", fnv1a_u32(&colors.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect::<Vec<_>>())));
    }
    let text = lines.join("\n") + "\n";
    let path = fixtures_dir().join("golden.txt");
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, &text).unwrap();
    }
    let committed = std::fs::read_to_string(&path).expect("fixtures/golden.txt ausente; rode com UPDATE_GOLDEN=1");
    assert_eq!(committed.replace("\r\n", "\n"), text, "o resultado mudou; se foi de propósito, UPDATE_GOLDEN=1 e documente");
}

#[test]
fn ffi_matches_direct_calls() {
    use crate::ffi::*;
    let bytes = fixture("ebu-100");
    unsafe {
        let s = rs_scopes_new();
        assert_eq!(rs_scopes_configure(s, 480, 256, CH_ALL, LEVEL_MIN, LEVEL_MAX, 256, VECTOR_FULL_SCALE, 256, 128, 0.0, 0.0, 1.0, 1.0), 0);
        assert_eq!(rs_scopes_run_ycc(s, bytes.as_ptr(), bytes.len()), 0);
        let (_, frame) = parse_ycc(&bytes).unwrap();
        let mut direct = Scopes::new(Config::default());
        direct.accumulate(&frame).unwrap();
        assert_eq!(golden_line("x", &*s), golden_line("x", &direct));
        assert_eq!(rs_scopes_frame_size(s), 1920 | (1080 << 16));
        assert_eq!(rs_scopes_run_ycc(s, bytes.as_ptr(), 10), -3);
        rs_scopes_free(s);
    }
}
