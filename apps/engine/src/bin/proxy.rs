//! Browser proxy; never used as a broadcast master. Uses the bundled decoder.
use anyhow::{anyhow, Context, Result};
use gstreamer as gst;
use gst::prelude::*;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};

fn transcode(source: &str, destination: &str) -> Result<()> {
    gst::init()?;
    let source = std::fs::canonicalize(source)?;
    let uri = gst::glib::filename_to_uri(&source, None)?;
    let pipeline = gst::Pipeline::new();
    struct Stop(gst::Pipeline);
    impl Drop for Stop { fn drop(&mut self) { let _ = self.0.set_state(gst::State::Null); } }
    let _stop = Stop(pipeline.clone());
    let decode = gst::ElementFactory::make("uridecodebin").property("uri", uri.as_str()).build()?;
    let mux = gst::ElementFactory::make("mp4mux").property("faststart", true).build()?;
    let sink = gst::ElementFactory::make("filesink").property("location", destination).build()?;
    let video = gst::parse::bin_from_description(
        "queue ! deinterlace ! videoconvert ! videoscale add-borders=true ! videorate ! video/x-raw,width=426,height=240,framerate=10/1,pixel-aspect-ratio=1/1 ! x264enc speed-preset=ultrafast tune=zerolatency bitrate=220 key-int-max=20 ! h264parse", true)?;
    pipeline.add_many([&decode, &mux, &sink, video.upcast_ref()])?;
    video.link(&mux)?; mux.link(&sink)?;
    let has_video = Arc::new(AtomicBool::new(false));
    let got_video = has_video.clone();
    let has_audio = Arc::new(AtomicBool::new(false));
    let pipeline_ref = pipeline.downgrade();
    let mux_ref = mux.downgrade();
    let errors = Arc::new(Mutex::new(None::<String>));
    let stream_errors = errors.clone();
    decode.connect_pad_added(move |_, pad| {
        let caps = pad.current_caps().unwrap_or_else(|| pad.query_caps(None));
        let Some(structure) = caps.structure(0) else { return; };
        let kind = structure.name().as_str();
        if kind.starts_with("video/") && !got_video.swap(true, Ordering::SeqCst) {
            if let Some(target) = video.static_pad("sink") {
                if let Err(error) = pad.link(&target) { *stream_errors.lock().unwrap() = Some(format!("vídeo: {error}")); }
            }
        } else if kind.starts_with("audio/") && !has_audio.swap(true, Ordering::SeqCst) {
            let (Some(pipeline), Some(mux)) = (pipeline_ref.upgrade(), mux_ref.upgrade()) else { return; };
            let branch = gst::parse::bin_from_description(
                "queue ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! avenc_aac bitrate=48000 ! aacparse", true);
            match branch {
              Ok(branch) => {
                let result = pipeline.add(&branch).and_then(|_| branch.link(&mux)).and_then(|_| branch.sync_state_with_parent());
                match result {
                    Ok(()) => { if let Some(target) = branch.static_pad("sink") { if let Err(error) = pad.link(&target) { *stream_errors.lock().unwrap() = Some(format!("áudio: {error}")); } } },
                    Err(error) => { *stream_errors.lock().unwrap() = Some(format!("áudio: {error}")); }
                }
              },
              Err(error) => { *stream_errors.lock().unwrap() = Some(format!("encoder de áudio: {error}")); }
            }
        }
    });
    pipeline.set_state(gst::State::Playing).context("não foi possível iniciar o proxy")?;
    let deadline = Instant::now() + Duration::from_secs(900);
    let bus = pipeline.bus().ok_or_else(|| anyhow!("pipeline sem bus"))?;
    loop {
        if Instant::now() > deadline { return Err(anyhow!("proxy excedeu 15 minutos")); }
        if let Some(message) = bus.timed_pop(gst::ClockTime::from_seconds(1)) {
            match message.view() {
                gst::MessageView::Error(error) => return Err(anyhow!("{}: {:?}", error.error(), error.debug())),
                gst::MessageView::Eos(..) => break,
                _ => {}
            }
        }
    }
    if !has_video.load(Ordering::SeqCst) { return Err(anyhow!("arquivo não possui vídeo")); }
    if let Some(error) = errors.lock().unwrap().take() { return Err(anyhow!(error)); }
    pipeline.set_state(gst::State::Null)?;
    if std::fs::metadata(destination)?.len() < 100 { return Err(anyhow!("proxy vazio")); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_proxy_preserves_video_and_audio_from_unicode_path() {
        gst::init().unwrap();
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("rplayout-proxy-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
        let _cleanup = Cleanup(root.clone());
        let source = root.join("AÇÃO estúdio.mp4");
        let output = root.join("proxy.mp4");
        let fixture = gst::parse::launch("videotestsrc num-buffers=50 ! video/x-raw,width=640,height=360,framerate=25/1 ! x264enc tune=zerolatency ! h264parse ! queue ! mux.video_0 audiotestsrc num-buffers=94 ! audioconvert ! avenc_aac ! aacparse ! queue ! mux.audio_0 mp4mux name=mux ! filesink name=out")
            .unwrap().downcast::<gst::Pipeline>().unwrap();
        fixture.by_name("out").unwrap().set_property("location", source.to_str().unwrap());
        fixture.set_state(gst::State::Playing).unwrap();
        let message = fixture.bus().unwrap().timed_pop_filtered(gst::ClockTime::from_seconds(15), &[gst::MessageType::Eos, gst::MessageType::Error]).unwrap();
        fixture.set_state(gst::State::Null).unwrap();
        assert!(matches!(message.view(), gst::MessageView::Eos(..)), "fixture failed: {message:?}");
        transcode(source.to_str().unwrap(), output.to_str().unwrap()).unwrap();
        let inspect = gst::parse::launch("uridecodebin name=src src. ! queue ! videoconvert ! appsink name=video sync=false src. ! queue ! audioconvert ! appsink name=audio sync=false")
            .unwrap().downcast::<gst::Pipeline>().unwrap();
        struct Stop(gst::Pipeline);
        impl Drop for Stop { fn drop(&mut self) { let _ = self.0.set_state(gst::State::Null); } }
        let _stop = Stop(inspect.clone());
        inspect.by_name("src").unwrap().set_property("uri", gst::glib::filename_to_uri(&output, None).unwrap().as_str());
        inspect.set_state(gst::State::Playing).unwrap();
        let video = inspect.by_name("video").unwrap().downcast::<gstreamer_app::AppSink>().unwrap();
        let audio = inspect.by_name("audio").unwrap().downcast::<gstreamer_app::AppSink>().unwrap();
        let sample = video.try_pull_sample(gst::ClockTime::from_seconds(5)).expect("proxy must contain real video");
        let caps = sample.caps().unwrap().structure(0).unwrap();
        assert_eq!(caps.get::<i32>("width").unwrap(), 426);
        assert_eq!(caps.get::<i32>("height").unwrap(), 240);
        assert_eq!(caps.get::<gst::Fraction>("framerate").unwrap(), gst::Fraction::new(10, 1));
        assert!(audio.try_pull_sample(gst::ClockTime::from_seconds(5)).is_some(), "proxy must preserve audio");
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let result = if args.len() == 3 { transcode(&args[1], &args[2]) } else { Err(anyhow!("uso: rplayout-proxy <origem> <destino.mp4>")) };
    match result {
        Ok(()) => println!("{{\"ok\":true}}"),
        Err(error) => { println!("{}", serde_json::json!({"ok":false,"error":format!("{error:#}")})); std::process::exit(1); }
    }
}
