use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, FILETIME, HANDLE, INVALID_HANDLE_VALUE, WAIT_ABANDONED,
    WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob,
    JobObjectBasicAccountingInformation, JobObjectBasicProcessIdList,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_BASIC_PROCESS_ID_LIST,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    CreateMutexW, GetCurrentProcess, GetCurrentProcessId, GetProcessTimes, OpenProcess,
    ReleaseMutex, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA,
    PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};

#[path = "sockets.rs"]
mod sockets;

// Constant machine-wide namespace: do not derive it from user input, DB,
// installation folder, Windows session, hostname or account.
const MUTEX: &str = "Global\\RPlayout.Broadcast.Distribution.v1";
const JOB: &str = "Global\\RPlayout.Broadcast.ProcessFamily.v1";
const MAX_LINE: usize = 4096;

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
struct MutexOwner(Handle);
impl Drop for MutexOwner {
    fn drop(&mut self) {
        unsafe {
            ReleaseMutex(self.0 .0);
        }
    }
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}
fn last(context: &str) -> anyhow::Error {
    anyhow!("{context}: Windows error {}", unsafe { GetLastError() })
}
fn handle(value: HANDLE, context: &str) -> Result<Handle> {
    if value.is_null() || value == INVALID_HANDLE_VALUE {
        Err(last(context))
    } else {
        Ok(Handle(value))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u8,
    nonce: String,
    action: String,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    pid: Option<u32>,
    #[serde(default)]
    process_token: Option<String>,
}
fn parse(text: &str) -> Result<Request> {
    if text.len() > MAX_LINE {
        bail!("private request too large");
    }
    let request: Request = serde_json::from_str(text).context("invalid private request")?;
    if request.version != 1
        || request.nonce.len() != 64
        || !request.nonce.bytes().all(|byte| byte.is_ascii_hexdigit())
        || request
            .request_id
            .as_ref()
            .is_some_and(|id| id.len() > 64 || id.is_empty())
        || request.process_token.as_ref().is_some_and(|token| {
            token.is_empty()
                || token.len() > 64
                || !token
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        bail!("invalid private protocol binding");
    }
    Ok(request)
}
fn emit(value: Value) -> Result<()> {
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer(&mut output, &value)?;
    writeln!(output)?;
    output.flush()?;
    Ok(())
}
fn reply_or_drain(draining: &mut bool, value: Value) {
    // A lost reply pipe is not proof that already admitted publishers died.
    // Preserve the fence/family, stop admitting commands and await actual exit.
    if emit(value).is_err() {
        *draining = true;
    }
}

fn process_parent(me: u32) -> Result<u32> {
    let snapshot = handle(
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) },
        "process parent snapshot",
    )?;
    let mut row: PROCESSENTRY32W = unsafe { zeroed() };
    row.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut found = unsafe { Process32FirstW(snapshot.0, &mut row) };
    while found != 0 {
        if row.th32ProcessID == me {
            if row.th32ParentProcessID == 0 || row.th32ParentProcessID == me {
                bail!("actual parent absent");
            }
            return Ok(row.th32ParentProcessID);
        }
        found = unsafe { Process32NextW(snapshot.0, &mut row) };
    }
    bail!("actual parent not enumerated")
}
fn actual_parent() -> Result<u32> {
    process_parent(unsafe { GetCurrentProcessId() })
}

// Retain an exact kernel handle, not a reusable numeric PID. A socket snapshot
// is accepted only while this same process is alive before AND after it. A
// second process receiving the old PID cannot satisfy the retained handle.
struct PinnedProcess {
    process: Handle,
    pid: u32,
    birth: u64,
}
impl PinnedProcess {
    fn pin(job: &Handle, pid: u32, parent: u32) -> Result<Self> {
        if pid == parent || pid == unsafe { GetCurrentProcessId() } {
            bail!("parent/broker is not a media child");
        }
        let process = handle(
            unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    0,
                    pid,
                )
            },
            "media child unavailable",
        )?;
        let mut included = 0;
        if unsafe { IsProcessInJob(process.0, job.0, &mut included) } == 0
            || included == 0
            || process_parent(pid)? != parent
        {
            bail!("process is not a direct admitted child");
        }
        let birth = creation_time(process.0)?;
        let pinned = Self {
            process,
            pid,
            birth,
        };
        pinned.verify()?;
        Ok(pinned)
    }
    fn verify(&self) -> Result<()> {
        if self.birth == 0
            || unsafe { WaitForSingleObject(self.process.0, 0) } != WAIT_TIMEOUT
            || creation_time(self.process.0)? != self.birth
        {
            bail!("exact media incarnation ended or is unknown");
        }
        Ok(())
    }
}
fn processes(job: &Handle) -> Result<u32> {
    let mut information: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
    if unsafe {
        QueryInformationJobObject(
            job.0,
            JobObjectBasicAccountingInformation,
            (&mut information as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
            size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
            null_mut(),
        )
    } == 0
    {
        return Err(last("job accounting unavailable"));
    }
    Ok(information.ActiveProcesses)
}
fn contains(job: &Handle, pid: u32) -> Result<bool> {
    if pid == 0 {
        bail!("invalid process identity");
    }
    let process = handle(
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) },
        "process membership unavailable",
    )?;
    let mut included = 0;
    if unsafe { IsProcessInJob(process.0, job.0, &mut included) } == 0 {
        return Err(last("process job membership unavailable"));
    }
    Ok(included != 0)
}
fn family(job: &Handle) -> Result<Vec<u32>> {
    // Aligned, bounded private buffer. Refuse incomplete/oversized lists instead
    // of presenting a guessed process count as containment proof.
    let mut buffer = vec![0u64; 4096];
    if unsafe {
        QueryInformationJobObject(
            job.0,
            JobObjectBasicProcessIdList,
            buffer.as_mut_ptr().cast(),
            (buffer.len() * size_of::<u64>()) as u32,
            null_mut(),
        )
    } == 0
    {
        return Err(last("complete job process list unavailable"));
    }
    let header = unsafe { &*buffer.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() };
    let count = header.NumberOfProcessIdsInList as usize;
    let offset = std::mem::offset_of!(JOBOBJECT_BASIC_PROCESS_ID_LIST, ProcessIdList);
    if header.NumberOfAssignedProcesses != header.NumberOfProcessIdsInList
        || offset + count * size_of::<usize>() > buffer.len() * size_of::<u64>()
    {
        bail!("incomplete job process list");
    }
    let rows = unsafe {
        std::slice::from_raw_parts(
            buffer.as_ptr().cast::<u8>().add(offset).cast::<usize>(),
            count,
        )
    };
    rows.iter()
        .map(|pid| u32::try_from(*pid).context("invalid job process identity"))
        .collect()
}
fn bind_parent(parent: u32) -> Result<Handle> {
    // Keep the exact kernel handle through admission, not just a recycled PID.
    let process = handle(
        unsafe {
            OpenProcess(
                PROCESS_SET_QUOTA
                    | PROCESS_TERMINATE
                    | PROCESS_QUERY_LIMITED_INFORMATION
                    | PROCESS_SYNCHRONIZE,
                0,
                parent,
            )
        },
        "actual parent unavailable",
    )?;
    if !parent_predates_broker(
        creation_time(process.0)?,
        creation_time(unsafe { GetCurrentProcess() })?,
    ) || unsafe { WaitForSingleObject(process.0, 0) } != WAIT_TIMEOUT
    {
        bail!("actual parent died or PID was recycled; no process will be admitted");
    }
    let job = handle(
        unsafe { CreateJobObjectW(null(), wide(JOB).as_ptr()) },
        "machine job unavailable",
    )?;
    // An existing job still containing processes is NOT an empty slot. Never
    // adopt, reconfigure or explicitly terminate it even after abandoned mutex.
    if processes(&job)? != 0 {
        bail!("predecessor process family still active");
    }
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        return Err(last("cannot protect process family"));
    }
    if unsafe { AssignProcessToJobObject(job.0, process.0) } == 0 {
        return Err(last("cannot bind actual parent; no publisher may start"));
    }
    let mut broker_included = 0;
    if unsafe { IsProcessInJob(GetCurrentProcess(), job.0, &mut broker_included) } == 0
        || broker_included != 0
        || !contains(&job, parent)?
    {
        bail!("broker/parent containment inconsistent");
    }
    Ok(job)
}
fn creation_time(process: HANDLE) -> Result<u64> {
    let (mut created, mut exited, mut kernel, mut user): (FILETIME, FILETIME, FILETIME, FILETIME) =
        unsafe { zeroed() };
    if unsafe { GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) } == 0 {
        return Err(last("process birth unavailable"));
    }
    Ok(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
}
fn parent_predates_broker(parent: u64, broker: u64) -> bool {
    parent > 0 && parent < broker
}

pub fn run() -> Result<()> {
    let stdin = std::io::stdin();
    let mut first = String::new();
    // Bounded first read, rather than unbounded read_line of a hostile pipe.
    let mut reader = stdin.lock();
    let read = reader
        .by_ref()
        .take((MAX_LINE + 1) as u64)
        .read_line(&mut first)?;
    if read == 0 {
        bail!("private admission absent");
    }
    let initial = parse(&first)?;
    if initial.action != "acquire"
        || initial.pid.is_some()
        || initial.request_id.is_some()
        || initial.process_token.is_some()
    {
        bail!("admission must bind actual parent, not caller-supplied PID");
    }
    let parent = actual_parent()?;
    let me = unsafe { GetCurrentProcessId() };
    let mutex = handle(
        unsafe { CreateMutexW(null(), 0, wide(MUTEX).as_ptr()) },
        "machine mutex unavailable",
    )?;
    match unsafe { WaitForSingleObject(mutex.0, 0) } {
        WAIT_OBJECT_0 | WAIT_ABANDONED => {}
        WAIT_TIMEOUT => {
            emit(
                json!({"event":"blocked","version":1,"nonce":initial.nonce,"reason":"HOST_DISTRIBUTION_BUSY"}),
            )?;
            return Ok(());
        }
        _ => return Err(last("machine mutex ownership unavailable")),
    }
    let _owned = MutexOwner(mutex);
    let job = bind_parent(parent)?;
    emit(
        json!({"event":"ready","version":1,"nonce":initial.nonce,"parentPid":parent,"guardPid":me,"jobBound":true,"hostExclusive":true}),
    )?;
    // Only the main thread owns/releases the mutex. The reader conveys EOF;
    // it cannot release the job or mutex merely because the parent disappeared.
    drop(reader);
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let input = std::io::stdin();
        let mut input = input.lock();
        loop {
            let mut line = String::new();
            match input
                .by_ref()
                .take((MAX_LINE + 1) as u64)
                .read_line(&mut line)
            {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if sender.send(line).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let mut draining = false;
    let mut pinned: HashMap<String, PinnedProcess> = HashMap::new();
    loop {
        match processes(&job) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => {
                draining = true;
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
        }
        if draining {
            std::thread::sleep(Duration::from_millis(100));
            continue;
        }
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                draining = true;
            }
            Ok(line) => {
                let request = match parse(&line) {
                    Ok(request) => request,
                    Err(_) => {
                        draining = true;
                        reply_or_drain(
                            &mut draining,
                            json!({"event":"refused","version":1,"nonce":initial.nonce,"reason":"PRIVATE_PROTOCOL_INVALID"}),
                        );
                        continue;
                    }
                };
                if request.nonce != initial.nonce
                    || request.action == "acquire"
                    || request.request_id.is_none()
                {
                    draining = true;
                    reply_or_drain(
                        &mut draining,
                        json!({"event":"refused","version":1,"nonce":initial.nonce,"reason":"PRIVATE_BINDING_CHANGED"}),
                    );
                    continue;
                }
                match request.action.as_str() {
                    "assert" if request.pid.is_none() && request.process_token.is_none() => {
                        if !matches!(contains(&job, parent), Ok(true)) {
                            draining = true;
                            reply_or_drain(
                                &mut draining,
                                json!({"event":"unavailable","version":1,"nonce":initial.nonce,"requestId":request.request_id,"reason":"PARENT_MEMBERSHIP_UNKNOWN"}),
                            );
                            continue;
                        }
                        let pids = match family(&job) {
                            Ok(pids) => pids,
                            Err(_) => {
                                reply_or_drain(
                                    &mut draining,
                                    json!({"event":"unavailable","version":1,"nonce":initial.nonce,"requestId":request.request_id,"reason":"PROCESS_FAMILY_UNKNOWN"}),
                                );
                                continue;
                            }
                        };
                        if !pids.contains(&parent) || pids.contains(&me) {
                            draining = true;
                            reply_or_drain(
                                &mut draining,
                                json!({"event":"unavailable","version":1,"nonce":initial.nonce,"requestId":request.request_id,"reason":"PROCESS_FAMILY_INCONSISTENT"}),
                            );
                            continue;
                        }
                        reply_or_drain(
                            &mut draining,
                            json!({"event":"asserted","version":1,"nonce":initial.nonce,"requestId":request.request_id,"parentPid":parent,"guardPid":me,"activeProcesses":pids.len(),"processPids":pids}),
                        );
                    }
                    "contains" if request.pid.is_some() && request.process_token.is_none() => {
                        reply_or_drain(
                            &mut draining,
                            json!({"event":"membership","version":1,"nonce":initial.nonce,"requestId":request.request_id,"included":request.pid.and_then(|pid|contains(&job,pid).ok())}),
                        )
                    }
                    "ports" if request.pid.is_none() && request.process_token.is_none() => {
                        let mut bindings = match sockets::snapshot() {
                            Ok(bindings) => bindings,
                            Err(error) => {
                                let mut value = json!({"event":"unavailable","version":1,"nonce":initial.nonce,"requestId":request.request_id,"reason":"PORT_OWNERSHIP_UNAVAILABLE"});
                                if let Some(diagnostic) = sockets::diagnostic(&error) {
                                    value["socketDiagnostic"] = json!(diagnostic);
                                }
                                reply_or_drain(&mut draining, value);
                                continue;
                            }
                        };
                        for binding in &mut bindings {
                            binding.included = contains(&job, binding.pid).ok();
                        }
                        reply_or_drain(
                            &mut draining,
                            json!({"event":"ports","version":1,"nonce":initial.nonce,"requestId":request.request_id,"bindings":bindings}),
                        );
                    }
                    "pin" if request.pid.is_some() && request.process_token.is_some() => {
                        let token = request.process_token.as_ref().unwrap();
                        let pid = request.pid.unwrap();
                        let result = if let Some(existing) = pinned.get(token) {
                            if existing.pid != pid {
                                Err(anyhow!("token cannot adopt another PID"))
                            } else {
                                existing.verify()
                            }
                        } else if pinned.len() >= 4096 {
                            Err(anyhow!("too many private process handles"))
                        } else {
                            PinnedProcess::pin(&job, pid, parent).map(|process| {
                                pinned.insert(token.clone(), process);
                            })
                        };
                        let value = match result {
                            Ok(()) => {
                                json!({"event":"pinned","version":1,"nonce":initial.nonce,"requestId":request.request_id,"processToken":token})
                            }
                            Err(_) => {
                                json!({"event":"unavailable","version":1,"nonce":initial.nonce,"requestId":request.request_id,"reason":"PROCESS_IDENTITY_UNAVAILABLE"})
                            }
                        };
                        reply_or_drain(&mut draining, value);
                    }
                    "process_ports" if request.pid.is_none() && request.process_token.is_some() => {
                        let token = request.process_token.as_ref().unwrap();
                        let result = (|| -> Result<_> {
                            let process = pinned
                                .get(token)
                                .ok_or_else(|| anyhow!("process not pinned"))?;
                            process.verify()?;
                            let mut bindings = sockets::snapshot()?;
                            for binding in &mut bindings {
                                binding.included = contains(&job, binding.pid).ok();
                            }
                            process.verify()?;
                            Ok(bindings)
                        })();
                        let value = match result {
                            Ok(bindings) => {
                                json!({"event":"process_ports","version":1,"nonce":initial.nonce,"requestId":request.request_id,"processToken":token,"bindings":bindings})
                            }
                            Err(error) => {
                                if let Some(diagnostic) = sockets::diagnostic(&error) {
                                    json!({"event":"unavailable","version":1,"nonce":initial.nonce,"requestId":request.request_id,"reason":"PORT_OWNERSHIP_UNAVAILABLE","socketDiagnostic":diagnostic})
                                } else {
                                    json!({"event":"unavailable","version":1,"nonce":initial.nonce,"requestId":request.request_id,"reason":"PROCESS_IDENTITY_UNAVAILABLE"})
                                }
                            }
                        };
                        reply_or_drain(&mut draining, value);
                    }
                    "release_process"
                        if request.pid.is_none() && request.process_token.is_some() =>
                    {
                        let token = request.process_token.as_ref().unwrap();
                        pinned.remove(token);
                        reply_or_drain(
                            &mut draining,
                            json!({"event":"process_released","version":1,"nonce":initial.nonce,"requestId":request.request_id,"processToken":token}),
                        );
                    }
                    "drain" if request.pid.is_none() && request.process_token.is_none() => {
                        draining = true;
                        reply_or_drain(
                            &mut draining,
                            json!({"event":"draining","version":1,"nonce":initial.nonce,"requestId":request.request_id}),
                        );
                    }
                    _ => {
                        draining = true;
                        reply_or_drain(
                            &mut draining,
                            json!({"event":"refused","version":1,"nonce":initial.nonce,"requestId":request.request_id,"reason":"PRIVATE_OPERATION_INVALID"}),
                        );
                    }
                }
            }
        }
    }
    // job is dropped before _owned, so the family is empty before mutex release.
    drop(job);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recycled_or_unknown_parent_birth_never_admits_foreign_process() {
        assert!(parent_predates_broker(10, 20));
        for (parent, broker) in [(0, 20), (20, 20), (21, 20), (u64::MAX, 20), (10, 0)] {
            assert!(!parent_predates_broker(parent, broker));
        }
    }
    fn valid(action: &str) -> String {
        json!({"version":1,"nonce":"a".repeat(64),"action":action}).to_string()
    }
    #[test]
    fn protocol_requires_bound_nonce_version_and_size() {
        assert!(parse(&valid("acquire")).is_ok());
        for value in [
            json!({"version":2,"nonce":"a".repeat(64),"action":"acquire"}),
            json!({"version":1,"nonce":"g".repeat(64),"action":"acquire"}),
            json!({"version":1,"nonce":"a","action":"acquire"}),
            json!({"version":1,"nonce":"a".repeat(64),"action":"acquire","unexpected":true}),
        ] {
            assert!(parse(&value.to_string()).is_err());
        }
        assert!(parse(&" ".repeat(MAX_LINE + 1)).is_err());
    }
    #[test]
    fn request_identity_is_bounded_without_secret_or_resource_namespace() {
        let mut value: Value = serde_json::from_str(&valid("assert")).unwrap();
        value["request_id"] = json!("");
        assert!(parse(&value.to_string()).is_err());
        value["request_id"] = json!("x".repeat(65));
        assert!(parse(&value.to_string()).is_err());
        value["request_id"] = json!("ok");
        assert!(parse(&value.to_string()).is_ok());
        assert!(MUTEX.starts_with("Global\\"));
        assert!(JOB.starts_with("Global\\"));
    }
    #[test]
    fn process_generation_never_accepts_path_secret_or_unbounded_identity() {
        let mut value: Value = serde_json::from_str(&valid("pin")).unwrap();
        value["process_token"] = json!("media-generation-1");
        value["pid"] = json!(123);
        assert!(parse(&value.to_string()).is_ok());
        for token in [
            "".to_string(),
            "x".repeat(65),
            "../media".to_string(),
            "a\nb".to_string(),
        ] {
            value["process_token"] = json!(token);
            assert!(parse(&value.to_string()).is_err());
        }
    }
}
