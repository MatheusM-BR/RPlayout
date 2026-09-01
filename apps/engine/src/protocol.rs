//! Contrato entre o servidor e o engine.
//!
//! Uma linha JSON por mensagem, comandos entrando pelo stdin e eventos saindo
//! pelo stdout. Log vai para o stderr, para nunca contaminar o canal de dados.

use serde::{Deserialize, Serialize};

use crate::output::Report;

/// Item que o engine coloca no ar. Tempos em frames, como no resto do sistema.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSpec {
    pub item_id: String,
    /// Arquivo do acervo. Vazio quando o item é ao vivo.
    #[serde(default)]
    pub path: String,
    /// Fonte ao vivo: `srt://...`, `rtsp://...`, `sdi:0`, `ndi:Nome`.
    ///
    /// Preenchido, manda: item ao vivo não tem corte, não termina sozinho e
    /// quem decide quando ele sai é a grade, não o arquivo.
    #[serde(default)]
    pub source: Option<String>,
    pub trim_in: i64,
    pub trim_out: i64,
    /// Ganho de nivelamento já resolvido pelo servidor.
    pub gain_db: f64,
    /// O que fazer quando a proporção do material não é a do canal.
    #[serde(default)]
    pub fit: Fit,
    /// Qual trilha de áudio tocar, na ordem em que o arquivo as declara.
    ///
    /// Arquivo com dublagem, idioma original e trilha internacional é comum, e
    /// pegar sempre a primeira é escolha, não padrão neutro.
    #[serde(default)]
    pub audio_track: usize,
}

/// Proporção diferente da do canal. Deformar não é opção.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Fit {
    /// Mostra o quadro inteiro e preenche a sobra com preto.
    #[default]
    Pillarbox,
    /// Enche a tela e corta o que passa da borda.
    Crop,
}

impl ItemSpec {
    pub fn is_live(&self) -> bool {
        self.source.is_some()
    }
}

/// Entrada e saída de grafismo. Curto o bastante para não atrasar quem opera,
/// longo o bastante para não parecer defeito.
fn default_fade() -> u64 {
    300
}

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Command {
    /// Arma um item: abre, decodifica e para no primeiro frame do corte.
    Load { item: ItemSpec },
    /// Grafismo: SVG já preenchido, ou nada para tirar do ar.
    Graphic {
        #[serde(default)]
        svg: Option<String>,
        #[serde(default = "default_fade")]
        fade_ms: u64,
    },
    /// Coloca no ar o que estiver armado.
    Take,
    /// Abre um arquivo no preview, ou fecha o que estiver aberto.
    Preview { item: Option<ItemSpec> },
    /// Tira do ar e volta para o preto.
    Stop,
    /// Muda o ganho do item no ar sem interromper nada.
    SetGain { gain_db: f64 },
    Status,
    Shutdown,
}

#[derive(Debug, Deserialize)]
pub struct Envelope {
    pub id: u64,
    #[serde(flatten)]
    pub command: Command,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    Ready {
        channel_id: String,
        width: i32,
        height: i32,
        fps: f64,
    },
    Ack {
        id: u64,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    State {
        #[serde(skip_serializing_if = "Option::is_none")]
        on_air: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        armed: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        preview: Option<String>,
        /// Se há grafismo no ar. O operador precisa saber sem olhar o monitor.
        graphic: bool,
    },
    /// Posição do item no ar, em frames desde o ponto de entrada.
    Position {
        item_id: String,
        frames: i64,
        duration: i64,
    },
    Eos {
        item_id: String,
    },
    /// Fonte ao vivo caiu. Não é fim de item: a grade não anda por causa disto,
    /// e o engine fica tentando reabrir até a hora marcada de sair.
    SourceLost {
        item_id: String,
        reason: String,
    },
    /// Medição pela BS.1770-4. Pico em dBFS, loudness em LUFS, faixa em LU.
    /// Não é RMS: tem ponderação K e gate.
    Levels {
        /// Qual barramento: `pgm` ou `pvw`.
        bus: &'static str,
        peak: Vec<f64>,
        momentary: f64,
        short_term: f64,
        integrated: f64,
        range: f64,
        true_peak: f64,
        correlation: f64,
        /// Redução do limiter em dB. Zero é o estado saudável.
        gain_reduction: f64,
    },
    /// Quantos frames o compositor entregou. É a prova de que o PGM não parou.
    Output {
        frames: u64,
    },
    /// Situação de uma saída de rede. Emitido quando muda e no `status`, para
    /// a interface saber se o canal está de fato chegando ao destino.
    Publisher {
        #[serde(flatten)]
        report: Report,
    },
    Error {
        message: String,
    },
}

impl Event {
    /// Serializa numa linha. Falha de serialização vira log, nunca pânico: o
    /// engine não pode morrer por causa de uma mensagem malformada.
    pub fn emit(&self) {
        match serde_json::to_string(self) {
            Ok(line) => {
                // Quem lê isto é um supervisor, não um terminal: sem flush o
                // stdout fica em bloco e o servidor passa minutos sem notícia.
                println!("{line}");
                let _ = std::io::Write::flush(&mut std::io::stdout());
            }
            Err(error) => eprintln!("[engine] evento não serializou: {error}"),
        }
    }
}
