//! Engine de vídeo do RPlayout.
//!
//! Um processo por canal. Não guarda estado de grade nem sabe o que é uma
//! âncora: recebe ordens do servidor e informa o que está acontecendo. Toda a
//! inteligência de tempo continua no `packages/scheduler`.

mod channel;
mod audio_routing;
mod audio_bus;
mod loudness;
mod limiter;
mod limiter_element;
mod output;
mod omt;
mod omt_runtime;
mod protocol;
mod live_replacement;
mod bootstrap;
mod fencing;

use anyhow::{anyhow, Context, Result};
use channel::{Channel, Config, Output, Scan};
use gstreamer as gst;
use gstreamer::prelude::GstObjectExt;
use protocol::{Command, Envelope, Event};
use std::io::BufRead;
use std::sync::mpsc;
use std::time::{Duration, Instant};

const POSITION_EVERY: Duration = Duration::from_millis(100);
/// O medidor entrega dez vezes por segundo, que é a cadência do bloco de
/// 100 ms da R128 e o mínimo para um VU não parecer travado.
const METER_EVERY: Duration = Duration::from_millis(100);
/// Espera entre tentativas de reabrir uma fonte ao vivo que caiu. Curta o
/// bastante para o estúdio voltar rápido, longa o bastante para não inundar a
/// rede de tentativas.
const LIVE_RETRY: Duration = Duration::from_secs(2);
const OUTPUT_EVERY: Duration = Duration::from_secs(1);

fn parse_args(input: &mut impl BufRead) -> Result<(Config, Option<String>, Option<Output>,bool)> {
    let mut channel_id = String::from("canal");
    let mut width = 1920;
    let mut height = 1080;
    let mut fps_n = 50;
    let mut fps_d = 1;
    let mut bitrate_kbps = 4000;
    let mut ceiling_dbtp = -1.0;
    let mut audio_channels = 2;
    let mut scan = Scan::Progressive;
    let mut top_field_first = true;
    let mut outputs = Vec::new();
    let mut preview = None;
    let mut qc_preview = None;
    let mut private_outputs = false;
    let mut fence_owner = None;
    let mut hold_program_outputs=false;

    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < args.len() {
        let flag = args[index].as_str();
        let mut value = || -> Result<String> {
            index += 1;
            args.get(index)
                .cloned()
                .ok_or_else(|| anyhow!("{flag} precisa de um valor"))
        };

        match flag {
            "--channel-id" => channel_id = value()?,
            "--width" => width = value()?.parse().context("--width")?,
            "--height" => height = value()?.parse().context("--height")?,
            "--fps-num" => fps_n = value()?.parse().context("--fps-num")?,
            "--fps-den" => fps_d = value()?.parse().context("--fps-den")?,
            "--bitrate" => bitrate_kbps = value()?.parse().context("--bitrate")?,
            "--ceiling" => ceiling_dbtp = value()?.parse().context("--ceiling")?,
            "--audio-channels" => audio_channels = value()?.parse().context("--audio-channels")?,
            "--scan" => scan = Scan::parse(&value()?)?,
            "--field-order" => top_field_first = value()? != "bff",
            "--output" => outputs.push(Output::parse(&value()?)?),
            "--preview" => preview = Some(Output::parse(&value()?)?),
            "--private-outputs-stdin" => private_outputs = true,
            other => return Err(anyhow!("argumento desconhecido: {other}")),
        }
        index += 1;
    }

    if private_outputs {
        if !outputs.is_empty() || preview.is_some() {
            return Err(anyhow!("Configuração privada não admite destinos também nos argumentos."));
        }
        let private: bootstrap::EngineOutputs = bootstrap::read(input)?;
        fence_owner = private.fence_owner;
        hold_program_outputs=private.hold_program_outputs;
        outputs = private.outputs.iter().map(|value| Output::parse(value)
            .map_err(|_| anyhow!("Destino inválido na configuração privada."))).collect::<Result<_>>()?;
        preview = private.preview.as_deref().map(Output::parse).transpose()
            .map_err(|_| anyhow!("Preview inválido na configuração privada."))?;
        qc_preview = private.qc_preview.as_deref().map(Output::parse).transpose()
            .map_err(|_| anyhow!("Inspeção inválida na configuração privada."))?;
    }
    if outputs.is_empty() {
        outputs.push(Output::Null);
    }

    audio_bus::validate_channels(audio_channels)?;
    Ok((Config {
        channel_id,
        width,
        height,
        fps_n,
        fps_d,
        bitrate_kbps,
        ceiling_dbtp,
        audio_channels,
        scan,
        top_field_first,
        outputs,
        preview,
    }, fence_owner, qc_preview,hold_program_outputs))
}

/// Empacota uma leitura do medidor para o protocolo.
fn levels(bus: &'static str, reading: &channel::Reading) -> Event {
    Event::Levels {
        bus,
        peak: reading.peak_dbfs.to_vec(),
        momentary: reading.momentary_lufs,
        short_term: reading.short_term_lufs,
        integrated: reading.integrated_lufs,
        range: reading.range_lu,
        true_peak: reading.true_peak_dbtp,
        correlation: reading.correlation,
        gain_reduction: reading.gain_reduction_db,
    }
}

/// Estado atual do canal, emitido depois de toda ordem que o altera.
fn announce(channel: &Channel) {
    Event::State {
        on_air: channel.on_air_id(),
        armed: channel.armed_id(),
        preview: channel.preview_id(),
        on_air_decoder_id: channel.decoder_id("pgm"),
        armed_decoder_id: channel.decoder_id("armed"),
        program_hold:channel.program_hold_state(),
        program_selection_uncertain: channel.program_selection_uncertain(),
        graphic: channel.graphic_on_air(),
    }
    .emit();
}

fn emit_replacement_receipt(channel: &mut Channel, id: u64, receipt: live_replacement::Receipt, replayed: bool) {
    // A synchronous result subsumes queued readiness/result for that key.
    // Keep events about a previous, expired transaction before this result.
    for previous in channel.live_replacement_events() {
        if previous.transaction_id != receipt.transaction_id {
            Event::LiveReplacement { id: None, receipt: previous, replayed: false }.emit();
        }
    }
    Event::LiveReplacement { id: Some(id), receipt, replayed }.emit();
}

fn poll_live_replacement(channel: &mut Channel) {
    channel.service_live_replacement();
    for receipt in channel.live_replacement_events() {
        Event::LiveReplacement { id: None, receipt, replayed: false }.emit();
    }
}

/// An asynchronously rejected live preroll is an item fault, not an engine
/// fault. The previous program and all independent outputs must stay alive.
fn poll_pending_take(channel:&mut Channel)->(bool,Option<Event>) {
    let candidate=channel.armed_id();
    let decoder_id=channel.decoder_id("armed");
    match channel.service_pending_take() {
        Ok(Some(_))=>(true,None),
        Ok(None)=>(false,None),
        Err(error)=>(true,Some(match candidate {
            Some(item_id)=>Event::ItemError{item_id,bus:"pgm",decoder_id,message:format!("TAKE recusado: {error}; PGM anterior preservado")},
            None=>Event::Error{message:format!("TAKE pendente recusado: {error}; PGM anterior preservado")},
        })),
    }
}

#[derive(Default)]
struct LiveRecovery {
    target: Option<(String, u64)>,
    retry_at: Option<Instant>,
    pending_decoder: Option<u64>,
}

impl LiveRecovery {
    fn lost(&mut self, target: (String, u64), now: Instant) {
        if self.target.as_ref() != Some(&target) {
            self.target = Some(target);
            self.retry_at = Some(now + LIVE_RETRY);
            self.pending_decoder = None;
        }
    }

    fn due(&mut self, current: Option<(String, u64)>, live: bool,
        armed: Option<u64>, now: Instant) -> bool {
        // Item IDs can be reused. Only this failed decoder opening owns the
        // retry; STOP, another TAKE, or an operator's LOAD wins immediately.
        if !live || current != self.target || self.target.is_none() {
            *self = Self::default();
            return false;
        }
        if let Some(armed) = armed {
            if self.pending_decoder != Some(armed) { *self = Self::default(); }
            return false;
        }
        if self.pending_decoder.take().is_some() {
            // Our asynchronous opening was refused/removed. Retry it rather
            // than forgetting the recovery after a state-change acceptance.
            self.retry_at = Some(now + LIVE_RETRY);
            return false;
        }
        self.retry_at.is_some_and(|at| now >= at)
    }
}

/// Shared by the command loop and the isolated native network diagnostic.
fn poll_program_input(channel: &mut Channel, recovery: &mut LiveRecovery) -> (Vec<Event>, bool) {
    let mut events = Vec::new();
    if let (Some(bus), Some(item_id)) = (channel.item_bus(), channel.on_air_id()) {
        let live = channel.on_air_is_live();
        let decoder_id = channel.decoder_id("pgm");
        while let Some(message) = bus.pop() {
            let fault = match message.view() {
                gst::MessageView::Eos(_) if live => Some("a fonte encerrou o sinal".into()),
                gst::MessageView::Error(error) if live => Some(error.error().to_string()),
                gst::MessageView::Eos(_) => {
                    events.push(Event::Eos { item_id: item_id.clone() }); None
                }
                gst::MessageView::Error(error) => {
                    events.push(Event::ItemError { item_id: item_id.clone(), bus: "pgm", decoder_id,
                        message: format!("item {item_id}: {}", error.error()) }); None
                }
                _ => None,
            };
            if let Some(reason) = fault {
                events.push(Event::SourceLost { item_id: item_id.clone(), decoder_id, reason });
                if let Some(decoder) = decoder_id {
                    recovery.lost((item_id.clone(), decoder), Instant::now());
                }
                break;
            }
        }
    }
    let current = channel.on_air_id().zip(channel.decoder_id("pgm"));
    // Reopening PRIMARY must not consume the slot/intent preparing its
    // alternative. Expiry/cancel/failure returns control to normal recovery.
    if channel.has_pending_live_replacement() || channel.program_selection_uncertain() {
        return (events, false);
    }
    if recovery.due(current, channel.on_air_is_live(), channel.decoder_id("armed"), Instant::now()) {
        let changed = channel.restart_on_air().is_ok();
        recovery.pending_decoder = channel.decoder_id("armed");
        recovery.retry_at = Some(Instant::now() + LIVE_RETRY);
        return (events, changed);
    }
    (events, false)
}

fn run_command(channel: &mut Channel, command: Command, request_id:u64) -> Result<bool> {
    match command {
        Command::MonitorAdmitted {owner_id,term,bus,on}=>{
            fencing::authorize_publication(&owner_id,term)?;
            if channel.program_outputs_held() { return Err(anyhow!("Monitor HA exige saídas admitidas.")); }
            if !channel.set_monitor(&bus,on) { return Err(anyhow!("não existe monitor chamado {bus}")); }
            if fencing::authorize_publication(&owner_id,term).is_err() { std::process::exit(75); }
            for report in channel.outputs_report() { Event::Publisher {report}.emit(); }
            Ok(true)
        }
        Command::ReleasePreviewOutput {owner_id,term}=>{
            fencing::authorize_publication(&owner_id,term)?;
            channel.release_preview_output()?;
            if fencing::authorize_publication(&owner_id,term).is_err() { std::process::exit(75); }
            for report in channel.outputs_report() { Event::Publisher {report}.emit(); }
            Ok(true)
        }
        Command::ReleaseProgramOutputs {owner_id,term,item_id,decoder_id}=>{
            fencing::authorize_publication(&owner_id,term)?;
            channel.release_program_outputs(item_id.as_deref(),decoder_id)?;
            // Outputs may already exist here. Do not leave publication alive
            // awaiting Node after a post-setup decoder/cursor failure.
            let cursor=match channel.program_admission_cursor(){Ok(cursor)=>cursor,Err(_)=>std::process::exit(76)};
            if fencing::authorize_publication(&owner_id,term).is_err(){std::process::exit(75);}
            Event::ProgramOutputs {held:channel.program_outputs_held(),owner_id,term,item_id,decoder_id,cursor}.emit();
            Ok(true)
        }
        Command::FenceGrant { .. } => Err(anyhow!("Concessão deve ser processada pela thread privada da cerca.")),
        Command::Load { item } => {
            channel.load(item)?;
            announce(channel);
            Ok(true)
        }
        Command::PrepareLiveReplacement { request } => {
            let replayed = channel.live_replacement_receipt(&request.engine_generation, &request.transaction_id).is_ok();
            let receipt = channel.prepare_live_replacement(request)?;
            emit_replacement_receipt(channel, request_id, receipt, replayed);
            Ok(true)
        }
        Command::CommitLiveReplacement { engine_generation, transaction_id, prepared_decoder_id, owner_id, term } => {
            fencing::authorize_publication(&owner_id, term)?;
            let replayed = channel.live_replacement_receipt(&engine_generation, &transaction_id).is_ok_and(|receipt| receipt.phase.terminal());
            let result = channel.commit_live_replacement(&engine_generation, &transaction_id, prepared_decoder_id);
            if fencing::authorize_publication(&owner_id, term).is_err() { std::process::exit(75); }
            let receipt = result?;
            emit_replacement_receipt(channel, request_id, receipt, replayed);
            announce(channel);
            Ok(true)
        }
        Command::CancelLiveReplacement { engine_generation, transaction_id } => {
            let replayed = channel.live_replacement_receipt(&engine_generation, &transaction_id).is_ok_and(|receipt| receipt.phase.terminal());
            let receipt = channel.cancel_live_replacement(&engine_generation, &transaction_id)?;
            emit_replacement_receipt(channel, request_id, receipt, replayed);
            Ok(true)
        }
        Command::LiveReplacementStatus { engine_generation, transaction_id } => {
            channel.service_live_replacement();
            let receipt = channel.live_replacement_receipt(&engine_generation, &transaction_id)?;
            emit_replacement_receipt(channel, request_id, receipt, true);
            Ok(true)
        }
        Command::Take => {
            channel.take()?;
            announce(channel);
            Ok(true)
        }
        Command::CancelTake => {
            channel.cancel_pending_take();
            announce(channel);
            Ok(true)
        }
        Command::ProgramHold {item_id,decoder_id,on}=>{
            let frames=channel.set_program_hold(&item_id,decoder_id,on)?;
            Event::ProgramHold{id:request_id,item_id,decoder_id,held:on,frames}.emit();
            announce(channel);
            Ok(true)
        }
        Command::RestoreProgramHold {item}=>{
            let item_id=item.item_id.clone();
            let frames=channel.restore_program_hold(item)?;
            let decoder_id=channel.decoder_id("pgm").ok_or_else(||anyhow!("decoder restaurado sem identidade"))?;
            Event::ProgramHold{id:request_id,item_id,decoder_id,held:true,frames}.emit();
            announce(channel);
            Ok(true)
        }
        Command::Preview { item } => {
            channel.preview(item)?;
            announce(channel);
            Ok(true)
        }
        Command::Stop => {
            channel.stop()?;
            announce(channel);
            Ok(true)
        }
        Command::Graphic { svg, fade_ms } => {
            channel.set_graphic(svg, fade_ms);
            announce(channel);
            Ok(true)
        }
        Command::SetGain { gain_db } => {
            channel.set_gain(gain_db)?;
            Ok(true)
        }
        Command::Seek { bus, frames } => {
            channel.seek(&bus, frames)?;
            Ok(true)
        }
        Command::Monitor { bus, on } => {
            if !channel.set_monitor(&bus, on) {
                return Err(anyhow::anyhow!("não existe monitor chamado {bus}"));
            }
            // O relatório sai daqui, e não do laço de serviço: ligar e desligar
            // acontece fora dele, e sem este anúncio o servidor ficava com a
            // leitura velha -- o painel mostrava um monitor "caído" que na
            // verdade tinha sido desligado de propósito.
            for report in channel.outputs_report() {
                Event::Publisher { report }.emit();
            }
            Ok(true)
        }
        Command::QcMonitor { item_id, on } => {
            channel.set_qc_monitor(&item_id, on)?;
            for report in channel.outputs_report() { Event::Publisher { report }.emit(); }
            Ok(true)
        }
        Command::ReplaceOutput { output_id, output } => {
            channel.replace_output(&output_id, output)?;
            for report in channel.outputs_report() {
                Event::Publisher { report }.emit();
            }
            Ok(true)
        }
        Command::Status => {
            announce(channel);
            Event::Output {
                frames: channel.frames_out(),
            }
            .emit();
            for report in channel.outputs_report() {
                Event::Publisher { report }.emit();
            }
            Ok(true)
        }
        Command::Shutdown => Ok(false),
    }
}

/// Mensagens do GStreamer viram eventos do protocolo. O bus é a única fonte de
/// verdade sobre o que o pipeline está fazendo.
fn handle_message(message: &gst::Message) -> Option<Event> {
    use gst::MessageView;

    match message.view() {
        MessageView::Error(error) => Some(Event::Error {
            message: format!(
                "{} ({})",
                error.error(),
                error.debug().unwrap_or_else(|| "sem detalhe".into())
            ),
        }),
        MessageView::Warning(warning) => {
            // Sem o nome do elemento, um aviso do GStreamer é um enigma: dizer
            // "clock problem" sem dizer quem reclamou não ajuda ninguém. E sem
            // o detalhe é pior ainda: "clock problem" é a categoria, e a frase
            // que explica o que houve mora só no campo de depuração -- que
            // este código descartava, deixando no log exatamente a metade
            // inútil da mensagem.
            let source = message
                .src()
                .map(|object| object.name().to_string())
                .unwrap_or_else(|| "desconhecido".to_string());
            let erro = warning.error();
            eprintln!(
                "[engine] aviso de {source}: {erro} ({})",
                warning.debug().unwrap_or_else(|| "sem detalhe".into())
            );

            // Aviso de relógio vindo de um sink é o jeito do GStreamer dizer
            // que o buffer chegou tarde demais e foi descartado. Do lado de
            // fora isso é a imagem engasgando, e até aqui o operador não tinha
            // como saber a causa: a frase morria no stderr. É o único aviso
            // que sobe -- os outros seguem sendo log, para o sino não virar
            // ruído.
            if erro.kind::<gst::CoreError>() == Some(gst::CoreError::Clock) {
                return Some(Event::Warning {
                    message: format!(
                        "o computador não está dando conta e o canal está descartando \
                         quadros ({source})"
                    ),
                });
            }
            None
        }
        MessageView::Application(application) => {
            let structure = application.structure()?;
            if structure.name() != "item-eos" {
                return None;
            }
            Some(Event::Eos {
                item_id: structure.get::<String>("item-id").ok()?,
            })
        }
        _ => None,
    }
}

/// Emit once per actual ready decoder opening, not once per editorial item ID.
fn new_ready_opening(cache: &mut Option<(String, u64)>, current: Option<(String, u64)>) -> Option<String> {
    let changed = current.is_some() && *cache != current;
    let item_id = if changed { current.as_ref().map(|value| value.0.clone()) } else { None };
    *cache = current;
    item_id
}

fn main() -> Result<()> {
    gst::init().context("GStreamer não inicializou")?;
    limiter_element::register().context("o limiter não registrou")?;

    let mut input = std::io::BufReader::new(std::io::stdin());
    let (config, fence_owner, qc_preview,hold_program_outputs) = parse_args(&mut input)?;
    let channel_id = config.channel_id.clone();
    let width = config.width;
    let height = config.height;
    let fps = config.fps_n as f64 / config.fps_d as f64;

    fencing::install(fence_owner)?;
    // Read renewal grants while Channel::new/start or a decoder/driver blocks.
    let (sender, receiver) = mpsc::channel::<Envelope>();
    std::thread::spawn(move || {
        for line in input.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() { continue; }
            match serde_json::from_str::<Envelope>(&line) {
                Ok(Envelope { id, command: Command::FenceGrant { owner_id, nonce, term, ttl_ms } }) => {
                    let result = fencing::grant(&owner_id, nonce, term, ttl_ms);
                    if result.is_ok() { Event::FenceApplied { nonce, term }.emit(); }
                    Event::Ack { id, ok: result.is_ok(), decoder_id:None, error: result.err().map(|error| error.to_string()) }.emit();
                }
                Ok(envelope) => { if sender.send(envelope).is_err() { break; } }
                Err(_) => Event::Error { message: "Comando JSON inválido.".into() }.emit(),
            }
        }
        fencing::abort();
    });
    fencing::wait_initial()?;
    let mut channel = Channel::new_with_program_hold(config,hold_program_outputs).context("não consegui montar o pipeline do canal")?;
    if let Some(output) = qc_preview { channel.attach_qc_preview(&output)?; }
    channel.start().context("o canal não entrou em execução")?;
    // As saídas de rede sobem depois do canal e por conta própria: se o
    // destino ainda não está de pé, o canal não pode ficar esperando por ele.
    for report in channel.service_outputs() {
        Event::Publisher { report }.emit();
    }

    Event::Ready {
        channel_id,
        width,
        height,
        fps,
        decoder_identity: true,
        program_admission:true,
        program_outputs_held:channel.program_outputs_held(),
        preview_admission:true,
        live_replacement_protocol: 1,
        engine_generation: channel.generation_id().to_string(),
    }
    .emit();

    // Um evento por fonte/barramento: não poluir o protocolo a cada ciclo.
    let mut ready_pgm: Option<(String, u64)> = None;
    let mut ready_pvw: Option<(String, u64)> = None;

    let bus = channel.bus();
    let mut last_position = Instant::now();
    let mut last_output = Instant::now();
    let mut last_meter = Instant::now();
    let mut last_graphics = Instant::now();
    let mut live_recovery = LiveRecovery::default();
    let mut running = true;

    while running {
        // A transição do grafismo anda com o relógio de verdade, não com o
        // número de voltas do laço: a volta dura o que o bus deixar.
        let elapsed = last_graphics.elapsed();
        last_graphics = Instant::now();
        channel.tick_graphics(elapsed.as_secs_f64() * 1000.0);

        loop {
            let envelope = match receiver.try_recv() {
                Ok(envelope) => envelope,
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    // The owning server closed stdin or crashed. Do not leave
                    // an orphan engine publishing while a replacement starts.
                    eprintln!("Canal de controle encerrado; fechando o engine pertencente ao servidor.");
                    running = false;
                    break;
                }
            };
            let id = envelope.id;
            let preview_command = matches!(&envelope.command, Command::Preview { .. });
            let program_hold_command=matches!(&envelope.command,Command::ProgramHold{..}|Command::RestoreProgramHold{..});
            match run_command(&mut channel, envelope.command,id) {
                Ok(keep_running) => {
                    Event::Ack {
                        id,
                        ok: true,
                        error: None,
                        decoder_id: if preview_command { channel.decoder_id("pvw") } else if program_hold_command {channel.decoder_id("pgm")} else { None },
                    }
                    .emit();
                    running = keep_running;
                }
                Err(error) => {
                    // Uma falha pode ter fechado o item anterior. Publique o
                    // estado real também neste caminho, antes de recusar.
                    announce(&channel);
                    Event::Ack {
                        id,
                        ok: false,
                        error: Some(format!("{error:#}")),
                        decoder_id: None,
                    }
                    .emit();
                }
            }
            // Publish invalidation/expiry even when an ordinary command or
            // a failed COMMIT produced only an ACK/error.
            poll_live_replacement(&mut channel);
            if !running {
                break;
            }
        }
        if !running {
            break;
        }

        // TAKE de fonte ao vivo só comuta o seletor depois que o decoder
        // confirmou um frame. Enquanto a NDI/SRT/RTMP faz preroll, o PGM
        // continua no item anterior em vez de expor o preto do inter.
        let (take_changed,take_error)=poll_pending_take(&mut channel);
        if let Some(error)=take_error {error.emit();}
        if take_changed {
            announce(&channel);
        }
        poll_live_replacement(&mut channel);

        if let Some(item_id) = new_ready_opening(&mut ready_pgm, channel.on_air_live_ready_identity()) {
            Event::SourceReady { item_id, bus: "pgm", decoder_id:channel.decoder_id("pgm"), configured_source_id:channel.configured_source_id("pgm") }.emit();
        }
        if let Some(item_id) = new_ready_opening(&mut ready_pvw, channel.preview_live_ready_identity()) {
            Event::SourceReady { item_id, bus: "pvw", decoder_id:channel.decoder_id("pvw"), configured_source_id:channel.configured_source_id("pvw") }.emit();
        }

        if let Some(message) = bus.timed_pop(gst::ClockTime::from_mseconds(20)) {
            if let Some(event) = handle_message(&message) {
                event.emit();
            }
        }

        let (input_events, recovered) = poll_program_input(&mut channel, &mut live_recovery);
        for event in input_events { event.emit(); }
        if recovered { announce(&channel); }

        // O preview tem bus próprio pelo mesmo motivo do item no ar: o fim de
        // um arquivo aberto para olhar não pode virar fim de nada.
        if let (Some(preview_bus), Some(item_id)) = (channel.preview_bus(), channel.preview_id()) {
            while let Some(message) = preview_bus.pop() {
                if let gst::MessageView::Error(error) = message.view() {
                    Event::ItemError {
                        item_id: item_id.clone(),
                        bus: "pvw",
                        decoder_id:channel.decoder_id("pvw"),
                        message: format!("preview {item_id}: {}", error.error()),
                    }
                    .emit();
                }
            }
        }

        if last_meter.elapsed() >= METER_EVERY {
            last_meter = Instant::now();
            let (program, preview, video) = channel.measure();
            levels("pgm", &program).emit();
            levels("pvw", &preview).emit();
            Event::VideoProbe { luma: video.luma, black: video.black, freeze: video.freeze, freeze_duration_ms:video.freeze_duration_ms, sample_age_ms:video.sample_age_ms }.emit();
            if let Some(black) = channel.black_transition() {
                Event::Warning {
                    message: if black {
                        "vídeo do PGM em preto por mais de 5 segundos".to_string()
                    } else {
                        "vídeo do PGM recuperado após preto sustentado".to_string()
                    },
                }
                .emit();
            }
        }

        if last_position.elapsed() >= POSITION_EVERY {
            last_position = Instant::now();
            if let Some((item_id, frames, duration)) = channel.position() {
                Event::Position {
                    item_id,
                    decoder_id: channel.decoder_id("pgm"),
                    frames,
                    duration,
                }
                .emit();
            }
            if let Some((item_id, frames, duration)) = channel.preview_position() {
                Event::PreviewPosition { item_id, frames, duration }.emit();
            }
            if let Some((item_id,decoder_id,delivered,age_ms,paused_file))=channel.preview_frame_observation(){
                Event::PreviewFrame{item_id,decoder_id,delivered,age_ms,paused_file}.emit();
            }
        }

        for report in channel.service_outputs() {
            Event::Publisher { report }.emit();
        }

        if last_output.elapsed() >= OUTPUT_EVERY {
            last_output = Instant::now();
            for (item_id, bus, signal) in channel.live_signal_reports() {
                Event::SourceTelemetry { item_id, bus, decoder_id:channel.decoder_id(bus), configured_source_id:channel.configured_source_id(bus), signal }.emit();
            }
            Event::Output {
                frames: channel.frames_out(),
            }
            .emit();
            // Repetir a situação das saídas de segundo em segundo mantém a
            // contagem de entrega viva na interface sem depender de mudança.
            for report in channel.outputs_report() {
                Event::Publisher { report }.emit();
            }
        }
    }

    channel.shutdown();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_recovery_cannot_override_stop_take_or_operator_arming() {
        let now = Instant::now();
        let target = ("camera".to_string(), 10);
        for (current, live, armed) in [
            (None, false, None),
            (Some(("vt".into(), 11)), false, None),
            (Some(("camera".into(), 11)), true, None),
            (Some(target.clone()), true, Some(20)),
        ] {
            let mut recovery = LiveRecovery::default();
            recovery.lost(target.clone(), now);
            assert!(!recovery.due(current, live, armed, now + LIVE_RETRY));
            assert!(recovery.target.is_none());
        }
    }

    #[test]
    fn live_recovery_waits_for_owned_opening_and_retries_async_rejection() {
        let now = Instant::now();
        let target = ("camera".to_string(), 10);
        let mut recovery = LiveRecovery::default();
        recovery.lost(target.clone(), now);
        assert!(!recovery.due(Some(target.clone()), true, None, now));
        assert!(recovery.due(Some(target.clone()), true, None, now + LIVE_RETRY));
        recovery.pending_decoder = Some(20);
        assert!(!recovery.due(Some(target.clone()), true, Some(20), now + LIVE_RETRY));
        let rejected = now + Duration::from_secs(10);
        assert!(!recovery.due(Some(target.clone()), true, None, rejected));
        assert!(!recovery.due(Some(target.clone()), true, None, rejected + Duration::from_secs(1)));
        assert!(recovery.due(Some(target), true, None, rejected + LIVE_RETRY));
        assert!(!recovery.due(Some(("camera".into(), 20)), true, None, rejected + LIVE_RETRY));
        assert!(recovery.target.is_none());
    }

    #[test]
    fn wire_decoder_identity_is_serialized_for_ack_state_and_source_events() {
        let ack=serde_json::to_value(Event::Ack{id:9,ok:true,error:None,decoder_id:Some(42)}).unwrap();
        assert_eq!(ack["decoderId"],42);assert_eq!(ack["id"],9);
        let ready=serde_json::to_value(Event::SourceReady{item_id:"same-item".into(),bus:"pvw",decoder_id:Some(42),configured_source_id:Some("selected".into())}).unwrap();
        assert_eq!(ready["itemId"],"same-item");assert_eq!(ready["decoderId"],42);
        assert_eq!(ready["configuredSourceId"],"selected");
        let state=serde_json::to_value(Event::State{on_air:Some("same-item".into()),armed:None,preview:None,on_air_decoder_id:Some(43),armed_decoder_id:None,program_hold:None,program_selection_uncertain:false,graphic:false}).unwrap();
        assert_eq!(state["onAirDecoderId"],43);assert!(state["armedDecoderId"].is_null());
    }

    #[test]
    fn repeated_ready_item_announces_each_real_decoder_opening() {
        let mut cache = None;
        assert_eq!(new_ready_opening(&mut cache, Some(("camera".into(), 1))), Some("camera".into()));
        assert_eq!(new_ready_opening(&mut cache, Some(("camera".into(), 1))), None);
        // No intervening None: reopening can already be ready in the next loop.
        assert_eq!(new_ready_opening(&mut cache, Some(("camera".into(), 2))), Some("camera".into()));
        assert_eq!(new_ready_opening(&mut cache, None), None);
        assert_eq!(new_ready_opening(&mut cache, Some(("camera".into(), 2))), Some("camera".into()));
    }

    fn aviso(erro: gst::glib::Error) -> gst::Message {
        gst::message::Warning::builder_from_error(erro).build()
    }

    #[test]
    fn aviso_de_relogio_vira_recado_para_o_operador() {
        gst::init().unwrap();
        // É assim que o GStreamer diz "cheguei tarde, joguei o quadro fora" --
        // e é a explicação de "a imagem está engasgando".
        let evento = handle_message(&aviso(gst::glib::Error::new(
            gst::CoreError::Clock,
            "A lot of buffers are being dropped.",
        )));
        match evento {
            Some(Event::Warning { message }) => {
                assert!(message.contains("descartando quadros"), "{message}");
            }
            outro => panic!("esperava um aviso para o operador, veio {outro:?}"),
        }
    }

    #[test]
    fn outros_avisos_seguem_sendo_so_log() {
        gst::init().unwrap();
        // O sino é caro: aviso que o operador não pode agir sobre fica no log.
        let evento = handle_message(&aviso(gst::glib::Error::new(
            gst::ResourceError::Read,
            "não consegui ler",
        )));
        assert!(evento.is_none());
    }
}
