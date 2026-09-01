//! Engine de vídeo do RPlayout.
//!
//! Um processo por canal. Não guarda estado de grade nem sabe o que é uma
//! âncora: recebe ordens do servidor e informa o que está acontecendo. Toda a
//! inteligência de tempo continua no `packages/scheduler`.

mod channel;
mod output;
mod protocol;

use anyhow::{anyhow, Context, Result};
use channel::{Channel, Config, Output};
use gstreamer as gst;
use gstreamer::prelude::GstObjectExt;
use protocol::{Command, Envelope, Event};
use std::io::BufRead;
use std::sync::mpsc;
use std::time::{Duration, Instant};

const POSITION_EVERY: Duration = Duration::from_millis(100);
const OUTPUT_EVERY: Duration = Duration::from_secs(1);

fn parse_args() -> Result<Config> {
    let mut channel_id = String::from("canal");
    let mut width = 1920;
    let mut height = 1080;
    let mut fps_n = 50;
    let mut fps_d = 1;
    let mut bitrate_kbps = 4000;
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
        outputs,
        preview,
    })
}

/// Estado atual do canal, emitido depois de toda ordem que o altera.
fn announce(channel: &Channel) {
    Event::State {
        on_air: channel.on_air_id(),
        armed: channel.armed_id(),
        preview: channel.preview_id(),
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
        Command::SetGain { gain_db } => {
            channel.set_gain(gain_db)?;
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
            // "clock problem" sem dizer quem reclamou não ajuda ninguém.
            let source = message
                .src()
                .map(|object| object.name().to_string())
                .unwrap_or_else(|| "desconhecido".to_string());
            eprintln!("[engine] aviso de {source}: {}", warning.error());
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
        MessageView::Element(element) => {
            let structure = element.structure()?;
            if structure.name() != "level" {
                return None;
            }
            // O `level` publica GValueArray -- nem GstArray nem GstList. Ler
            // com o tipo errado devolve vazio e o medidor fica mudo sem dizer
            // por quê, que foi exatamente o que aconteceu aqui.
            let numbers = |field: &str| -> Vec<f64> {
                structure
                    .get::<gst::glib::ValueArray>(field)
                    .map(|array| {
                        array
                            .iter()
                            .filter_map(|value| value.get::<f64>().ok())
                            .collect()
                    })
                    .unwrap_or_default()
            };

            let peak = numbers("peak");
            if peak.is_empty() {
                return None;
            }
            Some(Event::Levels {
                peak,
                rms: numbers("rms"),
            })
        }
        _ => None,
    }
}

fn main() -> Result<()> {
    gst::init().context("GStreamer não inicializou")?;

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
    let mut running = true;

    while running {
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
            while let Some(message) = item_bus.pop() {
                match message.view() {
                    gst::MessageView::Eos(_) => Event::Eos {
                        item_id: item_id.clone(),
                    }
                    .emit(),
                    gst::MessageView::Error(error) => Event::Error {
                        message: format!("item {item_id}: {}", error.error()),
                    }
                    .emit(),
                    _ => {}
                }
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
