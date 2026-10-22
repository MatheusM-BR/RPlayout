//! Isolated still-graphic render, never a channel or physical publisher.
//! JSON request on stdin; one JSON header + exactly one RGBA frame on stdout.
use anyhow::{anyhow, ensure, Result};
use gstreamer as gst;
use gst::prelude::*;
use gstreamer_app as gst_app;
use quick_xml::{events::Event, Reader};
use serde::Deserialize;
use std::io::{Read, Write};

const SVG_LIMIT: usize = 4 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request { version: u32, svg: String, width: i32, height: i32 }

fn local_reference(value: &str) -> bool {
    let value = value.trim();
    if let Some(fragment) = value.strip_prefix('#') {
        return !fragment.is_empty() && !fragment.chars().any(|c| c.is_whitespace() || c.is_control());
    }
    ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/gif;base64,", "data:image/webp;base64,"].iter().any(|prefix| {
        value.strip_prefix(prefix).is_some_and(|data| !data.is_empty() && data.bytes().all(|c| c.is_ascii_alphanumeric() || b"+/=\r\n ".contains(&c)))
    })
}

// Escaped/commented CSS and imports need a local-resource decision, not an
// improvised stylesheet parser. Plain CSS/internal references remain usable.
fn check_css(value: &str) -> Result<()> {
    ensure!(!value.contains(['\\', '@']) && !value.contains("/*") && !value.contains("*/"), "CSS_RESOURCE_BINDING_REQUIRED");
    let lower = value.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(offset) = rest.find("url") {
        rest = rest[offset + 3..].trim_start();
        if !rest.starts_with('(') { continue; }
        let end = rest.find(')').ok_or_else(|| anyhow!("CSS_RESOURCE_INVALID"))?;
        let reference = rest[1..end].trim().trim_matches(['\'', '"']);
        ensure!(local_reference(reference), "GRAPHIC_EXTERNAL_RESOURCE_LOCAL_BINDING_REQUIRED");
        rest = &rest[end + 1..];
    }
    Ok(())
}

fn check_svg(svg: &str) -> Result<()> {
    ensure!(svg.len() <= SVG_LIMIT, "GRAPHIC_PAYLOAD_LIMIT");
    let mut reader = Reader::from_str(svg);
    reader.config_mut().check_comments = true;
    let mut depth = 0usize;
    let mut nodes = 0usize;
    let mut roots = 0usize;
    let mut style_depth = None;
    loop {
        let event = reader.read_event()?;
        match event {
            Event::Start(ref element) | Event::Empty(ref element) => {
                nodes += 1;
                ensure!(nodes <= 100000 && depth < 256, "GRAPHIC_XML_LIMIT");
                let name = element.name().as_ref().to_owned();
                ensure!(!name.contains(':') && !["script", "foreignobject", "set", "animate", "animatemotion", "animatetransform", "animation"].contains(&name.to_ascii_lowercase().as_str()), "GRAPHIC_DYNAMIC_OR_FOREIGN_CONTENT");
                if depth == 0 { roots += 1; ensure!(roots == 1 && name == "svg", "GRAPHIC_ROOT_INVALID"); }
                for attribute in element.attributes() {
                    let attribute = attribute?;
                    let key = attribute.key.as_ref();
                    let value = attribute.unescape_value()?;
                    ensure!(!key.to_ascii_lowercase().starts_with("on") && key != "xml:base", "GRAPHIC_ACTIVE_CONTENT");
                    if key == "xmlns" { ensure!(value == "http://www.w3.org/2000/svg", "GRAPHIC_NAMESPACE_INVALID"); }
                    else if key == "xmlns:xlink" { ensure!(value == "http://www.w3.org/1999/xlink", "GRAPHIC_NAMESPACE_INVALID"); }
                    else {
                        ensure!(!key.contains(':') || ["xlink:href", "xml:space", "xml:lang"].contains(&key), "GRAPHIC_NAMESPACE_BINDING_REQUIRED");
                        if key == "href" || key == "xlink:href" { ensure!(local_reference(&value), "GRAPHIC_EXTERNAL_RESOURCE_LOCAL_BINDING_REQUIRED"); }
                        if ["style", "fill", "stroke", "filter", "mask", "clip-path", "marker", "marker-start", "marker-mid", "marker-end", "cursor"].contains(&key) { check_css(&value)?; }
                    }
                }
                if matches!(event, Event::Start(_)) {
                    depth += 1;
                    if name == "style" { ensure!(style_depth.is_none(), "GRAPHIC_STYLE_INVALID"); style_depth = Some(depth); }
                }
            }
            Event::End(_) => { if style_depth == Some(depth) { style_depth = None; } depth = depth.checked_sub(1).ok_or_else(|| anyhow!("GRAPHIC_XML_INVALID"))?; }
            Event::Text(text) if style_depth.is_some() => check_css(&text.xml10_content())?,
            Event::Text(text) if depth == 0 => ensure!(text.xml10_content().trim().is_empty(), "GRAPHIC_ROOT_TEXT_INVALID"),
            Event::CData(text) if style_depth.is_some() => check_css(&text.xml10_content())?,
            Event::CData(_) if depth == 0 => return Err(anyhow!("GRAPHIC_ROOT_TEXT_INVALID")),
            Event::GeneralRef(_) if style_depth.is_some() => return Err(anyhow!("GRAPHIC_CSS_ENTITY_BINDING_REQUIRED")),
            Event::GeneralRef(_) if depth == 0 => return Err(anyhow!("GRAPHIC_ROOT_TEXT_INVALID")),
            Event::DocType(_) | Event::PI(_) | Event::Decl(_) => return Err(anyhow!("GRAPHIC_EXTERNAL_XML_REFUSED")),
            Event::Eof => break,
            _ => {}
        }
    }
    ensure!(roots == 1 && depth == 0, "GRAPHIC_XML_INVALID");
    Ok(())
}

fn render(request: &Request) -> Result<Vec<u8>> {
    ensure!(request.version == 1 && (2..=3840).contains(&request.width) && (2..=2160).contains(&request.height), "GRAPHIC_GEOMETRY_INVALID");
    check_svg(&request.svg)?;
    gst::init()?;
    let pipeline = gst::Pipeline::new();
    struct Stop(gst::Pipeline);
    impl Drop for Stop { fn drop(&mut self) { let _ = self.0.set_state(gst::State::Null); } }
    let _stop = Stop(pipeline.clone());
    let source = gst::ElementFactory::make("videotestsrc").property("num-buffers", 1i32).property_from_str("pattern", "black").build()?;
    let caps = gst::Caps::builder("video/x-raw").field("format", "RGBA").field("width", request.width).field("height", request.height).field("framerate", gst::Fraction::new(1, 1)).field("pixel-aspect-ratio", gst::Fraction::new(1, 1)).build();
    let filter = gst::ElementFactory::make("capsfilter").property("caps", &caps).build()?;
    let overlay = gst::ElementFactory::make("rsvgoverlay").property("fit-to-frame", true).property("data", &request.svg).build()?;
    let sink = gst_app::AppSink::builder().caps(&caps).sync(false).max_buffers(1).build();
    pipeline.add_many([&source, &filter, &overlay, sink.upcast_ref()])?;
    gst::Element::link_many([&source, &filter, &overlay, sink.upcast_ref()])?;
    pipeline.set_state(gst::State::Playing)?;
    let sample = sink.try_pull_sample(gst::ClockTime::from_seconds(10)).ok_or_else(|| anyhow!("GRAPHIC_FRAME_MISSING"))?;
    let actual = sample.caps().and_then(|caps| caps.structure(0)).ok_or_else(|| anyhow!("GRAPHIC_CAPS_MISSING"))?;
    ensure!(actual.get::<i32>("width")? == request.width && actual.get::<i32>("height")? == request.height && actual.get::<String>("format")? == "RGBA", "GRAPHIC_CAPS_INVALID");
    let buffer = sample.buffer().ok_or_else(|| anyhow!("GRAPHIC_FRAME_MISSING"))?;
    let map = buffer.map_readable()?;
    let expected = request.width as usize * request.height as usize * 4;
    ensure!(map.size() == expected, "GRAPHIC_FRAME_SIZE_INVALID");
    let bus = pipeline.bus().ok_or_else(|| anyhow!("GRAPHIC_BUS_MISSING"))?;
    for message in bus.iter() { if matches!(message.view(), gst::MessageView::Error(_) | gst::MessageView::Warning(_)) { return Err(anyhow!("GRAPHIC_RENDER_DIAGNOSTIC")); } }
    Ok(map.as_slice().to_vec())
}

fn main() {
    let result = (|| -> Result<()> {
        let mut bytes = Vec::new();
        std::io::stdin().take((SVG_LIMIT * 6 + 1024) as u64 + 1).read_to_end(&mut bytes)?;
        ensure!(bytes.len() <= SVG_LIMIT * 6 + 1024, "GRAPHIC_REQUEST_LIMIT");
        let request: Request = serde_json::from_slice(&bytes)?;
        let pixels = render(&request)?;
        let header = serde_json::json!({"version":1,"ok":true,"width":request.width,"height":request.height,"format":"RGBA","decodedFrames":1,"pixelBytes":pixels.len()});
        let mut output = std::io::stdout().lock();
        writeln!(output, "{header}")?;
        output.write_all(&pixels)?;
        output.flush()?;
        Ok(())
    })();
    if result.is_err() { eprintln!("GRAPHIC_RENDER_FAILED"); std::process::exit(1); }
}

#[cfg(test)]
mod tests {
    use super::*;
    // NOT_RUN: prepared with the batch; neither XML nor GStreamer executed.
    #[test] fn local_geometry_and_internal_links() { assert!(check_svg("<svg xmlns=\"http://www.w3.org/2000/svg\"><defs><path id=\"x\"/></defs><use href=\"#x\"/></svg>").is_ok()); }
    #[test] fn encoded_external_resource_and_active_content_refused() {
        for svg in ["<svg><image href=\"&#102;ile:///C:/private.png\"/></svg>", "<svg xml:base=\"file:///C:/\"/>", "<svg><style>@import 'private.css';</style></svg>", "<svg><animate attributeName=\"href\" values=\"file:///private\"/></svg>", "<!DOCTYPE svg><svg/>", "<svg><script/></svg>"] { assert!(check_svg(svg).is_err()); }
    }
}
