//! Native lease gate. A Node stall must not keep publishing indefinitely.
//! The owner is private stdin data. Each nonce is timestamped here, before
//! the witness request, so delayed/buffered grants cannot reset the TTL.
use anyhow::{anyhow, Result};
use gstreamer as gst;
use gst::prelude::*;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const LEASE_MS: u64 = 5000;
const MARGIN_MS: u64 = 1000;
const STARTUP_MS: u64 = 20_000;
static FENCE: OnceLock<Arc<NativeFence>> = OnceLock::new();

#[derive(Default)]
struct LeaseState {
    challenges: VecDeque<(u64, u64)>,
    next_nonce: u64,
    last_nonce: u64,
    term: u64,
    deadline: Option<u64>,
    expired: bool,
}
impl LeaseState {
    fn challenge(&mut self, now: u64) -> u64 {
        self.next_nonce += 1;
        self.challenges.push_back((self.next_nonce, now));
        while self.challenges.len() > 8 { self.challenges.pop_front(); }
        self.next_nonce
    }
    fn observe(&mut self, now: u64) -> bool {
        if now >= self.deadline.unwrap_or(STARTUP_MS) { self.expired = true; }
        !self.expired && self.deadline.is_some()
    }
    fn grant(&mut self, nonce: u64, term: u64, ttl_ms: u64, now: u64) -> Result<()> {
        self.observe(now);
        if self.expired { return Err(anyhow!("Posse HA expirada; este engine não pode ser reativado.")); }
        if ttl_ms != LEASE_MS || term == 0 || (self.term != 0 && term != self.term) || nonce <= self.last_nonce {
            return Err(anyhow!("Concessão HA inválida, repetida ou fora de ordem."));
        }
        let issued = self.challenges.iter().find(|(id, _)| *id == nonce).map(|(_, issued)| *issued)
            .ok_or_else(|| anyhow!("Nonce HA não foi emitido por este engine."))?;
        let deadline = issued + ttl_ms - MARGIN_MS;
        if deadline <= now { return Err(anyhow!("Concessão HA atrasada; prazo não será reiniciado na entrega.")); }
        self.last_nonce = nonce;
        self.term = term;
        self.deadline = Some(deadline);
        Ok(())
    }
}
struct NativeFence { owner: String, origin: Instant, state: Mutex<LeaseState> }
impl NativeFence {
    fn now(&self) -> u64 { self.origin.elapsed().as_millis().min(u64::MAX as u128) as u64 }
    fn permits(&self) -> bool { self.state.lock().map(|mut state| state.observe(self.now())).unwrap_or(false) }
    fn expired(&self) -> bool { self.state.lock().map(|mut state| { state.observe(self.now()); state.expired }).unwrap_or(true) }
}

pub fn install(owner: Option<String>) -> Result<()> {
    let Some(owner) = owner else { return Ok(()); };
    if owner.len() != 36 || owner.chars().any(|c| !c.is_ascii_hexdigit() && c != '-') { return Err(anyhow!("Dono privado HA inválido.")); }
    let fence = Arc::new(NativeFence {owner, origin: Instant::now(), state: Mutex::new(LeaseState::default())});
    FENCE.set(fence.clone()).map_err(|_| anyhow!("Cerca HA já configurada."))?;
    let watchdog = fence.clone();
    // This thread does no stdout/stderr IO and never calls a GStreamer state
    // transition that could hang on a driver. Exit also closes socket handles.
    std::thread::spawn(move || loop {
        if watchdog.expired() { std::process::exit(75); }
        std::thread::sleep(Duration::from_millis(25));
    });
    // stdout can backpressure during a Node stall. Keep it off the watchdog.
    std::thread::spawn(move || loop {
        if fence.expired() { return; }
        let nonce = fence.state.lock().unwrap().challenge(fence.now());
        crate::protocol::Event::FenceRequest { owner_id: fence.owner.clone(), nonce }.emit();
        std::thread::sleep(Duration::from_millis(750));
    });
    Ok(())
}
pub fn grant(owner: &str, nonce: u64, term: u64, ttl_ms: u64) -> Result<()> {
    let fence = FENCE.get().ok_or_else(|| anyhow!("Este engine não está em modo HA com concessão."))?;
    if owner != fence.owner { return Err(anyhow!("Concessão pertence a outro engine.")); }
    fence.state.lock().map_err(|_| anyhow!("Estado da cerca HA indisponível."))?.grant(nonce, term, ttl_ms, fence.now())
}
pub fn wait_initial() -> Result<()> {
    if let Some(fence) = FENCE.get() {
        while !fence.permits() {
            if fence.expired() { return Err(anyhow!("Nenhuma concessão HA válida; PGM não será aberto.")); }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    Ok(())
}
pub fn abort() { if let Some(fence) = FENCE.get() { if let Ok(mut state) = fence.state.lock() { state.expired = true; } } }

/// All sink inputs, including SDI, NDI, OMT appsinks and mux/network sinks,
/// refuse new buffers after expiry even if the command/service loop blocks.
/// This does not certify external routing or purge packets already in flight.
pub fn guard_pipeline(pipeline: &gst::Pipeline) -> Result<()> {
    let Some(fence) = FENCE.get() else { return Ok(()); };
    for element in pipeline.iterate_sinks() {
        let element = element.map_err(|_| anyhow!("Não foi possível cercar as saídas HA."))?;
        for pad in element.sink_pads() {
            let fence = fence.clone();
            pad.add_probe(gst::PadProbeType::BUFFER | gst::PadProbeType::BUFFER_LIST, move |_, _| {
                if fence.permits() { gst::PadProbeReturn::Ok } else { gst::PadProbeReturn::Drop }
            }).ok_or_else(|| anyhow!("Saída sem probe HA; publicação recusada."))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn deadline_starts_at_nonce_not_ack() {
        let mut state = LeaseState::default(); let nonce = state.challenge(10);
        state.grant(nonce, 1, 5000, 2000).unwrap();
        assert!(state.observe(4009)); assert!(!state.observe(4010));
    }
    #[test] fn delayed_or_duplicate_grant_cannot_extend_expiry() {
        let mut state = LeaseState::default(); let nonce = state.challenge(0);
        assert!(state.grant(nonce, 1, 5000, 4000).is_err());
        state.grant(nonce, 1, 5000, 100).unwrap();
        assert!(state.grant(nonce, 1, 5000, 3000).is_err());
        assert!(!state.observe(4000));
    }
    #[test] fn expired_engine_never_revives_with_a_fresh_term_or_nonce() {
        let mut state = LeaseState::default(); let nonce = state.challenge(0);
        state.grant(nonce, 1, 5000, 0).unwrap(); assert!(!state.observe(4000));
        let next = state.challenge(4001); assert!(state.grant(next, 2, 5000, 4002).is_err());
    }
    #[test] fn nonce_owner_term_and_ttl_are_not_freeform_authority() {
        let mut state = LeaseState::default(); let nonce = state.challenge(0);
        assert!(state.grant(999, 1, 5000, 0).is_err()); assert!(state.grant(nonce, 0, 5000, 0).is_err());
        assert!(state.grant(nonce, 1, 9000, 0).is_err()); state.grant(nonce, 1, 5000, 0).unwrap();
        let next = state.challenge(750); assert!(state.grant(next, 2, 5000, 750).is_err());
        state.grant(next, 1, 5000, 750).unwrap(); assert!(state.observe(4749)); assert!(!state.observe(4750));
    }
}
