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
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Quanto esperar o servidor responder antes de desistir e mostrar o log.
const READY_TIMEOUT: Duration = Duration::from_secs(90);
const PORT: u16 = 4000;

fn main() -> Result<()> {
    let raiz = raiz_da_instalacao()?;
    let argumentos: Vec<String> = std::env::args().skip(1).collect();
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

    // Duplo clique no atalho não pode criar um segundo servidor, e portanto
    // nem uma segunda família de engines disputando os mesmos destinos. Se a
    // API já responde, reaproveitamos a instância existente e só mostramos a
    // interface.
    if std::net::TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
        println!("RPlayout já está em execução na porta {PORT}; reutilizando a instância.");
        if !somente_servidor { abrir_navegador(workspace.as_deref()); }
        return Ok(());
    }

    let mut servidor = subir_servidor(&raiz)?;

    match esperar_porta() {
        Ok(()) => {
            println!("RPlayout no ar em http://localhost:{PORT}");
            if !somente_servidor { abrir_navegador(workspace.as_deref()); }
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
    let pid = servidor.id();
    let saida = match servidor.wait() {
        Ok(status) => status,
        Err(error) => {
            encerrar_arvore(pid);
            return Err(error).context("o servidor encerrou de forma inesperada");
        }
    };
    encerrar_arvore(pid);
    println!("O servidor encerrou ({saida}).");
    Ok(())
}

/// O launcher sobe `cmd -> pnpm -> node`; matar só o primeiro processo deixa
/// descendentes vivos no Windows. Limpe a árvore ao sair para não criar
/// engines órfãos na próxima execução.
fn encerrar_arvore(pid: u32) {
    if !cfg!(windows) { return; }
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output();
}

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
fn subir_servidor(raiz: &Path) -> Result<Child> {
    let mut comando = shell();
    comando.current_dir(raiz);
    configurar_runtime_gstreamer(&mut comando, raiz);

    let bin = raiz.join("apps/engine/target/release");
    let opcionais = [
        ("RPLAYOUT_ENGINE", bin.join(executavel("rplayout-engine"))),
        ("RPLAYOUT_PROBE", bin.join(executavel("rplayout-probe"))),
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
    if std::env::var("RPLAYOUT_MEDIA").is_err() {
        comando.env("RPLAYOUT_MEDIA", raiz.join("midia"));
    }

    comando
        .arg("pnpm --filter @rplayout/server start")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());

    let mut filho = comando.spawn().context("não consegui subir o servidor (o pnpm está no PATH?)")?;

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
    let pnpm_dir = runtime_dir.join("pnpm");
    if pnpm_dir.exists() { prefixes.push(pnpm_dir); }
    if bin.exists() { prefixes.push(bin); }
    if !prefixes.is_empty() {
        let current = std::env::var("PATH").unwrap_or_default();
        let prefix = prefixes.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join(";");
        comando.env("PATH", format!("{prefix};{current}"));
    }
    if !runtime.join("bin").exists() { return; }
    comando.env("GSTREAMER_1_0_ROOT_MSVC_X86_64", &runtime);
    comando.env("GST_PLUGIN_PATH", &plugins);
    comando.env("GST_REGISTRY_1_0_FILE", raiz.join(".cache").join("gstreamer-registry.bin"));
    println!("  GStreamer portátil: {}", runtime.display());
}

/// Espera o servidor responder de verdade, não só o processo existir.
fn esperar_porta() -> Result<()> {
    let limite = Instant::now() + READY_TIMEOUT;
    while Instant::now() < limite {
        if std::net::TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    Err(anyhow!("nada atendeu na porta {PORT} em 90 segundos"))
}

fn abrir_navegador(workspace: Option<&str>) {
    let endereco = match workspace {
        Some(nome) => format!("http://localhost:{PORT}/?workspace={nome}"),
        None => format!("http://localhost:{PORT}"),
    };
    let resultado = if cfg!(windows) {
        Command::new("cmd").args(["/C", "start", "", &endereco]).spawn()
    } else {
        Command::new("xdg-open").arg(&endereco).spawn()
    };
    if resultado.is_err() {
        println!("Abra o navegador em {endereco}");
    }
}

fn shell() -> Command {
    if cfg!(windows) {
        let mut comando = Command::new("cmd");
        comando.arg("/C");
        comando
    } else {
        let mut comando = Command::new("sh");
        comando.arg("-c");
        comando
    }
}

fn executavel(nome: &str) -> String {
    if cfg!(windows) {
        format!("{nome}.exe")
    } else {
        nome.to_string()
    }
}
