//! Bancada dos monitores em níveis: prova cada nível publicado de verdade por
//! SRT local, mede cadência, atraso até o quadro decodificado (pelo relógio
//! gravado na imagem) e o custo de CPU do engine.
//!
//! Os testes são `#[ignore]`: abrem portas SRT e consomem CPU por segundos.
//! Rodar com `cargo test --release monitor_bench -- --ignored --nocapture`.
//! A bancada (`bench_monitor_niveis`) lê `BENCH_*` do ambiente; veja
//! docs/MONITORES-NAVEGADOR.md.

use gstreamer as gst;
use gstreamer::prelude::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::monitor::{read_luma, wall_clock_ms, MonitorBus, MonitorBusSpec, MonitorSource, MonitorTier, TEST_CLOCK};

fn free_port() -> u16 {
    std::net::UdpSocket::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

/// Canal de mentira: bola em movimento (mostra quadro repetido) e tom.
fn source(id: &str, w: i32, h: i32, n: i32, d: i32) -> gst::Pipeline {
    let pipeline = source_with(id, w, h, n, d);
    pipeline.set_state(gst::State::Playing).unwrap();
    pipeline
}

/// Fonte com o relógio gravado já na origem (antes do inter): serve para
/// medir o monitor antigo, que não tinha relógio próprio, do mesmo ponto.
fn stamped_source(id: &str, w: i32, h: i32, n: i32, d: i32) -> gst::Pipeline {
    let pipeline = source_with(id, w, h, n, d);
    let caps = pipeline.by_name("srccaps").unwrap();
    caps.static_pad("src").unwrap().add_probe(gst::PadProbeType::BUFFER, move |_, info| {
        if let Some(gst::PadProbeData::Buffer(buffer)) = info.data.as_mut() {
            if let Ok(mut map) = buffer.make_mut().map_writable() {
                crate::monitor::stamp_i420(map.as_mut_slice(), w, h, wall_clock_ms());
            }
        }
        gst::PadProbeReturn::Ok
    });
    pipeline.set_state(gst::State::Playing).unwrap();
    pipeline
}

fn source_with(id: &str, w: i32, h: i32, n: i32, d: i32) -> gst::Pipeline {
    // BENCH_FILE: imagem real (VT com movimento) no lugar da barra de teste;
    // o custo de decodificar o arquivo entra na linha de base e é descontado.
    let video = match std::env::var("BENCH_FILE") {
        Ok(file) => format!("filesrc location=\"{file}\" ! qtdemux ! h264parse ! avdec_h264 ! videoconvert ! videoscale ! videorate ! queue max-size-buffers=4 ! clocksync"),
        Err(_) => "videotestsrc is-live=true pattern=ball motion=sweep".to_string(),
    };
    let text = format!(
        "{video} ! capsfilter name=srccaps caps=video/x-raw,format=I420,width={w},height={h},framerate={n}/{d},pixel-aspect-ratio=1/1 ! intervideosink channel={id}-v \
         audiotestsrc is-live=true wave=sine freq=1000 volume=0.3 ! audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved ! interaudiosink channel={id}-a"
    );
    gst::parse::launch(&text).unwrap().downcast::<gst::Pipeline>().unwrap()
}

/// Lê a faixa de uma imagem que foi reduzida depois de gravada.
fn read_scaled(luma: &[u8], stride: usize, w: i32, h: i32, origin: Option<(i32, i32)>) -> Option<u64> {
    let Some((sw, sh)) = origin else { return read_luma(luma, stride, w, h) };
    let block = crate::monitor::clock_block(sw, sh) as f64 * w as f64 / sw as f64;
    let sample = |index: usize| luma.get((block / 2.0) as usize * stride + (index as f64 * block + block / 2.0) as usize).map(|v| *v > 126);
    let last = crate::monitor::CLOCK_BLOCKS as usize - 1;
    if sample(0)? != true || sample(1)? || sample(last - 1)? || sample(last)? != true { return None; }
    let mut ms = 0u64;
    for bit in 0..crate::monitor::CLOCK_BITS as usize { ms = (ms << 1) | sample(bit + 2)? as u64; }
    Some(ms)
}

#[derive(Default, Debug, Clone)]
pub struct Received {
    pub width: i32,
    pub height: i32,
    pub frames: u64,
    pub audio_buffers: u64,
    pub latencies_ms: Vec<i64>,
    pub intervals_ms: Vec<f64>,
    pub bytes: u64,
}

/// Receptor SRT em modo listener: decodifica, lê o relógio e conta tudo.
struct Receiver {
    pipeline: gst::Pipeline,
    data: Arc<Mutex<Received>>,
}

impl Receiver {
    fn new(port: u16) -> Self {
        Self::with(port, None)
    }

    /// `origin`: raster em que o relógio foi gravado, se não for o recebido.
    /// A latência SRT do receptor imita o MediaMTX (gosrt: 120 ms), salvo
    /// `BENCH_SRT_LATENCY`.
    fn with(port: u16, origin: Option<(i32, i32)>) -> Self {
        let srt_latency = std::env::var("BENCH_SRT_LATENCY").unwrap_or_else(|_| "120".into());
        let text = format!(
            "srtsrc uri=srt://127.0.0.1:{port}?mode=listener latency={srt_latency} name=src ! tsdemux name=d latency=0 \
             d. ! queue ! h264parse ! avdec_h264 ! videoconvert ! video/x-raw,format=GRAY8 ! appsink name=video sync=false emit-signals=false max-buffers=4 drop=true \
             d. ! queue ! fakesink name=audio sync=false"
        );
        let pipeline = gst::parse::launch(&text).unwrap().downcast::<gst::Pipeline>().unwrap();
        let data = Arc::new(Mutex::new(Received::default()));
        let bytes = Arc::new(AtomicU64::new(0));
        if let Some(src) = pipeline.by_name("src") {
            let counter = Arc::clone(&bytes);
            let shared = Arc::clone(&data);
            src.static_pad("src").unwrap().add_probe(gst::PadProbeType::BUFFER, move |_, info| {
                if let Some(gst::PadProbeData::Buffer(buffer)) = &info.data {
                    let total = counter.fetch_add(buffer.size() as u64, Ordering::Relaxed) + buffer.size() as u64;
                    shared.lock().unwrap().bytes = total;
                }
                gst::PadProbeReturn::Ok
            });
        }
        let sink = pipeline.by_name("video").unwrap();
        let shared = Arc::clone(&data);
        let last = Arc::new(Mutex::new(None::<Instant>));
        sink.static_pad("sink").unwrap().add_probe(gst::PadProbeType::BUFFER, move |pad, info| {
            let now_ms = wall_clock_ms() as i64;
            let Some(gst::PadProbeData::Buffer(buffer)) = &info.data else { return gst::PadProbeReturn::Ok };
            let Some(caps) = pad.current_caps() else { return gst::PadProbeReturn::Ok };
            let s = caps.structure(0).unwrap();
            let (w, h) = (s.get::<i32>("width").unwrap_or(0), s.get::<i32>("height").unwrap_or(0));
            let mut received = shared.lock().unwrap();
            received.width = w;
            received.height = h;
            received.frames += 1;
            if let Ok(map) = buffer.map_readable() {
                let stride = ((w + 3) & !3) as usize;
                if let Some(stamp) = read_scaled(map.as_slice(), stride, w, h, origin) {
                    received.latencies_ms.push(now_ms - stamp as i64);
                }
            }
            let mut previous = last.lock().unwrap();
            let now = Instant::now();
            if let Some(before) = *previous {
                received.intervals_ms.push(now.duration_since(before).as_secs_f64() * 1000.0);
            }
            *previous = Some(now);
            gst::PadProbeReturn::Ok
        });
        let shared = Arc::clone(&data);
        pipeline.by_name("audio").unwrap().static_pad("sink").unwrap().add_probe(gst::PadProbeType::BUFFER, move |_, _| {
            shared.lock().unwrap().audio_buffers += 1;
            gst::PadProbeReturn::Ok
        });
        pipeline.set_state(gst::State::Playing).unwrap();
        Self { pipeline, data }
    }

    fn snapshot(&self) -> Received {
        self.data.lock().unwrap().clone()
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

/// CPU (utime+stime) deste processo, em segundos.
fn process_cpu_seconds() -> f64 {
    let stat = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    let after = stat.rsplit(')').next().unwrap_or("");
    let fields: Vec<&str> = after.split_whitespace().collect();
    let ticks = fields.get(11).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) + fields.get(12).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
    ticks / 100.0
}

fn pump(bus: &mut MonitorBus, seconds: f64) {
    let until = Instant::now() + Duration::from_secs_f64(seconds);
    while Instant::now() < until {
        bus.service();
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn percentile(values: &[i64], p: f64) -> i64 {
    if values.is_empty() {
        return -1;
    }
    let mut sorted = values.to_vec();
    sorted.sort();
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

fn spec(id: &str, source: MonitorSource, ports: &[(MonitorTier, u16)]) -> MonitorBusSpec {
    MonitorBusSpec {
        video_channel: format!("{id}-v"),
        audio_channel: format!("{id}-a"),
        url: "srt://127.0.0.1:1?streamid=publish:x/mon".into(),
        source,
        opus: true,
        url_overrides: ports.iter().map(|(t, p)| (*t, format!("srt://127.0.0.1:{p}?latency=20"))).collect(),
    }
}

/// Os três níveis ao mesmo tempo, de um canal 1080i25 (composição 50p):
/// geometria e cadência certas em cada caminho, com som, e um nível que
/// sai não derruba os outros.
#[test]
#[ignore]
fn monitor_bus_publica_tres_niveis_e_troca_a_quente() {
    gst::init().unwrap();
    let id = format!("mb-{}", std::process::id());
    let _source = source(&id, 1920, 1080, 50, 1);
    let ports = [(MonitorTier::Ref, free_port()), (MonitorTier::Std, free_port()), (MonitorTier::Lite, free_port())];
    let receivers: Vec<(MonitorTier, Receiver)> = ports.iter().map(|(t, p)| (*t, Receiver::new(*p))).collect();
    std::env::set_var("RPLAYOUT_MONITOR_SW_MPX", "1000");
    let src = MonitorSource { width: 1920, height: 1080, fps_n: 50, fps_d: 1, frame_n: 25, frame_d: 1, bitrate_ceiling_kbps: 8000 };
    let mut bus = MonitorBus::new(spec(&id, src, &ports));
    TEST_CLOCK.store(true, Ordering::Relaxed);
    for (tier, _) in &ports {
        bus.set_tier(*tier, true, false);
    }
    pump(&mut bus, 6.0);
    let before: Vec<Received> = receivers.iter().map(|(_, r)| r.snapshot()).collect();
    for ((tier, _), got) in receivers.iter().zip(&before) {
        eprintln!("{tier:?}: {}x{} quadros={} áudio={} latência p50={} ms", got.width, got.height, got.frames, got.audio_buffers, percentile(&got.latencies_ms, 0.5));
        assert!(got.audio_buffers > 10, "{tier:?} sem áudio");
        assert!(!got.latencies_ms.is_empty(), "{tier:?} sem relógio legível");
    }
    assert_eq!((before[0].width, before[0].height), (1920, 1080));
    assert_eq!((before[1].width, before[1].height), (960, 540));
    assert_eq!((before[2].width, before[2].height), (428, 240));
    // REF e PADRÃO na cadência de campo (50), LEVE na de quadro (25). O
    // número recebido depende da CPU (este teste decodifica os três níveis
    // no mesmo processo); a cadência pedida ao encoder é a que se confere.
    let reports = bus.tier_reports();
    let rate = |t: MonitorTier| reports.iter().find(|r| r.tier == t).and_then(|r| r.profile).map(|p| (p.fps_n, p.fps_d));
    assert_eq!(rate(MonitorTier::Ref), Some((50, 1)));
    assert_eq!(rate(MonitorTier::Std), Some((50, 1)));
    assert_eq!(rate(MonitorTier::Lite), Some((25, 1)));
    assert!(before[1].frames > before[2].frames * 3 / 2, "PADRÃO (50) deveria receber mais quadros que o LEVE (25)");
    assert_eq!(reports.len(), 3);
    assert!(reports.iter().all(|r| r.health == crate::output::Health::OnAir), "{reports:?}");

    // Desliga o PADRÃO: REF e LEVE continuam sem interrupção.
    bus.set_tier(MonitorTier::Std, false, false);
    let ref_before = receivers[0].1.snapshot().frames;
    pump(&mut bus, 2.0);
    let ref_after = receivers[0].1.snapshot().frames;
    assert!(ref_after - ref_before > 30, "REF parou quando o PADRÃO saiu: {}", ref_after - ref_before);
    assert_eq!(bus.tier_reports().len(), 2);
    // E volta.
    bus.set_tier(MonitorTier::Std, true, false);
    pump(&mut bus, 2.0);
    assert!(bus.tier_reports().iter().all(|r| r.health == crate::output::Health::OnAir));
    bus.shutdown();
    TEST_CLOCK.store(false, Ordering::Relaxed);
}

/// Placa concedida mas indisponível (ou falhando): o nível sai em x264 sem
/// derrubar nada. Aqui não há GPU, então `nvh264enc` forçado não existe e o
/// ramo cai para o software na hora.
#[test]
#[ignore]
fn placa_ausente_cai_para_x264_sem_derrubar() {
    gst::init().unwrap();
    let id = format!("mbhw-{}", std::process::id());
    let _source = source(&id, 1280, 720, 25, 1);
    let port = free_port();
    let receiver = Receiver::new(port);
    std::env::set_var("RPLAYOUT_MONITOR_ENCODER", "nvh264enc");
    let src = MonitorSource { width: 1280, height: 720, fps_n: 25, fps_d: 1, frame_n: 25, frame_d: 1, bitrate_ceiling_kbps: 8000 };
    let mut bus = MonitorBus::new(spec(&id, src, &[(MonitorTier::Std, port)]));
    bus.set_tier(MonitorTier::Std, true, true);
    pump(&mut bus, 3.0);
    std::env::remove_var("RPLAYOUT_MONITOR_ENCODER");
    let report = &bus.tier_reports()[0];
    assert_eq!(report.encoder.as_deref(), Some("x264enc"));
    assert!(!report.hardware);
    assert!(receiver.snapshot().frames > 30);
    bus.shutdown();
}

/// Bancada: um nível, uma fonte, N segundos. Imprime uma linha JSON.
/// BENCH_TIER=ref|std|lite BENCH_RASTER=1920x1080 BENCH_RATE=50/1
/// BENCH_FRAME=25/1 BENCH_SECONDS=20 BENCH_URL=srt://... (sem URL, recebe aqui)
#[test]
#[ignore]
fn bench_monitor_niveis() {
    gst::init().unwrap();
    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
    let tier = match env("BENCH_TIER", "ref").as_str() {
        "std" => MonitorTier::Std,
        "lite" => MonitorTier::Lite,
        _ => MonitorTier::Ref,
    };
    let (w, h) = env("BENCH_RASTER", "1920x1080").split_once('x').map(|(a, b)| (a.parse().unwrap(), b.parse().unwrap())).unwrap();
    let (n, d) = env("BENCH_RATE", "50/1").split_once('/').map(|(a, b)| (a.parse().unwrap(), b.parse().unwrap())).unwrap();
    let (fn_, fd) = env("BENCH_FRAME", &format!("{n}/{d}")).split_once('/').map(|(a, b)| (a.parse().unwrap(), b.parse().unwrap())).unwrap();
    let seconds: f64 = env("BENCH_SECONDS", "20").parse().unwrap();
    let id = format!("bench-{}", std::process::id());
    // Antes (BENCH_LEGACY=1): o monitor de sempre, Publisher sem níveis em
    // 240p/15 fps/450 kbps, GOP 2 s, mux 500 ms, latência de saída 650 ms.
    let legacy = std::env::var("BENCH_LEGACY").is_ok();
    let _source = if legacy { stamped_source(&id, w, h, n, d) } else { source(&id, w, h, n, d) };
    std::thread::sleep(Duration::from_secs(2));
    let base_wall = Instant::now();
    let base_cpu = process_cpu_seconds();
    std::thread::sleep(Duration::from_secs(4));
    let source_cpu = (process_cpu_seconds() - base_cpu) / base_wall.elapsed().as_secs_f64();

    let external = std::env::var("BENCH_URL").ok();
    let port = free_port();
    let receiver = external.is_none().then(|| Receiver::with(port, legacy.then_some((w, h))));
    let url = external.clone().unwrap_or_else(|| format!("srt://127.0.0.1:{port}"));
    enum Sut { Bus(MonitorBus), Legacy(crate::output::Publisher) }
    let mut sut = if legacy {
        let (lw, lh) = crate::channel::monitor_size(w, h);
        let mut publisher = crate::output::Publisher::new(crate::output::PublisherSpec {
            output_id: "legacy".into(), kind: crate::output::Kind::Srt, url, video_channel: format!("{id}-v"), audio_channel: format!("{id}-a"),
            width: lw, height: lh, fps_n: 15, fps_d: 1, bitrate_kbps: 450, interlaced: false, top_field_first: true,
            prefer_software: true, role: "mon".into(), on_demand: true, opus: true, monitor: None,
        });
        publisher.set_wanted(true);
        Sut::Legacy(publisher)
    } else {
        let src = MonitorSource { width: w, height: h, fps_n: n, fps_d: d, frame_n: fn_, frame_d: fd, bitrate_ceiling_kbps: 8000 };
        let mut spec = spec(&id, src, &[]);
        spec.url_overrides.insert(tier, url);
        let mut bus = MonitorBus::new(spec);
        TEST_CLOCK.store(true, Ordering::Relaxed);
        bus.set_tier(tier, true, false);
        Sut::Bus(bus)
    };
    let mut run = |sut: &mut Sut, seconds: f64| {
        let until = Instant::now() + Duration::from_secs_f64(seconds);
        while Instant::now() < until {
            match sut { Sut::Bus(bus) => { bus.service(); } Sut::Legacy(p) => { p.service(); } }
            std::thread::sleep(Duration::from_millis(20));
        }
    };
    run(&mut sut, 4.0);
    let receiver_cpu0 = process_cpu_seconds();
    let wall = Instant::now();
    let before = receiver.as_ref().map(Receiver::snapshot).unwrap_or_default();
    run(&mut sut, seconds);
    let total_cpu = (process_cpu_seconds() - receiver_cpu0) / wall.elapsed().as_secs_f64();
    let after = receiver.as_ref().map(Receiver::snapshot).unwrap_or_default();
    let (profile, encoder, degraded) = match &sut {
        Sut::Bus(bus) => { let r = bus.tier_reports().into_iter().next(); (r.as_ref().and_then(|r| r.profile).map(|p| serde_json::to_string(&p).unwrap()).unwrap_or("null".into()), r.as_ref().and_then(|r| r.encoder.clone()), r.and_then(|r| r.degraded)) }
        Sut::Legacy(p) => (format!("\"legacy {}x{} 15fps 450kbps\"", crate::channel::monitor_size(w, h).0, crate::channel::monitor_size(w, h).1), p.report().encoder, None),
    };
    let lat: Vec<i64> = after.latencies_ms[before.latencies_ms.len().min(after.latencies_ms.len())..].to_vec();
    let intervals: Vec<f64> = after.intervals_ms[before.intervals_ms.len().min(after.intervals_ms.len())..].to_vec();
    let fps = (after.frames - before.frames) as f64 / wall.elapsed().as_secs_f64();
    let kbps = (after.bytes - before.bytes) as f64 * 8.0 / 1000.0 / wall.elapsed().as_secs_f64();
    let late = intervals.iter().filter(|v| **v > 1.5 * 1000.0 / fps.max(1.0)).count();
    println!(
        "BENCH {{\"tier\":\"{}\",\"source\":\"{w}x{h}@{n}/{d}\",\"profile\":{},\"encoder\":{:?},\"degraded\":{:?},\"cpuSourceCores\":{:.3},\"cpuTotalCores\":{:.3},\"fpsReceived\":{:.2},\"kbps\":{:.0},\"latencyP50\":{},\"latencyP95\":{},\"lateIntervals\":{}}}",
        if legacy { "legacy" } else { tier.name() }, profile, encoder, degraded, source_cpu, total_cpu, fps, kbps,
        percentile(&lat, 0.5), percentile(&lat, 0.95), late
    );
    if let Ok(hold) = std::env::var("BENCH_HOLD") {
        run(&mut sut, hold.parse().unwrap_or(60.0));
    }
    match &mut sut { Sut::Bus(bus) => bus.shutdown(), Sut::Legacy(p) => p.shutdown() }
    TEST_CLOCK.store(false, Ordering::Relaxed);
}
