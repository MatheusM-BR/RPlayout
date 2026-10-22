//! Lançador do RPlayout: um duplo clique põe o sistema no ar.
//!
//! Ele não é o sistema -- é a porta de entrada dele. Sobe o servidor com os
//! caminhos certos, espera a porta responder e abre a interface no navegador.
//! Sem isto o operador precisa decorar meia dúzia de variáveis de ambiente e
//! digitá-las todo dia, o que é jeito seguro de um dia digitar errado.
//!
//! Fica na raiz da instalação (`C:\RPlayout\RPlayout.exe`) e descobre todo o
//! resto a partir de onde ele mesmo está.

use anyhow::{anyhow, Context, Result};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Quanto esperar o servidor responder antes de desistir e mostrar o log.
const READY_TIMEOUT: Duration = Duration::from_secs(90);
const DEFAULT_PORT: u16 = 4000;

struct LocalEndpoint { port:u16, connect_host:String, browser_host:String, bind_host:String }
fn configured_endpoint(args:&[String],env_port:Option<&str>,env_host:Option<&str>)->Result<LocalEndpoint>{
    let mut selected=None;
    for arg in args {
        if let Some(value)=arg.strip_prefix("--port=") {
            if selected.replace(value).is_some(){return Err(anyhow!("porta repetida"));}
        }else if arg.starts_with("--port"){return Err(anyhow!("use --port=NUMERO"));}
    }
    let value=selected.or(env_port);
    let port=match value {
        None=>DEFAULT_PORT,
        Some(value) if !value.is_empty()&&value.bytes().all(|b|b.is_ascii_digit())=>value.parse::<u16>().ok().filter(|port|*port>0).ok_or_else(||anyhow!("porta deve estar entre 1 e 65535"))?,
        _=>return Err(anyhow!("porta deve ser um número inteiro entre 1 e 65535")),
    };
    let host=env_host.unwrap_or("0.0.0.0");
    if host.is_empty()||!(host.parse::<std::net::IpAddr>().is_ok()||host.bytes().all(|b|b.is_ascii_alphanumeric()||b".-_".contains(&b))){return Err(anyhow!("HOST deve ser um nome/IP de escuta sem porta, protocolo ou caminho"));}
    let connect_host=match host {"0.0.0.0"=>"127.0.0.1","::"=>"::1",other=>other}.to_owned();
    let browser_host=if host=="0.0.0.0"||host=="::"{"localhost".to_owned()}else if host.contains(':'){format!("[{host}]")}else{host.to_owned()};
    Ok(LocalEndpoint{port,connect_host,browser_host,bind_host:host.to_owned()})
}
impl LocalEndpoint {
    fn connect(&self)->std::io::Result<TcpStream>{
        let mut last=None;
        for address in (self.connect_host.as_str(),self.port).to_socket_addrs()? {
            match TcpStream::connect_timeout(&address,Duration::from_millis(500)){Ok(stream)=>return Ok(stream),Err(error)=>last=Some(error)}
        }
        Err(last.unwrap_or_else(||std::io::Error::new(std::io::ErrorKind::AddrNotAvailable,"endereço local não resolvido")))
    }
    fn url(&self,workspace:Option<&str>)->String{
        let base=format!("http://{}:{}",self.browser_host,self.port);
        match workspace {None=>base,Some(value)=>{
            let encoded=value.bytes().map(|b|if b.is_ascii_alphanumeric()||b"-._~".contains(&b){(b as char).to_string()}else{format!("%{b:02X}")}).collect::<String>();
            format!("{base}/?workspace={encoded}")
        }}
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct LocalIdentity { application:String,version:u32,pid:u32,port:u16,instance_id:String }
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct LocalDescriptor { application:String,version:u32,pid:u32,port:u16,instance_id:String,root:PathBuf,database:PathBuf }
fn same_physical_file(left:&Path,right:&Path)->bool{
    match (std::fs::canonicalize(left),std::fs::canonicalize(right)){
        (Ok(left),Ok(right))=>if cfg!(windows){left.to_string_lossy().to_lowercase()==right.to_string_lossy().to_lowercase()}else{left==right},_=>false,
    }
}
fn read_identity_response(bytes:&[u8])->Result<LocalIdentity>{
    if bytes.len()>8192{return Err(anyhow!("resposta local excede limite"));}
    let split=bytes.windows(4).position(|part|part==b"\r\n\r\n").ok_or_else(||anyhow!("resposta HTTP local inválida"))?;
    let headers=std::str::from_utf8(&bytes[..split])?;
    let mut lines=headers.split("\r\n");
    if !matches!(lines.next(),Some("HTTP/1.1 200 OK"|"HTTP/1.0 200 OK")){return Err(anyhow!("identificação local não está pronta"));}
    if lines.any(|line|line.to_ascii_lowercase().starts_with("transfer-encoding:")){return Err(anyhow!("resposta local não delimitada"));}
    Ok(serde_json::from_slice(&bytes[split+4..])?)
}
fn verify_server(root:&Path,database:&Path,endpoint:&LocalEndpoint,expected_pid:Option<u32>)->Result<()> {
    let file=root.join(format!(".rplayout-launcher-{}.json",endpoint.port));
    caminho_fisico_perfil(&file)?;
    let metadata=std::fs::metadata(&file)?;
    if !metadata.is_file()||metadata.len()>8192{return Err(anyhow!("identificação privada inválida"));}
    let record:LocalDescriptor=serde_json::from_slice(&std::fs::read(&file)?)?;
    if record.application!="RPlayout"||record.version!=1||record.pid==0||record.port!=endpoint.port||record.instance_id.len()!=36
        ||!same_physical_file(&record.root,root)||!same_physical_file(&record.database,database)||expected_pid.is_some_and(|pid|pid!=record.pid){return Err(anyhow!("identificação pertence a outra instalação, banco ou processo"));}
    let mut stream=endpoint.connect()?;
    stream.set_read_timeout(Some(Duration::from_millis(1000)))?;
    stream.set_write_timeout(Some(Duration::from_millis(1000)))?;
    let host=if endpoint.connect_host.contains(':'){format!("[{}]",endpoint.connect_host)}else{endpoint.connect_host.clone()};
    // No private paths, credentials or instance token are sent to an occupied port.
    write!(stream,"GET /_rplayout/launcher HTTP/1.1\r\nHost: {host}:{}\r\nConnection: close\r\nAccept: application/json\r\n\r\n",endpoint.port)?;
    let mut bytes=Vec::new();stream.take(8193).read_to_end(&mut bytes)?;
    let identity=read_identity_response(&bytes)?;
    if identity.application!="RPlayout"||identity.version!=1||identity.pid!=record.pid||identity.port!=record.port||identity.instance_id!=record.instance_id{return Err(anyhow!("serviço da porta ocupada não corresponde à identificação privada"));}
    Ok(())
}

struct RestorationOptions { profile: PathBuf, manifest: PathBuf, activate: bool, adopt: bool }
fn opcoes_restauracao(args: &[String]) -> Result<Option<RestorationOptions>> {
    let mut profile = None; let mut manifest = None; let mut activate = false; let mut confirmed = false; let mut adopt = false;
    for arg in args {
        if let Some(value) = arg.strip_prefix("--installation-profile=") {
            if value.is_empty() || profile.replace(PathBuf::from(value)).is_some() { return Err(anyhow!("perfil vazio/repetido")); }
        } else if let Some(value) = arg.strip_prefix("--stage-restored=") {
            if value.is_empty() || manifest.replace(PathBuf::from(value)).is_some() { return Err(anyhow!("modo/manifesto restaurado vazio/repetido")); }
        } else if let Some(value) = arg.strip_prefix("--activate-restored=") {
            if value.is_empty() || manifest.replace(PathBuf::from(value)).is_some() { return Err(anyhow!("modo/manifesto restaurado vazio/repetido")); }
            activate = true;
        } else if arg == "--adopt-upgrade-profile" {
            if adopt { return Err(anyhow!("adoção de perfil repetida")); } adopt = true;
        } else if arg == "--confirm-restored-activation" {
            if confirmed { return Err(anyhow!("confirmação repetida")); } confirmed = true;
        } else if arg.starts_with("--installation-profile") || arg.starts_with("--stage-restored") || arg.starts_with("--activate-restored") || arg.starts_with("--confirm-restored") {
            return Err(anyhow!("opção de restauração inválida; use a ferramenta de atualização"));
        }
    }
    if profile.is_none() && manifest.is_none() && !confirmed && !adopt { return Ok(None); }
    if adopt && !activate { return Err(anyhow!("adoção permanente exige ativação explícita")); }
    if activate != confirmed { return Err(anyhow!("ativação exige confirmação explícita; conferência não aceita confirmação de TAKE")); }
    let options = RestorationOptions {profile: profile.ok_or_else(|| anyhow!("perfil candidato obrigatório"))?, manifest: manifest.ok_or_else(|| anyhow!("manifesto protegido obrigatório"))?, activate, adopt};
    if !options.profile.is_absolute() || !options.manifest.is_absolute() { return Err(anyhow!("perfil/manifesto restaurados exigem caminhos absolutos")); }
    Ok(Some(options))
}

fn main() -> Result<()> {
    let raiz = raiz_da_instalacao()?;
    let argumentos: Vec<String> = std::env::args().skip(1).collect();
    let restoration = opcoes_restauracao(&argumentos)?;
    let endpoint=configured_endpoint(&argumentos,std::env::var("PORT").ok().as_deref(),std::env::var("HOST").ok().as_deref())?;
    let nome_executavel = std::env::current_exe().ok().and_then(|path| path.file_stem().map(|name| name.to_string_lossy().to_lowercase())).unwrap_or_default();
    let somente_servidor = argumentos.iter().any(|arg| arg == "--server-only") || nome_executavel.contains("server");
    let workspace = argumentos.iter().find_map(|arg| arg.strip_prefix("--workspace=").map(str::to_owned)).or_else(|| {
        if nome_executavel.contains("schedule") || nome_executavel.contains("playlist") { Some("playlist".to_owned()) }
        else if nome_executavel.contains("users") || nome_executavel.contains("admin") { Some("users".to_owned()) }
        else if nome_executavel.contains("monitor") { Some("monitor".to_owned()) }
        else if nome_executavel.contains("aired") { Some("aired".to_owned()) }
        else if nome_executavel.contains("qc") { Some("qc".to_owned()) }
        else if nome_executavel.contains("master") { Some("master".to_owned()) }
        else { None }
    });
    println!("RPlayout · instalação em {}", raiz.display());

    if !raiz.join("apps/web/dist/index.html").exists() {
        println!();
        println!("A interface ainda não foi construída. Rode uma vez:");
        println!("    pnpm install");
        println!("    pnpm build");
        println!();
        return Err(anyhow!("apps/web/dist não existe"));
    }

    conferir_carimbo(&raiz);
    let mut command=preparar_servidor(&raiz,restoration.as_ref(),&endpoint)?;
    let database=command.get_envs().find(|(name,_)|*name=="RPLAYOUT_DB").and_then(|(_,value)|value.map(PathBuf::from))
        .or_else(||std::env::var_os("RPLAYOUT_DB").map(PathBuf::from)).unwrap_or_else(||raiz.join("rplayout.db"));

    // Duplo clique no atalho não pode criar um segundo servidor, e portanto
    // nem uma segunda família de engines disputando os mesmos destinos. Se a
    // API já responde, reaproveitamos a instância existente e só mostramos a
    // interface.
    if endpoint.connect().is_ok() {
        if restoration.is_some() { return Err(anyhow!("porta {} ocupada: preparação/ativação não reutiliza outra instância. Confira e encerre o predecessor explicitamente.",endpoint.port)); }
        verify_server(&raiz,&database,&endpoint,None).context("porta ocupada sem identificação válida desta instalação; nenhum serviço foi interrompido")?;
        println!("RPlayout desta instalação já está em execução na porta {}; reutilizando a instância confirmada.",endpoint.port);
        if !somente_servidor { abrir_navegador(&endpoint,workspace.as_deref()); }
        return Ok(());
    }

    let mut servidor = subir_servidor(&mut command)?;
    let _owned_job=match OwnedServerJob::attach(&servidor){Ok(job)=>job,Err(error)=>{let _=servidor.kill();let _=servidor.wait();return Err(error);}};

    match esperar_porta(&raiz,&database,&endpoint,&mut servidor) {
        Ok(()) => {
            if restoration.as_ref().is_some_and(|options| !options.activate) { println!("RPlayout em quarentena para conferência em {}; canais não ativados.",endpoint.url(None)); }
            else { println!("RPlayout disponível em {}; confira PGM e saídas.",endpoint.url(None)); }
            if !somente_servidor { abrir_navegador(&endpoint,workspace.as_deref()); }
        }
        Err(erro) => {
            // Servidor que não sobe deixa o motivo no próprio terminal: matar
            // o processo aqui esconderia justamente a mensagem que explica.
            eprintln!("O servidor não respondeu: {erro}");
            eprintln!("A janela continua aberta com o log dele.");
        }
    }

    // Daqui em diante a janela é o log do servidor. Fechá-la derruba o canal,
    // e é por isso que ela diz isso em vez de sumir para a bandeja.
    println!("Feche esta janela para tirar o RPlayout do ar.");
    let saida = match servidor.wait() {
        Ok(status) => status,
        Err(error) => {
            // Child owns the OS process handle; do not act on a recycled PID.
            let _=servidor.kill();let _=servidor.wait();
            return Err(error).context("o servidor encerrou de forma inesperada");
        }
    };
    println!("O servidor encerrou ({saida}).");
    if !saida.success() { return Err(anyhow!("servidor terminou sem sucesso; confira o registro, sem repetir ativação automaticamente")); }
    Ok(())
}

// Bind cleanup to an OS handle, not a PID queried again after the child exits.
// Client/reuse launchers never acquire this job or stop an existing server.
#[cfg(windows)]
struct OwnedServerJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl OwnedServerJob {
    fn attach(child:&Child)->Result<Self>{
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::{CreateJobObjectW,SetInformationJobObject,AssignProcessToJobObject,JobObjectExtendedLimitInformation,JOBOBJECT_EXTENDED_LIMIT_INFORMATION,JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
        let handle=unsafe{CreateJobObjectW(std::ptr::null(),std::ptr::null())};
        if handle.is_null(){return Err(std::io::Error::last_os_error()).context("não foi possível criar supervisão do servidor próprio");}
        let job=Self(handle);
        let mut limits:JOBOBJECT_EXTENDED_LIMIT_INFORMATION=unsafe{std::mem::zeroed()};
        limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe{SetInformationJobObject(handle,JobObjectExtendedLimitInformation,&limits as *const _ as *const std::ffi::c_void,std::mem::size_of_val(&limits) as u32)}==0
            ||unsafe{AssignProcessToJobObject(handle,child.as_raw_handle() as _)}==0{return Err(std::io::Error::last_os_error()).context("não foi possível supervisionar o servidor próprio");}
        Ok(job)
    }
}
#[cfg(windows)]
impl Drop for OwnedServerJob{fn drop(&mut self){unsafe{windows_sys::Win32::Foundation::CloseHandle(self.0);}}}
#[cfg(not(windows))]
struct OwnedServerJob;
#[cfg(not(windows))]
impl OwnedServerJob{fn attach(_child:&Child)->Result<Self>{Ok(Self)}}

/// Avisa quando a interface construída é de outro commit que o código na pasta.
///
/// Este é o erro que ninguém desconfia: a tela antiga funciona perfeitamente,
/// com todos os botões no lugar -- só que são os botões de duas semanas atrás.
/// Quem atualiza o código e esquece de reconstruir passa horas procurando um
/// problema que não existe. Comparar leva um milissegundo.
///
/// Só avisa; não impede de subir. Rodar uma build antiga de propósito é uma
/// decisão legítima, e derrubar o canal por causa dela seria pior.
fn conferir_carimbo(raiz: &Path) {
    let Some(construido) = commit_da_build(raiz) else { return };
    let Some(codigo) = commit_do_codigo(raiz) else { return };
    if construido == codigo {
        return;
    }

    eprintln!();
    eprintln!("  ATENÇÃO: a tela não é a deste código.");
    eprintln!("  interface construída: {construido}");
    eprintln!("  código nesta pasta:   {codigo}");
    eprintln!();
    eprintln!("  Rode, nesta pasta:");
    eprintln!("      pnpm install");
    eprintln!("      pnpm build");
    eprintln!("      cargo build --release --manifest-path apps/engine/Cargo.toml");
    eprintln!();
}

/// O commit que o `pnpm build` carimbou em `apps/web/dist/build.json`.
fn commit_da_build(raiz: &Path) -> Option<String> {
    let bruto = std::fs::read_to_string(raiz.join("apps/web/dist/build.json")).ok()?;
    // Um JSON de três campos não justifica uma dependência: procura-se o valor
    // de "commit" na mão, e qualquer surpresa no formato vira `None` -- que
    // significa "não sei", e não um aviso errado.
    let depois = bruto.split("\"commit\"").nth(1)?;
    let inicio = depois.find('"')? + 1;
    let resto = &depois[inicio..];
    let fim = resto.find('"')?;
    let commit = resto[..fim].trim().to_string();
    (!commit.is_empty() && commit != "sem git").then_some(commit)
}

/// O commit que está na pasta agora, perguntando ao git.
fn commit_do_codigo(raiz: &Path) -> Option<String> {
    let saida = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(raiz)
        .output()
        .ok()?;
    if !saida.status.success() {
        // Cópia sem git: não há com o que comparar, e calar é o certo.
        return None;
    }
    let commit = String::from_utf8_lossy(&saida.stdout).trim().to_string();
    (!commit.is_empty()).then_some(commit)
}

/// A pasta onde o RPlayout está instalado.
///
/// O executável pode estar na raiz (uso normal) ou em
/// `apps/engine/target/release` (recém-compilado, antes de alguém copiá-lo).
/// Nos dois casos a raiz é a pasta que tem `package.json` e `apps`.
fn raiz_da_instalacao() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("não descobri onde este programa está")?;
    let mut atual = exe.parent().map(Path::to_path_buf);

    while let Some(pasta) = atual {
        if pasta.join("package.json").exists() && pasta.join("apps").is_dir() {
            return Ok(pasta);
        }
        atual = pasta.parent().map(Path::to_path_buf);
    }

    // Rodando de outro lugar: a pasta atual ainda pode ser a instalação.
    let cwd = std::env::current_dir()?;
    if cwd.join("package.json").exists() {
        return Ok(cwd);
    }
    Err(anyhow!(
        "não achei a instalação do RPlayout: ponha este programa na pasta que tem package.json"
    ))
}

/// Sobe o servidor com os binários e as pastas que existirem.
///
/// O que não existir simplesmente não é passado: o servidor sabe funcionar sem
/// servidor de mídia, sem sonda e sem descoberta de dispositivos, cada um
/// tirando um recurso. Passar caminho de arquivo que não existe seria pior --
/// falharia no meio, longe daqui.
fn preparar_servidor(raiz: &Path, restoration: Option<&RestorationOptions>,endpoint:&LocalEndpoint) -> Result<Command> {
    let node_portatil = raiz.join("runtime").join("node").join(executavel("node"));
    if raiz.join("package-manifest.json").exists() && !node_portatil.is_file() {
        return Err(anyhow!("runtime Node portátil ausente; reinstale o pacote completo. Não será usado Node global."));
    }
    let node = if node_portatil.exists() { node_portatil } else { PathBuf::from(executavel("node")) };
    let servidor = raiz.join("apps").join("server").join("dist").join("server.cjs");
    if !servidor.exists() {
        return Err(anyhow!("servidor empacotado não encontrado: {}", servidor.display()));
    }
    let mut comando = Command::new(node);
    if raiz.join("package-manifest.json").exists(){comando.env_remove("NODE_OPTIONS");comando.env_remove("NODE_PATH");}
    comando.current_dir(raiz);
    comando.env("RPLAYOUT_INSTALL_ROOT", raiz);
    comando.env("PORT",endpoint.port.to_string());
    comando.env("HOST",&endpoint.bind_host);
    comando.env("RPLAYOUT_LAUNCHER_DISCOVERY","1");
    comando.env_remove("RPLAYOUT_ADOPT_UPGRADE_PROFILE");
    if let Some(options) = restoration.filter(|options| options.adopt) { comando.env("RPLAYOUT_ADOPT_UPGRADE_PROFILE", &options.profile); }
    configurar_perfil_instalacao(&mut comando, raiz, restoration.map(|options| options.profile.as_path()))?;
    configurar_runtime_gstreamer(&mut comando, raiz);

    let bin = raiz.join("apps/engine/target/release");
    let opcionais = [
        ("RPLAYOUT_ENGINE", bin.join(executavel("rplayout-engine"))),
        ("RPLAYOUT_PROBE", bin.join(executavel("rplayout-probe"))),
        ("RPLAYOUT_PROXY", bin.join(executavel("rplayout-proxy"))),
        ("RPLAYOUT_DEVICES", bin.join(executavel("rplayout-devices"))),
        ("RPLAYOUT_RELAY", bin.join(executavel("rplayout-relay"))),
        ("RPLAYOUT_MEDIAMTX", raiz.join("mediamtx").join(executavel("mediamtx"))),
    ];

    for (variavel, caminho) in opcionais {
        if caminho.exists() {
            comando.env(variavel, &caminho);
        } else {
            println!("  sem {variavel}: {} não existe", caminho.display());
        }
    }

    // A pasta de mídia é escolha do operador e muda de instalação para
    // instalação: quem já definiu manda, e o padrão é `midia` aqui do lado.
    if std::env::var("RPLAYOUT_MEDIA").is_err() && restoration.is_none() && !raiz.join("installation-profile.json").exists() {
        comando.env("RPLAYOUT_MEDIA", raiz.join("midia"));
    }

    comando
        .arg(servidor)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if let Some(options) = restoration {
        caminho_fisico_perfil(&options.manifest)?;
        let info = std::fs::metadata(&options.manifest)?;
        if !info.is_file() || info.len() > 1024 * 1024 { return Err(anyhow!("manifesto restaurado inválido")); }
        comando.arg(if options.activate { "--activate-restored" } else { "--stage-restored" }).arg(&options.manifest);
    }

    Ok(comando)
}
fn subir_servidor(comando:&mut Command)->Result<Child>{
    let mut filho = comando.spawn().context("não consegui subir o servidor Node portátil")?;

    // O log do servidor vai para esta janela: é onde o operador vê por que uma
    // saída caiu ou um arquivo não abriu.
    if let Some(saida) = filho.stdout.take() {
        std::thread::spawn(move || {
            for linha in BufReader::new(saida).lines().map_while(Result::ok) {
                println!("{linha}");
            }
        });
    }
    Ok(filho)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PerfilInstalacao {
    version: u32,
    data_root: PathBuf,
    #[serde(default)]
    database_file: Option<PathBuf>,
    media_root: PathBuf,
    vault_file: PathBuf,
}

fn caminho_fisico_perfil(path: &Path) -> Result<()> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, std::path::Component::ParentDir | std::path::Component::CurDir)) {
        return Err(anyhow!("perfil exige caminhos absolutos sem segmentos relativos"));
    }
    for ancestor in path.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                let mut link = metadata.file_type().is_symlink();
                #[cfg(windows)] {
                    use std::os::windows::fs::MetadataExt;
                    link |= metadata.file_attributes() & 0x400 != 0;
                }
                if link { return Err(anyhow!("perfil atravessa link/junção; selecione um caminho físico")); }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(error).context("não foi possível conferir os caminhos do perfil"),
        }
    }
    Ok(())
}

/// Explicit local paths only: never infer the preceding edition or copy its DB.
/// A missing/invalid profile is an error, not permission to open another DB.
fn configurar_perfil_instalacao(command: &mut Command, root: &Path, selected: Option<&Path>) -> Result<()> {
    let file = selected.map(Path::to_path_buf).unwrap_or_else(|| root.join("installation-profile.json"));
    match std::fs::symlink_metadata(&file) {
        Ok(_) => {},
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && selected.is_none() => return Ok(()), // Legacy installation.
        Err(error) => return Err(error).context("não foi possível conferir o perfil da instalação"),
    }
    caminho_fisico_perfil(&file)?;
    let metadata = std::fs::metadata(&file)?;
    if !metadata.is_file() || metadata.len() > 16 * 1024 { return Err(anyhow!("perfil de instalação inválido")); }
    let profile: PerfilInstalacao = serde_json::from_slice(&std::fs::read(&file)?).context("perfil de instalação inválido; não será substituído")?;
    if profile.version != 1 { return Err(anyhow!("versão do perfil de instalação não suportada")); }
    for path in [&profile.data_root, &profile.media_root, &profile.vault_file] { caminho_fisico_perfil(path)?; }
    let database = profile.database_file.unwrap_or_else(|| profile.data_root.join("rplayout.db"));
    caminho_fisico_perfil(&database)?;
    if database.parent() != Some(profile.data_root.as_path()) { return Err(anyhow!("banco do perfil deve pertencer diretamente à pasta de dados declarada")); }
    if !profile.data_root.is_dir() { return Err(anyhow!("pasta de dados do perfil ausente; restaure a instalação correta")); }
    for (name, path) in [
        ("RPLAYOUT_DB", database),
        ("RPLAYOUT_BACKUPS", profile.data_root.join("backups")),
        ("RPLAYOUT_MEDIA", profile.media_root),
        ("RPLAYOUT_VAULT_FILE", profile.vault_file),
    ] {
        if let Some(existing) = std::env::var_os(name) {
            if PathBuf::from(existing) != path { return Err(anyhow!("{name} conflita com o perfil; revise a configuração antes de abrir o servidor")); }
        }
        command.env(name, path);
    }
    if std::env::var_os("RPLAYOUT_VAULT_KEY").is_some() { return Err(anyhow!("chave de cofre externa conflita com o perfil da instalação; revise explicitamente")); }
    Ok(())
}

#[cfg(test)]
mod installation_profile_tests {
    use super::*;
    // Prepared for the consolidated batch review; not run during integration.
    #[test]
    fn rejects_unknown_fields_including_secret_overrides() {
        let json = r#"{"version":1,"dataRoot":"C:/data","mediaRoot":"C:/media","vaultFile":"C:/vault.json","vaultKey":"not-allowed"}"#;
        assert!(serde_json::from_str::<PerfilInstalacao>(json).is_err());
    }
    #[test]
    fn requires_every_explicit_path() {
        assert!(serde_json::from_str::<PerfilInstalacao>(r#"{"version":1,"dataRoot":"C:/data"}"#).is_err());
    }
    #[test]
    fn relative_profile_path_is_not_accepted() {
        assert!(caminho_fisico_perfil(Path::new("relative-data")).is_err());
    }
    #[test]
    fn activation_requires_confirmation_and_cannot_mix_modes() {
        let profile = std::env::temp_dir().join("candidate.json");
        let manifest = std::env::temp_dir().join("quarantine.json");
        let args = vec![format!("--installation-profile={}", profile.display()), format!("--activate-restored={}", manifest.display())];
        assert!(opcoes_restauracao(&args).is_err());
        let mut confirmed = args.clone(); confirmed.push("--confirm-restored-activation".to_owned());
        assert!(opcoes_restauracao(&confirmed).unwrap().unwrap().activate);
        confirmed.push(format!("--stage-restored={}", manifest.display()));
        assert!(opcoes_restauracao(&confirmed).is_err());
    }
    #[test]
    fn ordinary_start_is_not_activation_and_incomplete_restore_options_fail() {
        assert!(opcoes_restauracao(&[]).unwrap().is_none());
        assert!(opcoes_restauracao(&["--confirm-restored-activation".to_owned()]).is_err());
        assert!(opcoes_restauracao(&["--installation-profile=relative.json".to_owned()]).is_err());
    }
}

/// Usa o runtime distribuído junto ao aplicativo quando ele existir. Isso
/// elimina a necessidade de instalar GStreamer globalmente; drivers físicos
/// (DeckLink/NDI) continuam sendo responsabilidade do fabricante.
fn configurar_runtime_gstreamer(comando: &mut Command, raiz: &Path) {
    let runtime = raiz.join("runtime").join("gstreamer");
    let bin = runtime.join("bin");
    let plugins = runtime.join("lib").join("gstreamer-1.0");
    let runtime_dir = raiz.join("runtime");
    let node_dir = runtime_dir.join("node");
    let mut prefixes = Vec::new();
    if node_dir.exists() { prefixes.push(node_dir); }
    if bin.exists() { prefixes.push(bin); }
    if !prefixes.is_empty() {
        let current = std::env::var("PATH").unwrap_or_default();
        let prefix = prefixes.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join(";");
        comando.env("PATH", format!("{prefix};{current}"));
    }
    if !runtime.join("bin").exists() { return; }
    comando.env("GSTREAMER_1_0_ROOT_MSVC_X86_64", &runtime);
    comando.env("GST_PLUGIN_PATH", &plugins);
    comando.env("GST_PLUGIN_SYSTEM_PATH", &plugins);
    comando.env("GST_PLUGIN_SCANNER", runtime.join("libexec").join("gstreamer-1.0").join("gst-plugin-scanner.exe"));
    comando.env("GST_REGISTRY", raiz.join(".cache").join("gstreamer-registry.bin"));
    println!("  GStreamer portátil: {}", runtime.display());
}

/// Espera o servidor responder de verdade, não só o processo existir.
fn esperar_porta(root:&Path,database:&Path,endpoint:&LocalEndpoint,child:&mut Child) -> Result<()> {
    let limite = Instant::now() + READY_TIMEOUT;
    while Instant::now() < limite {
        if let Some(status)=child.try_wait()?{return Err(anyhow!("servidor encerrou antes da prontidão ({status})"));}
        if verify_server(root,database,endpoint,Some(child.id())).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    Err(anyhow!("servidor desta instalação não confirmou prontidão na porta {} em 90 segundos",endpoint.port))
}

fn abrir_navegador(endpoint:&LocalEndpoint,workspace: Option<&str>) {
    let endereco = endpoint.url(workspace);
    let resultado = if cfg!(windows) {
        Command::new("cmd").args(["/C", "start", "", &endereco]).spawn()
    } else {
        Command::new("xdg-open").arg(&endereco).spawn()
    };
    if resultado.is_err() {
        println!("Abra o navegador em {endereco}");
    }
}

fn executavel(nome: &str) -> String {
    if cfg!(windows) {
        format!("{nome}.exe")
    } else {
        nome.to_string()
    }
}

#[cfg(test)]
mod launcher_endpoint_tests {
    use super::*;
    #[test]
    fn default_and_configured_port_have_one_url_and_probe_target(){
        let default=configured_endpoint(&[],None,None).unwrap();
        assert_eq!(default.port,4000);assert_eq!(default.url(None),"http://localhost:4000");
        let custom=configured_endpoint(&[],Some("54123"),Some("127.0.0.1")).unwrap();
        assert_eq!(custom.port,54123);assert_eq!(custom.url(Some("qc")),"http://127.0.0.1:54123/?workspace=qc");
        assert_eq!(configured_endpoint(&["--port=49123".into()],Some("invalid"),None).unwrap().port,49123);
    }
    #[test]
    fn malformed_or_repeated_ports_never_spawn_or_fall_back(){
        for value in ["","0","65536","-1","1.5"," 4000","4000\r\n","+4000"]{
            assert!(configured_endpoint(&[],Some(value),None).is_err(),"{value:?}");
        }
        assert!(configured_endpoint(&["--port=4000".into(),"--port=4001".into()],None,None).is_err());
        assert!(configured_endpoint(&["--port".into()],None,None).is_err());
    }
    #[test]
    fn host_and_workspace_cannot_inject_http_or_shell_commands(){
        for host in ["","http://host","127.0.0.1:4000","host&calc","host\r\nOther: yes","%PATH%"]{
            assert!(configured_endpoint(&[],None,Some(host)).is_err(),"{host:?}");
        }
        let endpoint=configured_endpoint(&[],None,Some("::1")).unwrap();
        assert_eq!(endpoint.url(Some("qc&x=1")),"http://[::1]:4000/?workspace=qc%26x%3D1");
    }
    #[test]
    fn tcp_or_foreign_http_is_not_identity(){
        for response in [b"".as_slice(),b"HTTP/1.1 200 OK\r\n\r\n{}",b"HTTP/1.1 302 Found\r\n\r\n{}",b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{}"]{
            assert!(read_identity_response(response).is_err());
        }
        assert!(read_identity_response(&vec![b' ';8193]).is_err());
    }
    fn exercise_identity(wrong_instance:bool,wrong_pid:bool)->Result<()>{
        let root=std::env::temp_dir().join(format!("rplayout-launcher-native-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos()));
        std::fs::create_dir(&root)?;let database=root.join("data.db");std::fs::write(&database,b"own fixture")?;
        let listener=std::net::TcpListener::bind("127.0.0.1:0")?;
        let port=listener.local_addr()?.port();
        let instance="12345678-1234-1234-1234-123456789012";
        let record=serde_json::json!({"application":"RPlayout","version":1,"port":port,"pid":12345,"instanceId":instance,"root":root,"database":database});
        std::fs::write(root.join(format!(".rplayout-launcher-{port}.json")),serde_json::to_vec(&record)?)?;
        listener.set_nonblocking(true)?;
        let thread=std::thread::spawn(move||{
            let deadline=Instant::now()+Duration::from_secs(3);
            let mut socket=loop {
                match listener.accept(){Ok((socket,_))=>break socket,Err(error) if error.kind()==std::io::ErrorKind::WouldBlock&&Instant::now()<deadline=>std::thread::sleep(Duration::from_millis(5)),Err(error)=>panic!("own test accept failed: {error}")}
            };
            socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut bytes=[0;4096];let size=socket.read(&mut bytes).unwrap();let request=String::from_utf8_lossy(&bytes[..size]);
            assert!(request.starts_with("GET /_rplayout/launcher HTTP/1.1\r\n"));assert!(!request.contains(instance));
            let body=serde_json::json!({"application":"RPlayout","version":1,"port":port,"pid":if wrong_pid{54321}else{12345},"instanceId":if wrong_instance{"foreign-instance"}else{instance}}).to_string();
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        });
        let endpoint=configured_endpoint(&[],Some(&port.to_string()),Some("127.0.0.1"))?;
        let verified=verify_server(&root,&database,&endpoint,Some(12345));thread.join().unwrap();
        verified
    }
    #[test]
    fn http_identity_and_private_descriptor_must_both_match(){exercise_identity(false,false).unwrap();}
    #[test]
    fn http_identity_stale_or_forged_instance_is_refused(){assert!(exercise_identity(true,false).is_err());}
    #[test]
    fn http_identity_pid_mismatch_is_refused(){assert!(exercise_identity(false,true).is_err());}
}
