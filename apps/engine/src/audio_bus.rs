//! Numbered embedded pairs are not speaker positions or a surround downmix.
//! Master remains pair 1; auxiliaries originate from the selected input track,
//! before the master's mix/gain. Unassigned pairs are explicit silence.
use anyhow::{anyhow, Result};
use gstreamer as gst;
use gst::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuxiliaryPair {
    /// One-based stereo pair. Pair 1 is reserved for the existing master.
    pub output_pair: usize,
    pub input_pair: usize,
    #[serde(default)]
    pub gain_db: f64,
}

pub fn validate_channels(channels: usize) -> Result<()> {
    if ![2, 8, 16].contains(&channels) {
        return Err(anyhow!("barramento de áudio exige 2, 8 ou 16 canais"));
    }
    Ok(())
}

pub fn validate_pairs(pairs: &[AuxiliaryPair], channels: usize) -> Result<()> {
    validate_channels(channels)?;
    let mut assigned = std::collections::HashSet::new();
    for pair in pairs {
        if pair.output_pair < 2 || pair.output_pair > channels / 2 ||
            pair.input_pair < 1 || pair.input_pair > 32 ||
            !pair.gain_db.is_finite() || !(-60.0..=12.0).contains(&pair.gain_db) ||
            !assigned.insert(pair.output_pair) {
            return Err(anyhow!("par auxiliar inválido/repetido: destino 2..{}, entrada 1..32, ganho -60..12 dB; par 1 reservado ao PGM", channels / 2));
        }
    }
    Ok(())
}

/// Request enough real DeckLink input channels. Output channel count cannot
/// establish which input pair exists; capture still needs actual caps/buffers.
pub fn sdi_capture_channels(master:&crate::audio_routing::AudioRouting,pairs:&[AuxiliaryPair])->Result<usize> {
    let required=master.required_channels()?.max(pairs.iter().map(|pair|pair.input_pair.saturating_mul(2)).max().unwrap_or(0));
    if required>16 {return Err(anyhow!("roteamento SDI exige {required} canais; plugin de captura suporta até 16"));}
    Ok(if required<=2 {2} else if required<=8 {8} else {16})
}

pub fn caps(channels: usize) -> gst::Caps {
    let builder = gst::Caps::builder("audio/x-raw")
        .field("format", "F32LE").field("layout", "interleaved")
        .field("rate", 48_000i32).field("channels", channels as i32);
    if channels > 2 { builder.field("channel-mask", gst::Bitmask::new(0)).build() }
    else { builder.build() }
}

pub fn matrix(convert: &gst::Element, coefficients: Vec<Vec<f32>>) {
    convert.set_property("mix-matrix", gst::Array::new(coefficients.into_iter().map(gst::Array::new)));
}

/// Expand the legacy stereo master, with no invented SAP/clean/AD signal.
pub fn expand_master(convert: &gst::Element, channels: usize) {
    let mut coefficients = vec![vec![0.0; 2]; channels];
    coefficients[0][0] = 1.0; coefficients[1][1] = 1.0;
    matrix(convert, coefficients);
}

/// Positional identity/extraction, never speaker-based downmixing. Empty
/// explicit matrix lets GStreamer resize on caps renegotiation; a fixed matrix
/// would pin inter sources to the initial two-channel silence format.
pub fn numbered_channels(convert: &gst::Element, output_channels: usize) -> Result<()> {
    validate_channels(output_channels)?;
    matrix(convert, Vec::new());
    Ok(())
}

#[derive(Clone)]
pub struct AuxiliaryRouting {
    pub pairs: Vec<AuxiliaryPair>,
    pub channels: usize,
}
impl AuxiliaryRouting {
    /// audioconvert coefficients are limited to -1..1. A common gain after
    /// conversion permits independently specified positive or negative gains.
    pub fn gain(&self) -> f64 {
        self.pairs.iter().map(|pair| 10f64.powf(pair.gain_db / 20.0)).fold(1.0, f64::max)
    }
    pub fn coefficients(&self, input_channels: usize) -> Result<Vec<Vec<f32>>> {
        validate_pairs(&self.pairs, self.channels)?;
        if input_channels == 0 || input_channels > 64 { return Err(anyhow!("entrada auxiliar exige 1..64 canais")); }
        let mut coefficients = vec![vec![0.0; input_channels]; self.channels];
        for pair in &self.pairs {
            if pair.input_pair * 2 > input_channels {
                return Err(anyhow!("par auxiliar {} exige canais {}-{}; entrada declarou {input_channels}; PGM anterior preservado", pair.output_pair, pair.input_pair * 2 - 1, pair.input_pair * 2));
            }
            let level = (10f64.powf(pair.gain_db / 20.0) / self.gain()) as f32;
            coefficients[(pair.output_pair - 1) * 2][(pair.input_pair - 1) * 2] = level;
            coefficients[(pair.output_pair - 1) * 2 + 1][(pair.input_pair - 1) * 2 + 1] = level;
        }
        Ok(coefficients)
    }
    pub fn configure(&self, convert: &gst::Element, caps: &gst::CapsRef) -> Result<()> {
        let channels = caps.structure(0).and_then(|structure| structure.get::<i32>("channels").ok())
            .ok_or_else(||anyhow!("entrada ainda não declarou canais auxiliares"))?;
        matrix(convert, self.coefficients(channels as usize)?);
        Ok(())
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn explicit_contract_no_invented_feed() {
        for channels in [2, 8, 16] { validate_channels(channels).unwrap(); }
        for channels in [0, 1, 4, 6, 32, 64] { assert!(validate_channels(channels).is_err()); }
        let pair = AuxiliaryPair { output_pair: 8, input_pair: 2, gain_db: -6.0 };
        assert!(validate_pairs(&[pair.clone()], 8).is_err());
        assert!(validate_pairs(&[pair.clone(), pair.clone()], 16).is_err());
        assert!(validate_pairs(&[AuxiliaryPair { output_pair: 1, ..pair.clone() }], 16).is_err());
        for gain_db in [f64::NAN, f64::INFINITY, -61., 13.] {
            assert!(validate_pairs(&[AuxiliaryPair { gain_db, ..pair.clone() }], 16).is_err());
        }
        assert!(serde_json::from_str::<AuxiliaryPair>(r#"{"outputPair":2,"inputPair":2,"gainDb":0,"sap":true}"#).is_err());
        let master=crate::audio_routing::AudioRouting::default();
        assert_eq!(sdi_capture_channels(&master,&[]).unwrap(),2);
        assert_eq!(sdi_capture_channels(&crate::audio_routing::AudioRouting{mode:crate::audio_routing::RoutingMode::Stereo3_4,..Default::default()},&[]).unwrap(),8);
        assert_eq!(sdi_capture_channels(&master,&[AuxiliaryPair{output_pair:2,input_pair:8,gain_db:0.}]).unwrap(),16);
        assert!(sdi_capture_channels(&master,&[AuxiliaryPair{output_pair:2,input_pair:9,gain_db:0.}]).is_err());
    }
    #[test] fn all_auxiliaries_required_silent_unassigned_and_independent_gains() {
        let routing = AuxiliaryRouting { channels: 16, pairs: vec![
            AuxiliaryPair { output_pair: 2, input_pair: 2, gain_db: 12.0 },
            AuxiliaryPair { output_pair: 8, input_pair: 1, gain_db: -6.0 },
        ] };
        assert!(routing.coefficients(2).is_err());
        let coefficients = routing.coefficients(4).unwrap();
        for index in [0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] { assert_eq!(coefficients[index], vec![0.;4]); }
        assert_eq!(coefficients[2], vec![0.,0.,1.,0.]);
        assert_eq!(coefficients[3], vec![0.,0.,0.,1.]);
        assert!((coefficients[14][0] as f64 * routing.gain() - 10f64.powf(-6./20.)).abs()<0.00001);
    }
    #[test] fn real_samples_extract_only_master_and_limit_pairs_independently() {
        gst::init().unwrap();
        if gst::ElementFactory::find(crate::limiter_element::FACTORY).is_none() { crate::limiter_element::register().unwrap(); }
        for channels in [8, 16] {
            let pipeline = gst::Pipeline::new();
            let source = gst::ElementFactory::make("appsrc").build().unwrap().downcast::<gstreamer_app::AppSrc>().unwrap();
            source.set_caps(Some(&caps(channels)));
            let limiter = gst::ElementFactory::make(crate::limiter_element::FACTORY)
                .property("ceiling-dbtp", -1f64).property("pair-linked", true).build().unwrap();
            let sink = gst::ElementFactory::make("appsink").property("sync", false).build().unwrap().downcast::<gstreamer_app::AppSink>().unwrap();
            pipeline.add_many([source.upcast_ref(), &limiter, sink.upcast_ref()]).unwrap();
            gst::Element::link_many([source.upcast_ref(), &limiter, sink.upcast_ref()]).unwrap();
            pipeline.set_state(gst::State::Playing).unwrap();
            let input:Vec<u8> = (0..9600).flat_map(|_|(0..channels).flat_map(|index| {
                let sample:f32 = match index { 0=>0.1, 1=>0.2, 2=>2.0, 3=>-2.0, _=>0.0 };
                sample.to_le_bytes()
            })).collect();
            source.push_buffer(gst::Buffer::from_mut_slice(input)).unwrap(); source.end_of_stream().unwrap();
            let sample=sink.try_pull_sample(gst::ClockTime::from_seconds(5)).expect("limiter multicanal sem amostras");
            pipeline.set_state(gst::State::Null).unwrap();
            let map=sample.buffer().unwrap().map_readable().unwrap();
            let frame=map.as_slice().chunks_exact(channels*4).last().unwrap();
            let values:Vec<f32>=frame.chunks_exact(4).map(|v|f32::from_le_bytes(v.try_into().unwrap())).collect();
            assert!((values[0]-0.1).abs()<0.00001 && (values[1]-0.2).abs()<0.00001,"auxiliar não pode reduzir o master: {values:?}");
            assert!(values[2]>0.5 && values[2]<0.9 && (values[2]+values[3]).abs()<0.00001,"par auxiliar protegido e L/R vinculados: {values:?}");
            assert!(values[4..].iter().all(|v|*v==0.0));

            for output_channels in [2, channels] {
            let extract=gst::Pipeline::new();
            let source=gst::ElementFactory::make("appsrc").build().unwrap().downcast::<gstreamer_app::AppSrc>().unwrap();source.set_caps(Some(&caps(channels)));
            let convert=gst::ElementFactory::make("audioconvert").build().unwrap();numbered_channels(&convert,output_channels).unwrap();
            let filter=gst::ElementFactory::make("capsfilter").property("caps",caps(output_channels)).build().unwrap();
            let sink=gst::ElementFactory::make("appsink").property("sync",false).build().unwrap().downcast::<gstreamer_app::AppSink>().unwrap();
            extract.add_many([source.upcast_ref(),&convert,&filter,sink.upcast_ref()]).unwrap();
            gst::Element::link_many([source.upcast_ref(),&convert,&filter,sink.upcast_ref()]).unwrap();extract.set_state(gst::State::Playing).unwrap();
            source.push_buffer(gst::Buffer::from_mut_slice(map.as_slice().to_vec())).unwrap();source.end_of_stream().unwrap();
            let sample=sink.try_pull_sample(gst::ClockTime::from_seconds(5)).expect("master sem extração estéreo");extract.set_state(gst::State::Null).unwrap();
            assert_eq!(sample.caps().unwrap().structure(0).unwrap().get::<i32>("channels").unwrap(),output_channels as i32);
            let map=sample.buffer().unwrap().map_readable().unwrap();
            let last=map.as_slice().chunks_exact(output_channels*4).last().unwrap();
            assert!((f32::from_le_bytes(last[..4].try_into().unwrap())-0.1).abs()<0.00001);
            assert!((f32::from_le_bytes(last[4..8].try_into().unwrap())-0.2).abs()<0.00001);
            }
        }
    }
}
