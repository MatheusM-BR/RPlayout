//! Exportações cruas para o WASM (`extern "C"` + memória linear).
//!
//! Sem wasm-bindgen de propósito: o contrato é pequeno, o carregador TS
//! (`apps/web/src/scopes/wasm.ts`) tem 150 linhas e não há ferramenta extra
//! para instalar no Windows de build. Toda função devolve código (0 = ok,
//! negativo = erro) ou ponteiro; o JS lê os resultados por `Uint32Array`/
//! `Float64Array` sobre `memory.buffer` **depois** de cada chamada (a memória
//! pode crescer e trocar o `ArrayBuffer`).
//!
//! Só existe no alvo wasm32 (e nos testes): o engine nativo não exporta nada.
#![cfg(any(target_arch = "wasm32", test))]

use crate::{false_color_frame, parse_ycc, Config, FalseColor, Frame, Matrix, Pixels, Scopes};

/// Versão do contrato. O loader recusa um `.wasm` de outra versão.
pub const ABI_VERSION: u32 = 1;

#[no_mangle]
pub extern "C" fn rs_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn rs_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len.max(1));
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// # Safety
/// `ptr`/`len` devem vir de [`rs_alloc`] com o mesmo `len`.
#[no_mangle]
pub unsafe extern "C" fn rs_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
    }
}

#[no_mangle]
pub extern "C" fn rs_scopes_new() -> *mut Scopes {
    Box::into_raw(Box::new(Scopes::new(Config::default())))
}

/// # Safety
/// `scopes` deve vir de [`rs_scopes_new`].
#[no_mangle]
pub unsafe extern "C" fn rs_scopes_free(scopes: *mut Scopes) {
    if !scopes.is_null() {
        drop(Box::from_raw(scopes));
    }
}

/// # Safety
/// `scopes` deve vir de [`rs_scopes_new`].
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn rs_scopes_configure(
    scopes: *mut Scopes,
    wave_columns: u32,
    wave_rows: u32,
    channels: u32,
    level_min: f32,
    level_max: f32,
    vector_size: u32,
    vector_scale: f32,
    hist_bins: u32,
    diamond_size: u32,
    roi_x0: f32,
    roi_y0: f32,
    roi_x1: f32,
    roi_y1: f32,
) -> i32 {
    let Some(scopes) = scopes.as_mut() else { return -1 };
    let config = Config {
        wave_columns,
        wave_rows,
        channels,
        level_min,
        level_max,
        vector_size,
        vector_scale,
        hist_bins,
        diamond_size,
        roi: [roi_x0, roi_y0, roi_x1, roi_y1],
    };
    if config.sanitized() != scopes.config {
        scopes.configure(config);
    }
    0
}

/// Acumula um `.ycc` inteiro (cabeçalho + planos).
///
/// # Safety
/// `bytes` aponta para `len` bytes válidos na memória do WASM.
#[no_mangle]
pub unsafe extern "C" fn rs_scopes_run_ycc(scopes: *mut Scopes, bytes: *const u8, len: usize) -> i32 {
    let Some(scopes) = scopes.as_mut() else { return -1 };
    if bytes.is_null() { return -2; }
    let data = std::slice::from_raw_parts(bytes, len);
    match parse_ycc(data) {
        Ok((_, frame)) => match scopes.accumulate(&frame) { Ok(()) => 0, Err(_) => -4 },
        Err(_) => -3,
    }
}

/// Acumula RGBA de 8 bits (faixa cheia) reconvertendo pela matriz (H.273).
///
/// # Safety
/// `rgba` aponta para `width·height·4` bytes válidos.
#[no_mangle]
pub unsafe extern "C" fn rs_scopes_run_rgba(scopes: *mut Scopes, rgba: *const u8, width: u32, height: u32, matrix: u32) -> i32 {
    let Some(scopes) = scopes.as_mut() else { return -1 };
    let Some(matrix) = Matrix::from_code(matrix as u8) else { return -5 };
    if rgba.is_null() { return -2; }
    let data = std::slice::from_raw_parts(rgba, width as usize * height as usize * 4);
    match scopes.accumulate(&Frame { width, height, pixels: Pixels::Rgba8 { data, matrix } }) { Ok(()) => 0, Err(_) => -4 }
}

/// # Safety
/// `scopes` deve vir de [`rs_scopes_new`].
#[no_mangle]
pub unsafe extern "C" fn rs_scopes_wave(scopes: *const Scopes) -> *const u32 {
    scopes.as_ref().map_or(std::ptr::null(), |s| s.wave.as_ptr())
}
/// # Safety
/// `scopes` deve vir de [`rs_scopes_new`].
#[no_mangle]
pub unsafe extern "C" fn rs_scopes_vector(scopes: *const Scopes) -> *const u32 {
    scopes.as_ref().map_or(std::ptr::null(), |s| s.vector.as_ptr())
}
/// # Safety
/// `scopes` deve vir de [`rs_scopes_new`].
#[no_mangle]
pub unsafe extern "C" fn rs_scopes_hist(scopes: *const Scopes) -> *const u32 {
    scopes.as_ref().map_or(std::ptr::null(), |s| s.hist.as_ptr())
}
/// # Safety
/// `scopes` deve vir de [`rs_scopes_new`].
#[no_mangle]
pub unsafe extern "C" fn rs_scopes_diamond(scopes: *const Scopes) -> *const u32 {
    scopes.as_ref().map_or(std::ptr::null(), |s| s.diamond.as_ptr())
}

/// Estatísticas no layout de [`crate::Stats::to_array`] (16 × f64), num
/// buffer estático lido logo depois da chamada.
///
/// # Safety
/// `scopes` deve vir de [`rs_scopes_new`].
#[no_mangle]
pub unsafe extern "C" fn rs_scopes_stats(scopes: *const Scopes) -> *const f64 {
    static mut OUT: [f64; 16] = [0.0; 16];
    let Some(scopes) = scopes.as_ref() else { return std::ptr::null() };
    let out = &raw mut OUT;
    (*out) = scopes.stats.to_array();
    (*out).as_ptr()
}

/// Largura/altura do último quadro acumulado (u32 empacotado: w | h<<16).
///
/// # Safety
/// `scopes` deve vir de [`rs_scopes_new`].
#[no_mangle]
pub unsafe extern "C" fn rs_scopes_frame_size(scopes: *const Scopes) -> u32 {
    scopes.as_ref().map_or(0, |s| (s.frame_width & 0xffff) | (s.frame_height << 16))
}

/// Falsa cor de um `.ycc` em `out` (largura·altura·4 bytes).
///
/// # Safety
/// `bytes`/`out` apontam para buffers válidos dos tamanhos indicados.
#[no_mangle]
pub unsafe extern "C" fn rs_false_color_ycc(bytes: *const u8, len: usize, mode: u32, out: *mut u8, out_len: usize) -> i32 {
    if bytes.is_null() || out.is_null() { return -2; }
    let data = std::slice::from_raw_parts(bytes, len);
    let output = std::slice::from_raw_parts_mut(out, out_len);
    let mode = if mode == 1 { FalseColor::Gamut } else { FalseColor::Exposure };
    match parse_ycc(data) {
        Ok((_, frame)) => match false_color_frame(&frame, mode, output) { Ok(()) => 0, Err(_) => -4 },
        Err(_) => -3,
    }
}

/// Falsa cor de RGBA de 8 bits.
///
/// # Safety
/// `rgba`/`out` apontam para `width·height·4` bytes válidos.
#[no_mangle]
pub unsafe extern "C" fn rs_false_color_rgba(rgba: *const u8, width: u32, height: u32, matrix: u32, mode: u32, out: *mut u8) -> i32 {
    if rgba.is_null() || out.is_null() { return -2; }
    let Some(matrix) = Matrix::from_code(matrix as u8) else { return -5 };
    let count = width as usize * height as usize * 4;
    let data = std::slice::from_raw_parts(rgba, count);
    let output = std::slice::from_raw_parts_mut(out, count);
    let mode = if mode == 1 { FalseColor::Gamut } else { FalseColor::Exposure };
    match false_color_frame(&Frame { width, height, pixels: Pixels::Rgba8 { data, matrix } }, mode, output) { Ok(()) => 0, Err(_) => -4 }
}
