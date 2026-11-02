//! Offline rendered bus using the actual item branches and shared bus limiter.
//! RESET, trim after mix, flush delay: not transition/AV/PGM qualification.
use anyhow::{anyhow,Result};
use gstreamer as gst;
use gst::prelude::*;
use gstreamer_app as gst_app;
use std::sync::{Arc,Mutex,atomic::{AtomicBool,AtomicUsize,Ordering}};
use std::time::{Duration,Instant};
#[allow(dead_code)]#[path="../audio_routing.rs"]mod audio_routing;
#[allow(dead_code)]#[path="../audio_bus.rs"]mod audio_bus;
#[allow(dead_code)]#[path="../loudness.rs"]mod loudness;
#[allow(dead_code)]#[path="../limiter.rs"]mod limiter;
#[allow(dead_code)]#[path="../continuous_bus.rs"]mod continuous_bus;
#[allow(dead_code)]#[path="../continuous_bus_meter.rs"]mod continuous_bus_meter;
#[allow(dead_code)]#[path="../audio_measurement.rs"]mod audio_measurement;
// audio_bus's existing test module references the real registered element.
#[allow(dead_code)]#[path="../limiter_element.rs"]mod limiter_element;
use audio_measurement::{MeasureTrim,SampleClock,RawPcmCoverage};
#[derive(Clone,serde::Deserialize,serde::Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Config{audio_track:usize,input_channels:usize,audio_channels:usize,routing:audio_routing::AudioRouting,auxiliary_pairs:Vec<audio_bus::AuxiliaryPair>,gain_db:f64,ceiling_dbtp:f64,trim:MeasureTrim}
impl Config{
    fn validate(&self)->Result<()>{
        self.trim.validate()?;self.routing.validate()?;audio_bus::validate_pairs(&self.auxiliary_pairs,self.audio_channels)?;
        if self.audio_track>63||self.input_channels==0||self.input_channels>64||!self.gain_db.is_finite()||!(-60.0..=12.0).contains(&self.gain_db)||!self.ceiling_dbtp.is_finite()||!(-30.0..=0.0).contains(&self.ceiling_dbtp){return Err(anyhow!("configuração de bus inválida"));}
        self.routing.coefficients(self.input_channels)?;
        audio_bus::AuxiliaryRouting{pairs:self.auxiliary_pairs.clone(),channels:self.audio_channels}.coefficients(self.input_channels)?;Ok(())
    }
}
struct BusWindow{channels:usize,limiter:limiter::BusLimiter,meters:Vec<loudness::Meter>,skip:usize,input:u64,output:u64,reduction:f64,finished:bool}
impl BusWindow{
    fn new(channels:usize,ceiling:f64)->Result<Self>{
        let limiter=limiter::BusLimiter::new(48000,channels,ceiling,channels>2).map_err(|error|anyhow!("{error}"))?;let skip=limiter.delay_frames();
        Ok(Self{channels,limiter,meters:(0..channels/2).map(|_|loudness::Meter::new(48000,2)).collect(),skip,input:0,output:0,reduction:0.0,finished:false})
    }
    fn measure(&mut self,values:&[f32]){
        for(pair,meter)in self.meters.iter_mut().enumerate(){let stereo:Vec<f32>=values.chunks_exact(self.channels).flat_map(|frame|frame[pair*2..pair*2+2].iter().copied()).collect();meter.push(&stereo);}
        self.output+=(values.len()/self.channels)as u64;
    }
    fn push(&mut self,values:&mut[f32])->Result<()>{
        if self.finished||values.len()%self.channels!=0||values.iter().any(|value|!value.is_finite()){return Err(anyhow!("PCM inválido ou bus encerrado"));}
        self.limiter.process(values).map_err(|error|anyhow!("{error}"))?;
        if values.iter().any(|value|!value.is_finite()){return Err(anyhow!("bus não finito"));}
        self.reduction=self.reduction.max(self.limiter.take_reduction_db());let frames=values.len()/self.channels;let skip=self.skip.min(frames);self.skip-=skip;self.input+=frames as u64;self.measure(&values[skip*self.channels..]);Ok(())
    }
    fn finish(&mut self,trim:MeasureTrim)->Result<serde_json::Value>{
        if self.finished||self.skip!=0||self.input.abs_diff(trim.expected_frames())>1{return Err(anyhow!("bus não cobre exatamente o corte ou já foi finalizado"));}self.finished=true;
        let delay=self.limiter.delay_frames();let mut tail=vec![0.0;delay*self.channels];self.limiter.process(&mut tail).map_err(|error|anyhow!("{error}"))?;
        if tail.iter().any(|value|!value.is_finite()){return Err(anyhow!("cauda do bus não finita"));}self.reduction=self.reduction.max(self.limiter.take_reduction_db());self.measure(&tail);
        if self.output!=self.input{return Err(anyhow!("cobertura de saída do bus divergente"));}
        let pairs:Vec<serde_json::Value>=self.meters.iter_mut().enumerate().map(|(pair,meter)|{let value=meter.read();serde_json::json!({"outputPair":pair+1,"integratedLufs":value.integrated_lufs,"lra":value.range_lu,"truePeakDbtp":value.true_peak_dbtp,"sampleFrames":self.output})}).collect();
        Ok(serde_json::json!({"pairs":pairs,"sampleFrames":self.input,"startupFramesRemoved":delay,"flushedFrames":delay,"limiterReductionDb":self.reduction}))
    }
}
#[derive(Default)]struct RawState{info:Option<gstreamer_audio::AudioInfo>,coverage:RawPcmCoverage}
#[derive(Clone)]enum CutConsumer{Isolated(Arc<Mutex<BusWindow>>),Continuous(Arc<Mutex<continuous_bus_meter::ContinuousBusMeter>>)}
impl CutConsumer{fn push(&self,index:usize,values:&mut[f32],channels:usize)->Result<()>{
    match self{Self::Isolated(window)=>window.lock().unwrap().push(values),Self::Continuous(meter)=>{let mut meter=meter.lock().unwrap();for chunk in values.chunks_mut(48000*channels){meter.push(index,chunk)?;}Ok(())}}
}}
#[derive(serde::Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
struct SequenceItem{path:String,configuration:Config}
#[derive(serde::Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Sequence{items:Vec<SequenceItem>}
impl Sequence{fn validate(&self)->Result<(usize,f64,Vec<u64>)>{
    if self.items.is_empty()||self.items.len()>128{return Err(anyhow!("sequência exige 1..128 cortes"));}
    let channels=self.items[0].configuration.audio_channels;let ceiling=self.items[0].configuration.ceiling_dbtp;
    for item in &self.items{item.configuration.validate()?;if item.path.is_empty()||item.configuration.audio_channels!=channels||item.configuration.ceiling_dbtp!=ceiling{return Err(anyhow!("origem inválida ou bus/teto mudou na sequência"));}}
    Ok((channels,ceiling,self.items.iter().map(|item|item.configuration.trim.expected_frames()).collect()))
}}
fn render_cut(path:&str,config:Config,consumer:CutConsumer,index:usize,lost:Arc<AtomicBool>,deadline:Instant)->Result<()>{
    config.validate()?;
    let path=std::path::Path::new(path).canonicalize()?;if !path.is_file(){return Err(anyhow!("origem não é arquivo"));}
    let pipeline=gst::Pipeline::new();let uri=gst::glib::filename_to_uri(path,None)?;let source=gst::ElementFactory::make("uridecodebin").property("uri",uri.as_str()).build()?;pipeline.add(&source)?;
    let raw=Arc::new(Mutex::new(RawState::default()));
    let failure=Arc::new(Mutex::new(None::<String>));
    let stage=pipeline.clone();let observed=consumer;let original=raw.clone();let errors=failure.clone();let selected=config.clone();let tracks=AtomicUsize::new(0);
    source.connect_pad_added(move|_,pad|{
        let caps=pad.current_caps().unwrap_or_else(||pad.query_caps(None));let audio=caps.structure(0).is_some_and(|structure|structure.name().starts_with("audio/"));
        let chosen=audio&&tracks.fetch_add(1,Ordering::AcqRel)==selected.audio_track;
        let attach=(||->Result<()>{
            if !chosen{let sink=gst::ElementFactory::make("fakesink").property("sync",false).property("async",false).build()?;stage.add(&sink)?;pad.link(&sink.static_pad("sink").unwrap())?;sink.sync_state_with_parent()?;return Ok(());}
            let mut branches=audio_bus::item_audio_branches(selected.audio_channels,10f64.powf(selected.gain_db/20.0),&selected.auxiliary_pairs)?;
            let convert=branches.main[0].clone();let auxiliary=branches.auxiliary.get(1).cloned();let route=branches.auxiliary_routing.clone();let routing=selected.routing.clone();let expected_channels=selected.input_channels;
            let configure=move|caps:&gst::CapsRef|->Result<gstreamer_audio::AudioInfo>{
                let info=gstreamer_audio::AudioInfo::from_caps(caps)?;if info.channels()as usize!=expected_channels||info.rate()==0||info.rate()>384000||info.bpf()==0{return Err(anyhow!("caps reais da trilha diferem da entrada declarada"));}
                routing.configure(&convert,caps)?;if let(Some(route),Some(convert))=(&route,&auxiliary){route.configure(convert,caps)?;}Ok(info)
            };
            original.lock().unwrap().info=Some(configure(&caps)?);
            let read_raw=original.clone();let read_errors=errors.clone();let owner=stage.clone();
            pad.add_probe(gst::PadProbeType::EVENT_DOWNSTREAM|gst::PadProbeType::BUFFER,move|_,data|{
                let checked=(||->Result<()>{
                    if let Some(gst::PadProbeData::Event(event))=&data.data{if let gst::EventView::Caps(caps)=event.view(){let info=configure(caps.caps())?;let mut state=read_raw.lock().unwrap();if state.info.as_ref().is_some_and(|before|before.rate()!=info.rate()||before.channels()!=info.channels()||before.bpf()!=info.bpf()||before.format()!=info.format()){return Err(anyhow!("caps da origem mudaram"));}state.info=Some(info);}}
                    if let Some(buffer)=data.buffer(){let mut state=read_raw.lock().unwrap();let info=state.info.as_ref().ok_or_else(||anyhow!("PCM sem caps"))?;let rate=info.rate();let bpf=info.bpf()as usize;
                        if buffer.size()%bpf!=0{return Err(anyhow!("origem com frame parcial"));}let pts=buffer.pts().ok_or_else(||anyhow!("origem sem PTS"))?.nseconds();state.coverage.push(pts,buffer.size()/bpf,rate,buffer.flags().contains(gst::BufferFlags::DISCONT),buffer.flags().contains(gst::BufferFlags::GAP))?;
                    }Ok(())
                })();if let Err(error)=checked{*read_errors.lock().unwrap()=Some(error.to_string());owner.post_error_message(gst::error_msg!(gst::StreamError::Format,["origem não comprova cobertura PCM do bus"]));return gst::PadProbeReturn::Drop;}gst::PadProbeReturn::Ok
            });
            let filter=gst::ElementFactory::make("capsfilter").property("caps",audio_bus::caps(selected.audio_channels)).build()?;
            let sink=gst::ElementFactory::make("appsink").property("sync",false).property("max-buffers",16u32).build()?.downcast::<gst_app::AppSink>().map_err(|_|anyhow!("appsink indisponível"))?;
            let read_window=observed.clone();let read_errors=errors.clone();let trim=selected.trim;let channels=selected.audio_channels;let clock=Mutex::new(SampleClock::default());
            sink.set_callbacks(gst_app::AppSinkCallbacks::builder().new_sample(move|sink|{
                let sample=sink.pull_sample().map_err(|_|gst::FlowError::Eos)?;
                let checked=(||->Result<()>{let buffer=sample.buffer().ok_or_else(||anyhow!("bus sem buffer"))?;let caps=sample.caps().ok_or_else(||anyhow!("bus sem caps"))?;let info=gstreamer_audio::AudioInfo::from_caps(caps)?;
                    let format=caps.structure(0).and_then(|structure|structure.get::<String>("format").ok());
                    if info.channels()as usize!=channels||info.rate()!=48000||info.bpf()as usize!=channels*4||format.as_deref()!=Some("F32LE"){return Err(anyhow!("caps de saída do bus divergentes"));}
                    let map=buffer.map_readable()?;let bytes=map.as_slice();if bytes.len()%(channels*4)!=0{return Err(anyhow!("bus com frame parcial"));}
                    let frames=bytes.len()/(channels*4);let pts=buffer.pts().ok_or_else(||anyhow!("bus sem PTS"))?.nseconds();let time=clock.lock().unwrap().advance(pts,frames,buffer.flags().contains(gst::BufferFlags::DISCONT))?;let(start,end)=trim.slice(time,frames);
                    if start<end{let mut values:Vec<f32>=bytes[start*channels*4..end*channels*4].chunks_exact(4).map(|value|f32::from_le_bytes(value.try_into().unwrap())).collect();read_window.push(index,&mut values,channels)?;}Ok(())
                })();if let Err(error)=checked{*read_errors.lock().unwrap()=Some(error.to_string());return Err(gst::FlowError::Error);}Ok(gst::FlowSuccess::Ok)
            }).build());
            branches.main.extend([filter,sink.upcast_ref::<gst::Element>().clone()]);
            let all:Vec<&gst::Element>=branches.main.iter().chain(branches.raw_tee.iter()).chain(branches.auxiliary.iter()).collect();for element in &all{stage.add(*element)?;}
            audio_bus::link_item_audio_branches(&branches.main,branches.raw_tee.as_ref(),&branches.auxiliary)?;
            let head=branches.raw_tee.as_ref().unwrap_or(&branches.main[0]);pad.link(&head.static_pad("sink").ok_or_else(||anyhow!("ramo sem sink"))?)?;for element in all{element.sync_state_with_parent()?;}Ok(())
        })();if let Err(error)=attach{*errors.lock().unwrap()=Some(error.to_string());stage.post_error_message(gst::error_msg!(gst::StreamError::Failed,["não foi possível montar o bus escolhido"]));}
    });
    let result=(||->Result<()>{
        pipeline.set_state(gst::State::Playing)?;let bus=pipeline.bus().unwrap();
        loop{if lost.load(Ordering::Acquire){return Err(anyhow!("servidor encerrou"));}if Instant::now()>deadline{return Err(anyhow!("render excedeu quinze minutos"));}
            if let Some(message)=bus.timed_pop_filtered(gst::ClockTime::from_seconds(1),&[gst::MessageType::Eos,gst::MessageType::Error]){match message.view(){gst::MessageView::Eos(_)=>break,gst::MessageView::Error(error)=>return Err(anyhow!("{}",failure.lock().unwrap().clone().unwrap_or_else(||error.error().to_string()))),_=>{}}}}
        if lost.load(Ordering::Acquire){return Err(anyhow!("servidor encerrou"));}if let Some(error)=failure.lock().unwrap().as_ref(){return Err(anyhow!("{error}"));}
        raw.lock().unwrap().coverage.confirm(config.trim)?;Ok(())
    })();let _=pipeline.set_state(gst::State::Null);result
}
fn run()->Result<serde_json::Value>{
    let args:Vec<String>=std::env::args().skip(1).collect();let parent_pipe=args.len()==3&&args[2]=="--parent-pipe";
    if args.len()!=2&&!parent_pipe{return Err(anyhow!("informe arquivo/configuração ou --sequence/configuração"));}
    if args[1].len()>60000{return Err(anyhow!("configuração excede limite do helper"));}
    gst::init()?;let deadline=Instant::now()+Duration::from_secs(900);
    let lost=Arc::new(AtomicBool::new(false));if parent_pipe{let lost=lost.clone();std::thread::spawn(move||{use std::io::Read;let mut byte=[0];while matches!(std::io::stdin().read(&mut byte),Ok(n)if n>0){}lost.store(true,Ordering::Release);});}
    if args[0]=="--sequence"{
        let sequence:Sequence=serde_json::from_str(&args[1])?;
        let(channels,ceiling,counts)=sequence.validate()?;
        let meter=Arc::new(Mutex::new(continuous_bus_meter::ContinuousBusMeter::new(channels,ceiling,counts)?));
        for(index,item)in sequence.items.iter().enumerate(){render_cut(&item.path,item.configuration.clone(),CutConsumer::Continuous(meter.clone()),index,lost.clone(),deadline)?;}
        if lost.load(Ordering::Acquire){return Err(anyhow!("servidor encerrou"));}
        let mut value=meter.lock().unwrap().finish()?;
        value["ok"]=serde_json::json!(true);value["sourceCoverageConfirmed"]=serde_json::json!(true);
        value["kind"]=serde_json::json!("CONTINUOUS_RENDERED_CUT_SEQUENCE");
        value["trimStage"]=serde_json::json!("AFTER_ITEM_MIX");value["decodeFromStart"]=serde_json::json!(true);
        value["configurations"]=serde_json::json!(sequence.items.iter().map(|item|&item.configuration).collect::<Vec<_>>());
        // Sequential offline cuts prove DSP continuity, not the operational
        // selector's preroll, timing, gaps, crossfades or physical transition.
        value["operationalSelectorQualified"]=serde_json::json!(false);Ok(value)
    }else{
        let config:Config=serde_json::from_str(&args[1])?;config.validate()?;
        let window=Arc::new(Mutex::new(BusWindow::new(config.audio_channels,config.ceiling_dbtp)?));
        render_cut(&args[0],config.clone(),CutConsumer::Isolated(window.clone()),0,lost.clone(),deadline)?;
        if lost.load(Ordering::Acquire){return Err(anyhow!("servidor encerrou"));}
        let mut value=window.lock().unwrap().finish(config.trim)?;
        value["ok"]=serde_json::json!(true);value["rate"]=serde_json::json!(48000);value["channels"]=serde_json::json!(config.audio_channels);value["trim"]=serde_json::json!(config.trim);
        value["processing"]=serde_json::json!({"kind":"ISOLATED_RENDERED_BUS","inputChannels":config.input_channels,"audioTrack":config.audio_track,"gainDb":config.gain_db,"ceilingDbtp":config.ceiling_dbtp,"routing":config.routing,"auxiliaryPairs":config.auxiliary_pairs,"initialState":"RESET","sourceCoverageConfirmed":true,"trimStage":"AFTER_ITEM_MIX","decodeFromStart":true,"tailFlushed":true,"pairLinked":config.audio_channels>2,"busQualified":false,"transitionQualified":false,"avQualified":false,"publicationAuthorized":false});Ok(value)
    }
}
fn main(){let value=match run(){Ok(value)=>value,Err(error)=>serde_json::json!({"ok":false,"reason":error.to_string()})};println!("{value}");}

#[cfg(test)]mod tests{
    use super::*;
    // NOT_RUN: offline contracts only; not bus/transition/AV qualification.
    #[test]fn sequence_requires_explicit_stable_bus_and_ceiling(){
        let config=||Config{audio_track:0,input_channels:2,audio_channels:8,routing:audio_routing::AudioRouting::default(),auxiliary_pairs:vec![],gain_db:0.0,ceiling_dbtp:-1.0,trim:MeasureTrim{in_ns:0,out_ns:500_000_000}};
        let mut sequence=Sequence{items:vec![SequenceItem{path:"a.mxf".into(),configuration:config()},SequenceItem{path:"b.mxf".into(),configuration:config()}]};
        assert_eq!(sequence.validate().unwrap().2,vec![24000,24000]);
        sequence.items[1].configuration.ceiling_dbtp=-2.0;assert!(sequence.validate().is_err());
        sequence.items[1].configuration=config();sequence.items[1].configuration.audio_channels=16;assert!(sequence.validate().is_err());
        sequence.items.clear();assert!(sequence.validate().is_err());
    }
    #[test]fn full_bus_preserves_tail_and_exact_frames(){
        let trim=MeasureTrim{in_ns:0,out_ns:500_000_000};
        for channels in [2,8,16]{
            let mut bus=BusWindow::new(channels,-1.0).unwrap();
            let frames=trim.expected_frames()as usize;
            let mut pcm=vec![0.0;frames*channels];
            for frame in pcm[(frames-240)*channels..].chunks_exact_mut(channels){for sample in frame{*sample=0.25;}}
            for chunk in pcm.chunks_mut(137*channels){bus.push(chunk).unwrap();}
            let reading=bus.finish(trim).unwrap();
            assert_eq!(reading["sampleFrames"].as_u64(),Some(frames as u64));
            assert_eq!(reading["startupFramesRemoved"].as_u64(),Some(240));
            assert_eq!(reading["flushedFrames"].as_u64(),Some(240));
            let pairs=reading["pairs"].as_array().unwrap();assert_eq!(pairs.len(),channels/2);
            for pair in pairs{assert!(pair["truePeakDbtp"].as_f64().unwrap()>-20.0);}
            assert!(bus.finish(trim).is_err());assert!(bus.push(&mut[0.0,0.0]).is_err());
        }
    }
    #[test]fn incomplete_cut_or_partial_pcm_never_produces_receipt(){
        let trim=MeasureTrim{in_ns:0,out_ns:500_000_000};let mut bus=BusWindow::new(8,-1.0).unwrap();
        assert!(bus.push(&mut[0.0;7]).is_err());assert_eq!(bus.input,0);
        let mut partial=vec![0.0;12000*8];bus.push(&mut partial).unwrap();assert!(bus.finish(trim).is_err());
    }
}
