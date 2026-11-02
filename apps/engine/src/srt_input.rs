//! Retomada rápida da entrada SRT depois de uma queda da fonte.
//!
//! O libsrt só declara a conexão quebrada depois de ~5 s sem resposta do
//! outro lado. O piso não depende de `peeridletimeo`: o socket também precisa
//! de 16 expirações do temporizador EXP, e cada uma leva no mínimo 300 ms.
//! Enquanto isso não acontece, o `srtsrc`:
//! - em **caller**, não tenta reconectar. Se a fonte volta antes de 5 s,
//!   espera o resto do prazo. Medido: queda de 3 s e retomada em 2,3 s;
//! - em **listener**, continua preso à sessão morta. O caller que volta
//!   completa o handshake no libsrt, mas fica na fila do listener sem ser
//!   lido até o prazo vencer. Medido: retomada em 3 a 4 s.
//!
//! Com o T1 de 5 s do watchdog, uma queda de 3 s virava contingência.
//!
//! A correção não espera o libsrt. A fonte é dada como caída quando passa
//! [`SRT_STALL`] sem sinal de vida, depois de ter entregado dados. Sinal de
//! vida é qualquer um destes:
//! - um buffer saindo do `srtsrc`;
//! - o contador `packets-received` das estatísticas do libsrt (propriedade
//!   `stats`) andando. Esse contador é da thread de recepção do libsrt e
//!   anda mesmo quando o `srtsrc` está parado esperando o resto do pipeline
//!   (máquina carregada, fila cheia). Antes só o buffer contava, e um engine
//!   sem CPU por 1 s derrubava uma sessão viva.
//!
//! Durante a queda o outro lado não manda nada, nem keepalive: um encoder
//! congelado (SIGSTOP, soluço de rede) é indistinguível de um morto enquanto
//! dura. Por isso o limite é tempo, e ele fica acima do maior soluço que a
//! sessão tem de aguentar (1,5 s) com folga para carga: 2,5 s. Abaixo da
//! queda real de 3 s, o socket novo já está pronto quando a fonte volta.
//!
//! Na queda, o `srtsrc`, e só ele, passa por NULL e volta ao estado do pai, o
//! que abre um socket novo. O resto continua igual: o `uridecodebin`, os
//! decodificadores, a superfície `inter`, o seletor do PGM e o identificador
//! do decoder. Por isso não há TAKE, a superfície não fica preta e os outros
//! slots não são tocados.
//! - em **caller**, o socket novo fica refazendo o handshake (a cada 250 ms)
//!   até a fonte voltar;
//! - em **listener**, a porta nova aceita o caller que voltar.
//!
//! Isso acontece uma vez por queda. Enquanto não voltar byte nenhum, o socket
//! novo é mantido, para não derrubar um handshake em andamento.
//!
//! A imagem que volta ainda espera no sink o atraso de recepção do item: o
//! adiantamento que o encoder dá ao PTS sobre o PCR (o `muxdelay` do ffmpeg
//! é 0,7 s) mais a latência do pipeline. Com os 700 ms padrão do `tsdemux`,
//! isso dava 1,6 s sem quadro depois da volta, com o decoder já entregando
//! imagem: não é espera de quadro-chave. Ver [`SRT_DEMUX_LATENCY_MS`].

use gstreamer as gst;
use gstreamer::prelude::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Tempo sem nenhum sinal de vida da sessão que conta como queda da fonte
/// SRT. Fica acima do soluço de 1,5 s que a sessão tem de aguentar e abaixo
/// da queda de 3 s que tem de voltar sem contingência.
pub const SRT_STALL: Duration = Duration::from_millis(2500);
const POLL: Duration = Duration::from_millis(100);
/// Ciclo da vigia que atrasou tanto não decide: o processo ficou sem CPU, e
/// o libsrt ainda não contou os pacotes que esperam no socket.
const LATE_TICK: Duration = Duration::from_millis(300);

/// `poll-timeout` do `srtsrc`. Com o padrão de 1000 ms, levar o `srtsrc` a
/// NULL esperava o `epoll` do listener vencer, e a reabertura atrasava 1 s.
pub const SRT_POLL_TIMEOUT_MS: i32 = 100;

/// Latência que o `tsdemux` declara nas entradas SRT (o padrão é 700 ms).
///
/// Quem segura a imagem da sessão nova é o sink: ele espera o PTS do quadro
/// mais a latência do pipeline. O PTS de um encoder ao vivo já vem adiantado
/// em relação ao PCR (0,7 s no ffmpeg), e o SRT já entrega os pacotes no
/// ritmo de origem (TSBPD) e declara a própria latência. Os 700 ms do demux
/// eram atraso a mais: na volta de uma queda, o primeiro quadro esperava
/// 1,6 s no sink. Com 150 ms o atraso de recepção cai ~0,55 s, no ar e na
/// volta, e ainda sobra margem para decodificar quando o encoder quase não
/// adianta o PTS.
pub const SRT_DEMUX_LATENCY_MS: i32 = 150;

/// Último sinal de vida da sessão SRT.
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
        self.last_ms.fetch_max(self.millis(now), Ordering::AcqRel);
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

/// Pacotes que o libsrt já recebeu na sessão atual, somando os callers no
/// listener. `None` quando ainda não há sessão.
pub fn received_packets(stats: &gst::StructureRef) -> Option<i64> {
    let own = stats.get::<i64>("packets-received").ok();
    let callers = stats.get::<gst::glib::ValueArray>("callers").ok().map(|callers| {
        callers.iter()
            .filter_map(|value| value.get::<gst::Structure>().ok())
            .filter_map(|caller| caller.get::<i64>("packets-received").ok())
            .sum::<i64>()
    });
    match (own, callers) {
        (None, None) => None,
        (own, callers) => Some(own.unwrap_or(0) + callers.unwrap_or(0)),
    }
}

/// Liga a retomada rápida em todo `srtsrc` que o `uridecodebin` criar.
pub fn recycle_stalled_srt(decoder: &gst::Element) {
    decoder.connect("source-setup", false, |values| {
        let source = values.get(1)?.get::<gst::Element>().ok()?;
        if source.factory().is_none_or(|factory| factory.name() != "srtsrc") { return None; }
        let pad = source.static_pad("src")?;
        if source.find_property("poll-timeout").is_some() { source.set_property("poll-timeout", SRT_POLL_TIMEOUT_MS); }
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

/// Latência do `tsdemux` das entradas SRT: [`SRT_DEMUX_LATENCY_MS`], ou
/// `RPLAYOUT_SRT_DEMUX_LATENCY_MS` (50 a 2000). A variável é a saída de
/// emergência para uma fonte com B-frames longos ou PCR espaçado que solte
/// quadro atrasado com 150 ms: volta ao padrão do GStreamer (700) sem novo build.
pub fn srt_demux_latency_ms() -> i32 {
    std::env::var("RPLAYOUT_SRT_DEMUX_LATENCY_MS").ok()
        .and_then(|value| value.trim().parse::<i32>().ok())
        .filter(|value| (50..=2000).contains(value))
        .unwrap_or(SRT_DEMUX_LATENCY_MS)
}

/// Aplica [`srt_demux_latency_ms`] ao `tsdemux` que o `uridecodebin` criar.
pub fn trim_demux_latency(decoder: &gst::Element) {
    let Some(bin) = decoder.downcast_ref::<gst::Bin>() else { return };
    bin.connect_deep_element_added(|_, _, element| {
        if element.factory().is_some_and(|factory| factory.name() == "tsdemux") && element.find_property("latency").is_some() {
            element.set_property("latency", srt_demux_latency_ms());
        }
    });
}

/// Vigia de um `srtsrc`. A referência é fraca, e a thread termina sozinha
/// quando o item é descartado.
fn watch(source: gst::glib::WeakRef<gst::Element>, activity: Arc<SrtActivity>) {
    let mut seen_playing = false;
    let mut packets: Option<i64> = None;
    let mut skipped_late = false;
    loop {
        let tick = Instant::now();
        std::thread::sleep(POLL);
        let late = tick.elapsed() > LATE_TICK;
        let Some(source) = source.upgrade() else { return };
        let (_, current, pending) = source.state(gst::ClockTime::ZERO);
        if current == gst::State::Playing { seen_playing = true; }
        // Item fechado: o pipeline levou a fonte a NULL.
        if seen_playing && current == gst::State::Null && pending == gst::State::VoidPending { return; }
        if current != gst::State::Playing || pending != gst::State::VoidPending { continue; }
        // O contador do libsrt anda com a sessão viva, mesmo com o `srtsrc`
        // parado esperando o pipeline. Ele zera no socket novo.
        let now_packets = received_packets(&source.property::<gst::Structure>("stats"));
        if now_packets.is_some_and(|count| count > 0) && now_packets != packets { activity.mark(Instant::now()); }
        packets = now_packets;
        if late && !skipped_late { skipped_late = true; continue; }
        skipped_late = false;
        if !activity.take_stall(Instant::now(), SRT_STALL) { continue; }
        let Some(parent) = source.parent().and_then(|parent| parent.downcast::<gst::Element>().ok()) else { return };
        let (_, parent_state, parent_pending) = parent.state(gst::ClockTime::ZERO);
        if parent_state != gst::State::Playing || parent_pending != gst::State::VoidPending { continue; }
        eprintln!("[engine] entrada SRT sem sinal de vida há {} ms: reabrindo o socket SRT (o item e o PGM continuam)", SRT_STALL.as_millis());
        let _ = source.set_state(gst::State::Null);
        packets = None;
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
        assert!(!activity.take_stall(at(6_500), SRT_STALL), "soluço de 1,5 s não é queda");
        assert!(!activity.take_stall(at(7_400), SRT_STALL), "2,4 s ainda não é queda");
        assert!(activity.take_stall(at(7_600), SRT_STALL), "2,5 s calada depois de fluir é queda");
        assert!(!activity.take_stall(at(12_000), SRT_STALL), "uma reabertura por queda, sem derrubar o handshake em curso");
        activity.mark(at(12_500));
        assert!(!activity.take_stall(at(14_000), SRT_STALL));
        assert!(activity.take_stall(at(15_100), SRT_STALL), "nova queda depois da volta reabre de novo");
    }

    #[test]
    fn late_mark_never_moves_activity_backwards() {
        let origin = Instant::now();
        let activity = SrtActivity::new(origin);
        let at = |ms: u64| origin + Duration::from_millis(ms);
        activity.mark(at(3_000));
        // A vigia e o probe marcam de threads diferentes; um `now` mais velho
        // que chega depois não pode encurtar a sessão viva.
        activity.mark(at(1_000));
        assert!(!activity.take_stall(at(5_000), SRT_STALL));
    }

    #[test]
    fn received_packets_reads_caller_and_listener_stats() {
        gst::init().unwrap();
        let caller = gst::Structure::builder("application/x-srt-statistics").field("packets-received", 120i64).build();
        assert_eq!(received_packets(&caller), Some(120));
        // Forma que o `srtsrc` em listener devolve: um GValueArray de
        // estruturas, uma por caller (GValueArray não é `Send` no Rust).
        let one = gst::Structure::builder("application/x-srt-statistics").field("packets-received", 7i64).build();
        let two = gst::Structure::builder("application/x-srt-statistics").field("packets-received", 5i64).build();
        let callers = gst::glib::ValueArray::new([one.to_value(), two.to_value()]);
        let mut listener = gst::Structure::new_empty("application/x-srt-statistics");
        listener.set_value("callers", unsafe { callers.to_value().into_send_value() });
        assert_eq!(received_packets(&listener), Some(12));
        // Socket recém-aberto: só o total de bytes, sem sessão.
        let fresh = gst::Structure::builder("application/x-srt-statistics").field("bytes-received-total", 0u64).build();
        assert_eq!(received_packets(&fresh), None);
    }
}
