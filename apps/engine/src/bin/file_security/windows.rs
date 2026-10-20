use std::{
    ffi::c_void,
    mem::{size_of, zeroed},
    os::windows::ffi::OsStrExt,
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, HANDLE, INVALID_HANDLE_VALUE},
    Security::{
        Authorization::{
            GetSecurityInfo, SetEntriesInAclW, SetSecurityInfo, EXPLICIT_ACCESS_W, SET_ACCESS,
            SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_USER, TRUSTEE_W,
        },
        CreateWellKnownSid, EqualSid, GetAce, GetSecurityDescriptorControl, GetTokenInformation,
        IsValidAcl, IsValidSid, TokenOwner, TokenUser, WinLocalSystemSid, ACCESS_ALLOWED_ACE, ACL,
        DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
        SE_DACL_PROTECTED, TOKEN_OWNER, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{
        CreateFileW, GetFileInformationByHandle, GetFileType, BY_HANDLE_FILE_INFORMATION,
        FILE_ALL_ACCESS, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_TYPE_DISK, OPEN_EXISTING, READ_CONTROL, WRITE_DAC,
        WRITE_OWNER,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
struct LocalAllocation(*mut c_void);
impl Drop for LocalAllocation {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}

unsafe fn owner_matches(
    file: HANDLE,
    expected: *mut c_void,
    default_owner: *mut c_void,
) -> Result<bool, &'static str> {
    let mut owner = null_mut();
    let mut descriptor = null_mut();
    if GetSecurityInfo(
        file,
        SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION,
        &mut owner,
        null_mut(),
        null_mut(),
        null_mut(),
        &mut descriptor,
    ) != 0
    {
        return Err("owner unavailable");
    }
    let _descriptor = LocalAllocation(descriptor);
    if owner.is_null()
        || IsValidSid(owner) == 0
        || (EqualSid(owner, expected) == 0 && EqualSid(owner, default_owner) == 0)
    {
        return Err("not own temporary file");
    }
    Ok(EqualSid(owner, expected) != 0)
}

unsafe fn verify(
    file: HANDLE,
    owner_sid: *mut c_void,
    system_sid: *mut c_void,
    same_sid: bool,
    directory: bool,
) -> Result<(), &'static str> {
    let mut owner = null_mut();
    let mut acl: *mut ACL = null_mut();
    let mut descriptor = null_mut();
    if GetSecurityInfo(
        file,
        SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        &mut owner,
        null_mut(),
        &mut acl,
        null_mut(),
        &mut descriptor,
    ) != 0
    {
        return Err("permissions unavailable");
    }
    let _descriptor = LocalAllocation(descriptor);
    let mut control = 0;
    let mut revision = 0;
    if descriptor.is_null()
        || GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) == 0
        || control & SE_DACL_PROTECTED == 0
        || owner.is_null()
        || EqualSid(owner, owner_sid) == 0
        || acl.is_null()
        || IsValidAcl(acl) == 0
        || (*acl).AceCount != if same_sid { 1 } else { 2 }
    {
        return Err("permissions not protected");
    }
    let mut owner_seen = false;
    let mut system_seen = false;
    for index in 0..(*acl).AceCount {
        let mut raw = null_mut();
        if GetAce(acl, u32::from(index), &mut raw) == 0 || raw.is_null() {
            return Err("invalid permission");
        }
        let ace = &*(raw as *const ACCESS_ALLOWED_ACE);
        // ACCESS_ALLOWED_ACE_TYPE = 0. Empty HA directories alone allow
        // OBJECT/CONTAINER inheritance for future children (flags 3).
        if ace.Header.AceType != 0
            || ace.Header.AceFlags != if directory {3}else{0}
            || usize::from(ace.Header.AceSize) < size_of::<ACCESS_ALLOWED_ACE>()
            || ace.Mask != FILE_ALL_ACCESS
        {
            return Err("unexpected permission");
        }
        let sid = (&ace.SidStart as *const u32).cast_mut().cast::<c_void>();
        if IsValidSid(sid) == 0 {
            return Err("invalid permission SID");
        }
        if EqualSid(sid, owner_sid) != 0 && !owner_seen {
            owner_seen = true;
        } else if !same_sid && EqualSid(sid, system_sid) != 0 && !system_seen {
            system_seen = true;
        } else {
            return Err("unexpected permission SID");
        }
    }
    if !owner_seen || (!same_sid && !system_seen) {
        return Err("missing permission");
    }
    Ok(())
}

pub fn protect(path: &str) -> Result<(), &'static str> {
    protect_object(path,false)
}
pub fn protect_directory(path:&str)->Result<(),&'static str>{protect_object(path,true)}
fn empty_directory(path:&str)->Result<(),&'static str>{
    if std::fs::read_dir(path).map_err(|_|"directory unavailable")?.next().is_some(){return Err("directory is not empty");}Ok(())
}
fn protect_object(path: &str,directory:bool) -> Result<(), &'static str> {
    if directory {empty_directory(path)?;}
    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        // Exclusive handle, no traversal of a final reparse point, no creation.
        let mut file = CreateFileW(
            wide.as_ptr(),
            READ_CONTROL | WRITE_DAC | WRITE_OWNER,
            0,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | if directory {FILE_FLAG_BACKUP_SEMANTICS}else{0},
            null_mut(),
        );
        let can_set_owner=file!=INVALID_HANDLE_VALUE;
        if !can_set_owner {
            // Owning a new file grants DACL control, but inherited Modify does
            // not necessarily grant WRITE_OWNER. No owner change is needed
            // when the owner is already the current user. Still refuse an
            // elevated default-owner group unless normalization is possible.
            file=CreateFileW(wide.as_ptr(),READ_CONTROL|WRITE_DAC,0,null(),OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT | if directory {FILE_FLAG_BACKUP_SEMANTICS}else{0},null_mut());
        }
        if file == INVALID_HANDLE_VALUE {
            return Err("temporary file unavailable");
        }
        let file = Handle(file);
        let mut info: BY_HANDLE_FILE_INFORMATION = zeroed();
        if GetFileType(file.0) != FILE_TYPE_DISK
            || GetFileInformationByHandle(file.0, &mut info) == 0
            || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
            || !directory&&(info.nFileSizeHigh != 0 || info.nFileSizeLow != 0)
            || info.nNumberOfLinks != 1
        {
            return Err("not an empty unlinked regular file");
        }
        let mut token = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err("identity unavailable");
        }
        let token = Handle(token);
        let mut length = 0;
        GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut length);
        if length < size_of::<TOKEN_USER>() as u32 || length > 65_536 {
            return Err("invalid identity");
        }
        // usize allocation retains alignment for TOKEN_USER and its embedded SID.
        let mut token_data = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
        if GetTokenInformation(
            token.0,
            TokenUser,
            token_data.as_mut_ptr().cast(),
            length,
            &mut length,
        ) == 0
        {
            return Err("identity unavailable");
        }
        let owner = (*(token_data.as_ptr() as *const TOKEN_USER)).User.Sid;
        if owner.is_null() || IsValidSid(owner) == 0 {
            return Err("invalid identity");
        }
        // An elevated token may create files with its TokenOwner group rather
        // than TokenUser. Accept only that OS-derived default or this user,
        // never an arbitrary group supplied by the request.
        let mut default_length = 0;
        GetTokenInformation(token.0, TokenOwner, null_mut(), 0, &mut default_length);
        if default_length < size_of::<TOKEN_OWNER>() as u32 || default_length > 65_536 {
            return Err("invalid default owner");
        }
        let mut default_data = vec![0usize; (default_length as usize).div_ceil(size_of::<usize>())];
        if GetTokenInformation(
            token.0,
            TokenOwner,
            default_data.as_mut_ptr().cast(),
            default_length,
            &mut default_length,
        ) == 0
        {
            return Err("default owner unavailable");
        }
        let default_owner = (*(default_data.as_ptr() as *const TOKEN_OWNER)).Owner;
        if default_owner.is_null() || IsValidSid(default_owner) == 0 {
            return Err("invalid default owner");
        }
        let already_owned=owner_matches(file.0, owner, default_owner)?;
        if !already_owned&&!can_set_owner{return Err("owner normalization unavailable");}
        let mut system_data = [0u64; 9];
        let mut system_size = 72;
        let system = system_data.as_mut_ptr().cast::<c_void>();
        if CreateWellKnownSid(WinLocalSystemSid, null_mut(), system, &mut system_size) == 0 {
            return Err("SYSTEM identity unavailable");
        }
        let same_sid = EqualSid(owner, system) != 0;
        let entry = |sid| EXPLICIT_ACCESS_W {
            grfAccessPermissions: FILE_ALL_ACCESS,
            grfAccessMode: SET_ACCESS,
            grfInheritance: if directory {3}else{0},
            Trustee: TRUSTEE_W {
                pMultipleTrustee: null_mut(),
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_USER,
                ptstrName: sid as *mut u16,
            },
        };
        let entries = [entry(owner), entry(system)];
        let mut acl = null_mut();
        if SetEntriesInAclW(
            if same_sid { 1 } else { 2 },
            entries.as_ptr(),
            null(),
            &mut acl,
        ) != 0
            || acl.is_null()
        {
            return Err("permissions creation failed");
        }
        let _acl = LocalAllocation(acl.cast());
        if SetSecurityInfo(
            file.0,
            SE_FILE_OBJECT,
            (if already_owned {0}else{OWNER_SECURITY_INFORMATION})
                | DACL_SECURITY_INFORMATION
                | PROTECTED_DACL_SECURITY_INFORMATION,
            if already_owned {null_mut()}else{owner},
            null_mut(),
            acl,
            null(),
        ) != 0
        {
            return Err("permissions application failed");
        }
        verify(file.0, owner, system, same_sid,directory)?;
        drop(file);
        if directory {empty_directory(path)?;}
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (std::path::PathBuf, std::path::PathBuf) {
        static COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let name = format!(
            "RPlayout-file-security-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );
        let directory = std::env::temp_dir().join(name);
        std::fs::create_dir(&directory).unwrap();
        let file = directory.join(".CONFIGURAÇÃO.yml.private-12345678-1234-1234-1234-123456789abc");
        (directory, file)
    }
    #[test]
    fn real_empty_unicode_file_has_exact_protected_acl() {
        let (directory, file) = fixture();
        std::fs::write(&file, []).unwrap();
        protect(file.to_str().unwrap()).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"");
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
    // NOT_RUN in the current batch: native Windows ACL fixtures.
    #[test]
    fn empty_ha_directory_has_exact_inheritable_acl() {
        let (parent,_) = fixture();
        let directory=parent.join(".ha-execution.private-12345678-1234-1234-1234-123456789abc");
        std::fs::create_dir(&directory).unwrap();
        protect_directory(directory.to_str().unwrap()).unwrap();
        let wal=directory.join("operational.db-wal");
        std::fs::write(&wal,b"OWN_NEW_SIDECAR").unwrap();
        assert_eq!(std::fs::read(&wal).unwrap(),b"OWN_NEW_SIDECAR");
        assert!(protect_directory(directory.to_str().unwrap()).is_err());
        std::fs::remove_file(wal).unwrap();std::fs::remove_dir(directory).unwrap();std::fs::remove_dir(parent).unwrap();
    }
    #[test]
    fn refuses_content_hardlinks_and_directory_without_writing() {
        let (directory, file) = fixture();
        std::fs::write(&file, b"ORIGINAL_BYTES").unwrap();
        assert!(protect(file.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"ORIGINAL_BYTES");
        std::fs::write(&file, []).unwrap();
        let alias = directory.join("alias");
        std::fs::hard_link(&file, &alias).unwrap();
        assert!(protect(file.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read(&alias).unwrap(), b"");
        assert!(protect(directory.to_str().unwrap()).is_err());
        std::fs::remove_file(alias).unwrap();
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
