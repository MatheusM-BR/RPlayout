//! Private IPv4/IPv6 TCP listener and UDP ownership, directly from IP Helper.
//! No localized CLI, DNS, credential, configuration read or port connection.
use anyhow::Result;
use serde::Serialize;
use std::ffi::c_void;
use std::mem::{offset_of, size_of};
use std::ptr::{null_mut, read_unaligned};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, GetExtendedUdpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID,
    MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, MIB_UDP6ROW_OWNER_PID, MIB_UDP6TABLE_OWNER_PID,
    MIB_UDPROW_OWNER_PID, MIB_UDPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    UDP_TABLE_OWNER_PID,
};
use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};
const MAX_TABLE: usize = 1024 * 1024;
const INSUFFICIENT_BUFFER: u32 = 122;
/// Allowlisted private diagnostic: never include addresses, PIDs, paths or
/// arbitrary OS text. A failed query remains a failed query, not an empty table.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketDiagnostic {
    table: &'static str,
    phase: &'static str,
    reason: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    win32_code: Option<u32>,
}
impl std::fmt::Display for SocketDiagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "socket ownership unavailable: {} / {} / {}",
            self.table, self.phase, self.reason
        )
    }
}
impl std::error::Error for SocketDiagnostic {}
fn query_failure(phase: &'static str, reason: &'static str, code: Option<u32>) -> anyhow::Error {
    SocketDiagnostic {
        table: "UNSPECIFIED",
        phase,
        reason,
        win32_code: code,
    }
    .into()
}
fn for_table(error: anyhow::Error, table: &'static str) -> anyhow::Error {
    let Some(mut diagnostic) = error.downcast_ref::<SocketDiagnostic>().cloned() else {
        // Do not turn an unclassified failure into a fictional layout error.
        return error;
    };
    diagnostic.table = table;
    diagnostic.into()
}
pub fn diagnostic(error: &anyhow::Error) -> Option<&SocketDiagnostic> {
    error
        .downcast_ref::<SocketDiagnostic>()
        .filter(|value| matches!(value.table, "TCP4" | "TCP6" | "UDP4" | "UDP6"))
}
#[derive(Debug, Serialize)]
pub struct Binding {
    pub protocol: &'static str,
    pub family: u8,
    pub port: u16,
    pub pid: u32,
    pub included: Option<bool>,
}
fn table(query: impl Fn(*mut c_void, &mut u32) -> u32) -> Result<Vec<u8>> {
    let mut size = 0;
    let first = query(null_mut(), &mut size);
    if first != INSUFFICIENT_BUFFER && first != 0 {
        return Err(query_failure("SIZE", "OS_ERROR", Some(first)));
    }
    for _ in 0..3 {
        if size < 4 || size as usize > MAX_TABLE {
            return Err(query_failure("READ", "TABLE_BOUND", None));
        }
        let mut bytes = vec![0u8; size as usize];
        let result = query(bytes.as_mut_ptr().cast(), &mut size);
        if result == INSUFFICIENT_BUFFER {
            continue;
        }
        if result != 0 {
            return Err(query_failure("READ", "OS_ERROR", Some(result)));
        }
        if size < 4 || size as usize > bytes.len() {
            return Err(query_failure("READ", "INCOMPLETE_TABLE", None));
        }
        bytes.truncate(size as usize);
        return Ok(bytes);
    }
    Err(query_failure("READ", "TABLE_CHANGED", None))
}
fn rows<T: Copy>(bytes: &[u8], offset: usize) -> Result<Vec<T>> {
    if bytes.len() < 4 || bytes.len() > MAX_TABLE || offset < 4 {
        return Err(query_failure("DECODE", "LAYOUT_INVALID", None));
    }
    let count = u32::from_ne_bytes(bytes[..4].try_into().unwrap()) as usize;
    let end = count
        .checked_mul(size_of::<T>())
        .and_then(|length| offset.checked_add(length))
        .ok_or_else(|| query_failure("DECODE", "LAYOUT_INVALID", None))?;
    if end > bytes.len() {
        return Err(query_failure("DECODE", "INCOMPLETE_TABLE", None));
    }
    Ok((0..count)
        .map(|index| unsafe {
            read_unaligned(
                bytes
                    .as_ptr()
                    .add(offset + index * size_of::<T>())
                    .cast::<T>(),
            )
        })
        .collect())
}
fn add(
    bindings: &mut Vec<Binding>,
    protocol: &'static str,
    family: u8,
    raw_port: u32,
    pid: u32,
) -> Result<()> {
    // Windows documents the low 16 bits as network byte order; the upper bits
    // are unspecified and MUST NOT be used as part of the port.
    let port = u16::from_be(raw_port as u16);
    let relevant = if protocol == "TCP" {
        [1935, 8554, 8888, 8889, 9997].contains(&port)
    } else {
        [8890, 8189, 8000, 8001].contains(&port)
    };
    if relevant {
        if pid == 0 {
            return Err(query_failure("OWNER", "UNKNOWN_OWNER", None));
        }
        bindings.push(Binding {
            protocol,
            family,
            port,
            pid,
            included: None,
        });
    }
    Ok(())
}
pub fn snapshot() -> Result<Vec<Binding>> {
    let mut bindings = Vec::new();
    let tcp4 = table(|buffer, size| unsafe {
        GetExtendedTcpTable(
            buffer,
            size,
            0,
            AF_INET as u32,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    })
    .map_err(|error| for_table(error, "TCP4"))?;
    for row in rows::<MIB_TCPROW_OWNER_PID>(&tcp4, offset_of!(MIB_TCPTABLE_OWNER_PID, table))
        .map_err(|error| for_table(error, "TCP4"))?
    {
        add(&mut bindings, "TCP", 4, row.dwLocalPort, row.dwOwningPid)
            .map_err(|error| for_table(error, "TCP4"))?;
    }
    let tcp6 = table(|buffer, size| unsafe {
        GetExtendedTcpTable(
            buffer,
            size,
            0,
            AF_INET6 as u32,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    })
    .map_err(|error| for_table(error, "TCP6"))?;
    for row in rows::<MIB_TCP6ROW_OWNER_PID>(&tcp6, offset_of!(MIB_TCP6TABLE_OWNER_PID, table))
        .map_err(|error| for_table(error, "TCP6"))?
    {
        add(&mut bindings, "TCP", 6, row.dwLocalPort, row.dwOwningPid)
            .map_err(|error| for_table(error, "TCP6"))?;
    }
    let udp4 = table(|buffer, size| unsafe {
        GetExtendedUdpTable(buffer, size, 0, AF_INET as u32, UDP_TABLE_OWNER_PID, 0)
    })
    .map_err(|error| for_table(error, "UDP4"))?;
    for row in rows::<MIB_UDPROW_OWNER_PID>(&udp4, offset_of!(MIB_UDPTABLE_OWNER_PID, table))
        .map_err(|error| for_table(error, "UDP4"))?
    {
        add(&mut bindings, "UDP", 4, row.dwLocalPort, row.dwOwningPid)
            .map_err(|error| for_table(error, "UDP4"))?;
    }
    let udp6 = table(|buffer, size| unsafe {
        GetExtendedUdpTable(buffer, size, 0, AF_INET6 as u32, UDP_TABLE_OWNER_PID, 0)
    })
    .map_err(|error| for_table(error, "UDP6"))?;
    for row in rows::<MIB_UDP6ROW_OWNER_PID>(&udp6, offset_of!(MIB_UDP6TABLE_OWNER_PID, table))
        .map_err(|error| for_table(error, "UDP6"))?
    {
        add(&mut bindings, "UDP", 6, row.dwLocalPort, row.dwOwningPid)
            .map_err(|error| for_table(error, "UDP6"))?;
    }
    Ok(bindings)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    #[test]
    fn structured_query_failure_preserves_numeric_code_without_private_text() {
        let error = for_table(table(|_, _| 5).unwrap_err(), "TCP6");
        let value = serde_json::to_value(diagnostic(&error).unwrap()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"table":"TCP6","phase":"SIZE","reason":"OS_ERROR","win32Code":5})
        );
        let error = for_table(rows::<MIB_TCPROW_OWNER_PID>(&[], 4).err().unwrap(), "UDP4");
        assert_eq!(
            serde_json::to_value(diagnostic(&error).unwrap()).unwrap(),
            serde_json::json!({"table":"UDP4","phase":"DECODE","reason":"LAYOUT_INVALID"})
        );
        assert!(diagnostic(&anyhow::anyhow!("PRIVATE_PATH_TOKEN_PID")).is_none());
        assert!(diagnostic(&for_table(anyhow::anyhow!("PRIVATE_UNKNOWN"), "TCP4")).is_none());
    }
    #[test]
    fn rows_reject_short_overflowing_and_incomplete_layouts() {
        for bytes in [&[][..], &[1, 0, 0, 0][..], &[255, 255, 255, 255][..]] {
            assert!(rows::<MIB_TCPROW_OWNER_PID>(bytes, 4).is_err());
        }
        assert!(rows::<MIB_TCPROW_OWNER_PID>(&[0, 0, 0, 0], 4)
            .unwrap()
            .is_empty());
        assert!(rows::<MIB_TCPROW_OWNER_PID>(&vec![0; MAX_TABLE + 1], 4).is_err());
    }
    #[test]
    fn network_ports_ignore_upper_bits_and_never_invent_owner() {
        let mut bindings = Vec::new();
        add(
            &mut bindings,
            "TCP",
            4,
            0xffff0000 | 9997u16.to_be() as u32,
            42,
        )
        .unwrap();
        add(&mut bindings, "UDP", 6, 8890u16.to_be() as u32, 43).unwrap();
        add(&mut bindings, "TCP", 4, 135u16.to_be() as u32, 0).unwrap();
        assert_eq!(bindings.len(), 2);
        assert_eq!(bindings[0].port, 9997);
        assert_eq!(bindings[1].port, 8890);
        assert_eq!(bindings[1].family, 6);
        assert!(bindings[0].included.is_none());
        assert!(add(&mut bindings, "TCP", 4, 9997u16.to_be() as u32, 0).is_err());
    }
    #[test]
    fn query_refuses_os_error_and_continuous_growth() {
        assert!(table(|_, _| 5).is_err());
        let calls = Cell::new(0);
        assert!(table(|_, size| {
            calls.set(calls.get() + 1);
            *size = 8;
            INSUFFICIENT_BUFFER
        })
        .is_err());
        assert_eq!(calls.get(), 4);
        assert!(table(|_, size| {
            *size = MAX_TABLE as u32 + 1;
            INSUFFICIENT_BUFFER
        })
        .is_err());
    }
    #[test]
    fn valid_padded_row_is_read_without_assuming_buffer_alignment() {
        let offset = offset_of!(MIB_TCP6TABLE_OWNER_PID, table);
        let mut bytes = vec![0u8; offset + size_of::<MIB_TCP6ROW_OWNER_PID>()];
        bytes[..4].copy_from_slice(&1u32.to_ne_bytes());
        let mut row: MIB_TCP6ROW_OWNER_PID = unsafe { std::mem::zeroed() };
        row.dwLocalPort = 9997u16.to_be() as u32;
        row.dwOwningPid = 123;
        unsafe { std::ptr::write_unaligned(bytes.as_mut_ptr().add(offset).cast(), row) };
        let parsed = rows::<MIB_TCP6ROW_OWNER_PID>(&bytes, offset).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].dwOwningPid, 123);
    }
}
