//! Receptor OMT nativo para o barramento do engine.
//!
//! OMT entrega vídeo já decodificado por `libomt`/`libvmx`. Em vez de abrir
//! uma sessão para cada tela, este módulo coloca os quadros uma vez num
//! `appsrc`; o item do canal publica no barramento `inter` normal e daí PVW,
//! PGM, QC e Monitor usam exatamente a mesma renderização do engine.

use anyhow::{anyhow, Context, Result};
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use libloading::Library;
use std::ffi::{c_char, c_void, CString};
use std::thread;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use crate::omt_runtime::load_runtime;

const VIDEO: i32 = 2;
const AUDIO: i32 = 4;
const UYVY: i32 = 0x5956_5955;
const YUY2: i32 = 0x3259_5559;
const BGRA: i32 = 0x4152_4742;

#[repr(C)]
struct Frame {
    kind: i32,
    timestamp: i64,
    codec: i32,
    width: i32,
    height: i32,
    stride: i32,
    flags: i32,
    frame_rate_n: i32,
    frame_rate_d: i32,
    aspect_ratio: f32,
    color_space: i32,
    sample_rate: i32,
    channels: i32,
    samples_per_channel: i32,
    data: *const u8,
    data_length: i32,
    compressed_data: *const u8,
    compressed_length: i32,
    metadata: *const u8,
    metadata_length: i32,
}

impl Default for Frame {
    fn default() -> Self {
        // The official ABI requires every unused field to be zero/null.
        unsafe { std::mem::zeroed() }
    }
}

type ReceiveCreate = unsafe extern "C" fn(*const c_char, i32, i32, i32) -> *mut c_void;
type Receive = unsafe extern "C" fn(*mut c_void, i32, i32) -> *const Frame;
type ReceiveDestroy = unsafe extern "C" fn(*mut c_void);
type SendCreate = unsafe extern "C" fn(*const c_char, i32) -> *mut c_void;
type SendFrame = unsafe extern "C" fn(*mut c_void, *const Frame) -> i32;
type SendDestroy = unsafe extern "C" fn(*mut c_void);

/// Opaque handles are stored as an address, never dereferenced by Rust. All
/// calls for one sender are serialized under a Mutex; receiver has one owner.
struct Sender {
    _library: &'static Library,
    handle: usize,
    send: SendFrame,
    destroy: SendDestroy,
}

impl Sender {
    fn new(name: &str) -> Result<Self> {
        let name = CString::new(name.trim()).context("nome OMT contém byte inválido")?;
        if name.as_bytes().is_empty() { return Err(anyhow!("a saída OMT precisa de um nome")); }
        let library = load_runtime()?;
        let create = unsafe { *library.get::<SendCreate>(b"omt_send_create\0")? };
        let send = unsafe { *library.get::<SendFrame>(b"omt_send\0")? };
        let destroy = unsafe { *library.get::<SendDestroy>(b"omt_send_destroy\0")? };
        let handle = unsafe { create(name.as_ptr(), 0) };
        if handle.is_null() { return Err(anyhow!("libomt recusou criar a saída OMT")); }
        Ok(Self { _library: library, handle: handle as usize, send, destroy })
    }

    fn send_frame(&mut self, frame: &Frame) -> Result<usize> {
        let bytes = unsafe { (self.send)(self.handle as *mut c_void, frame) };
        if bytes < 0 {
            return Err(anyhow!("libomt recusou o quadro de vídeo/áudio"));
        }
        // Zero is normal with no subscribers, not a failed publisher. Count
        // actual delivery only after the runtime writes to a receiver.
        Ok(bytes as usize)
    }
}

impl Drop for Sender {
    fn drop(&mut self) { unsafe { (self.destroy)(self.handle as *mut c_void) }; }
}

struct ReceiverSession {
    _library: &'static Library,
    handle: usize,
    receive: Receive,
    destroy: ReceiveDestroy,
}

impl ReceiverSession {
    fn new(address: &str) -> Result<Self> {
        let library = load_runtime()?;
        let create = unsafe { *library.get::<ReceiveCreate>(b"omt_receive_create\0")? };
        let receive = unsafe { *library.get::<Receive>(b"omt_receive\0")? };
        let destroy = unsafe { *library.get::<ReceiveDestroy>(b"omt_receive_destroy\0")? };
        let address = CString::new(address).context("nome OMT contém byte inválido")?;
        let handle = unsafe { create(address.as_ptr(), VIDEO | AUDIO, 1, 0) };
        if handle.is_null() { return Err(anyhow!("libomt recusou abrir a fonte anunciada")); }
        Ok(Self { _library: library, handle: handle as usize, receive, destroy })
    }
}

impl Drop for ReceiverSession {
    fn drop(&mut self) { unsafe { (self.destroy)(self.handle as *mut c_void) }; }
}

fn planar_audio(interleaved: &[u8], channels: usize) -> Result<Vec<u8>> {
    if channels == 0 || channels > 32 || interleaved.len() % (channels * 4) != 0 {
        return Err(anyhow!("áudio OMT inválido: esperado F32LE intercalado"));
    }
    let samples = interleaved.len() / (channels * 4);
    let mut planar = vec![0; interleaved.len()];
    for sample in 0..samples {
        for channel in 0..channels {
            let from = (sample * channels + channel) * 4;
            let to = (channel * samples + sample) * 4;
            planar[to..to + 4].copy_from_slice(&interleaved[from..from + 4]);
        }
    }
    Ok(planar)
}

/// Isolated publisher: raw program buses -> UYVY/F32LE -> official libomt.
/// Missing runtime or native failure affects this output, never the PGM mixer.
pub fn publisher(spec: &crate::output::PublisherSpec, delivered: Arc<AtomicU64>) -> Result<gst::Pipeline> {
    use crate::channel::make;
    let name = spec.url.trim().trim_start_matches("omt:").trim_start_matches("//");
    let sender = Arc::new(Mutex::new(Sender::new(name)?));
    let pipeline = gst::Pipeline::new();
    let vsrc = make("intervideosrc")?;
    vsrc.set_property("channel", &spec.video_channel);
    crate::output::retain_last_video_frame(&vsrc);
    let vconv = make("videoconvert")?;
    let vscale = make("videoscale")?;
    let vrate = make("videorate")?;
    let vcaps = make("capsfilter")?;
    vcaps.set_property("caps", gst::Caps::builder("video/x-raw")
        .field("format", "UYVY").field("width", spec.width).field("height", spec.height)
        .field("framerate", gst::Fraction::new(spec.fps_n, spec.fps_d)).build());
    let vsink = make("appsink")?.dynamic_cast::<gst_app::AppSink>().map_err(|_| anyhow!("appsink OMT inválido"))?;
    vsink.set_sync(true);
    vsink.set_property("async", false);
    vsink.set_max_buffers(2);
    vsink.set_drop(true);
    let video_sender = sender.clone();
    let (width, height, fps_n, fps_d) = (spec.width, spec.height, spec.fps_n, spec.fps_d);
    vsink.set_callbacks(gst_app::AppSinkCallbacks::builder().new_sample(move |sink| {
        let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
        let buffer = sample.buffer().ok_or(gst::FlowError::Error)?;
        let map = buffer.map_readable().map_err(|_| gst::FlowError::Error)?;
        let frame = Frame { kind: VIDEO, timestamp: (buffer.pts().map(|pts| pts.nseconds()).unwrap_or(0) / 100) as i64,
            codec: UYVY, width, height, stride: ((width * 2 + 3) / 4) * 4,
            frame_rate_n: fps_n, frame_rate_d: fps_d, aspect_ratio: width as f32 / height as f32,
            color_space: if height < 720 { 601 } else { 709 }, data: map.as_ptr(), data_length: map.len() as i32, ..Frame::default() };
        match video_sender.lock().map_err(|_| gst::FlowError::Error)?.send_frame(&frame) {
            Ok(bytes) if bytes > 0 => { delivered.fetch_add(1, Ordering::Relaxed); },
            Ok(_) => {},
            Err(error) => {
                gst::element_error!(sink, gst::StreamError::Failed, ("publicação OMT falhou: {error}"));
                return Err(gst::FlowError::Error);
            }
        }
        Ok(gst::FlowSuccess::Ok)
    }).build());
    let asrc = make("interaudiosrc")?;
    asrc.set_property("channel", &spec.audio_channel);
    crate::channel::aplicar_latencia_de_audio(&asrc);
    let aconv = make("audioconvert")?;
    crate::audio_bus::numbered_channels(&aconv, 2)?;
    let ares = make("audioresample")?;
    let acaps = make("capsfilter")?;
    acaps.set_property("caps", gst::Caps::builder("audio/x-raw")
        .field("format", "F32LE").field("layout", "interleaved").field("rate", 48000i32).field("channels", 2i32).build());
    let asink = make("appsink")?.dynamic_cast::<gst_app::AppSink>().map_err(|_| anyhow!("appsink áudio OMT inválido"))?;
    asink.set_sync(true);
    asink.set_property("async", false);
    asink.set_max_buffers(4);
    asink.set_callbacks(gst_app::AppSinkCallbacks::builder().new_sample(move |sink| {
        let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
        let buffer = sample.buffer().ok_or(gst::FlowError::Error)?;
        let map = buffer.map_readable().map_err(|_| gst::FlowError::Error)?;
        let planar = planar_audio(&map, 2).map_err(|_| gst::FlowError::Error)?;
        let frame = Frame { kind: AUDIO, timestamp: (buffer.pts().map(|pts| pts.nseconds()).unwrap_or(0) / 100) as i64,
            codec: 0x3141_5046, sample_rate: 48000, channels: 2, samples_per_channel: (planar.len() / 8) as i32,
            data: planar.as_ptr(), data_length: planar.len() as i32, ..Frame::default() };
        if let Err(error) = sender.lock().map_err(|_| gst::FlowError::Error)?.send_frame(&frame) {
            gst::element_error!(sink, gst::StreamError::Failed, ("publicação de áudio OMT falhou: {error}"));
            return Err(gst::FlowError::Error);
        }
        Ok(gst::FlowSuccess::Ok)
    }).build());
    pipeline.add_many([&vsrc, &vconv, &vscale, &vrate, &vcaps, vsink.upcast_ref(), &asrc, &aconv, &ares, &acaps, asink.upcast_ref()])?;
    gst::Element::link_many([&vsrc, &vconv, &vscale, &vrate, &vcaps, vsink.upcast_ref()])?;
    gst::Element::link_many([&asrc, &aconv, &ares, &acaps, asink.upcast_ref()])?;
    Ok(pipeline)
}

/// Onde o instalador colocou o SDK. A variável permite que uma operação use
/// uma versão homologada fora da pasta do aplicativo, sem recompilar.
/// Recebe uma fonte anunciada por DNS-SD e a torna uma origem GStreamer.
///
/// A DLL só é carregada quando o operador realmente usa OMT. Assim uma
/// instalação sem OMT continua operando NDI/SRT/RTMP normalmente.
pub fn receiver(address: &str) -> Result<(gst::Element, gst::Element)> {
    if !cfg!(windows) {
        return Err(anyhow!("OMT nativo está disponível neste pacote apenas para Windows x64"));
    }
    let source = address.trim();
    if source.is_empty() {
        return Err(anyhow!("a fonte OMT não informou o nome DNS-SD"));
    }
    // Fail synchronously for an absent/mismatched DLL: an accepted CUE must
    // not conceal a receiver that could never have been opened.
    let session = ReceiverSession::new(source)?;
    let video = gst::ElementFactory::make("appsrc")
        .name("omt-video")
        .build()
        .context("o plugin GStreamer appsrc não está instalado")?
        .dynamic_cast::<gst_app::AppSrc>()
        .map_err(|_| anyhow!("appsrc OMT não pôde ser criado"))?;
    configure_source(&video, 32 * 1024 * 1024);
    let audio = gst::ElementFactory::make("appsrc")
        .name("omt-audio")
        .build()
        .context("o plugin GStreamer appsrc não está instalado")?
        .dynamic_cast::<gst_app::AppSrc>()
        .map_err(|_| anyhow!("appsrc de áudio OMT não pôde ser criado"))?;
    configure_source(&audio, 4 * 1024 * 1024);

    let video_destination = video.downgrade();
    let audio_destination = audio.downgrade();
    thread::Builder::new()
        .name("rplayout-omt-receive".to_owned())
        .spawn(move || {
            if let Err(error) = receive_loop(session, video_destination, audio_destination) {
                eprintln!("[engine] receptor OMT encerrou: {error:#}");
            }
        })
        .context("não consegui iniciar o receptor OMT")?;

    Ok((video.upcast(), audio.upcast()))
}

fn configure_source(source: &gst_app::AppSrc, max_bytes: u64) {
    source.set_format(gst::Format::Time);
    source.set_is_live(true);
    source.set_do_timestamp(false);
    source.set_max_bytes(max_bytes);
    source.set_block(false);
}

// Bounds are checked before creating slices from SDK-owned memory. Padded
// source rows must be repacked to GStreamer's four-byte aligned raw layout.
fn video_layout(frame: &Frame) -> Option<(usize, usize, usize)> {
    if !(1..=8192).contains(&frame.width) || !(1..=8192).contains(&frame.height) { return None; }
    let bpp = match frame.codec { BGRA => 4, UYVY | YUY2 if frame.width % 2 == 0 => 2, _ => return None };
    let row = (frame.width as usize).checked_mul(bpp)?;
    let source_stride = if frame.stride == 0 { row } else { usize::try_from(frame.stride).ok()? };
    if source_stride < row { return None; }
    let needed = source_stride.checked_mul(frame.height as usize - 1)?.checked_add(row)?;
    if usize::try_from(frame.data_length).ok()? < needed { return None; }
    Some((row, source_stride, (row + 3) & !3))
}

fn audio_bytes(frame: &Frame) -> Option<usize> {
    if frame.codec != i32::from_le_bytes(*b"FPA1") || !(1..=32).contains(&frame.channels)
        || !(8000..=192000).contains(&frame.sample_rate)
        || !(1..=192000).contains(&frame.samples_per_channel) { return None; }
    let bytes = (frame.samples_per_channel as usize).checked_mul(frame.channels as usize)?.checked_mul(4)?;
    if usize::try_from(frame.data_length).ok()? < bytes { return None; }
    Some(bytes)
}

#[derive(Default)]
struct FrameClock { origin: Option<i64>, latest: i64, base: u64, video_end: u64, audio_end: u64,video_discont:bool,audio_discont:bool,initialized:bool }
impl FrameClock {
    #[cfg(test)]
    fn pts(&mut self, timestamp: i64, video: bool, duration: u64) -> u64 {
        self.pts_at(timestamp,video,duration,None,false).0
    }
    fn pts_at(&mut self,timestamp:i64,video:bool,duration:u64,running:Option<u64>,resumed:bool)->(u64,bool){
        let reset=timestamp>=0&&self.origin.is_some()&&timestamp<self.latest.saturating_sub(10_000_000);
        if resumed||reset||!self.initialized{
            self.initialized=true;
            self.origin=(timestamp>=0).then_some(timestamp);
            self.base=self.video_end.max(self.audio_end).max(running.unwrap_or(0));
            self.latest=timestamp.max(0);self.video_discont=true;self.audio_discont=true;
        }
        let end = if video { self.video_end } else { self.audio_end };
        let pts = if timestamp < 0 { end.max(self.base) } else {
            self.origin.get_or_insert(timestamp);
            // A reconnect can restart the sender's clock. Rebase both media
            // streams together, rather than restarting either one at zero.
            self.latest = self.latest.max(timestamp);
            let relative = timestamp.saturating_sub(self.origin.unwrap()).max(0) as u64;
            self.base.saturating_add(relative.saturating_mul(100)).max(end)
        };
        if video { self.video_end = pts.saturating_add(duration); }
        else { self.audio_end = pts.saturating_add(duration); }
        let discontinuity=if video{std::mem::replace(&mut self.video_discont,false)}else{std::mem::replace(&mut self.audio_discont,false)};
        (pts,discontinuity)
    }
}

fn receive_loop(session: ReceiverSession, video_ref: gst::glib::WeakRef<gst_app::AppSrc>, audio_ref: gst::glib::WeakRef<gst_app::AppSrc>) -> Result<()> {
    let mut clock = FrameClock::default();
    let mut video_configured: Option<(i32, i32, i32, i32, i32)> = None;
    let mut audio_configured: Option<(i32, i32)> = None;
    let mut started = false;
    let mut last_valid_frame:Option<std::time::Instant>=None;
    loop {
        let (Some(video), Some(audio)) = (video_ref.upgrade(), audio_ref.upgrade()) else { break; };
        if video.current_state() != gst::State::Null { started = true; }
        else if started { break; }
        let frame = unsafe { (session.receive)(session.handle as *mut c_void, VIDEO | AUDIO, 250) };
        if frame.is_null() {
            continue;
        }
        let frame = unsafe { &*frame };
        if frame.data.is_null() || frame.data_length <= 0 {
            continue;
        }
        if frame.kind == AUDIO {
            let Some(bytes) = audio_bytes(frame) else { continue; };
            let configured = (frame.sample_rate, frame.channels);
            if audio_configured != Some(configured) {
                let caps = gst::Caps::builder("audio/x-raw")
                    .field("format", "F32LE")
                    .field("layout", "interleaved")
                    .field("rate", frame.sample_rate)
                    .field("channels", frame.channels)
                    .build();
                audio.set_caps(Some(&caps));
                audio_configured = Some(configured);
            }
            let mut buffer = gst::Buffer::with_size(bytes).context("não consegui reservar áudio OMT")?;
            {
                let buffer = buffer.get_mut().ok_or_else(|| anyhow!("buffer de áudio OMT não é mutável"))?;
                let mut map = buffer.map_writable().context("não consegui escrever áudio OMT")?;
                // OMT FPA1 é planar; GStreamer recebe F32LE intercalado.
                // Intercalar aqui preserva o relógio e evita um ramo de áudio
                // separado que ficaria fora de sincronia com o vídeo.
                let source = unsafe { std::slice::from_raw_parts(frame.data, bytes) };
                let target = map.as_mut_slice();
                for sample in 0..frame.samples_per_channel as usize {
                    for channel in 0..frame.channels as usize {
                        let from = (channel * frame.samples_per_channel as usize + sample) * 4;
                        let to = (sample * frame.channels as usize + channel) * 4;
                        target[to..to + 4].copy_from_slice(&source[from..from + 4]);
                    }
                }
                drop(map);
                let duration = 1_000_000_000u64 * frame.samples_per_channel as u64 / frame.sample_rate as u64;
                let now=std::time::Instant::now();let resumed=last_valid_frame.is_some_and(|last|now.duration_since(last)>=std::time::Duration::from_secs(2));
                let running=audio.current_running_time().map(|time|time.nseconds());
                let(pts,discontinuity)=clock.pts_at(frame.timestamp,false,duration,running,resumed);last_valid_frame=Some(now);
                buffer.set_pts(gst::ClockTime::from_nseconds(pts));
                if discontinuity{buffer.set_flags(gst::BufferFlags::DISCONT);}
                buffer.set_duration(gst::ClockTime::from_nseconds(duration));
            }
            if audio.push_buffer(buffer).is_err() {
                break;
            }
            continue;
        }
        if frame.kind != VIDEO || frame.frame_rate_n <= 0 || frame.frame_rate_d <= 0 {
            continue;
        }
        let Some((row_bytes, source_stride, target_stride)) = video_layout(frame) else { continue; };
        let format = match frame.codec {
            UYVY => "UYVY",
            YUY2 => "YUY2",
            BGRA => "BGRA",
            other => {
                eprintln!("[engine] quadro OMT ignorado: codec {other:#x} não é raw suportado");
                continue;
            }
        };
        let fps_n = frame.frame_rate_n;
        let fps_d = frame.frame_rate_d;
        let negotiated = (frame.width, frame.height, frame.codec, fps_n, fps_d);
        if video_configured != Some(negotiated) {
            let caps = gst::Caps::builder("video/x-raw")
                .field("format", format)
                .field("width", frame.width)
                .field("height", frame.height)
                .field("framerate", gst::Fraction::new(fps_n, fps_d))
                .build();
            video.set_caps(Some(&caps));
            video_configured = Some(negotiated);
        }
        let mut buffer = gst::Buffer::with_size(target_stride * frame.height as usize)
            .context("não consegui reservar buffer para quadro OMT")?;
        {
            let buffer = buffer.get_mut().ok_or_else(|| anyhow!("buffer OMT não é mutável"))?;
            let mut map = buffer.map_writable().context("não consegui escrever quadro OMT")?;
            let target = map.as_mut_slice();
            target.fill(0);
            for row in 0..frame.height as usize {
                unsafe {
                    std::ptr::copy_nonoverlapping(frame.data.add(row * source_stride), target.as_mut_ptr().add(row * target_stride), row_bytes);
                }
            }
            drop(map);
            let duration = 1_000_000_000u64.saturating_mul(fps_d as u64) / fps_n as u64;
            let now=std::time::Instant::now();let resumed=last_valid_frame.is_some_and(|last|now.duration_since(last)>=std::time::Duration::from_secs(2));
            let running=video.current_running_time().map(|time|time.nseconds());
            let(pts,discontinuity)=clock.pts_at(frame.timestamp,true,duration,running,resumed);last_valid_frame=Some(now);
            buffer.set_pts(gst::ClockTime::from_nseconds(pts));
            if discontinuity{buffer.set_flags(gst::BufferFlags::DISCONT);}
            buffer.set_duration(gst::ClockTime::from_nseconds(duration));
        }
        if video.push_buffer(buffer).is_err() {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_frames_and_accounts_for_row_padding() {
        let mut frame = Frame { codec: UYVY, width: 6, height: 2, stride: 16, data_length: 28, ..Default::default() };
        assert_eq!(video_layout(&frame), Some((12, 16, 12)));
        frame.data_length = 27;
        assert_eq!(video_layout(&frame), None);
        frame.data_length = 32; frame.stride = 4;
        assert_eq!(video_layout(&frame), None);
        frame.width = i32::MAX;
        assert_eq!(video_layout(&frame), None);
        frame = Frame { codec: i32::from_le_bytes(*b"FPA1"), sample_rate: 48000, channels: 2, samples_per_channel: 480, data_length: 3840, ..Default::default() };
        assert_eq!(audio_bytes(&frame), Some(3840));
        frame.channels = 33;
        assert_eq!(audio_bytes(&frame), None);
        frame.channels = 2; frame.codec = BGRA;
        assert_eq!(audio_bytes(&frame), None);
    }

    #[test]
    fn keeps_audio_video_timestamp_offset_and_recovers_clock_reset() {
        let mut clock = FrameClock::default();
        assert_eq!(clock.pts(50_000_000, false, 10_000_000), 0);
        assert_eq!(clock.pts(50_200_000, true, 40_000_000), 20_000_000);
        assert_eq!(clock.pts(50_100_000, false, 10_000_000), 10_000_000);
        let before = clock.video_end.max(clock.audio_end);
        assert_eq!(clock.pts(0, true, 40_000_000), before);
        assert_eq!(clock.pts(100_000, false, 10_000_000), before + 10_000_000);
    }
    // NOT_RUN in current group-2 batch. A running-time rebase is not proof of
    // remote sender freshness, successful TAKE or physical A/V synchronization.
    #[test]
    fn resumed_sender_rebases_both_streams_to_running_clock_not_old_end(){
        let mut clock=FrameClock::default();
        assert_eq!(clock.pts_at(50_000_000,true,40_000_000,Some(5_000_000_000),false),(5_000_000_000,true));
        assert_eq!(clock.pts_at(50_100_000,false,10_000_000,Some(5_010_000_000),false),(5_010_000_000,true));
        assert_eq!(clock.pts_at(0,true,40_000_000,Some(8_000_000_000),true),(8_000_000_000,true));
        assert_eq!(clock.pts_at(100_000,false,10_000_000,Some(8_010_000_000),false),(8_010_000_000,true));
        assert_eq!(clock.pts_at(400_000,true,40_000_000,Some(8_040_000_000),false),(8_040_000_000,false));
    }
    #[test]
    fn unspecified_timestamps_do_not_reset_every_packet(){
        let mut clock=FrameClock::default();
        assert_eq!(clock.pts_at(-1,true,40_000_000,Some(5_000_000_000),false),(5_000_000_000,true));
        assert_eq!(clock.pts_at(-1,true,40_000_000,Some(5_040_000_000),false),(5_040_000_000,false));
        assert_eq!(clock.pts_at(-1,false,10_000_000,Some(5_040_000_000),false),(5_000_000_000,true));
    }

    #[test]
    fn aceita_codecs_raw_do_sdk() {
        assert_eq!(UYVY, 0x5956_5955);
        assert_eq!(YUY2, 0x3259_5559);
        assert_eq!(BGRA, 0x4152_4742);
    }

    #[test]
    fn converts_audio_to_official_planar_format() {
        let bytes: Vec<u8> = [1.0f32, 10.0, 2.0, 20.0].iter().flat_map(|value| value.to_le_bytes()).collect();
        let expected: Vec<u8> = [1.0f32, 2.0, 10.0, 20.0].iter().flat_map(|value| value.to_le_bytes()).collect();
        assert_eq!(planar_audio(&bytes, 2).unwrap(), expected);
        assert!(planar_audio(&[1, 2, 3], 2).is_err());
        assert!(planar_audio(&bytes, 0).is_err());
    }

    #[test]
    fn official_frame_layout_matches_windows_x64_abi() {
        assert_eq!(std::mem::size_of::<Frame>(), 112);
        assert_eq!(std::mem::offset_of!(Frame, timestamp), 8);
        assert_eq!(std::mem::offset_of!(Frame, data), 64);
    }

    #[test]
    #[ignore = "requires bundled Windows libomt/libvmx; run explicitly with RPLAYOUT_OMT_RUNTIME"]
    fn native_publisher_transmits_video_and_audio_to_loopback_receiver() {
        use crate::output::{Kind, PublisherSpec};
        use std::time::{Duration, Instant};
        // This ignored native diagnostic is run in its own test process.
        // SDK construction/cleanup can block outside the receive-loop deadline.
        let (_completion,completed)=std::sync::mpsc::channel::<()>();
        let progress=Arc::new(std::sync::atomic::AtomicUsize::new(0));let observed=progress.clone();
        std::thread::spawn(move||{
            if matches!(completed.recv_timeout(Duration::from_secs(60)),Err(std::sync::mpsc::RecvTimeoutError::Timeout)){
                eprintln!("OMT loopback timeout: stage={}",observed.load(Ordering::Acquire));
                std::process::exit(124);
            }
        });
        let stage=|number,label|{progress.store(number,Ordering::Release);eprintln!("OMT loopback stage={number}: {label}");};
        struct Running(gst::Pipeline);
        impl Drop for Running { fn drop(&mut self) { let _ = self.0.set_state(gst::State::Null); } }
        stage(1,"GStreamer init");gst::init().unwrap();
        let name = format!("RPlayout loopback {}", std::process::id());
        let spec = PublisherSpec { output_id: "omt-test".to_string(), kind: Kind::Omt, url: format!("omt:{name}"),
            video_channel: "omt-test-video".to_string(), audio_channel: "omt-test-audio".to_string(), width: 320, height: 180,
            fps_n: 25, fps_d: 1, bitrate_kbps: 450, interlaced: false, top_field_first: true,
            prefer_software: true, role: "test".to_string(), on_demand: false, opus: false };
        let delivered = Arc::new(AtomicU64::new(0));
        stage(2,"publisher/runtime construction");let output = Running(publisher(&spec, delivered.clone()).unwrap());
        stage(3,"official discovery");
        let address = crate::omt_runtime::discover().unwrap().into_iter().find(|address| address.contains(&name))
            .expect("official discovery must find the native sender");
        stage(4,"receiver construction");let session = ReceiverSession::new(&address).unwrap();
        let input = Running(gst::parse::launch("videotestsrc name=omt-test-picture is-live=true pattern=white ! video/x-raw,width=320,height=180,framerate=25/1 ! intervideosink channel=omt-test-video audiotestsrc is-live=true wave=sine ! audio/x-raw,rate=48000,channels=2 ! interaudiosink channel=omt-test-audio")
            .unwrap().downcast::<gst::Pipeline>().unwrap());
        stage(5,"input Playing");input.0.set_state(gst::State::Playing).unwrap();
        stage(6,"output Playing");
        output.0.set_state(gst::State::Playing).unwrap();
        stage(7,"receive video/audio");
        let deadline = Instant::now() + Duration::from_secs(8);
        let (mut video_ok, mut audio_ok) = (false, false);
        while Instant::now() < deadline && !(video_ok && audio_ok) {
            let frame = unsafe { (session.receive)(session.handle as *mut c_void, VIDEO | AUDIO, 250) };
            if frame.is_null() { continue; }
            let frame = unsafe { &*frame };
            if frame.kind == VIDEO && !frame.data.is_null() {
                assert_eq!((frame.width, frame.height, frame.frame_rate_n, frame.frame_rate_d), (320, 180, 25, 1));
                assert!(frame.data_length >= 320 * 180 * 2);
                let bytes = unsafe { std::slice::from_raw_parts(frame.data, frame.data_length as usize) };
                video_ok = bytes.iter().skip(1).step_by(2).take(1000).all(|y| *y > 200);
            }
            if frame.kind == AUDIO && !frame.data.is_null() {
                assert_eq!((frame.sample_rate, frame.channels), (48000, 2));
                assert!(frame.samples_per_channel > 0);
                let bytes = unsafe { std::slice::from_raw_parts(frame.data, frame.data_length as usize) };
                audio_ok = bytes.iter().any(|byte| *byte != 0);
            }
        }
        for pipeline in [&input.0, &output.0] {
            if let Some(bus) = pipeline.bus() {
                while let Some(message) = bus.pop() {
                    if let gst::MessageView::Error(error) = message.view() {
                        eprintln!("OMT loopback pipeline error: {} {:?}", error.error(), error.debug());
                    }
                }
            }
        }
        eprintln!("OMT loopback: video={video_ok} audio={audio_ok} delivered={}", delivered.load(Ordering::Relaxed));
        assert!(video_ok, "no valid white video frame received through native OMT");
        assert!(audio_ok, "no real sine audio received through native OMT");
        assert!(delivered.load(Ordering::Relaxed) > 0, "publisher must count actual delivered video");
        // Also exercise the engine's actual appsrc ingest, not only SDK receive.
        stage(8,"actual appsrc ingest");let (vsrc, asrc) = receiver(&address).unwrap();
        let vsink = gst_app::AppSink::builder().sync(false).max_buffers(2).drop(true).build();
        let asink = gst_app::AppSink::builder().sync(false).max_buffers(4).drop(true).build();
        vsink.set_property("async", false); asink.set_property("async", false);
        let ingest = Running(gst::Pipeline::new());
        ingest.0.add_many([&vsrc, &asrc, vsink.upcast_ref(), asink.upcast_ref()]).unwrap();
        vsrc.link(&vsink).unwrap(); asrc.link(&asink).unwrap();
        ingest.0.set_state(gst::State::Playing).unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        let (mut decoded_video, mut decoded_audio) = (false, false);
        while Instant::now() < deadline && !(decoded_video && decoded_audio) {
            if let Some(sample) = vsink.try_pull_sample(gst::ClockTime::from_mseconds(100)) {
                let caps = sample.caps().unwrap().structure(0).unwrap();
                assert_eq!((caps.get::<i32>("width").unwrap(), caps.get::<i32>("height").unwrap()), (320, 180));
                let map = sample.buffer().unwrap().map_readable().unwrap();
                decoded_video = map.as_slice().iter().skip(1).step_by(2).take(1000).all(|y| *y > 200);
            }
            if let Some(sample) = asink.try_pull_sample(gst::ClockTime::from_mseconds(100)) {
                let map = sample.buffer().unwrap().map_readable().unwrap();
                decoded_audio = map.as_slice().chunks_exact(4).map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap())).any(|value| value.is_finite() && value.abs() > 0.01);
            }
        }
        assert!(decoded_video, "native OMT must deliver white video through engine appsrc");
        assert!(decoded_audio, "native OMT must deliver interleaved float sine audio through engine appsrc");
        eprintln!("OMT engine ingest: video={decoded_video} audio={decoded_audio}");
        // Validate the channel's telemetry on the actual native decoder path.
        // Its compositor is deliberately a different size; source format must
        // not be inferred from the scaled program/preview caps.
        use crate::channel::{Channel, Config, Output, Scan};
        stage(9,"channel construction/CUE");
        crate::limiter_element::register().unwrap();
        struct RunningChannel(Channel);
        impl Drop for RunningChannel { fn drop(&mut self) { self.0.shutdown(); } }
        // The preview publisher remains on-demand and is never activated: no
        // endpoint receives data. The real PVW decoder/intersink still runs.
        let mut channel = RunningChannel(Channel::new(Config { channel_id:format!("omt-signal-{}",std::process::id()),width:640,height:360,fps_n:25,fps_d:1,bitrate_kbps:450,ceiling_dbtp:-1.0,audio_channels:8,scan:Scan::Progressive,top_field_first:true,outputs:vec![Output::Null],preview:Some(Output::parse("srt://127.0.0.1:19003?mode=caller").unwrap()) }).unwrap());
        channel.0.start().unwrap();
        let item: crate::protocol::ItemSpec = serde_json::from_value(serde_json::json!({"itemId":"omt-native-signal","source":format!("omt:{address}"),"trimIn":0,"trimOut":250,"gainDb":0.0,"auxiliaryPairs":[{"outputPair":2,"inputPair":1,"gainDb":-6}]})).unwrap();
        channel.0.preview(Some(item.clone())).unwrap();
        let deadline=Instant::now()+Duration::from_secs(8);
        let mut preview_ok=false;
        while Instant::now()<deadline && !preview_ok {
            preview_ok=channel.0.live_signal_reports().iter().any(|(_,bus,signal)| *bus=="pvw" && signal.video_present && signal.audio_present && signal.width==Some(320));
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(preview_ok,"CUE must independently decode OMT on PVW with received audio");
        assert!(channel.0.on_air_id().is_none(),"CUE cannot put its source on PGM");
        stage(10,"channel LOAD/TAKE");channel.0.load(item).unwrap();channel.0.take().unwrap();
        let deadline=Instant::now()+Duration::from_secs(8);
        let mut signal_ok=false;
        while Instant::now()<deadline && !signal_ok {
            channel.0.service_pending_take().unwrap();
            for (_,bus,signal) in channel.0.live_signal_reports() {
                if bus=="pgm" && signal.video_present && signal.audio_present {
                    assert_eq!((signal.width,signal.height,signal.rate_num,signal.rate_den),(Some(320),Some(180),Some(25),Some(1)));
                    assert_eq!((signal.audio_channels,signal.sample_rate),(Some(2),Some(48000)));
                    assert!(signal.received_frames>0);
                    signal_ok=true;
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if !signal_ok { eprintln!("OMT channel: onAir={:?} armed={:?} reports={:?}",channel.0.on_air_id(),channel.0.armed_id(),channel.0.live_signal_reports()); }
        assert!(signal_ok,"channel must report actual native OMT input format and received audio");
        let deadline=Instant::now()+Duration::from_secs(8);let mut audible=false;
        while Instant::now()<deadline && !audible {audible=channel.0.measure().0.peak_dbfs.iter().all(|peak|*peak > -40.);std::thread::sleep(Duration::from_millis(20));}
        assert!(audible && channel.0.frames_out()>0,"OMT must reach the running program, not only source telemetry");
        channel.0.preview(None).unwrap();
        assert_eq!(channel.0.on_air_id().as_deref(),Some("omt-native-signal"));
        eprintln!("OMT channel signal telemetry: video/audio/format=PASS, compositor=640x360 source=320x180");
        stage(11,"sender loss and native signal expiry");
        let decoder_id=channel.0.decoder_id("pgm");
        output.0.set_state(gst::State::Null).unwrap();
        let deadline=Instant::now()+Duration::from_secs(8);
        let mut lost=false;
        while Instant::now()<deadline && !lost {
            lost=channel.0.live_signal_reports().iter().any(|(_,bus,signal)|*bus=="pgm" && !signal.video_present);
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(lost,"stopped OMT publisher cannot remain SIGNAL_OK");
        assert_eq!(channel.0.on_air_id().as_deref(),Some("omt-native-signal"));
        stage(12,"sender return and running-clock rebasing");
        input.0.by_name("omt-test-picture").unwrap().set_property_from_str("pattern","red");
        output.0.set_state(gst::State::Playing).unwrap();
        let deadline=Instant::now()+Duration::from_secs(8);
        let mut returned=false;
        while Instant::now()<deadline && !returned {
            let signal_ok=channel.0.live_signal_reports().iter().any(|(_,bus,signal)|*bus=="pgm" && signal.video_present && signal.audio_present);
            let (audio,_,video)=channel.0.measure();
            returned=signal_ok && !audio.peak_dbfs.is_empty() && audio.peak_dbfs.iter().all(|peak|*peak > -40.)
                && video.sample_age_ms.is_some_and(|age|age<500) && (40.0..85.0).contains(&video.luma);
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(returned,"new red OMT picture/audio must reach PGM after the sender clock restarts, not held white");
        assert_eq!(channel.0.on_air_id().as_deref(),Some("omt-native-signal"));
        assert_eq!(channel.0.decoder_id("pgm"),decoder_id,"OMT appsrc session must survive this short interruption");
        stage(13,"cleanup");
    }
}
