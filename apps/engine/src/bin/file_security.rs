//! Protect one empty generated configuration or HA directory before data.
//! No shell, recursive ACL changes, network endpoint, fallback DACL or file data.
use serde::Deserialize;
use std::io::{Read, Write};

#[cfg(windows)]
#[path = "file_security/windows.rs"]
mod windows;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    path: String,
}

fn parse_request(bytes: &[u8]) -> Result<Request, &'static str> {
    if bytes.len() > 262_144 {
        return Err("invalid request");
    }
    let request: Request = serde_json::from_slice(bytes).map_err(|_| "invalid request")?;
    if request.path.contains('\0') || request.path.encode_utf16().count() > 32_767 {
        return Err("invalid path");
    }
    let path = std::path::Path::new(&request.path);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("invalid path")?;
    let (prefix, id) = name
        .rsplit_once(".private-")
        .ok_or("not a generated file")?;
    if !path.is_absolute()
        || !prefix.starts_with('.')
        || prefix.len() < 2
        || id.len() != 36
        || !id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
    {
        return Err("not a generated file");
    }
    Ok(request)
}

fn run() -> Result<(), &'static str> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let directory=args==["--private-directory-stdin"];
    if !directory&&args != ["--private-file-stdin"] {
        return Err("invalid invocation");
    }
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(262_145)
        .read_to_end(&mut bytes)
        .map_err(|_| "invalid request")?;
    let request = parse_request(&bytes)?;
    if directory&&!std::path::Path::new(&request.path).file_name().and_then(|name|name.to_str()).is_some_and(|name|name.starts_with(".ha-execution.private-")){return Err("not a generated HA directory");}
    #[cfg(windows)]
    if directory {windows::protect_directory(&request.path)?;}else{windows::protect(&request.path)?;}
    #[cfg(not(windows))]
    {
        let _ = request;
        return Err("requires Windows");
    }
    #[cfg(windows)]
    std::io::stdout()
        .write_all(b"PROTECTED")
        .map_err(|_| "reply failed")?;
    Ok(())
}

fn main() {
    if run().is_err() {
        eprintln!("file protection refused; no configuration contents accepted");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_request_is_bounded_and_strict() {
        assert!(parse_request(&vec![b' '; 262_145]).is_err());
        assert!(parse_request(br#"{"path":"C:\\x","secret":"not accepted"}"#).is_err());
        assert!(parse_request(br#"{"path":"C:\\x\u0000"}"#).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn only_absolute_generated_names_are_accepted() {
        let good = r"C:\ação\.CONFIGURAÇÃO.yml.private-12345678-1234-1234-1234-123456789abc";
        assert!(
            parse_request(&serde_json::to_vec(&serde_json::json!({"path":good})).unwrap()).is_ok()
        );
        for path in [
            r"C:\x\original.yml",
            r"C:\x\.y.private-invalid",
            r".y.private-12345678-1234-1234-1234-123456789abc",
        ] {
            assert!(
                parse_request(&serde_json::to_vec(&serde_json::json!({"path":path})).unwrap())
                    .is_err()
            );
        }
    }
}
