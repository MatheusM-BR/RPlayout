//! Engine de vídeo do RPlayout.
//!
//! Um processo por canal. Não guarda estado de grade nem sabe o que é uma
//! âncora: recebe ordens do servidor e informa o que está acontecendo. Toda a
//! inteligência de tempo continua no `packages/scheduler`.

mod channel;
mod loudness;
mod limiter;
mod limiter_element;
mod output;
mod protocol;

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

fn parse_args() -> Result<Config> {
    let mut channel_id = String::from("canal");
    let mut width = 1920;
    let mut height = 1080;
    let mut fps_n = 50;
    let mut fps_d = 1;
    let mut bitrate_kbps = 4000;
    let mut ceiling_dbtp = -1.0;
    let mut scan = Scan::Progressive;
    let mut top_field_first = true;
    let mut outputs = Vec::new();
    let mut preview = None;

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
            "--scan" => scan = Scan::parse(&value()?)?,
            "--field-order" => top_field_first = value()? != "bff",
            "--output" => outputs.push(Output::parse(&value()?)?),
            "--preview" => preview = Some(Output::parse(&value()?)?),
            other => return Err(anyhow!("argumento desconhecido: {other}")),
        }
        index += 1;
    }

    if outputs.is_empty() {
        outputs.push(Output::Null);
    }

    Ok(Config {
        channel_id,
        width,
        height,
        fps_n,
        fps_d,
        bitrate_kbps,
        ceiling_dbtp,
        scan,
        top_field_first,
        outputs,
        preview,
    })
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
        graphic: channel.graphic_on_air(),
    }
    .emit();
}

fn run_command(channel: &mut Channel, command: Command) -> Result<bool> {
    match command {
        Command::Load { item } => {
            channel.load(item)?;
            announce(channel);
            Ok(true)
        }
        Command::Take => {
            channel.take()?;
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

fn main() -> Result<()> {
    gst::init().context("GStreamer não inicializou")?;
    limiter_element::register().context("o limiter não registrou")?;

    let config = parse_args()?;
    let channel_id = config.channel_id.clone();
    let width = config.width;
    let height = config.height;
    let fps = config.fps_n as f64 / config.fps_d as f64;

    let mut channel = Channel::new(config).context("não consegui montar o pipeline do canal")?;
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
    }
    .emit();

    // O stdin bloqueia, então lê numa thread e entrega pela fila.
    let (sender, receiver) = mpsc::channel::<Envelope>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Envelope>(&line) {
                Ok(envelope) => {
                    if sender.send(envelope).is_err() {
                        break;
                    }
                }
                Err(error) => Event::Error {
                    message: format!("comando inválido: {error}"),
                }
                .emit(),
            }
        }
    });

    let bus = channel.bus();
    let mut last_position = Instant::now();
    let mut last_output = Instant::now();
    let mut last_meter = Instant::now();
    let mut last_graphics = Instant::now();
    let mut live_retry_at: Option<Instant> = None;
    let mut running = true;

    while running {
        // A transição do grafismo anda com o relógio de verdade, não com o
        // número de voltas do laço: a volta dura o que o bus deixar.
        let elapsed = last_graphics.elapsed();
        last_graphics = Instant::now();
        channel.tick_graphics(elapsed.as_secs_f64() * 1000.0);

        while let Ok(envelope) = receiver.try_recv() {
            let id = envelope.id;
            match run_command(&mut channel, envelope.command) {
                Ok(keep_running) => {
                    Event::Ack {
                        id,
                        ok: true,
                        error: None,
                    }
                    .emit();
                    running = keep_running;
                }
                Err(error) => Event::Ack {
                    id,
                    ok: false,
                    error: Some(error.to_string()),
                }
                .emit(),
            }
        }

        if let Some(message) = bus.timed_pop(gst::ClockTime::from_mseconds(20)) {
            if let Some(event) = handle_message(&message) {
                event.emit();
            }
        }

        // O item tem bus próprio. É por ele que chega o fim do trecho, e é por
        // isso que o fim de um item não tem como virar fim do canal.
        if let (Some(item_bus), Some(item_id)) = (channel.item_bus(), channel.on_air_id()) {
            let live = channel.on_air_is_live();
            while let Some(message) = item_bus.pop() {
                let fault = match message.view() {
                    // Fim de arquivo é fim de item; fonte ao vivo que termina
                    // é fonte que caiu, e isso não pode andar com a grade.
                    gst::MessageView::Eos(_) if !live => {
                        Event::Eos {
                            item_id: item_id.clone(),
                        }
                        .emit();
                        None
                    }
                    gst::MessageView::Eos(_) => Some("a fonte encerrou o sinal".to_string()),
                    gst::MessageView::Error(error) if live => Some(error.error().to_string()),
                    gst::MessageView::Error(error) => {
                        Event::Error {
                            message: format!("item {item_id}: {}", error.error()),
                        }
                        .emit();
                        None
                    }
                    _ => None,
                };

                if let Some(reason) = fault {
                    Event::SourceLost {
                        item_id: item_id.clone(),
                        reason,
                    }
                    .emit();
                    live_retry_at = Some(Instant::now() + LIVE_RETRY);
                    break;
                }
            }
        }

        // Fonte ao vivo caiu: tenta de novo até voltar. A hora de sair continua
        // sendo a que a grade marcou.
        if let Some(when) = live_retry_at {
            if Instant::now() >= when {
                live_retry_at = channel
                    .restart_on_air()
                    .err()
                    .map(|_| Instant::now() + LIVE_RETRY);
            }
        }

        // O preview tem bus próprio pelo mesmo motivo do item no ar: o fim de
        // um arquivo aberto para olhar não pode virar fim de nada.
        if let (Some(preview_bus), Some(item_id)) = (channel.preview_bus(), channel.preview_id()) {
            while let Some(message) = preview_bus.pop() {
                if let gst::MessageView::Error(error) = message.view() {
                    Event::Error {
                        message: format!("preview {item_id}: {}", error.error()),
                    }
                    .emit();
                }
            }
        }

        if last_meter.elapsed() >= METER_EVERY {
            last_meter = Instant::now();
            let (program, preview) = channel.measure();
            levels("pgm", &program).emit();
            levels("pvw", &preview).emit();
        }

        if last_position.elapsed() >= POSITION_EVERY {
            last_position = Instant::now();
            if let Some((item_id, frames, duration)) = channel.position() {
                Event::Position {
                    item_id,
                    frames,
                    duration,
                }
                .emit();
            }
        }

        for report in channel.service_outputs() {
            Event::Publisher { report }.emit();
        }

        if last_output.elapsed() >= OUTPUT_EVERY {
            last_output = Instant::now();
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
