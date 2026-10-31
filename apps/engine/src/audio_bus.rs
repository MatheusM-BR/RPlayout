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

/// Actual item branch construction, shared by engine and offline bus renderer.
/// No limiter here: the operational output applies its persistent bus limiter
/// after item switching. Offline analysis must declare reset/transition state.
pub struct ItemAudioBranches {
    pub main:Vec<gst::Element>,
    pub volume:gst::Element,
    pub raw_tee:Option<gst::Element>,
    pub auxiliary:Vec<gst::Element>,
    pub auxiliary_routing:Option<AuxiliaryRouting>,
}
pub fn item_audio_branches(channels:usize,master_gain:f64,pairs:&[AuxiliaryPair])->Result<ItemAudioBranches>{
    validate_pairs(pairs,channels)?;
    if !master_gain.is_finite()||master_gain<0.0{return Err(anyhow!("ganho linear do master inválido"));}
    let make=|factory:&str|->Result<gst::Element>{Ok(gst::ElementFactory::make(factory).build()?)};
    let convert=make("audioconvert")?;let resample=make("audioresample")?;resample.set_property("quality",8i32);
    let volume=make("volume")?;volume.set_property("volume",master_gain);
    // Formato fixo da casa, não só taxa e canais. Sem `format`/`layout` o
    // audioconvert repassava o PCM do arquivo (s24le/s16le de MOV ProRes) e o
    // `interaudiosink`, que aceita qualquer PCM, publicava S24LE na superfície;
    // o capsfilter F32LE do slot do canal recusava com not-negotiated, o PGM
    // ficava mudo e a fonte do slot morria até reiniciar o engine. Tudo que
    // for decodificável vira F32LE intercalado 48 kHz AQUI, dentro do pipeline
    // do item: se alguma conversão falhar, o erro fica no item.
    let filter=make("capsfilter")?;
    filter.set_property("caps",caps(2));
    let mut main=vec![convert,resample,volume.clone(),filter];let mut raw_tee=None;let mut auxiliary=Vec::new();let mut auxiliary_routing=None;
    if channels>2{
        let expand=make("audioconvert")?;expand_master(&expand,channels);
        let master_caps=make("capsfilter")?;master_caps.set_property("caps",caps(channels));main.extend([expand,master_caps]);
        if !pairs.is_empty(){
            let queue=make("queue")?;let mix=make("audiomixer")?;let mixed_caps=make("capsfilter")?;mixed_caps.set_property("caps",caps(channels));main.extend([queue,mix,mixed_caps]);
            let route=AuxiliaryRouting{pairs:pairs.to_vec(),channels};
            let aux_queue=make("queue")?;let aux_convert=make("audioconvert")?;matrix(&aux_convert,Vec::new());
            let aux_resample=make("audioresample")?;aux_resample.set_property("quality",8i32);
            let aux_volume=make("volume")?;aux_volume.set_property("volume",route.gain());
            let aux_caps=make("capsfilter")?;aux_caps.set_property("caps",caps(channels));let aux_output_queue=make("queue")?;
            auxiliary=vec![aux_queue,aux_convert,aux_resample,aux_volume,aux_caps,aux_output_queue];auxiliary_routing=Some(route);raw_tee=Some(make("tee")?);
        }
    }
    Ok(ItemAudioBranches{main,volume,raw_tee,auxiliary,auxiliary_routing})
}
/// Link real branches; caller adds elements, configures routing against actual
/// caps and attaches/synchronizes the source. No invented input channels.
pub fn link_item_audio_branches(main:&[gst::Element],raw_tee:Option<&gst::Element>,auxiliary:&[gst::Element])->Result<()>{
    if main.is_empty(){return Err(anyhow!("ramo principal vazio"));}
    gst::Element::link_many(main.iter())?;
    if let Some(raw)=raw_tee{
        raw.link(&main[0])?;
        if auxiliary.is_empty(){return Err(anyhow!("ramo auxiliar vazio"));}
        gst::Element::link_many(auxiliary.iter())?;raw.link(&auxiliary[0])?;
        let mix=main.iter().find(|element|element.factory().is_some_and(|factory|factory.name()=="audiomixer")).ok_or_else(||anyhow!("mix de pares ausente"))?;
        auxiliary.last().unwrap().link(mix)?;
    }else if !auxiliary.is_empty(){return Err(anyhow!("ramo auxiliar sem tee de entrada"));}
    Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    // NOT_RUN integration fixtures: construct/inspect only, no physical output.
    #[test] fn shared_item_branch_contract_preserves_engine_topology(){
        gst::init().unwrap();
        for channels in [2,8,16]{
            let pairs=if channels>2{vec![AuxiliaryPair{output_pair:channels/2,input_pair:2,gain_db:-6.0}]}else{vec![]};
            let branches=item_audio_branches(channels,0.5,&pairs).unwrap();
            let factories:Vec<String>=branches.main.iter().map(|element|element.factory().unwrap().name().to_string()).collect();
            assert_eq!(&factories[..4],&["audioconvert","audioresample","volume","capsfilter"]);
            assert_eq!(branches.main[1].property::<i32>("quality"),8);
            assert_eq!(branches.volume.property::<f64>("volume"),0.5);
            assert_eq!(branches.raw_tee.is_some(),channels>2);
            if channels>2{
                assert_eq!(factories.iter().filter(|factory|factory.as_str()=="audiomixer").count(),1);
                assert_eq!(branches.auxiliary.len(),6);
                assert_eq!(branches.auxiliary[2].property::<i32>("quality"),8);
                let route=branches.auxiliary_routing.as_ref().unwrap();
                assert_eq!(route.channels,channels);assert!(route.coefficients(2).is_err());assert!(route.coefficients(4).is_ok());
                assert_eq!(branches.auxiliary[3].property::<f64>("volume"),route.gain());
            }else{assert_eq!(factories.len(),4);assert!(branches.auxiliary.is_empty());assert!(branches.auxiliary_routing.is_none());}
        }
    }
    /// Comercial chega em PCM inteiro (MOV ProRes + s24le/s16le), não em F32.
    /// O ramo do item precisa entregar ao `interaudiosink` exatamente o formato
    /// da casa: o `interaudiosrc` do canal repassa o formato que encontrar na
    /// superfície, e o capsfilter F32LE do slot recusava S24LE com
    /// not-negotiated -- PGM mudo e a fonte do slot morta até reiniciar.
    #[test] fn item_branch_delivers_house_format_for_any_decoded_pcm(){
        gst::init().unwrap();
        let entradas:[(&str,i32,i32,Option<u64>);7]=[("S24LE",48000,2,None),("S16LE",48000,2,None),("S32LE",48000,2,None),("F64LE",48000,2,None),("S16LE",44100,1,None),("S24LE",44100,2,None),("S24LE",48000,6,Some(0x3f))];
        // Barramento de 2 canais, o do PGM do QA. A expansão 8/16 tem teste
        // próprio de ponta a ponta no canal.
        let channels=2usize;
        for (format,rate,input_channels,mask) in entradas {
            let pipeline=gst::Pipeline::new();
            let source=gst::ElementFactory::make("audiotestsrc").property("num-buffers",20i32).build().unwrap();
            let mut input=gst::Caps::builder("audio/x-raw").field("format",format).field("layout","interleaved").field("rate",rate).field("channels",input_channels);
            if let Some(mask)=mask {input=input.field("channel-mask",gst::Bitmask::new(mask));}
            let input_caps=gst::ElementFactory::make("capsfilter").property("caps",input.build()).build().unwrap();
            let branches=item_audio_branches(channels,1.0,&[]).unwrap();
            // O mesmo contrato do sink real: aceita qualquer PCM. É o
            // ramo que precisa fixar o formato, não o consumidor.
            let sink=gst::ElementFactory::make("appsink").property("sync",false).build().unwrap().downcast::<gstreamer_app::AppSink>().unwrap();
            pipeline.add_many([&source,&input_caps]).unwrap();pipeline.add_many(branches.main.iter()).unwrap();pipeline.add(&sink).unwrap();
            gst::Element::link_many([&source,&input_caps,&branches.main[0]]).unwrap();
            link_item_audio_branches(&branches.main,None,&[]).unwrap();
            branches.main.last().unwrap().link(&sink).unwrap();
            pipeline.set_state(gst::State::Playing).unwrap();
            let sample=sink.try_pull_sample(gst::ClockTime::from_seconds(5));
            pipeline.set_state(gst::State::Null).unwrap();
            let sample=sample.unwrap_or_else(||panic!("{format}/{rate}/{input_channels}ch não chegou ao inter do barramento {channels}"));
            let caps=sample.caps().unwrap();
            assert!(caps.can_intersect(&super::caps(channels)) && caps.is_fixed(),"{format}/{rate}/{input_channels}ch saiu como {caps} no barramento {channels}");
            let structure=caps.structure(0).unwrap();
            assert_eq!(structure.get::<String>("format").unwrap(),"F32LE","{format}: {caps}");
            assert_eq!(structure.get::<String>("layout").unwrap(),"interleaved","{format}: {caps}");
            assert_eq!(structure.get::<i32>("rate").unwrap(),48000,"{format}: {caps}");
            assert_eq!(structure.get::<i32>("channels").unwrap(),channels as i32,"{format}: {caps}");
        }
    }
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
