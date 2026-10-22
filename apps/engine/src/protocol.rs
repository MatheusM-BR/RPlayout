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
    /// Sparse decoded-content warning, not proof that a static scene failed.
    pub sampled_content_unchanged_ms:Option<u64>,
    pub content_sample_age_ms:Option<u64>,
    pub content_sample_frames:u64,
}

/// Observed native decoder cursor when admitting the held program outputs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramAdmissionCursor {
    pub paused:bool,
    pub elapsed:i64,
    pub first_video_confirmed:bool,
    pub trim:Option<ProgramAdmissionTrim>,
}
#[derive(Debug, Clone, Serialize)]
pub struct ProgramAdmissionTrim {pub r#in:i64,pub out:i64}

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
    /// Opaque catalog selection forwarded by the server, not a device identity.
    #[serde(default)]
    pub configured_source_id: Option<String>,
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
    /// A live decoder cannot seek. Its new clock starts at zero after recovery,
    /// but the operational occurrence must continue from the saved cursor.
    /// Files already seek to start_frame and must not add this offset twice.
    pub fn program_frames(&self, pipeline_frames:i64)->i64 {
        if self.is_live() {
            pipeline_frames.max(0).saturating_add(self.start_offset_frames.max(0))
        }else{
            pipeline_frames.saturating_sub(self.trim_in).max(0)
        }
    }
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
    fn live_position_preserves_cursor_without_seeking_or_double_offset_for_files() {
        let mut spec:ItemSpec=serde_json::from_str(r#"{"itemId":"live","source":"ndi:STUDIO","trimIn":100,"trimOut":350,"gainDb":0,"startOffsetFrames":84}"#).unwrap();
        assert_eq!(spec.start_frame(),0);
        assert_eq!(spec.program_frames(0),84);
        assert_eq!(spec.program_frames(25),109);
        assert_eq!(spec.program_frames(-1),84);
        spec.start_offset_frames=-10;
        assert_eq!(spec.program_frames(25),25);
        spec.start_offset_frames=i64::MAX;
        assert_eq!(spec.program_frames(25),i64::MAX);
        spec.source=None;spec.start_offset_frames=84;
        assert_eq!(spec.program_frames(184),84);
        assert_eq!(spec.program_frames(99),0);
    }
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
    /// Bound to the QC decoder's source, never a CUE, LOAD or TAKE.
    QcMonitor { item_id: String, on: bool },
    /// Opens/closes the QC's own live decoder. Never touches PVW or PGM.
    QcSource { item: Option<ItemSpec> },
    /// Private owning server only, before or during pipeline construction.
    FenceGrant { owner_id: String, nonce: u64, term: u64, ttl_ms: u64 },
    ReleaseProgramOutputs { owner_id:String,term:u64,item_id:Option<String>,decoder_id:Option<u64> },
    ReleasePreviewOutput { owner_id:String,term:u64 },
    /// Monitor of an admitted HA generation; never a source selection or TAKE.
    MonitorAdmitted { owner_id:String,term:u64,bus:String,on:bool },
    /// Arma um item: abre, decodifica e para no primeiro frame do corte.
    Load { item: ItemSpec },
    /// Independent decoder; never LOAD/TAKE or an editorial occurrence.
    PrepareLiveReplacement { request: crate::live_replacement::Request },
    /// Explicit commit, bound to this process's prepared decoder and lease.
    /// owner/term are required exactly when an HA fence is installed (see fencing::commit_authority).
    CommitLiveReplacement { engine_generation: String, transaction_id: String, prepared_decoder_id: u64, #[serde(default)] owner_id: Option<String>, #[serde(default)] term: Option<u64> },
    CancelLiveReplacement { engine_generation: String, transaction_id: String },
    LiveReplacementStatus { engine_generation: String, transaction_id: String },
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
    /// File PGM only, bound to the exact current decoder generation.
    ProgramHold { item_id:String, decoder_id:u64, on:bool },
    /// Fresh/idle PGM only; restores a file at startOffsetFrames in PAUSED.
    RestoreProgramHold {item:ItemSpec},
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
#[serde(rename_all="camelCase")]
pub struct ProgramHoldState {
    pub item_id:String,
    pub decoder_id:u64,
    pub status:&'static str,
    pub frames:Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    /// Native selector receipt, not a durable checkpoint or physical proof.
    LiveReplacement { id: Option<u64>, receipt: crate::live_replacement::Receipt, replayed: bool },
    /// Receipt emitted only after native state and cursor confirmation.
    ProgramHold { id:u64,item_id:String,decoder_id:u64,held:bool,frames:i64 },
    FenceRequest { owner_id: String, nonce: u64 },
    FenceApplied { nonce: u64, term: u64 },
    ProgramOutputs { held:bool,owner_id:String,term:u64,item_id:Option<String>,decoder_id:Option<u64>,cursor:ProgramAdmissionCursor },
    Ready {
        channel_id: String,
        width: i32,
        height: i32,
        fps: f64,
        decoder_identity: bool,
        program_admission: bool,
        program_outputs_held: bool,
        preview_admission: bool,
        live_replacement_protocol: u32,
        engine_generation: String,
    },
    Ack {
        id: u64,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        decoder_id: Option<u64>,
    },
    State {
        #[serde(skip_serializing_if = "Option::is_none")]
        on_air: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        armed: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        preview: Option<String>,
        on_air_decoder_id: Option<u64>,
        armed_decoder_id: Option<u64>,
        program_hold:Option<ProgramHoldState>,
        program_selection_uncertain: bool,
        /// Se há grafismo no ar. O operador precisa saber sem olhar o monitor.
        graphic: bool,
    },
    /// Posição do item no ar, em frames desde o ponto de entrada.
    Position {
        item_id: String,
        decoder_id: Option<u64>,
        frames: i64,
        duration: i64,
    },
    /// Posição do arquivo aberto no preview.
    PreviewFrame {
        item_id: String,
        decoder_id: u64,
        delivered: bool,
        age_ms: Option<u64>,
        paused_file: bool,
    },
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
        decoder_id: Option<u64>,
        message: String,
    },
    /// Fonte ao vivo caiu. Não é fim de item: a grade não anda por causa disto,
    /// e o engine fica tentando reabrir até a hora marcada de sair.
    SourceLost {
        item_id: String,
        decoder_id: Option<u64>,
        reason: String,
    },
    /// Primeiro quadro de uma entrada viva recebido pelo barramento indicado.
    SourceReady {
        item_id: String,
        bus: &'static str,
        decoder_id: Option<u64>,
        configured_source_id: Option<String>,
    },
    SourceTelemetry {
        item_id: String,
        bus: &'static str,
        decoder_id: Option<u64>,
        configured_source_id: Option<String>,
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
        freeze_duration_ms: u64,
        sample_age_ms: Option<u64>,
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

#[cfg(test)]
mod program_admission_tests {
    use super::*;
    #[test]
    fn live_replacement_wire_requires_generation_and_bound_prepare_context() {
        let request = serde_json::json!({"transactionId":"tx-1","engineGeneration":"generation-a",
            "selectionRevision":"pair-revision-17","itemId":"live-1","expectedDecoderId":7,
            "expectedSourceId":"primary","targetSourceId":"backup","targetSourceType":"NDI","targetSource":"ndi:Estúdio Çãó"});
        let envelope: Envelope = serde_json::from_value(serde_json::json!({"id":90,"cmd":"prepareLiveReplacement","request":request})).unwrap();
        match envelope.command {
            Command::PrepareLiveReplacement { request } => {
                request.validate().unwrap(); assert_eq!(request.target_source,"ndi:Estúdio Çãó");
            }, _ => panic!("wrong preparation command"),
        }
        let mut missing = request.clone(); missing.as_object_mut().unwrap().remove("engineGeneration");
        assert!(serde_json::from_value::<Envelope>(serde_json::json!({"id":90,"cmd":"prepareLiveReplacement","request":missing})).is_err());
        let mut extra = request.clone(); extra["gainDb"] = serde_json::json!(12);
        assert!(serde_json::from_value::<Envelope>(serde_json::json!({"id":90,"cmd":"prepareLiveReplacement","request":extra})).is_err());
        assert!(serde_json::from_value::<Envelope>(serde_json::json!({"id":91,"cmd":"commitLiveReplacement","transactionId":"tx-1","preparedDecoderId":8,"ownerId":"owner","term":17})).is_err());
    }

    #[test]
    fn commit_without_owner_term_parses_for_the_non_ha_private_pipe() {
        let envelope: Envelope = serde_json::from_value(serde_json::json!({"id":92,"cmd":"commitLiveReplacement","engineGeneration":"generation-a","transactionId":"tx-1","preparedDecoderId":8})).unwrap();
        assert!(matches!(envelope.command, Command::CommitLiveReplacement { owner_id: None, term: None, prepared_decoder_id: 8, .. }));
    }
    #[test]
    fn commit_cancel_and_status_are_bound_to_the_same_engine_generation() {
        for command in ["commitLiveReplacement", "cancelLiveReplacement", "liveReplacementStatus"] {
            let value = serde_json::json!({"id":91,"cmd":command,"engineGeneration":"generation-a","transactionId":"tx-1",
                "preparedDecoderId":8,"ownerId":"owner","term":17});
            let envelope: Envelope = serde_json::from_value(value).unwrap();
            match envelope.command {
                Command::CommitLiveReplacement {engine_generation,transaction_id,prepared_decoder_id:8,term:Some(17),..}
                    | Command::CancelLiveReplacement {engine_generation,transaction_id}
                    | Command::LiveReplacementStatus {engine_generation,transaction_id} => {
                        assert_eq!(engine_generation,"generation-a"); assert_eq!(transaction_id,"tx-1");
                    }, _ => panic!("unbound live replacement command"),
            }
        }
    }
    #[test]
    fn program_hold_wire_requires_exact_decoder_and_correlates_receipt(){
        let envelope:Envelope=serde_json::from_value(serde_json::json!({"id":24,"cmd":"programHold","itemId":"vt","decoderId":7,"on":true})).unwrap();
        assert_eq!(envelope.id,24);
        assert!(matches!(envelope.command,Command::ProgramHold{item_id,decoder_id:7,on:true} if item_id=="vt"));
        assert!(serde_json::from_value::<Envelope>(serde_json::json!({"id":24,"cmd":"programHold","itemId":"vt","on":true})).is_err());
        assert_eq!(serde_json::to_value(Event::ProgramHold{id:24,item_id:"vt".into(),decoder_id:7,held:true,frames:36}).unwrap(),serde_json::json!({"event":"programHold","id":24,"itemId":"vt","decoderId":7,"held":true,"frames":36}));
    }
    #[test]
    fn restore_program_hold_wire_preserves_trim_and_offset(){
        let envelope:Envelope=serde_json::from_value(serde_json::json!({"id":25,"cmd":"restoreProgramHold","item":{"itemId":"vt","path":"fixture.mkv","trimIn":25,"trimOut":200,"startOffsetFrames":61,"gainDb":0}})).unwrap();
        assert_eq!(envelope.id,25);
        match envelope.command{Command::RestoreProgramHold{item}=>{
            assert_eq!(item.item_id,"vt");assert_eq!(item.start_frame(),86);assert_eq!(item.start_offset_frames,61);assert_eq!(item.trim_out,200);
        },_=>panic!("wrong restoration command")}
    }
    #[test]
    fn preview_admission_uses_owner_term_not_a_new_destination() {
        let command:Envelope=serde_json::from_value(serde_json::json!({"id":18,"cmd":"releasePreviewOutput","ownerId":"owner","term":7})).unwrap();
        match command.command {Command::ReleasePreviewOutput {owner_id,term}=>{assert_eq!(owner_id,"owner");assert_eq!(term,7);},_=>panic!("wrong preview command")}
    }
    #[test]
    fn position_carries_native_decoder_identity() {
        let value=serde_json::to_value(Event::Position {item_id:"vt".into(),decoder_id:Some(31),frames:73,duration:250}).unwrap();
        assert_eq!(value,serde_json::json!({"event":"position","itemId":"vt","decoderId":31,"frames":73,"duration":250}));
    }
    // NOT_RUN in this batch. Wire fixtures do not certify GStreamer/hardware.
    #[test]
    fn release_and_proof_bind_exact_owner_term_item_decoder() {
        let envelope:Envelope=serde_json::from_value(serde_json::json!({
            "id":17,"cmd":"releaseProgramOutputs","ownerId":"owner","term":7,"itemId":"vt","decoderId":31
        })).unwrap();
        assert_eq!(envelope.id,17);
        match envelope.command {
            Command::ReleaseProgramOutputs {owner_id,term,item_id,decoder_id}=>{
                assert_eq!(owner_id,"owner");assert_eq!(term,7);
                assert_eq!(item_id.as_deref(),Some("vt"));assert_eq!(decoder_id,Some(31));
            },_=>panic!("wrong native command"),
        }
        let proof=serde_json::to_value(Event::ProgramOutputs {held:false,owner_id:"owner".into(),term:7,item_id:Some("vt".into()),decoder_id:Some(31),cursor:ProgramAdmissionCursor {paused:false,elapsed:80,first_video_confirmed:true,trim:Some(ProgramAdmissionTrim {r#in:10,out:500})}}).unwrap();
        assert_eq!(proof,serde_json::json!({"event":"programOutputs","held":false,"ownerId":"owner","term":7,"itemId":"vt","decoderId":31,"cursor":{"paused":false,"elapsed":80,"firstVideoConfirmed":true,"trim":{"in":10,"out":500}}}));
    }
    #[test]
    fn idle_proof_keeps_explicit_null_cursor_not_missing_identity() {
        let proof=serde_json::to_value(Event::ProgramOutputs {held:false,owner_id:"owner".into(),term:7,item_id:None,decoder_id:None,cursor:ProgramAdmissionCursor {paused:false,elapsed:0,first_video_confirmed:false,trim:None}}).unwrap();
        assert_eq!(proof.get("itemId"),Some(&serde_json::Value::Null));
        assert_eq!(proof.get("decoderId"),Some(&serde_json::Value::Null));
    }
}
