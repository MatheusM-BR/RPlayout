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
    };

    println!("{}", serde_json::to_string(&devices)?);
    Ok(())
}
