//! Official OMT runtime loading and discovery shared by engine and device probe.
use anyhow::{anyhow, Context, Result};
use libloading::Library;
use std::ffi::{c_char, CStr};
use std::path::PathBuf;
use std::time::Duration;
use std::sync::OnceLock;

// The Native AOT runtime owns discovery/logging background threads. Unloading
// its module when a single input closes can crash those threads. Retain one
// successful load for the lifetime of this process (failed loads can retry).
struct Runtime { omt: Library, _vmx: Library }
static RUNTIME: OnceLock<Runtime> = OnceLock::new();

pub fn runtime_path() -> PathBuf {
    if let Some(path) = std::env::var("RPLAYOUT_OMT_RUNTIME").ok().filter(|path| !path.trim().is_empty()) {
        return PathBuf::from(path);
    }
    std::env::current_exe().ok()
        .and_then(|path| path.parent().map(|parent| parent.join("libomt.dll")))
        .unwrap_or_else(|| PathBuf::from("libomt.dll"))
}

pub fn load_runtime() -> Result<&'static Library> {
    if !cfg!(windows) { return Err(anyhow!("OMT nativo está disponível neste pacote apenas para Windows x64")); }
    let path = runtime_path();
    if let Some(runtime) = RUNTIME.get() { return Ok(&runtime.omt); }
    let vmx_path = path.with_file_name("libvmx.dll");
    // Native AOT P/Invoke searches by module name rather than the parent of
    // libomt. Preload the sibling explicitly, including for runtime overrides.
    let vmx = unsafe { Library::new(&vmx_path) }.with_context(|| format!("não foi possível carregar o codec OMT {}", vmx_path.display()))?;
    let omt = unsafe { Library::new(&path) }.with_context(|| format!("não foi possível carregar o runtime OMT {}", path.display()))?;
    let _ = RUNTIME.set(Runtime { omt, _vmx: vmx });
    Ok(&RUNTIME.get().expect("runtime OMT inicializado").omt)
}

#[allow(dead_code)] // Shared module; production discovery is in rplayout-devices.
pub fn discover() -> Result<Vec<String>> {
    type GetAddresses = unsafe extern "C" fn(*mut i32) -> *const *const c_char;
    let library = load_runtime()?;
    let get = unsafe { *library.get::<GetAddresses>(b"omt_discovery_getaddresses\0")? };
    let mut names = Vec::new();
    for _ in 0..6 {
        let mut count = 0;
        let addresses = unsafe { get(&mut count) };
        if !addresses.is_null() && (1..=4096).contains(&count) {
            for index in 0..count as usize {
                let address = unsafe { *addresses.add(index) };
                if !address.is_null() {
                    let name = unsafe { CStr::from_ptr(address) }.to_string_lossy().into_owned();
                    if !name.is_empty() && !names.contains(&name) { names.push(name); }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Ok(names)
}
