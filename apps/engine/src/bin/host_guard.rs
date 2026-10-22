//! Windows-wide distribution fence, independent of database/path/session.
//! The broker remains OUTSIDE the job into which it admits its actual parent.
//! Later descendants inherit the job. A lost parent pipe does not release the
//! mutex while descendants survive; a killed broker closes the job and prevents
//! its own family from becoming unguarded publishers. No foreign process kill,
//! guessed PID parent, TTL-based takeover or network service.

#[cfg(windows)]
#[path = "host_guard/windows.rs"]
mod windows_host_guard;

fn main() {
    #[cfg(windows)]
    if let Err(error) = windows_host_guard::run() {
        eprintln!("host guard refused: {error}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    {
        eprintln!("host guard requires Windows kernel job/mutex support; no resource was acquired");
        std::process::exit(1);
    }
}
