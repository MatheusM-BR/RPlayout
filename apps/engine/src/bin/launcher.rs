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
    println!("RPlayout · instalação em {}", raiz.display());

    if !raiz.join("apps/web/dist/index.html").exists() {
        println!();
        println!("A interface ainda não foi construída. Rode uma vez:");
        println!("    pnpm install");
        println!("    pnpm build");
        println!();
        return Err(anyhow!("apps/web/dist não existe"));
    }

    let mut servidor = subir_servidor(&raiz)?;

    match esperar_porta() {
        Ok(()) => {
            println!("RPlayout no ar em http://localhost:{PORT}");
            abrir_navegador();
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
    let saida = servidor.wait().context("o servidor encerrou de forma inesperada")?;
    println!("O servidor encerrou ({saida}).");
    Ok(())
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

fn abrir_navegador() {
    let endereco = format!("http://localhost:{PORT}");
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
