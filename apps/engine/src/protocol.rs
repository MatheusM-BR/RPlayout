//! Contrato entre o servidor e o engine.
//!
//! Uma linha JSON por mensagem, comandos entrando pelo stdin e eventos saindo
//! pelo stdout. Log vai para o stderr, para nunca contaminar o canal de dados.

use serde::{Deserialize, Serialize};

use crate::output::Report;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSignalReport {
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub rate_num: Option<i32>,
    pub rate_den: Option<i32>,
    pub interlace_mode: Option<String>,
    pub audio_channels: Option<i32>,
    pub sample_rate: Option<i32>,
    pub video_age_ms: Option<u64>,
    pub audio_age_ms: Option<u64>,
    pub video_present: bool,
    pub audio_present: bool,
    pub received_frames: u64,
    /// Variation at the decoded input pad, not network RTT or packet jitter.
    pub arrival_jitter_ms: Option<f64>,
}

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
    #[serde(default)]
    pub source_type: Option<String>,
    #[serde(default)]
    pub fallback_path: Option<String>,
    pub trim_in: i64,
    pub trim_out: i64,
    /// Recovery cursor relative to Mark In. Seek before TAKE, never flash frame zero.
    #[serde(default)]
    pub start_offset_frames: i64,
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
    #[serde(default)]
    pub audio_routing:crate::audio_routing::AudioRouting,
    /// Additional real signals from the selected track, not copies of PGM.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub auxiliary_pairs: Vec<crate::audio_bus::AuxiliaryPair>,
    #[serde(default)]
    pub auto_follow_on_end: bool,
    #[serde(default)]
    pub emergency_cut_fade_ms: Option<u64>,
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
    pub fn start_frame(&self) -> i64 {
        if self.is_live() { return 0; }
        self.trim_in + self.start_offset_frames.clamp(0, (self.trim_out - self.trim_in - 1).max(0))
    }
    pub fn is_live(&self) -> bool {
        self.source.is_some()
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::ItemSpec;
    #[test]
    fn recovery_cursor_keeps_marks_and_clamps_before_eos() {
        let mut spec: ItemSpec = serde_json::from_str(r#"{"itemId":"vt","trimIn":100,"trimOut":350,"gainDb":0,"startOffsetFrames":125}"#).unwrap();
        assert_eq!(spec.start_frame(), 225);
        spec.start_offset_frames = 999;
        assert_eq!(spec.start_frame(), 349);
        spec.start_offset_frames = -10;
        assert_eq!(spec.start_frame(), 100);
        spec.source = Some("ndi:STUDIO".into());
        assert_eq!(spec.start_frame(), 0);
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
    /// Bound to the current preview, never a CUE, LOAD or TAKE.
    QcMonitor { item_id: String, on: bool },
    /// Private owning server only, before or during pipeline construction.
    FenceGrant { owner_id: String, nonce: u64, term: u64, ttl_ms: u64 },
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
    /// Cancela um TAKE ao vivo que ainda aguarda o primeiro quadro. O PGM
    /// continua intacto; só a fonte pendente é liberada.
    CancelTake,
    /// Abre um arquivo no preview, ou fecha o que estiver aberto.
    Preview { item: Option<ItemSpec> },
    /// Tira do ar e volta para o preto.
    Stop,
    /// Muda o ganho do item no ar sem interromper nada.
    SetGain { gain_db: f64 },
    /// Posiciona arquivo do programa ou preview em frames desde o Mark In.
    Seek { bus: String, frames: i64 },
    /// Liga ou desliga um monitor ("pvw", "mon") sob demanda.
    ///
    /// Os pipelines de saída são independentes do do canal, então parar um
    /// monitor não encosta no programa. É o que permite não codificar para uma
    /// janela que ninguém abriu.
    Monitor { bus: String, on: bool },
    /// Troca um destino já ligado ao barramento do programa.
    /// Só suporta RTMP, SRT e arquivo; SDI/NDI/OMT não fazem hot-switch.
    ReplaceOutput {
        output_id: String,
        output: crate::channel::OutputSpec,
    },
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
    FenceRequest { owner_id: String, nonce: u64 },
    FenceApplied { nonce: u64, term: u64 },
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
    /// Posição do arquivo aberto no preview.
    PreviewPosition {
        item_id: String,
        frames: i64,
        duration: i64,
    },
    Eos {
        item_id: String,
    },
    ItemError {
        item_id: String,
        bus: &'static str,
        message: String,
    },
    /// Fonte ao vivo caiu. Não é fim de item: a grade não anda por causa disto,
    /// e o engine fica tentando reabrir até a hora marcada de sair.
    SourceLost {
        item_id: String,
        reason: String,
    },
    /// Primeiro quadro de uma entrada viva recebido pelo barramento indicado.
    SourceReady {
        item_id: String,
        bus: &'static str,
    },
    SourceTelemetry {
        item_id: String,
        bus: &'static str,
        signal: SourceSignalReport,
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
    /// Análise reduzida do vídeo que sai do compositor PGM.
    VideoProbe {
        luma: f64,
        black: bool,
        freeze: bool,
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
    /// Aviso que o operador precisa ver, não só o log.
    ///
    /// O caso que motivou isto: quando a máquina não dá conta, o sink começa a
    /// descartar quadro e o GStreamer avisa -- no stderr, onde ninguém olha. Do
    /// lado de fora aparece só imagem engasgando, sem explicação. Nem todo aviso
    /// vira isto: só os que dizem alguma coisa a quem opera.
    Warning {
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
