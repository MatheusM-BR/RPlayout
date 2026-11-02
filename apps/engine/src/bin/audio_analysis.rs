//! Selected-track stereo mix measurement, whole file or explicit time interval.
//! Shared routing/meter; optional isolated post-gain/limiter measurement.
//! Isolated reset-state stereo is not full bus/transition/PGM qualification.
use anyhow::{anyhow,Result};
use gstreamer as gst;
use gst::prelude::*;
use gstreamer_app as gst_app;
use std::sync::{Arc,Mutex,atomic::{AtomicBool,AtomicUsize,AtomicU64,Ordering}};
use std::time::{Duration,Instant};
#[allow(dead_code)] #[path="../audio_routing.rs"] mod audio_routing;
#[allow(dead_code)] #[path="../loudness.rs"] mod loudness;
#[allow(dead_code)] #[path="../limiter.rs"] mod limiter;
#[allow(dead_code)] #[path="../audio_measurement.rs"] mod audio_measurement;
use audio_measurement::{MeasureTrim,SampleClock};
#[derive(serde::Deserialize)] #[serde(rename_all="camelCase",deny_unknown_fields)]
struct Config {audio_track:usize,routing:audio_routing::AudioRouting,trim:Option<MeasureTrim>,post_gain:Option<PostGain>}
#[derive(Clone,Copy,serde::Deserialize,serde::Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct PostGain {gain_db:f64,ceiling_dbtp:f64,tail_policy:Option<TailPolicy>}
#[derive(Clone,Copy,PartialEq,serde::Deserialize,serde::Serialize)]
#[serde(rename_all="SCREAMING_SNAKE_CASE")]
enum TailPolicy {CompensateAndFlush}
impl PostGain {
    fn validate(self)->Result<()> {
        if !self.gain_db.is_finite() || !(-60.0..=12.0).contains(&self.gain_db) || !self.ceiling_dbtp.is_finite() || !(-30.0..=0.0).contains(&self.ceiling_dbtp) {return Err(anyhow!("ganho/teto inválidos"));}
        Ok(())
    }
}
struct PostWindow {meter:loudness::Meter,skip:usize,input_frames:u64,output_frames:u64}
struct PostProcessor {gain:f32,limiter:limiter::BusLimiter,window:Option<PostWindow>,finished:bool}
impl PostProcessor {
    fn new(config:PostGain)->Self {
        let limiter=limiter::BusLimiter::new(48000,2,config.ceiling_dbtp,false).expect("PostGain validado antes de criar DSP");
        let window=config.tail_policy.map(|_|PostWindow{meter:loudness::Meter::new(48000,2),skip:limiter.delay_frames(),input_frames:0,output_frames:0});
        Self{gain:10f64.powf(config.gain_db/20.0) as f32,limiter,window,finished:false}
    }
    fn process(&mut self,values:&mut[f32])->Result<f64> {
        if self.finished||values.len()%2!=0||values.iter().any(|value|!value.is_finite()){return Err(anyhow!("PCM não finito, incompleto ou medidor encerrado"));}
        for value in values.iter_mut(){*value*=self.gain;}
        self.limiter.process(values).map_err(|error|anyhow!("{error}"))?;
        if values.iter().any(|value|!value.is_finite()){return Err(anyhow!("saída não finita"));}
        if let Some(window)=self.window.as_mut(){
            let frames=values.len()/2;let skip=window.skip.min(frames);window.skip-=skip;
            window.input_frames+=frames as u64;window.output_frames+=(frames-skip) as u64;
            window.meter.push(&values[skip*2..]);
        }
        Ok(self.limiter.take_reduction_db())
    }
    /// Compensate only this isolated RESET measurement: discard startup delay
    /// and drain exactly that many frames with zeros after the selected cut.
    /// No pipeline timing or PGM audio/video delay is changed by this helper.
    fn finish(&mut self)->Result<Option<loudness::Reading>> {
        if self.finished{return Err(anyhow!("cauda já descarregada"));}self.finished=true;
        let Some(window)=self.window.as_mut() else{return Ok(None);};
        let delay=self.limiter.delay_frames();
        if window.skip!=0||window.input_frames<delay as u64{return Err(anyhow!("PCM insuficiente para cauda"));}
        let mut tail=vec![0.0f32;delay*2];self.limiter.process(&mut tail).map_err(|error|anyhow!("{error}"))?;
        if tail.iter().any(|value|!value.is_finite()){return Err(anyhow!("cauda não finita"));}
        window.meter.push(&tail);window.output_frames+=delay as u64;
        if window.output_frames!=window.input_frames{return Err(anyhow!("cauda não preservou cobertura PCM"));}
        Ok(Some(window.meter.read()))
    }
}
fn run()->Result<serde_json::Value>{
    let args:Vec<String>=std::env::args().skip(1).collect();
    let parent_pipe=args.len()==3&&args[2]=="--parent-pipe";
    if args.len()!=2&&!parent_pipe{return Err(anyhow!("informe arquivo e configuração de mix JSON"));}
    let config:Config=serde_json::from_str(&args[1]).map_err(|_|anyhow!("configuração de mix inválida"))?;
    if config.audio_track>63{return Err(anyhow!("trilha fora do limite 0..63"));}config.routing.validate()?;
    if let Some(trim)=config.trim {trim.validate()?;}
    if let Some(post)=config.post_gain {post.validate()?;if config.trim.is_none(){return Err(anyhow!("pós-ganho exige corte explícito"));}}
    let requested_trim=config.trim;
    let requested_post=config.post_gain;
    let path=std::path::Path::new(&args[0]).canonicalize().map_err(|_|anyhow!("arquivo indisponível"))?;
    if !path.is_file(){return Err(anyhow!("origem não é arquivo"));}
    gst::init()?;
    let uri=gst::glib::filename_to_uri(path,None)?;
    let pipeline=gst::Pipeline::new();let source=gst::ElementFactory::make("uridecodebin").property("uri",uri.as_str()).build()?;pipeline.add(&source)?;
    let parent_lost=Arc::new(AtomicBool::new(false));
    if parent_pipe {
        let owned=pipeline.clone();let lost=parent_lost.clone();std::thread::spawn(move||{
            use std::io::Read;
            let mut byte=[0u8;1];while matches!(std::io::stdin().read(&mut byte),Ok(n) if n>0){}
            lost.store(true,Ordering::Release);
            // The owning server's pipe closes on crash/shutdown. Do not keep
            // a heavyweight decoder orphaned after its durable owner died.
            owned.post_error_message(gst::error_msg!(gst::ResourceError::Read,["servidor encerrou durante a medição"]));
        });
    }
    let count=Arc::new(AtomicUsize::new(0));let samples=Arc::new(AtomicU64::new(0));let meter=Arc::new(Mutex::new(loudness::Meter::new(48000,2)));let error=Arc::new(Mutex::new(None::<String>));
    let reduction=Arc::new(Mutex::new(0.0f64));
    let post_state=Arc::new(Mutex::new(config.post_gain.map(PostProcessor::new)));
    let selected_post=post_state.clone();
    let stage=pipeline.clone();let sample_count=samples.clone();let observed=meter.clone();let failure=error.clone();let observed_reduction=reduction.clone();
    source.connect_pad_added(move|_,pad|{
        let caps=pad.current_caps().unwrap_or_else(||pad.query_caps(None));
        let audio=caps.structure(0).is_some_and(|s|s.name().starts_with("audio/"));
        let selected=audio && count.fetch_add(1,Ordering::AcqRel)==config.audio_track;
        let attached=(||->Result<()>{
            if !selected{
                let sink=gst::ElementFactory::make("fakesink").property("sync",false).property("async",false).build()?;stage.add(&sink)?;pad.link(&sink.static_pad("sink").unwrap())?;sink.sync_state_with_parent()?;return Ok(());
            }
            let convert=gst::ElementFactory::make("audioconvert").build()?;config.routing.configure(&convert,&caps)?;
            let caps_routing=config.routing.clone();let caps_convert=convert.clone();let caps_error=failure.clone();let caps_pipeline=stage.clone();
            pad.add_probe(gst::PadProbeType::EVENT_DOWNSTREAM,move|_,info|{
                if let Some(gst::PadProbeData::Event(event))=&info.data {if let gst::EventView::Caps(caps)=event.view(){if let Err(e)=caps_routing.configure(&caps_convert,caps.caps()){
                    *caps_error.lock().unwrap()=Some(e.to_string());caps_pipeline.post_error_message(gst::error_msg!(gst::StreamError::Format,["canais incompatíveis com mix escolhido"]));return gst::PadProbeReturn::Drop;
                }}}gst::PadProbeReturn::Ok
            });
            let resample=gst::ElementFactory::make("audioresample").property("quality",8i32).build()?;let filter=gst::ElementFactory::make("capsfilter").build()?;
            filter.set_property("caps",gst::Caps::builder("audio/x-raw").field("format","F32LE").field("layout","interleaved").field("channels",2i32).field("rate",48000i32).build());
            let sink=gst::ElementFactory::make("appsink").property("sync",false).property("max-buffers",16u32).build()?.downcast::<gst_app::AppSink>().map_err(|_|anyhow!("appsink indisponível"))?;
            let read_meter=observed.clone();let read_count=sample_count.clone();let read_failure=failure.clone();let read_trim=config.trim;let read_clock=Mutex::new(SampleClock::default());
            let read_post=selected_post.clone();let read_reduction=observed_reduction.clone();
            sink.set_callbacks(gst_app::AppSinkCallbacks::builder().new_sample(move|sink|{
                let sample=sink.pull_sample().map_err(|_|gst::FlowError::Eos)?;let buffer=sample.buffer().ok_or(gst::FlowError::Error)?;let map=buffer.map_readable().map_err(|_|gst::FlowError::Error)?;
                let bytes=map.as_slice();if bytes.len()%8!=0{return Err(gst::FlowError::Error);}
                let frames=bytes.len()/8;
                let (start,end)=if let Some(trim)=read_trim {
                    let Some(pts)=buffer.pts() else {*read_failure.lock().unwrap()=Some("áudio sem timestamp: trecho não pode ser comprovado".into());return Err(gst::FlowError::Error);};
                    let time=match read_clock.lock().unwrap().advance(pts.nseconds(),frames,buffer.flags().contains(gst::BufferFlags::DISCONT)){Ok(time)=>time,Err(error)=>{*read_failure.lock().unwrap()=Some(error.to_string());return Err(gst::FlowError::Error);}};
                    trim.slice(time,frames)
                }else{(0,frames)};
                if start>=end{return Ok(gst::FlowSuccess::Ok);}
                let mut values:Vec<f32>=bytes[start*8..end*8].chunks_exact(4).map(|v|f32::from_le_bytes(v.try_into().unwrap())).collect();
                if let Some(processor)=read_post.lock().unwrap().as_mut(){
                    match processor.process(&mut values){Ok(value)=>{let mut peak=read_reduction.lock().unwrap();*peak=(*peak).max(value);},Err(error)=>{*read_failure.lock().unwrap()=Some(error.to_string());return Err(gst::FlowError::Error);}}
                }
                read_count.fetch_add((end-start) as u64,Ordering::AcqRel);read_meter.lock().unwrap().push(&values);Ok(gst::FlowSuccess::Ok)
            }).build());
            stage.add_many([&convert,&resample,&filter,sink.upcast_ref()])?;gst::Element::link_many([&convert,&resample,&filter,sink.upcast_ref()])?;pad.link(&convert.static_pad("sink").unwrap())?;
            for element in [&convert,&resample,&filter,sink.upcast_ref()]{element.sync_state_with_parent()?;}
            Ok(())
        })();
        if let Err(e)=attached{*failure.lock().unwrap()=Some(e.to_string());stage.post_error_message(gst::error_msg!(gst::StreamError::Failed,["não foi possível medir a trilha/mix escolhidos"]));}
    });
    let result=(||->Result<serde_json::Value>{
        pipeline.set_state(gst::State::Playing)?;let bus=pipeline.bus().unwrap();let deadline=Instant::now()+Duration::from_secs(900);
        loop{
            if parent_lost.load(Ordering::Acquire){return Err(anyhow!("servidor encerrou durante a medição"));}
            if Instant::now()>deadline{return Err(anyhow!("análise excedeu quinze minutos"));}
            if let Some(message)=bus.timed_pop_filtered(gst::ClockTime::from_seconds(1),&[gst::MessageType::Eos,gst::MessageType::Error]){match message.view(){gst::MessageView::Eos(_)=>break,gst::MessageView::Error(e)=>return Err(anyhow!("{}",error.lock().unwrap().clone().unwrap_or_else(||e.error().to_string()))),_=>{}}}
        }
        if parent_lost.load(Ordering::Acquire){return Err(anyhow!("servidor encerrou durante a medição"));}
        if let Some(message)=error.lock().unwrap().as_ref(){return Err(anyhow!("{message}"));}
        let frames=samples.load(Ordering::Acquire);if frames<19200{return Err(anyhow!("trilha escolhida ausente ou áudio insuficiente para medição (mínimo 400 ms)"));}
        if let Some(trim)=requested_trim {if frames.abs_diff(trim.expected_frames())>1{return Err(anyhow!("áudio não cobre integralmente o trecho solicitado; medição descartada ({frames}/{} amostras)",trim.expected_frames()));}}
        let mut reading=meter.lock().unwrap().read();
        if let Some(processor)=post_state.lock().unwrap().as_mut(){
            if let Some(complete)=processor.finish()?{reading=complete;}
            let mut peak=reduction.lock().unwrap();*peak=(*peak).max(processor.limiter.take_reduction_db());
        }
        let mut result=serde_json::json!({"ok":true,"integratedLufs":reading.integrated_lufs,"lra":reading.range_lu,"truePeakDbtp":reading.true_peak_dbtp,"sampleFrames":frames,"rate":48000,"channels":2,"trim":requested_trim});
        if let Some(post)=requested_post {
            let flushed=post.tail_policy==Some(TailPolicy::CompensateAndFlush);
            result["processing"]=serde_json::json!({"kind":if flushed{"ISOLATED_POSTGAIN_FLUSHED_STEREO"}else{"ISOLATED_POSTGAIN_LIMITED_STEREO"},"gainDb":post.gain_db,"ceilingDbtp":post.ceiling_dbtp,"lookaheadMs":limiter::DEFAULT_LOOKAHEAD_MS,"releaseMs":limiter::DEFAULT_RELEASE_MS,"limiterReductionDb":*reduction.lock().unwrap(),"initialState":"RESET","tailFlushed":flushed,"busQualified":false,"transitionQualified":false,"publicationAuthorized":false});
            if flushed{let delay=post_state.lock().unwrap().as_ref().unwrap().limiter.delay_frames();result["processing"]["startupFramesRemoved"]=serde_json::json!(delay);result["processing"]["flushedFrames"]=serde_json::json!(delay);}
        }
        Ok(result)
    })();let _=pipeline.set_state(gst::State::Null);result
}
fn main(){let value=match run(){Ok(value)=>value,Err(error)=>serde_json::json!({"ok":false,"reason":error.to_string()})};println!("{value}");}

#[cfg(test)] mod trim_tests {
    use super::*;
    // NOT_RUN in this integration batch; no native qualification claimed.
    #[test] fn flushed_window_preserves_cut_and_last_frames_once(){
        let mut processor=PostProcessor::new(PostGain{gain_db:0.0,ceiling_dbtp:-1.0,tail_policy:Some(TailPolicy::CompensateAndFlush)});
        let mut samples=vec![0.0f32;19200*2];
        // Signal only in the final delay window: legacy measurement loses it.
        for value in &mut samples[(19200-240)*2..]{*value=0.1;}
        for chunk in samples.chunks_mut(128){processor.process(chunk).unwrap();}
        let reading=processor.finish().unwrap().unwrap();
        let window=processor.window.as_ref().unwrap();
        assert_eq!(window.input_frames,19200);assert_eq!(window.output_frames,19200);assert_eq!(window.skip,0);
        assert!(reading.true_peak_dbtp.is_finite());assert!(reading.true_peak_dbtp> -40.0);
        assert!(processor.finish().is_err());assert!(processor.process(&mut[0.0,0.0]).is_err());
    }
    #[test] fn post_gain_is_explicit_finite_and_bounded(){
        assert!(PostGain{gain_db:-3.0,ceiling_dbtp:-1.0,tail_policy:None}.validate().is_ok());
        for config in [PostGain{gain_db:f64::NAN,ceiling_dbtp:-1.0,tail_policy:None},PostGain{gain_db:13.0,ceiling_dbtp:-1.0,tail_policy:None},PostGain{gain_db:0.0,ceiling_dbtp:1.0,tail_policy:None}]{assert!(config.validate().is_err());}
        let mut processor=PostProcessor::new(PostGain{gain_db:0.0,ceiling_dbtp:-1.0,tail_policy:None});
        assert!(processor.process(&mut[f32::INFINITY,0.0]).is_err());
        let mut samples=vec![0.25f32;96000];let count=samples.len();
        assert!(processor.process(&mut samples).unwrap().is_finite());assert_eq!(samples.len(),count);assert!(samples.iter().all(|value|value.is_finite()));
    }
    #[test] fn boundaries_are_half_open_and_sample_exact(){
        let trim=MeasureTrim{in_ns:1_000_000_000,out_ns:2_000_000_000};
        assert_eq!(trim.slice(0,48000),(48000,48000));
        assert_eq!(trim.slice(1_000_000_000,48000),(0,48000));
        assert_eq!(trim.slice(2_000_000_000,1024),(0,0));
        assert_eq!(trim.slice(990_000_000,1024),(480,1024));
        assert_eq!(trim.expected_frames(),48000);
    }
    #[test] fn validates_duration_and_rounds_fractional_boundaries(){
        assert!(MeasureTrim{in_ns:10,out_ns:9}.validate().is_err());
        assert!(MeasureTrim{in_ns:0,out_ns:399_999_999}.validate().is_err());
        assert!(MeasureTrim{in_ns:0,out_ns:400_000_000}.validate().is_ok());
        assert_eq!(MeasureTrim{in_ns:1,out_ns:1_000_000_001}.slice(0,48001),(1,48001));
    }
    #[test] fn sample_clock_preserves_pcm_through_rounded_pts_but_refuses_gaps(){
        let mut clock=SampleClock::default();assert_eq!(clock.advance(0,1024,true).unwrap(),0);
        assert_eq!(clock.advance(21_000_000,1024,false).unwrap(),21_333_333);
        assert_eq!(clock.advance(43_000_000,1024,false).unwrap(),42_666_666);
        assert!(clock.advance(70_000_000,1024,false).is_err());
        assert!(clock.advance(64_000_000,1024,true).is_err());
    }
}
