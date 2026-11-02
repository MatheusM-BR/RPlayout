//! In-process transaction journal for replacing one live decoder without TAKE.
//! It is deliberately not the durable server journal. A new engine generation
//! must reconcile from its checkpoint; receipts here only describe this process.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

const MAX_TRANSACTIONS: usize = 256;
pub const PREPARATION_DEADLINE: Duration = Duration::from_secs(10);

#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub transaction_id: String,
    pub engine_generation: String,
    pub selection_revision: String,
    pub item_id: String,
    pub expected_decoder_id: u64,
    pub expected_source_id: String,
    pub target_source_id: String,
    // Private pipe data. Never serialize a Request into receipts or logs.
    pub target_source: String,
    pub target_source_type: String,
}

impl std::fmt::Debug for Request {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LiveReplacementRequest")
            .field("transaction_id", &self.transaction_id)
            .field("item_id", &self.item_id)
            .field("expected_decoder_id", &self.expected_decoder_id)
            .field("target_source", &"[PRIVATE]")
            .finish_non_exhaustive()
    }
}

impl Request {
    pub fn validate(&self) -> Result<()> {
        for value in [
            &self.transaction_id,
            &self.engine_generation,
            &self.selection_revision,
        ] {
            if value.is_empty()
                || value.len() > 128
                || !value
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.:".contains(&c))
            {
                return Err(anyhow!("identidade/revisão da troca inválida"));
            }
        }
        for value in [
            &self.item_id,
            &self.expected_source_id,
            &self.target_source_id,
        ] {
            if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
                return Err(anyhow!("identidade de item/fonte inválida"));
            }
        }
        if self.expected_decoder_id == 0 || self.expected_source_id == self.target_source_id {
            return Err(anyhow!("troca exige geração atual e uma fonte alternativa"));
        }
        if self.target_source.is_empty()
            || self.target_source.len() > 8192
            || self.target_source.chars().any(char::is_control)
            || !matches!(
                self.target_source_type.as_str(),
                "SRT" | "RTMP" | "RTSP" | "NDI" | "OMT" | "SDI"
            )
        {
            return Err(anyhow!("seleção alternativa inválida"));
        }
        let prefixes: &[&str] = match self.target_source_type.as_str() {
            "SRT" => &["srt://"],
            "RTMP" => &["rtmp://", "rtmps://"],
            "RTSP" => &["rtsp://", "rtsps://"],
            "NDI" => &["ndi:"],
            "OMT" => &["omt:"],
            "SDI" => &["sdi:", "decklink:"],
            _ => &[],
        };
        if !prefixes
            .iter()
            .any(|prefix| self.target_source.starts_with(*prefix))
        {
            return Err(anyhow!("protocolo alternativo diverge do tipo de fonte"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Phase {
    Preparing,
    Ready,
    Committed,
    Cancelled,
    Expired,
    Invalidated,
    Failed,
    Uncertain,
}

impl Phase {
    pub fn terminal(self) -> bool {
        !matches!(self, Self::Preparing | Self::Ready)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub transaction_id: String,
    pub engine_generation: String,
    pub selection_revision: String,
    pub item_id: String,
    pub expected_decoder_id: u64,
    pub expected_source_id: String,
    pub target_source_id: String,
    pub prepared_decoder_id: Option<u64>,
    pub phase: Phase,
    // Occurrence cursor at selector confirmation, not an as-run duration.
    pub program_frames: Option<i64>,
}

struct Record {
    request: Request,
    receipt: Receipt,
    started: Instant,
}

#[derive(Default)]
pub struct Journal {
    records: BTreeMap<String, Record>,
    pending: Option<String>,
}

impl Journal {
    /// Duplicate preparation is a receipt lookup, never another decoder open.
    /// No eviction: accepting an evicted key could repeat an old physical cut.
    pub fn begin(&mut self, request: Request, now: Instant) -> Result<(Receipt, bool)> {
        request.validate()?;
        if let Some(record) = self.records.get(&request.transaction_id) {
            if record.request != request {
                return Err(anyhow!("chave da troca reutilizada com outro contexto"));
            }
            return Ok((record.receipt.clone(), true));
        }
        if self.pending.is_some() {
            return Err(anyhow!("já existe uma troca em preparação"));
        }
        if self.records.len() >= MAX_TRANSACTIONS {
            return Err(anyhow!(
                "limite de transações da geração atingido; reconciliar antes de renovar engine"
            ));
        }
        let receipt = Receipt {
            transaction_id: request.transaction_id.clone(),
            engine_generation: request.engine_generation.clone(),
            selection_revision: request.selection_revision.clone(),
            item_id: request.item_id.clone(),
            expected_decoder_id: request.expected_decoder_id,
            expected_source_id: request.expected_source_id.clone(),
            target_source_id: request.target_source_id.clone(),
            prepared_decoder_id: None,
            phase: Phase::Preparing,
            program_frames: None,
        };
        self.pending = Some(request.transaction_id.clone());
        self.records.insert(
            request.transaction_id.clone(),
            Record {
                request,
                receipt: receipt.clone(),
                started: now,
            },
        );
        Ok((receipt, false))
    }

    pub fn pending_request(&self) -> Option<&Request> {
        self.pending
            .as_ref()
            .and_then(|key| self.records.get(key))
            .map(|record| &record.request)
    }

    pub fn receipt(&self, key: &str) -> Result<Receipt> {
        self.records
            .get(key)
            .map(|record| record.receipt.clone())
            .ok_or_else(|| anyhow!("transação desconhecida nesta geração do engine"))
    }

    pub fn expired(&self, now: Instant) -> bool {
        self.pending
            .as_ref()
            .and_then(|key| self.records.get(key))
            .is_some_and(|record| {
                now.saturating_duration_since(record.started) >= PREPARATION_DEADLINE
            })
    }

    pub fn prepared(&mut self, decoder_id: u64) -> Result<()> {
        let key = self
            .pending
            .as_ref()
            .ok_or_else(|| anyhow!("nenhuma troca pendente"))?;
        let record = self
            .records
            .get_mut(key)
            .ok_or_else(|| anyhow!("troca pendente ausente"))?;
        if decoder_id == 0 || record.receipt.prepared_decoder_id.is_some() {
            return Err(anyhow!("geração preparada inválida ou já atribuída"));
        }
        record.receipt.prepared_decoder_id = Some(decoder_id);
        Ok(())
    }

    /// Readiness is deliberately reversible. A frame received before a source
    /// disappears must not permanently authorize a later commit.
    pub fn observe_ready(&mut self, ready: bool) -> Option<Receipt> {
        let key = self.pending.as_ref()?;
        let record = self.records.get_mut(key)?;
        let phase = if ready {
            Phase::Ready
        } else {
            Phase::Preparing
        };
        if record.receipt.phase == phase {
            return None;
        }
        record.receipt.phase = phase;
        Some(record.receipt.clone())
    }

    pub fn finish(&mut self, phase: Phase, frames: Option<i64>) -> Result<Receipt> {
        if !phase.terminal() {
            return Err(anyhow!("resultado de troca não terminal"));
        }
        let key = self
            .pending
            .as_ref()
            .ok_or_else(|| anyhow!("nenhuma troca pendente"))?;
        let record = self
            .records
            .get_mut(key)
            .ok_or_else(|| anyhow!("troca pendente ausente"))?;
        if phase == Phase::Committed
            && (record.receipt.phase != Phase::Ready
                || record.receipt.prepared_decoder_id.is_none()
                || frames.map_or(true, |frame| frame < 0))
        {
            return Err(anyhow!("troca sem quadro/geração/cursor confirmados"));
        }
        record.receipt.phase = phase;
        record.receipt.program_frames = if phase == Phase::Committed {
            frames
        } else {
            None
        };
        let receipt = record.receipt.clone();
        self.pending = None;
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(key: &str) -> Request {
        Request {
            transaction_id: key.into(),
            engine_generation: "generation-a".into(),
            selection_revision: "pair-revision-17".into(),
            item_id: "live-1".into(),
            expected_decoder_id: 7,
            expected_source_id: "primary".into(),
            target_source_id: "backup".into(),
            target_source: "srt://secret:password@example.invalid:9000".into(),
            target_source_type: "SRT".into(),
        }
    }

    #[test]
    fn replay_does_not_reset_deadline_or_open_again() {
        let now = Instant::now();
        let mut journal = Journal::default();
        assert!(!journal.begin(request("a"), now).unwrap().1);
        journal.prepared(8).unwrap();
        assert!(
            journal
                .begin(request("a"), now + Duration::from_secs(9))
                .unwrap()
                .1
        );
        assert!(journal.expired(now + PREPARATION_DEADLINE));
        assert_eq!(journal.receipt("a").unwrap().prepared_decoder_id, Some(8));
    }

    #[test]
    fn context_reuse_busy_and_double_preparation_are_rejected() {
        let now = Instant::now();
        let mut journal = Journal::default();
        journal.begin(request("a"), now).unwrap();
        assert!(journal.begin(request("b"), now).is_err());
        let mut changed = request("a");
        changed.target_source.push_str("/changed");
        assert!(journal.begin(changed, now).is_err());
        assert!(journal.prepared(0).is_err());
        journal.prepared(8).unwrap();
        assert!(journal.prepared(9).is_err());
    }

    #[test]
    fn readiness_can_be_lost_and_commit_requires_native_cursor() {
        let mut journal = Journal::default();
        journal.begin(request("a"), Instant::now()).unwrap();
        journal.prepared(8).unwrap();
        journal.observe_ready(true).unwrap();
        assert_eq!(
            journal.observe_ready(false).unwrap().phase,
            Phase::Preparing
        );
        assert!(journal.finish(Phase::Committed, Some(24)).is_err());
        journal.observe_ready(true).unwrap();
        assert!(journal.finish(Phase::Committed, None).is_err());
        assert!(journal.finish(Phase::Committed, Some(-1)).is_err());
        assert_eq!(
            journal
                .finish(Phase::Committed, Some(24))
                .unwrap()
                .program_frames,
            Some(24)
        );
        assert!(journal.finish(Phase::Committed, Some(25)).is_err());
        assert_eq!(
            journal.begin(request("a"), Instant::now()).unwrap().0.phase,
            Phase::Committed
        );
    }

    #[test]
    fn cancellation_expiry_and_failure_are_permanent_tombstones() {
        for phase in [
            Phase::Cancelled,
            Phase::Expired,
            Phase::Invalidated,
            Phase::Failed,
        ] {
            let now = Instant::now();
            let mut journal = Journal::default();
            journal.begin(request("a"), now).unwrap();
            journal.finish(phase, Some(123)).unwrap();
            let receipt = journal.begin(request("a"), now).unwrap();
            assert!(receipt.1);
            assert_eq!(receipt.0.phase, phase);
            assert_eq!(receipt.0.program_frames, None);
            assert!(journal.pending_request().is_none());
        }
    }

    #[test]
    fn receipts_do_not_serialize_credentials_and_unknown_generation_is_not_success() {
        let mut journal = Journal::default();
        let receipt = journal.begin(request("a"), Instant::now()).unwrap().0;
        let json = serde_json::to_string(&receipt).unwrap();
        assert!(!json.contains("secret"));
        assert!(!json.contains("password"));
        assert!(!json.contains("srt://"));
        assert!(journal.receipt("previous-generation").is_err());
    }

    #[test]
    fn journal_refuses_capacity_instead_of_eviction_and_reexecution() {
        let now = Instant::now();
        let mut journal = Journal::default();
        for index in 0..MAX_TRANSACTIONS {
            journal.begin(request(&format!("tx-{index}")), now).unwrap();
            journal.finish(Phase::Cancelled, None).unwrap();
        }
        assert!(journal.begin(request("overflow"), now).is_err());
        assert!(journal.begin(request("tx-0"), now).unwrap().1);
    }

    #[test]
    fn validation_is_bounded_and_never_returns_the_private_uri_in_errors() {
        let mut value = request("a");
        value.target_source.push('\n');
        assert!(!value.validate().unwrap_err().to_string().contains("secret"));
        value = request("a");
        value.expected_decoder_id = 0;
        assert!(value.validate().is_err());
        value = request("a");
        value.target_source_id = value.expected_source_id.clone();
        assert!(value.validate().is_err());
        value = request("a");
        value.selection_revision = "x".repeat(129);
        assert!(value.validate().is_err());
        value = request("a");
        value.target_source = "file:///private.mkv".into();
        assert!(value.validate().is_err());
        let debug = format!("{:?}", request("a"));
        assert!(!debug.contains("password"));
        assert!(!debug.contains("srt://"));
    }

    #[test]
    fn a_new_engine_has_no_receipt_and_cannot_replay_old_commit() {
        let now = Instant::now();
        let mut first = Journal::default();
        first.begin(request("a"), now).unwrap();
        first.prepared(8).unwrap();
        first.observe_ready(true);
        first.finish(Phase::Committed, Some(100)).unwrap();
        let second = Journal::default();
        assert!(second.receipt("a").is_err());
        let mut wrong_generation = request("a");
        wrong_generation.engine_generation = "generation-b".into();
        assert!(first.begin(wrong_generation, now).is_err());
    }

    #[test]
    fn uncertain_selection_is_terminal_but_never_confirms_a_cursor() {
        let now = Instant::now();
        let mut journal = Journal::default();
        journal.begin(request("a"), now).unwrap();
        journal.prepared(8).unwrap();
        journal.observe_ready(true);
        let result = journal.finish(Phase::Uncertain, Some(100)).unwrap();
        assert_eq!(result.phase, Phase::Uncertain);
        assert_eq!(result.program_frames, None);
        assert_eq!(
            journal.begin(request("a"), now).unwrap().0.phase,
            Phase::Uncertain
        );
    }
}
