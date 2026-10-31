//! Quais codificadores de H.264 esta máquina tem, e quantas sessões cada um
//! aguenta de verdade.
//!
//! A pergunta não se responde pelo nome da placa: GeForce limita as sessões
//! NVENC por driver (3, depois 5, hoje 8 nos drivers recentes), Quadro/RTX A
//! não limitam, e o número muda com a versão do driver. A única resposta
//! honesta é abrir sessões até a placa dizer não -- é o que [`probe`] faz,
//! uma vez, na partida, antes dos canais subirem.
//!
//! `mfh264enc` numa NVIDIA usa a mesma NVENC por baixo; por isso o servidor
//! soma as sessões só do melhor codificador de placa, nunca de dois.
//!
//! Este arquivo não depende do resto do engine: o binário
//! `rplayout-encoders` o inclui por `#[path]`.

use serde::Serialize;

/// Codificadores de placa, na ordem de preferência.
pub const HARDWARE: &[&str] = &["nvh264enc", "qsvh264enc", "mfh264enc"];
/// Acima disto a contagem para: "sem limite de driver".
pub const PROBE_MAX_SESSIONS: u32 = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderInfo {
    pub name: String,
    pub hardware: bool,
    pub available: bool,
    /// Sessões simultâneas que abriram. `None` no software (limite é CPU).
    pub sessions: Option<u32>,
    /// A contagem bateu no teto da sonda sem a placa recusar.
    pub unlimited: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Quem abre uma sessão de verdade. Os testes usam uma placa de mentira.
pub trait SessionOpener {
    fn exists(&self, name: &str) -> bool;
    /// Abre e segura uma sessão; ela fecha quando o valor é descartado.
    fn open(&mut self, name: &str) -> Result<Box<dyn std::any::Any>, String>;
}

/// Sonda todos os codificadores conhecidos.
pub fn probe(opener: &mut dyn SessionOpener, max_sessions: u32) -> Vec<EncoderInfo> {
    let mut out = Vec::new();
    for name in HARDWARE {
        if !opener.exists(name) {
            out.push(EncoderInfo { name: name.to_string(), hardware: true, available: false, sessions: None, unlimited: false, error: None });
            continue;
        }
        let mut held = Vec::new();
        let mut error = None;
        while (held.len() as u32) < max_sessions {
            match opener.open(name) {
                Ok(session) => held.push(session),
                Err(reason) => {
                    error = Some(reason);
                    break;
                }
            }
        }
        let count = held.len() as u32;
        drop(held);
        out.push(EncoderInfo {
            name: name.to_string(),
            hardware: true,
            available: count > 0,
            sessions: (count > 0).then_some(count),
            unlimited: count >= max_sessions,
            error: if count == 0 { error } else { None },
        });
    }
    out.push(EncoderInfo {
        name: "x264enc".into(),
        hardware: false,
        available: opener.exists("x264enc"),
        sessions: None,
        unlimited: true,
        error: None,
    });
    out
}

/// Sessões de placa disponíveis para o RPlayout: as do melhor codificador
/// de placa que respondeu (`None` = sem limite conhecido; `Some(0)` = sem placa).
pub fn hardware_sessions(list: &[EncoderInfo]) -> (Option<String>, Option<u32>) {
    match list.iter().find(|e| e.hardware && e.available) {
        Some(e) if e.unlimited => (Some(e.name.clone()), None),
        Some(e) => (Some(e.name.clone()), e.sessions),
        None => (None, Some(0)),
    }
}

/// Abre sessões com GStreamer: um quadro pequeno, até o encoder entregar.
pub struct GstOpener;

impl SessionOpener for GstOpener {
    fn exists(&self, name: &str) -> bool {
        gstreamer::ElementFactory::find(name).is_some()
    }

    fn open(&mut self, name: &str) -> Result<Box<dyn std::any::Any>, String> {
        use gstreamer as gst;
        use gstreamer::prelude::*;
        let text = format!(
            "videotestsrc pattern=black num-buffers=30 ! video/x-raw,width=320,height=240,framerate=30/1 ! videoconvert ! video/x-raw,format=NV12 ! {name} ! fakesink sync=false"
        );
        let pipeline = gst::parse::launch(&text).map_err(|e| e.to_string())?.downcast::<gst::Pipeline>().map_err(|_| "pipeline".to_string())?;
        pipeline.set_state(gst::State::Paused).map_err(|e| e.to_string())?;
        let bus = pipeline.bus().ok_or("sem bus")?;
        let message = bus.timed_pop_filtered(gst::ClockTime::from_seconds(5), &[gst::MessageType::AsyncDone, gst::MessageType::Error]);
        match message.as_ref().map(|m| m.view()) {
            Some(gst::MessageView::AsyncDone(_)) => Ok(Box::new(Session(pipeline))),
            Some(gst::MessageView::Error(error)) => {
                let _ = pipeline.set_state(gst::State::Null);
                Err(format!("{}", error.error()))
            }
            _ => {
                let _ = pipeline.set_state(gst::State::Null);
                Err("a placa não respondeu em 5 s".into())
            }
        }
    }
}

struct Session(gstreamer::Pipeline);

impl Drop for Session {
    fn drop(&mut self) {
        use gstreamer::prelude::*;
        let _ = self.0.set_state(gstreamer::State::Null);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;

    /// Placa de mentira: `limit` sessões por codificador, contadas de verdade.
    struct Fake {
        present: Vec<&'static str>,
        limit: Option<u32>,
        open_now: Rc<Cell<u32>>,
    }
    struct Held(Rc<Cell<u32>>);
    impl Drop for Held {
        fn drop(&mut self) {
            self.0.set(self.0.get() - 1);
        }
    }
    impl SessionOpener for Fake {
        fn exists(&self, name: &str) -> bool {
            self.present.contains(&name)
        }
        fn open(&mut self, _name: &str) -> Result<Box<dyn std::any::Any>, String> {
            if self.limit.is_some_and(|limit| self.open_now.get() >= limit) {
                return Err("OpenEncodeSessionEx failed: out of memory (session limit)".into());
            }
            self.open_now.set(self.open_now.get() + 1);
            Ok(Box::new(Held(Rc::clone(&self.open_now))))
        }
    }

    #[test]
    fn geforce_conta_o_limite_do_driver_e_devolve_as_sessoes() {
        let open = Rc::new(Cell::new(0));
        let mut fake = Fake { present: vec!["nvh264enc", "x264enc"], limit: Some(8), open_now: Rc::clone(&open) };
        let list = probe(&mut fake, PROBE_MAX_SESSIONS);
        let nv = list.iter().find(|e| e.name == "nvh264enc").unwrap();
        assert_eq!((nv.available, nv.sessions, nv.unlimited), (true, Some(8), false));
        assert_eq!(open.get(), 0, "a sonda não pode deixar sessão aberta");
        assert_eq!(hardware_sessions(&list), (Some("nvh264enc".into()), Some(8)));
    }

    #[test]
    fn quadro_nao_tem_limite() {
        let mut fake = Fake { present: vec!["nvh264enc", "x264enc"], limit: None, open_now: Rc::new(Cell::new(0)) };
        let list = probe(&mut fake, PROBE_MAX_SESSIONS);
        assert_eq!(hardware_sessions(&list), (Some("nvh264enc".into()), None));
    }

    #[test]
    fn sem_placa_so_software() {
        let mut fake = Fake { present: vec!["x264enc"], limit: None, open_now: Rc::new(Cell::new(0)) };
        let list = probe(&mut fake, PROBE_MAX_SESSIONS);
        assert!(list.iter().filter(|e| e.hardware).all(|e| !e.available));
        assert!(list.iter().any(|e| e.name == "x264enc" && e.available));
        assert_eq!(hardware_sessions(&list), (None, Some(0)));
    }

    #[test]
    fn placa_que_existe_mas_recusa_a_primeira_sessao_nao_conta() {
        let mut fake = Fake { present: vec!["nvh264enc", "qsvh264enc", "x264enc"], limit: Some(0), open_now: Rc::new(Cell::new(0)) };
        let list = probe(&mut fake, PROBE_MAX_SESSIONS);
        let nv = list.iter().find(|e| e.name == "nvh264enc").unwrap();
        assert!(!nv.available && nv.error.is_some());
        assert_eq!(hardware_sessions(&list), (None, Some(0)));
    }

    #[test]
    fn sonda_real_nesta_maquina() {
        gstreamer::init().unwrap();
        let list = probe(&mut GstOpener, 2);
        assert!(list.iter().any(|e| e.name == "x264enc" && e.available));
    }
}
