//! Private startup data arrives through the owning server's pipe, never argv.
//! Keep the same buffered reader for commands: it can already contain TAKE.
use anyhow::{anyhow, Result};
use serde::de::DeserializeOwned;
use std::io::{BufRead, Read};

const MAX_BOOTSTRAP_BYTES: u64 = 65_536;

pub fn read<T: DeserializeOwned>(reader: &mut impl BufRead) -> Result<T> {
    let mut bytes = Vec::new();
    (&mut *reader).take(MAX_BOOTSTRAP_BYTES + 1).read_until(b'\n', &mut bytes)
        .map_err(|_| anyhow!("Não foi possível receber a configuração privada."))?;
    if bytes.len() as u64 > MAX_BOOTSTRAP_BYTES || bytes.last() != Some(&b'\n') {
        bytes.fill(0);
        return Err(anyhow!("Configuração privada ausente, incompleta ou acima do limite."));
    }
    // Parsing diagnostics must not include secrets or their supplied values.
    let result = serde_json::from_slice(&bytes)
        .map_err(|_| anyhow!("Formato de configuração privada inválido."));
    bytes.fill(0);
    result
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)] // Shared module; the relay binary only consumes RelayConnection.
pub struct EngineOutputs {
    pub outputs: Vec<String>,
    pub preview: Option<String>,
    #[serde(default, rename = "qcPreview")]
    pub qc_preview: Option<String>,
    #[serde(default, rename = "fenceOwner")]
    pub fence_owner: Option<String>,
    #[serde(default, rename = "holdProgramOutputs")]
    pub hold_program_outputs: bool,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)] // Shared module; the engine binary only consumes EngineOutputs.
pub struct RelayConnection {
    pub from: String,
    pub to: String,
    #[serde(default, rename = "fenceOwner")]
    pub fence_owner: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufReader, Cursor};

    #[test]
    fn conserva_comando_bufferizado_depois_da_configuracao_privada() {
        let mut input = BufReader::new(Cursor::new(b"{\"outputs\":[\"null\"],\"preview\":null}\n{\"id\":1,\"cmd\":\"shutdown\"}\n"));
        let config: EngineOutputs = read(&mut input).unwrap();
        assert_eq!(config.outputs, ["null"]);
        assert!(config.preview.is_none());
        assert!(!config.hold_program_outputs);
        let mut command = String::new();
        input.read_line(&mut command).unwrap();
        assert_eq!(command, "{\"id\":1,\"cmd\":\"shutdown\"}\n");
    }

    #[test]
    fn preparacao_retida_exige_booleano_e_preserva_flag_privada() {
        let mut input=Cursor::new(b"{\"outputs\":[\"null\"],\"preview\":null,\"holdProgramOutputs\":true}\n");
        let config:EngineOutputs=read(&mut input).unwrap();assert!(config.hold_program_outputs);
        let mut invalid=Cursor::new(b"{\"outputs\":[\"null\"],\"preview\":null,\"holdProgramOutputs\":\"true\"}\n");
        assert!(read::<EngineOutputs>(&mut invalid).is_err());
    }
    #[test]
    fn rejeita_truncamento_tamanho_e_campos_desconhecidos_sem_expor_segredo() {
        for text in ["{\"outputs\":[\"PRIVATE_SECRET\"]}", "{\"outputs\":[\"PRIVATE_SECRET\"],\"unexpected\":true}\n", "{invalid PRIVATE_SECRET}\n"] {
            let result = read::<EngineOutputs>(&mut Cursor::new(text));
            assert!(result.is_err());
            assert!(!result.err().unwrap().to_string().contains("PRIVATE_SECRET"));
        }
        let large = format!("{{\"from\":\"{}\",\"to\":\"srt://host:9000\"}}\n", "x".repeat(MAX_BOOTSTRAP_BYTES as usize));
        assert!(read::<RelayConnection>(&mut Cursor::new(large)).is_err());
    }

    #[test]
    fn conserva_uri_e_unicode_do_relay_sem_normalizacao() {
        let mut input = Cursor::new("{\"from\":\"rtsp://127.0.0.1/ESTÚDIO\",\"to\":\"srt://host:9000?passphrase=PRIVATE_SECRET\"}\n");
        let config: RelayConnection = read(&mut input).unwrap();
        assert_eq!(config.from, "rtsp://127.0.0.1/ESTÚDIO");
        assert_eq!(config.to, "srt://host:9000?passphrase=PRIVATE_SECRET");
        assert!(config.fence_owner.is_none());
    }
    #[test]
    fn conserva_grant_bufferizado_apos_config_do_relay() {
        let mut input=BufReader::new(Cursor::new(b"{\"from\":\"rtsp://127.0.0.1/pgm\",\"to\":\"srt://127.0.0.1:9000\",\"fenceOwner\":\"consumer\"}\n{\"cmd\":\"fenceGrant\"}\n"));
        let config:RelayConnection=read(&mut input).unwrap();assert_eq!(config.fence_owner.as_deref(),Some("consumer"));
        let mut command=String::new();input.read_line(&mut command).unwrap();assert_eq!(command,"{\"cmd\":\"fenceGrant\"}\n");
    }
}
