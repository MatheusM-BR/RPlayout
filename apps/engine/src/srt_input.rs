//! Retomada rápida da entrada SRT depois de uma queda da fonte.
//!
//! O libsrt só declara a conexão quebrada depois de ~5 s sem resposta do
//! outro lado. O piso não depende de `peeridletimeo`: o socket também precisa
//! de 16 expirações do temporizador EXP, e cada uma leva no mínimo 300 ms.
//! Enquanto isso não acontece, o `srtsrc`:
//! - em **caller**, não tenta reconectar. Se a fonte volta antes de 5 s,
//!   espera o resto do prazo. Medido: queda de 3 s e retomada em 2,3 s;
//! - em **listener**, continua preso à sessão morta. O caller que volta
//!   não é atendido até o prazo vencer e precisa tentar de novo. Medido:
//!   retomada em 3 a 4 s.
//!
//! Com o T1 de 5 s do watchdog, uma queda de 3 s virava contingência.
//!
//! A correção não espera o libsrt. A fonte é dada como caída quando o
//! `srtsrc` passa [`SRT_STALL`] sem entregar nenhum byte, depois de ter
//! entregado. Uma fonte MPEG-TS viva nunca fica tanto tempo calada: só a tabela
//! de programa e o PCR já chegam várias vezes por segundo. Nesse caso o
//! `srtsrc`, e só ele, passa por NULL e volta ao estado do pai, o que abre um
//! socket novo. O resto continua igual: o `uridecodebin`, os decodificadores,
//! a superfície `inter`, o seletor do PGM e o identificador do decoder. Por
//! isso não há TAKE, a superfície não fica preta e os outros slots não são
//! tocados.
//! - em **caller**, o socket novo fica refazendo o handshake (a cada 250 ms)
//!   até a fonte voltar;
//! - em **listener**, a porta nova aceita o caller que voltar.
//!
//! Isso acontece uma vez por queda. Enquanto não voltar byte nenhum, o socket
//! novo é mantido, para não derrubar um handshake em andamento.

use gstreamer as gst;
use gstreamer::prelude::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Tempo sem nenhum byte da rede que já conta como queda da fonte SRT. É o
/// mesmo limite da perda de sinal do watchdog, então a fonte que volta
/// encontra o socket novo pronto.
pub const SRT_STALL: Duration = Duration::from_millis(1000);
const POLL: Duration = Duration::from_millis(100);

/// Última vez que a rede entregou bytes ao `srtsrc`.
pub struct SrtActivity {
    origin: Instant,
    last_ms: AtomicU64,
    /// Chegou byte desde a última reabertura (ou desde o início)?
    flowing: AtomicBool,
}

impl SrtActivity {
    pub fn new(origin: Instant) -> Self {
        Self { origin, last_ms: AtomicU64::new(0), flowing: AtomicBool::new(false) }
    }

    fn millis(&self, now: Instant) -> u64 {
        now.saturating_duration_since(self.origin).as_millis() as u64
    }

    pub fn mark(&self, now: Instant) {
        self.last_ms.store(self.millis(now), Ordering::Release);
        self.flowing.store(true, Ordering::Release);
    }

    /// `true` uma única vez por queda: houve fluxo e ele parou há mais de
    /// `limit`. A próxima vez só depois que algum byte voltar.
    pub fn take_stall(&self, now: Instant, limit: Duration) -> bool {
        if !self.flowing.load(Ordering::Acquire) { return false; }
        let silent = self.millis(now).saturating_sub(self.last_ms.load(Ordering::Acquire));
        if silent <= limit.as_millis() as u64 { return false; }
        // Quem perde a corrida com um byte que acabou de chegar não reabre.
        self.flowing.compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire).is_ok()
    }
}

/// Liga a retomada rápida em todo `srtsrc` que o `uridecodebin` criar.
pub fn recycle_stalled_srt(decoder: &gst::Element) {
    decoder.connect("source-setup", false, |values| {
        let source = values.get(1)?.get::<gst::Element>().ok()?;
        if source.factory().is_none_or(|factory| factory.name() != "srtsrc") { return None; }
        let pad = source.static_pad("src")?;
        let activity = Arc::new(SrtActivity::new(Instant::now()));
        let marker = Arc::clone(&activity);
        pad.add_probe(gst::PadProbeType::BUFFER | gst::PadProbeType::BUFFER_LIST, move |_, _| {
            marker.mark(Instant::now());
            gst::PadProbeReturn::Ok
        });
        let weak = source.downgrade();
        let spawned = std::thread::Builder::new().name("srt-retomada".into())
            .spawn(move || watch(weak, activity));
        if let Err(error) = spawned {
            eprintln!("[engine] sem vigia de retomada da entrada SRT: {error}");
        }
        None
    });
}

/// Vigia de um `srtsrc`. A referência é fraca, e a thread termina sozinha
/// quando o item é descartado.
fn watch(source: gst::glib::WeakRef<gst::Element>, activity: Arc<SrtActivity>) {
    let mut seen_playing = false;
    loop {
        std::thread::sleep(POLL);
        let Some(source) = source.upgrade() else { return };
        let (_, current, pending) = source.state(gst::ClockTime::ZERO);
        if current == gst::State::Playing { seen_playing = true; }
        // Item fechado: o pipeline levou a fonte a NULL.
        if seen_playing && current == gst::State::Null && pending == gst::State::VoidPending { return; }
        if current != gst::State::Playing || pending != gst::State::VoidPending { continue; }
        if !activity.take_stall(Instant::now(), SRT_STALL) { continue; }
        let Some(parent) = source.parent().and_then(|parent| parent.downcast::<gst::Element>().ok()) else { return };
        let (_, parent_state, parent_pending) = parent.state(gst::ClockTime::ZERO);
        if parent_state != gst::State::Playing || parent_pending != gst::State::VoidPending { continue; }
        eprintln!("[engine] entrada SRT sem dados há {} ms: reabrindo o socket SRT (o item e o PGM continuam)", SRT_STALL.as_millis());
        let _ = source.set_state(gst::State::Null);
        // Fonte em NULL não tem thread de streaming, então dá para limpar o
        // que vem depois dela. O `tsdemux` guarda o mapa PCR→tempo da sessão
        // velha. Um encoder que volta recomeça o PCR, e esse mapa carimbava
        // os quadros novos segundos no passado. O sink descartava os quadros
        // como atrasados, o QoS fazia o decoder pular tudo até o próximo
        // quadro-chave, e a imagem voltava aos soluços por segundos. O flush
        // (sem zerar o relógio do pipeline) faz o demux recomeçar o mapa.
        // Os decodificadores esperam o quadro-chave da sessão nova.
        if let Some(peer) = source.static_pad("src").and_then(|pad| pad.peer()) {
            peer.send_event(gst::event::FlushStart::new());
            peer.send_event(gst::event::FlushStop::new(false));
        }
        if let Err(error) = source.sync_state_with_parent() {
            eprintln!("[engine] não reabri o socket SRT: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stall_fires_once_per_outage_and_only_after_data_flowed() {
        let origin = Instant::now();
        let activity = SrtActivity::new(origin);
        let at = |ms: u64| origin + Duration::from_millis(ms);
        // A fonte nunca entregou nada: nada a reabrir (listener esperando caller).
        assert!(!activity.take_stall(at(5_000), SRT_STALL));
        activity.mark(at(5_000));
        assert!(!activity.take_stall(at(5_900), SRT_STALL), "jitter abaixo do limite não é queda");
        assert!(activity.take_stall(at(6_100), SRT_STALL), "1 s calada depois de fluir é queda");
        assert!(!activity.take_stall(at(9_000), SRT_STALL), "uma reabertura por queda, sem derrubar o handshake em curso");
        activity.mark(at(9_500));
        assert!(!activity.take_stall(at(10_000), SRT_STALL));
        assert!(activity.take_stall(at(10_600), SRT_STALL), "nova queda depois da volta reabre de novo");
    }
}
