//! Descoberta de fontes ao vivo na máquina.
//!
//! Pergunta ao próprio GStreamer o que existe, em vez de a interface adivinhar:
//! quem sabe quantos sub-dispositivos uma Decklink Duo 2 expõe é o driver dela,
//! e o mesmo binário que vai abrir a entrada é o que responde aqui.
//!
//! Ausência tem motivo. Placa sem driver e NDI sem plugin são situações
//! diferentes, e dizer qual das duas é poupa o operador de procurar no lugar
//! errado -- por isso a resposta traz `disponivel` e `motivo`, e não só uma
//! lista vazia.
//!
//! Uma linha de JSON no stdout.

use anyhow::{Context, Result};
use gstreamer as gst;
use gstreamer::prelude::*;
use serde::Serialize;
#[path = "../omt_runtime.rs"]
mod omt_runtime;

/// Quanto esperar o monitor listar. Descoberta de placa é instantânea; a de
/// NDI varre a rede e merece mais tempo.
const SETTLE_MS: u64 = 1200;

/// Optional fixed-stage diagnostics on stderr; stdout remains one JSON record.
/// No source names, endpoints, credentials or driver-provided errors are logged.
fn trace(stage: &str) {
    if !std::env::args().any(|arg| arg == "--trace") { return; }
    static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    eprintln!("[devices] {}ms {stage}", START.get_or_init(std::time::Instant::now).elapsed().as_millis());
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    /// Referência que vai no item da grade: `sdi:0`, `ndi:Estúdio`.
    reference: String,
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Family {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    sources: Vec<Source>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Devices {
    decklink: Family,
    decklink_outputs: Family,
    ndi: Family,
    /// Fontes Open Media Transport anunciadas por DNS-SD (_omt._tcp).
    omt: Family,
    /// O que o canal precisa e não está nesta instalação do GStreamer.
    plugins: Plugins,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Plugins {
    /// Elementos essenciais que faltam. Vazio é instalação completa.
    missing: Vec<Missing>,
    /// Elementos opcionais ausentes: o canal sobe sem eles, com menos recursos.
    optional: Vec<Missing>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Missing {
    element: String,
    /// De qual pacote ele vem, que é a informação que resolve o problema.
    plugin: String,
    /// O que deixa de funcionar sem ele.
    breaks: String,
}

/// O que o canal usa, com a origem de cada um.
///
/// Elemento que falta só aparece quando o caminho dele é exercitado -- a
/// gravação as-run que morre no primeiro take, a saída SRT que nunca conecta --
/// e aí a causa está longe do sintoma. Conferir antes é mais barato.
const REQUIRED: &[(&str, &str, &str)] = &[
    ("compositor", "base", "a composição do programa"),
    ("intervideosink", "bad (inter)", "a passagem do item para o canal"),
    ("uridecodebin", "base", "abrir qualquer arquivo"),
    ("deinterlace", "good", "entrada entrelaçada"),
    ("videocrop", "good (videocrop)", "encher a tela cortando a sobra"),
    ("imagefreeze", "good", "imagem parada na grade"),
    ("audiomixer", "base", "a mistura de áudio do canal"),
    ("x264enc", "ugly (x264)", "toda saída de vídeo"),
    ("avenc_aac", "gst-libav", "o áudio de toda saída"),
    ("flvmux", "good", "saída RTMP"),
    ("matroskamux", "good", "a gravação as-run"),
    ("jpegenc", "good", "as miniaturas do acervo"),
];

/// Onde um elemento pode vir de mais de um plugin.
///
/// Decodificar AAC é o caso que importa: quase todo arquivo de emissora é
/// H.264 com AAC, e sem decodificador ele vai ao ar **mudo** -- a imagem
/// aparece, o VT anda, e só quem está de fone descobre. O `avdec_aac` vem do
/// gst-libav e o `faad` do plugins-bad; um dos dois basta, e acusar falta
/// tendo o outro instalado mandaria procurar defeito onde não há.
const ALTERNATIVAS: &[(&[&str], &str, &str)] = &[(
    &["avdec_aac", "faad"],
    "gst-libav (ou o faad, do plugins-bad)",
    "tocar arquivo com áudio AAC -- sem ele o VT vai ao ar mudo",
)];

const OPTIONAL: &[(&str, &str, &str)] = &[
    ("rsvgoverlay", "bad (rsvg)", "o grafismo"),
    ("rtmp2sink", "bad (rtmp2)", "publicar em RTMP"),
    ("srtsink", "bad (srt)", "saída SRT"),
    ("mpegtsmux", "bad (mpegtsmux)", "saída SRT"),
    ("interlace", "bad", "saída entrelaçada, como 1080i5994"),
    ("decklinkvideosrc", "bad (decklink)", "entrada por placa"),
    ("decklinkvideosink", "bad (decklink)", "saída por placa"),
    ("ndisrc", "plugin NDI, instalado à parte", "entrada NDI"),
];

/// O que falta entre os que têm mais de uma origem possível.
fn survey_alternativas(list: &[(&[&str], &str, &str)]) -> Vec<Missing> {
    list.iter()
        .filter(|(opcoes, _, _)| {
            opcoes
                .iter()
                .all(|element| gst::ElementFactory::find(element).is_none())
        })
        .map(|(opcoes, plugin, breaks)| Missing {
            element: opcoes.join(" ou "),
            plugin: (*plugin).to_string(),
            breaks: (*breaks).to_string(),
        })
        .collect()
}

fn survey(list: &[(&str, &str, &str)]) -> Vec<Missing> {
    list.iter()
        .filter(|(element, _, _)| gst::ElementFactory::find(element).is_none())
        .map(|(element, plugin, breaks)| Missing {
            element: (*element).to_string(),
            plugin: (*plugin).to_string(),
            breaks: (*breaks).to_string(),
        })
        .collect()
}

/// Lista o que um provedor de dispositivos conhece.
///
/// Provedor ausente não é lista vazia: é plugin que falta, e o operador precisa
/// saber a diferença entre "não tem placa" e "não tem driver".
fn enumerate(provider: &str, prefix: &str, missing: &str, direction: &str) -> Family {
    trace(&format!("{provider}/{direction}:factory"));
    let Some(factory) = gst::DeviceProviderFactory::find(provider) else {
        let element = if direction == "Sink" { "decklinkvideosink" } else { "decklinkvideosrc" };
        if prefix == "sdi" && gst::ElementFactory::find(element).is_some() {
            return Family {
                available: true,
                reason: Some("o plugin DeckLink existe, mas o provedor de descoberta não está disponível; isso não confirma ausência da placa nem presença do driver Desktop Video".to_string()),
                sources: Vec::new(),
            };
        }
        return Family {
            available: false,
            reason: Some(missing.to_string()),
            sources: Vec::new(),
        };
    };
    let Some(device_provider) = factory.get() else {
        return Family {
            available: false,
            reason: Some(missing.to_string()),
            sources: Vec::new(),
        };
    };

    trace(&format!("{provider}/{direction}:start"));
    if let Err(error) = device_provider.start() {
        return Family {
            available: false,
            reason: Some(format!(
                "não foi possível iniciar o provedor de {prefix}: {error}; verifique o runtime e o driver no servidor"
            )),
            sources: Vec::new(),
        };
    }
    std::thread::sleep(std::time::Duration::from_millis(SETTLE_MS));

    trace(&format!("{provider}/{direction}:devices"));
    let mut sources: Vec<Source> = device_provider
        .devices()
        .into_iter()
        .filter(|device| accepts_device_class(device.device_class().as_str(), prefix, direction))
        .filter_map(|device| {
            let properties = device.properties()?;
            let reference = device_reference(&properties, prefix)?;
            Some(Source {
                reference,
                label: device.display_name().to_string(),
            })
        })
        .collect();

    trace(&format!("{provider}/{direction}:stop"));
    device_provider.stop();
    trace(&format!("{provider}/{direction}:stopped"));
    sources.sort_by(|a, b| a.reference.cmp(&b.reference));
    sources.dedup_by(|a, b| a.reference == b.reference);
    if prefix == "ndi" && sources.is_empty() {
        trace("ndi:mdns-fallback");
        sources = discover_mdns_services(&["_ndi._tcp.local"], "ndi");
    }

    Family {
        available: true,
        reason: if sources.is_empty() && prefix == "ndi" {
            Some("nenhuma fonte foi anunciada pelo NDI Runtime ou mDNS; confirme o NDI Runtime/Discovery Server, a mesma sub-rede e que multicast UDP 5353 não esteja bloqueado".to_string())
        } else if sources.is_empty() && prefix == "sdi" {
            Some(format!("o plugin DeckLink foi carregado, mas nenhuma porta de vídeo {direction} foi enumerada; confirme o Desktop Video compatível, conexão PCI/Thunderbolt e perfil dos conectores no servidor. Isso é distinto de uma entrada detectada sem sinal"))
        } else {
            None
        },
        sources,
    }
}

fn accepts_device_class(class: &str, prefix: &str, direction: &str) -> bool {
    class.split('/').any(|part| part == direction)
        && (prefix != "sdi" || class.split('/').any(|part| part == "Video"))
}

fn device_reference(properties: &gst::StructureRef, prefix: &str) -> Option<String> {
    // GStreamer DeckLink exports G_TYPE_UINT, not G_TYPE_INT. Reading only
    // i32 silently discarded every physical port on modern installations.
    if let Ok(number) = properties.get::<u32>("device-number") {
        return Some(format!("{prefix}:{number}"));
    }
    if let Ok(number) = properties.get::<i32>("device-number") {
        if number >= 0 { return Some(format!("{prefix}:{number}")); }
    }
    properties.get::<String>("ndi-name").ok().map(|name| format!("{prefix}:{name}"))
}

/// Faz consultas mDNS com a flag QU (unicast-response). A versão anterior
/// enviava uma pergunta multicast de uma porta efêmera sem pedir resposta
/// unicast: no Windows ela normalmente não recebia a resposta em 5353 e a UI
/// concluía erroneamente que a rede NDI estava vazia.
fn discover_mdns_services(services: &[&str], prefix: &str) -> Vec<Source> {
    use std::net::UdpSocket;
    use std::time::{Duration, Instant};

    let Ok(sock) = UdpSocket::bind("0.0.0.0:0") else {
        return Vec::new();
    };
    let _ = sock.set_read_timeout(Some(Duration::from_millis(300)));

    for (index, service) in services.iter().enumerate() {
        let mut query = vec![0, index as u8 + 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
        for label in service.split('.') {
            query.push(label.len() as u8);
            query.extend_from_slice(label.as_bytes());
        }
        query.push(0);
        query.extend_from_slice(&[0, 12, 0x80, 1]); // PTR, IN + QU
        let _ = sock.send_to(&query, "224.0.0.251:5353");
    }

    let deadline = Instant::now() + Duration::from_millis(1500);
    let mut buf = [0u8; 4096];
    let mut names = Vec::new();

    while Instant::now() < deadline {
        let Ok((n, _)) = sock.recv_from(&mut buf) else {
            continue;
        };
        let data = &buf[..n];

        for name in mdns_ptr_instances(data, services) {
            if !names.iter().any(|existing: &String| existing == &name) {
                names.push(name);
            }
        }
    }

    names
        .into_iter()
        .map(|name| Source {
            reference: format!("{prefix}:{name}"),
            label: name,
        })
        .collect()
}

/// Lê somente os registros PTR de uma resposta DNS/mDNS, inclusive nomes
/// compactados. Não tenta inferir fonte a partir de bytes aleatórios do pacote.
fn mdns_ptr_instances(data: &[u8], services: &[&str]) -> Vec<String> {
    if data.len() < 12 { return Vec::new(); }
    let questions = u16::from_be_bytes([data[4], data[5]]) as usize;
    let answers = u16::from_be_bytes([data[6], data[7]]) as usize;
    let additional = u16::from_be_bytes([data[10], data[11]]) as usize;
    let mut pos = 12;
    for _ in 0..questions {
        if decode_dns_name(data, &mut pos).is_none() || pos + 4 > data.len() { return Vec::new(); }
        pos += 4;
    }
    let mut found = Vec::new();
    for _ in 0..answers + additional {
        let Some(owner) = decode_dns_name(data, &mut pos) else { break; };
        if pos + 10 > data.len() { break; }
        let typ = u16::from_be_bytes([data[pos], data[pos + 1]]);
        let rdlen = u16::from_be_bytes([data[pos + 8], data[pos + 9]]) as usize;
        pos += 10;
        let rdata = pos;
        pos = pos.saturating_add(rdlen);
        if pos > data.len() || typ != 12 || !services.iter().any(|service| owner.eq_ignore_ascii_case(service)) { continue; }
        let mut target = rdata;
        let Some(instance) = decode_dns_name(data, &mut target) else { continue; };
        if let Some(service) = services.iter().find(|service| instance.to_ascii_lowercase().ends_with(&service.to_ascii_lowercase())) {
            let name = instance[..instance.len() - service.len()].trim_end_matches('.').trim();
            if !name.is_empty() { found.push(name.to_string()); }
        }
    }
    found
}

fn decode_dns_name(data: &[u8], pos: &mut usize) -> Option<String> {
    let mut cursor = *pos;
    let mut jumped = false;
    let mut labels = Vec::new();
    let mut guard = 0;
    loop {
        guard += 1;
        if guard > data.len() || cursor >= data.len() { return None; }
        let len = data[cursor];
        if len & 0xc0 == 0xc0 {
            if cursor + 1 >= data.len() { return None; }
            let offset = (((len & 0x3f) as usize) << 8) | data[cursor + 1] as usize;
            if !jumped { *pos = cursor + 2; jumped = true; }
            cursor = offset;
            continue;
        }
        if len == 0 {
            if !jumped { *pos = cursor + 1; }
            return Some(labels.join("."));
        }
        let end = cursor + 1 + len as usize;
        if end > data.len() { return None; }
        labels.push(std::str::from_utf8(&data[cursor + 1..end]).ok()?.to_string());
        cursor = end;
    }
}

fn main() -> Result<()> {
    trace("gstreamer:init");
    gst::init().context("GStreamer não inicializou")?;
    trace("gstreamer:ready");

    // Each provider waits SETTLE_MS for announcements and OMT waits for its own
    // discovery; done one after the other the operator waited ~5 s per scan.
    // Independent families run in parallel. Both DeckLink directions stay on
    // one thread (same driver/provider), so its enumeration order is unchanged.
    let (decklink, decklink_outputs, ndi, omt) = std::thread::scope(|scope| {
        let decklink = scope.spawn(|| {
            let sources = enumerate(
                "decklinkdeviceprovider",
                "sdi",
                "o plugin da Decklink não está nesta instalação do GStreamer",
                "Source",
            );
            let outputs = enumerate(
                "decklinkdeviceprovider",
                "sdi",
                "o plugin de saída DeckLink não está nesta instalação do GStreamer",
                "Sink",
            );
            (sources, outputs)
        });
        let ndi = scope.spawn(|| {
            enumerate(
                "ndideviceprovider",
                "ndi",
                "o plugin NDI (`ndisrc`) não está nesta instalação do GStreamer",
                "Source",
            )
        });
        let omt = scope.spawn(|| {
            trace("omt:discover");
            let found = omt_runtime::discover();
            trace("omt:discovered");
            match found {
                Ok(names) => Family {
                    available: true,
                    reason: if names.is_empty() {
                        Some("o runtime OMT está disponível, mas nenhuma fonte foi anunciada; confirme o emissor, DNS-SD ou Discovery Server".to_string())
                    } else { None },
                    sources: names.into_iter().map(|name| Source { reference: format!("omt:{name}"), label: name }).collect(),
                },
                Err(error) => Family { available: false, reason: Some(format!("{error:#}")), sources: Vec::new() },
            }
        });
        let failed = |family: &str| Family {
            available: false,
            reason: Some(format!("a descoberta de {family} falhou internamente; tente reescanear no servidor")),
            sources: Vec::new(),
        };
        let (decklink, decklink_outputs) = decklink.join().unwrap_or_else(|_| (failed("DeckLink"), failed("saídas DeckLink")));
        (decklink, decklink_outputs, ndi.join().unwrap_or_else(|_| failed("NDI")), omt.join().unwrap_or_else(|_| failed("OMT")))
    });

    let devices = Devices {
        decklink,
        decklink_outputs,
        ndi,
        omt,
        plugins: Plugins {
            missing: {
                trace("plugins:survey");
                let mut faltando = survey(REQUIRED);
                faltando.extend(survey_alternativas(ALTERNATIVAS));
                faltando
            },
            optional: survey(OPTIONAL),
        },
    };

    trace("json:emit");
    println!("{}", serde_json::to_string(&devices)?);
    trace("process:finish");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decklink_uint_port_is_not_discarded() {
        gst::init().unwrap();
        let properties = gst::Structure::builder("properties").field("device-number", 3u32).build();
        assert_eq!(device_reference(&properties, "sdi"), Some("sdi:3".to_string()));
    }

    #[test]
    fn decklink_only_lists_video_in_the_requested_direction() {
        assert!(accepts_device_class("Video/Source/Hardware", "sdi", "Source"));
        assert!(!accepts_device_class("Audio/Source/Hardware", "sdi", "Source"));
        assert!(!accepts_device_class("Video/Sink/Hardware", "sdi", "Source"));
        assert!(accepts_device_class("Video/Sink/Hardware", "sdi", "Sink"));
    }

    #[test]
    fn supports_legacy_signed_ports_and_unicode_ndi_names() {
        gst::init().unwrap();
        let signed = gst::Structure::builder("properties").field("device-number", 0i32).build();
        assert_eq!(device_reference(&signed, "sdi"), Some("sdi:0".to_string()));
        let ndi = gst::Structure::builder("properties").field("ndi-name", "Câmera São João").build();
        assert_eq!(device_reference(&ndi, "ndi"), Some("ndi:Câmera São João".to_string()));
    }

    #[test]
    fn basta_uma_das_alternativas_existir() {
        gst::init().unwrap();
        // `queue` existe em qualquer instalação; o outro nome não existe em
        // nenhuma. Tendo um dos dois, nada falta.
        let lista: &[(&[&str], &str, &str)] =
            &[(&["nao-existe-mesmo", "queue"], "algum", "alguma coisa")];
        assert!(survey_alternativas(lista).is_empty());
    }

    #[test]
    fn faltando_todas_vira_pendencia_com_os_dois_nomes() {
        gst::init().unwrap();
        let lista: &[(&[&str], &str, &str)] = &[(
            &["nao-existe-mesmo", "nem-este"],
            "gst-libav",
            "tocar AAC",
        )];
        let faltando = survey_alternativas(lista);
        assert_eq!(faltando.len(), 1);
        // Os dois nomes no recado: quem for instalar precisa saber que
        // qualquer um dos dois resolve.
        assert_eq!(faltando[0].element, "nao-existe-mesmo ou nem-este");
    }
}
