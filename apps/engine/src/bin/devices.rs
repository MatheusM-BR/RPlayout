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

/// Quanto esperar o monitor listar. Descoberta de placa é instantânea; a de
/// NDI varre a rede e merece mais tempo.
const SETTLE_MS: u64 = 1200;

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
    ndi: Family,
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

const OPTIONAL: &[(&str, &str, &str)] = &[
    ("rsvgoverlay", "bad (rsvg)", "o grafismo"),
    ("rtmp2sink", "bad (rtmp2)", "publicar em RTMP"),
    ("srtsink", "bad (srt)", "saída SRT"),
    ("mpegtsmux", "bad (mpegtsmux)", "saída SRT"),
    ("interlace", "bad", "saída entrelaçada, como 1080i5994"),
    ("decklinkvideosrc", "bad (decklink)", "entrada e saída por placa"),
    ("ndisrc", "plugin NDI, instalado à parte", "entrada NDI"),
];

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
fn enumerate(provider: &str, prefix: &str, missing: &str) -> Family {
    let Some(factory) = gst::DeviceProviderFactory::find(provider) else {
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

    if device_provider.start().is_err() {
        return Family {
            available: false,
            reason: Some(format!(
                "o driver respondeu, mas não consegui iniciar a busca de {prefix}"
            )),
            sources: Vec::new(),
        };
    }
    std::thread::sleep(std::time::Duration::from_millis(SETTLE_MS));

    let sources = device_provider
        .devices()
        .into_iter()
        .filter(|device| device.device_class().contains("Source"))
        .filter_map(|device| {
            let properties = device.properties()?;
            // A Decklink numera sub-dispositivos; o NDI identifica por nome.
            let reference = match properties.get::<i32>("device-number") {
                Ok(number) => format!("{prefix}:{number}"),
                Err(_) => format!("{prefix}:{}", properties.get::<String>("ndi-name").ok()?),
            };
            Some(Source {
                reference,
                label: device.display_name().to_string(),
            })
        })
        .collect();

    device_provider.stop();
    Family {
        available: true,
        reason: None,
        sources,
    }
}

fn main() -> Result<()> {
    gst::init().context("GStreamer não inicializou")?;

    let devices = Devices {
        decklink: enumerate(
            "decklinkdeviceprovider",
            "sdi",
            "o plugin da Decklink não está nesta instalação do GStreamer",
        ),
        ndi: enumerate(
            "ndideviceprovider",
            "ndi",
            "o plugin NDI (`ndisrc`) não está nesta instalação do GStreamer",
        ),
        plugins: Plugins {
            missing: survey(REQUIRED),
            optional: survey(OPTIONAL),
        },
    };

    println!("{}", serde_json::to_string(&devices)?);
    Ok(())
}
