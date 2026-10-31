//! Sonda dos codificadores de H.264 e das sessões de placa.
//!
//! O servidor roda uma vez na partida, antes de subir os canais, e usa o
//! resultado para reservar as sessões do programa e emprestar o que sobrar
//! aos monitores. Uma linha de JSON no stdout.

#[path = "../encoders.rs"]
mod encoders;

fn main() {
    if let Err(error) = gstreamer::init() {
        println!("{{\"encoders\":[],\"error\":{}}}", serde_json::to_string(&error.to_string()).unwrap_or_default());
        return;
    }
    let max = std::env::var("RPLAYOUT_ENCODER_PROBE_MAX").ok().and_then(|v| v.parse().ok()).unwrap_or(encoders::PROBE_MAX_SESSIONS);
    let list = encoders::probe(&mut encoders::GstOpener, max);
    let (hardware, sessions) = encoders::hardware_sessions(&list);
    println!(
        "{}",
        serde_json::json!({ "encoders": list, "hardware": hardware, "hardwareSessions": sessions })
    );
}
