//! Subordinate output lease: never owns/promotes a channel. A native deadline
//! runs even when Node, stdout, stdin or a GStreamer driver stops responding.
use anyhow::{anyhow, Result};
use gstreamer as gst;
use gst::prelude::*;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
const TTL_MS: u64 = 1500;
const MARGIN_MS: u64 = 250;
const STARTUP_MS: u64 = 20_000;
static FENCE: OnceLock<Arc<Fence>> = OnceLock::new();
#[derive(Default)]
struct State {next: u64, last: u64, term: u64, deadline: Option<u64>, expired: bool, challenges: VecDeque<(u64,u64)>}
impl State {
    fn challenge(&mut self, now: u64) -> u64 {
        self.next = self.next.saturating_add(1);
        self.challenges.push_back((self.next,now));
        while self.challenges.len()>8 {self.challenges.pop_front();}
        self.next
    }
    fn permits(&mut self, now: u64) -> bool {
        if now>=self.deadline.unwrap_or(STARTUP_MS) {self.expired=true;}
        !self.expired&&self.deadline.is_some()
    }
    fn grant(&mut self, nonce: u64, term: u64, ttl_ms: u64, now: u64) -> Result<()> {
        self.permits(now);
        if self.expired||ttl_ms!=TTL_MS||term==0||(self.term!=0&&term!=self.term)||nonce<=self.last {return Err(anyhow!("Concessão de relay expirada, repetida ou inválida."));}
        let issued=self.challenges.iter().find(|(n,_)|*n==nonce).map(|(_,at)|*at).ok_or_else(||anyhow!("Nonce não emitido por este relay."))?;
        let deadline=issued.saturating_add(TTL_MS-MARGIN_MS);
        if deadline<=now {return Err(anyhow!("Concessão atrasada; prazo não será estendido na entrega."));}
        self.last=nonce;self.term=term;self.deadline=Some(deadline);Ok(())
    }
}
struct Fence {owner:String,origin:Instant,state:Mutex<State>}
impl Fence {
    fn now(&self)->u64 {self.origin.elapsed().as_millis().min(u64::MAX as u128) as u64}
    fn permits(&self)->bool {self.state.lock().map(|mut state|state.permits(self.now())).unwrap_or(false)}
    fn expired(&self)->bool {self.state.lock().map(|mut state|{state.permits(self.now());state.expired}).unwrap_or(true)}
}
pub fn install(owner:Option<String>)->Result<()> {
    let Some(owner)=owner else {return Ok(());};
    if owner.len()!=36||owner.chars().any(|c|!c.is_ascii_hexdigit()&&c!='-') {return Err(anyhow!("Identidade privada de relay inválida."));}
    let fence=Arc::new(Fence {owner,origin:Instant::now(),state:Mutex::new(State::default())});
    FENCE.set(fence.clone()).map_err(|_|anyhow!("Cerca de relay já configurada."))?;
    let watch=fence.clone();
    std::thread::spawn(move||loop {
        if watch.expired(){std::process::exit(75);}
        std::thread::sleep(Duration::from_millis(20));
    });
    std::thread::spawn(move||loop {
        if fence.expired(){return;}
        let nonce=fence.state.lock().unwrap().challenge(fence.now());
        println!("{}",serde_json::json!({"event":"fenceRequest","ownerId":&fence.owner,"nonce":nonce}));
        let _=std::io::Write::flush(&mut std::io::stdout());
        std::thread::sleep(Duration::from_millis(300));
    });
    Ok(())
}
pub fn grant(owner:&str,nonce:u64,term:u64,ttl_ms:u64)->Result<()> {
    let fence=FENCE.get().ok_or_else(||anyhow!("Relay não exige concessão."))?;
    if owner!=fence.owner {return Err(anyhow!("Concessão pertence a outro relay."));}
    fence.state.lock().map_err(|_|anyhow!("Estado da cerca indisponível."))?.grant(nonce,term,ttl_ms,fence.now())
}
pub fn abort(){if let Some(fence)=FENCE.get(){if let Ok(mut state)=fence.state.lock(){state.expired=true;}}}
pub fn wait_initial()->Result<()> {
    if let Some(fence)=FENCE.get(){while !fence.permits(){if fence.expired(){return Err(anyhow!("Relay sem autorização; destino não será aberto."));}std::thread::sleep(Duration::from_millis(10));}}
    Ok(())
}
pub fn guard(sink:&gst::Element)->Result<()> {
    let Some(fence)=FENCE.get() else {return Ok(());};
    if sink.sink_pads().is_empty(){return Err(anyhow!("Destino sem ponto de cerca; publicação recusada."));}
    for pad in sink.sink_pads(){let fence=fence.clone();pad.add_probe(gst::PadProbeType::BUFFER|gst::PadProbeType::BUFFER_LIST,move|_,_|if fence.permits(){gst::PadProbeReturn::Ok}else{gst::PadProbeReturn::Drop}).ok_or_else(||anyhow!("Destino sem cerca nativa."))?;}
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn delayed_grant_does_not_restart_deadline(){let mut s=State::default();let n=s.challenge(10);s.grant(n,1,TTL_MS,500).unwrap();assert!(s.permits(1259));assert!(!s.permits(1260));}
    #[test] fn expired_relay_cannot_revive(){let mut s=State::default();let n=s.challenge(0);s.grant(n,1,TTL_MS,0).unwrap();assert!(!s.permits(1250));let n=s.challenge(1251);assert!(s.grant(n,1,TTL_MS,1252).is_err());}
    #[test] fn nonce_term_and_ttl_are_not_freeform(){let mut s=State::default();let n=s.challenge(0);assert!(s.grant(n,1,5000,0).is_err());s.grant(n,1,TTL_MS,0).unwrap();assert!(s.grant(n,1,TTL_MS,1).is_err());let n=s.challenge(300);assert!(s.grant(n,2,TTL_MS,301).is_err());}
}
