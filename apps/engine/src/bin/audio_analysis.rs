//! Whole-file, selected-track stereo mix measurement. Shares the exact input
//! routing and BS.1770 meter used by the playout; never applies gain/limiting.
use anyhow::{anyhow,Result};
use gstreamer as gst;
use gst::prelude::*;
use gstreamer_app as gst_app;
use std::sync::{Arc,Mutex,atomic::{AtomicBool,AtomicUsize,AtomicU64,Ordering}};
use std::time::{Duration,Instant};
#[allow(dead_code)] #[path="../audio_routing.rs"] mod audio_routing;
#[allow(dead_code)] #[path="../loudness.rs"] mod loudness;
#[derive(serde::Deserialize)] #[serde(rename_all="camelCase",deny_unknown_fields)]
struct Config {audio_track:usize,routing:audio_routing::AudioRouting}
fn run()->Result<serde_json::Value>{
    let args:Vec<String>=std::env::args().skip(1).collect();
    let parent_pipe=args.len()==3&&args[2]=="--parent-pipe";
    if args.len()!=2&&!parent_pipe{return Err(anyhow!("informe arquivo e configuração de mix JSON"));}
    let config:Config=serde_json::from_str(&args[1]).map_err(|_|anyhow!("configuração de mix inválida"))?;
    if config.audio_track>63{return Err(anyhow!("trilha fora do limite 0..63"));}config.routing.validate()?;
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
    let stage=pipeline.clone();let sample_count=samples.clone();let observed=meter.clone();let failure=error.clone();
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
            let resample=gst::ElementFactory::make("audioresample").build()?;let filter=gst::ElementFactory::make("capsfilter").build()?;
            filter.set_property("caps",gst::Caps::builder("audio/x-raw").field("format","F32LE").field("layout","interleaved").field("channels",2i32).field("rate",48000i32).build());
            let sink=gst::ElementFactory::make("appsink").property("sync",false).property("max-buffers",16u32).build()?.downcast::<gst_app::AppSink>().map_err(|_|anyhow!("appsink indisponível"))?;
            let read_meter=observed.clone();let read_count=sample_count.clone();
            sink.set_callbacks(gst_app::AppSinkCallbacks::builder().new_sample(move|sink|{
                let sample=sink.pull_sample().map_err(|_|gst::FlowError::Eos)?;let buffer=sample.buffer().ok_or(gst::FlowError::Error)?;let map=buffer.map_readable().map_err(|_|gst::FlowError::Error)?;
                let values:Vec<f32>=map.as_slice().chunks_exact(4).map(|v|f32::from_le_bytes(v.try_into().unwrap())).collect();read_count.fetch_add((values.len()/2) as u64,Ordering::AcqRel);read_meter.lock().unwrap().push(&values);Ok(gst::FlowSuccess::Ok)
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
        let reading=meter.lock().unwrap().read();
        Ok(serde_json::json!({"ok":true,"integratedLufs":reading.integrated_lufs,"lra":reading.range_lu,"truePeakDbtp":reading.true_peak_dbtp,"sampleFrames":frames,"rate":48000,"channels":2}))
    })();let _=pipeline.set_state(gst::State::Null);result
}
fn main(){let value=match run(){Ok(value)=>value,Err(error)=>serde_json::json!({"ok":false,"reason":error.to_string()})};println!("{value}");}
