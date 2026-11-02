//! Official OMT runtime loading and discovery shared by engine and device probe.
use anyhow::{anyhow, Context, Result};
use libloading::Library;
use std::ffi::{c_char, CStr};
use std::path::PathBuf;
use std::time::Duration;
use std::sync::{OnceLock,Mutex};

// The Native AOT runtime owns discovery/logging background threads. Unloading
// its module when a single input closes can crash those threads. Retain one
// successful load for the lifetime of this process (failed loads can retry).
struct Runtime { omt: Library, _vmx: Library }
static RUNTIME: OnceLock<Runtime> = OnceLock::new();
static INITIALIZATION:Mutex<()>=Mutex::new(());
// libomt returns shared addresses valid only until the NEXT native query.
// Hold this through copying the strings, not merely through the FFI call.
static DISCOVERY:Mutex<()>=Mutex::new(());
type GetAddresses = unsafe extern "C" fn(*mut i32) -> *const *const c_char;

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
    let _initialization=INITIALIZATION.lock().map_err(|_|anyhow!("inicialização OMT indisponível"))?;
    if let Some(runtime) = RUNTIME.get() { return Ok(&runtime.omt); }
    let vmx_path = path.with_file_name("libvmx.dll");
    // Native AOT P/Invoke searches by module name rather than the parent of
    // libomt. Preload the sibling explicitly, including for runtime overrides.
    let vmx = unsafe { Library::new(&vmx_path) }.with_context(|| format!("não foi possível carregar o codec OMT {}", vmx_path.display()))?;
    let omt = unsafe { Library::new(&path) }.with_context(|| format!("não foi possível carregar o runtime OMT {}", path.display()))?;
    // Official libomt.h: null disables the runtime's per-process file logger.
    // Configure before discovery/send/receive starts background work. Do not
    // redirect OMT_STORAGE_PATH: it also changes discovery settings, which
    // would silently replace the operator's existing DiscoveryServer config.
    // RPlayout keeps its own lifecycle/pipeline diagnostics; no admin ACL or
    // write to ProgramData is needed for this native logging policy.
    type SetLoggingFilename=unsafe extern "C" fn(*const c_char);
    let configure_logging=unsafe{*omt.get::<SetLoggingFilename>(b"omt_setloggingfilename\0")
        .context("runtime OMT incompatível: configuração oficial de logging indisponível")?};
    unsafe{configure_logging(std::ptr::null());}
    // Initialize the official discovery wrapper before send/receive handles
    // register asynchronous callbacks. This does not substitute discovery:
    // later queries must still return and prove the advertised source.
    let _discovery=DISCOVERY.lock().map_err(|_|anyhow!("descoberta OMT indisponível"))?;
    let get=unsafe{*omt.get::<GetAddresses>(b"omt_discovery_getaddresses\0")?};
    let mut count=0;
    #[cfg(test)]eprintln!("OMT runtime: initial discovery begin");
    let addresses=unsafe{get(&mut count)};
    #[cfg(test)]eprintln!("OMT runtime: initial discovery returned count={count}");
    if !(0..=4096).contains(&count)||count>0&&addresses.is_null(){return Err(anyhow!("runtime OMT retornou descoberta inicial inválida"));}
    let _ = RUNTIME.set(Runtime { omt, _vmx: vmx });
    Ok(&RUNTIME.get().expect("runtime OMT inicializado").omt)
}

#[allow(dead_code)] // Shared module; production discovery is in rplayout-devices.
pub fn discover() -> Result<Vec<String>> {
    let library = load_runtime()?;
    let get = unsafe { *library.get::<GetAddresses>(b"omt_discovery_getaddresses\0")? };
    let mut names = Vec::new();
    for attempt in 0..6 {
        let discovery=DISCOVERY.lock().map_err(|_|anyhow!("descoberta OMT indisponível"))?;
        let mut count = 0;
        #[cfg(test)]eprintln!("OMT discovery query {attempt}: begin");
        let addresses = unsafe { get(&mut count) };
        #[cfg(test)]eprintln!("OMT discovery query {attempt}: returned count={count}");
        #[cfg(not(test))]let _=attempt;
        if !(0..=4096).contains(&count)||count>0&&addresses.is_null(){return Err(anyhow!("runtime OMT retornou inventário inválido"));}
        if !addresses.is_null() && (1..=4096).contains(&count) {
            for index in 0..count as usize {
                let address = unsafe { *addresses.add(index) };
                if !address.is_null() {
                    let name = unsafe { CStr::from_ptr(address) }.to_string_lossy().into_owned();
                    if !name.is_empty() && !names.contains(&name) { names.push(name); }
                }
            }
        }
        drop(discovery);
        std::thread::sleep(Duration::from_millis(200));
    }
    Ok(names)
}
