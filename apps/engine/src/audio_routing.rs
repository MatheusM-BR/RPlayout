//! Input routing before stereo gain/meter/limiter. Missing channels are errors,
//! never a fallback to another pair. DEFAULT preserves GStreamer's old mix.
use anyhow::{anyhow,Result};
use gstreamer as gst;
use gst::prelude::*;
use serde::{Serialize,Deserialize};

#[derive(Debug,Clone,Default,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="SCREAMING_SNAKE_CASE")]
pub enum RoutingMode { #[default] Default,#[serde(rename="STEREO_1_2")] Stereo1_2,#[serde(rename="STEREO_3_4")] Stereo3_4,DownmixMono,LeftOnly,RightOnly,Matrix,PairMix }
#[derive(Debug,Clone,Default,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AudioRouting {
    pub mode:RoutingMode,
    #[serde(default)] pub matrix:Option<Vec<Vec<f32>>>,
    #[serde(default)] pub pairs:Option<Vec<usize>>,
}
impl AudioRouting {
    pub fn required(&self)->bool {self.mode!=RoutingMode::Default}
    pub fn validate(&self)->Result<()> {
        if self.mode==RoutingMode::Matrix {
            let m=self.matrix.as_ref().ok_or_else(||anyhow!("matriz de áudio ausente"))?;
            if m.len()!=2 || m[0].is_empty() || m[0].len()>64 || m[1].len()!=m[0].len() || m.iter().flatten().any(|v|!v.is_finite()||v.abs()>1.0){return Err(anyhow!("matriz exige 2 linhas iguais, 1..64 canais e coeficientes -1..1"));}
        } else if self.matrix.is_some(){return Err(anyhow!("matriz enviada fora do modo MATRIX"));}
        if self.mode==RoutingMode::PairMix {
            let p=self.pairs.as_ref().ok_or_else(||anyhow!("pares de áudio ausentes"))?;
            if p.is_empty() || p.len()>32 || p.iter().any(|i|*i>31) || p.iter().collect::<std::collections::HashSet<_>>().len()!=p.len(){return Err(anyhow!("pares de áudio inválidos/repetidos"));}
        } else if self.pairs.is_some(){return Err(anyhow!("pares enviados fora do modo PAIR_MIX"));}
        Ok(())
    }
    pub fn required_channels(&self)->Result<usize> {
        self.validate()?;
        Ok(match self.mode {RoutingMode::Default=>0,RoutingMode::Stereo3_4=>4,RoutingMode::LeftOnly=>1,RoutingMode::Matrix=>self.matrix.as_ref().unwrap()[0].len(),RoutingMode::PairMix=>self.pairs.as_ref().unwrap().iter().max().unwrap()*2+2,_=>2})
    }
    pub fn coefficients(&self,channels:usize)->Result<Option<Vec<Vec<f32>>>> {
        let required=self.required_channels()?;
        if channels==0 || channels>64{return Err(anyhow!("número de canais de áudio fora do limite 1..64"));}
        if self.mode==RoutingMode::Default{return Ok(None);}
        if required>channels || self.mode==RoutingMode::Matrix && required!=channels{return Err(anyhow!("roteamento exige {required} canais; entrada declarou {channels}; PGM anterior preservado"));}
        let mut m=vec![vec![0.0;channels];2];
        match self.mode {
            RoutingMode::Default=>{},
            RoutingMode::Stereo1_2=>{m[0][0]=1.0;m[1][1]=1.0;},
            RoutingMode::Stereo3_4=>{m[0][2]=1.0;m[1][3]=1.0;},
            RoutingMode::DownmixMono=>{for row in &mut m {row[0]=0.5;row[1]=0.5;}},
            RoutingMode::LeftOnly=>{m[0][0]=1.0;m[1][0]=1.0;},
            RoutingMode::RightOnly=>{m[0][1]=1.0;m[1][1]=1.0;},
            RoutingMode::Matrix=>m=self.matrix.clone().unwrap(),
            RoutingMode::PairMix=>{let p=self.pairs.as_ref().unwrap();let weight=1.0/p.len() as f32;for pair in p {m[0][pair*2]=weight;m[1][pair*2+1]=weight;}},
        }
        Ok(Some(m))
    }
    pub fn configure(&self,convert:&gst::Element,caps:&gst::CapsRef)->Result<()> {
        if !self.required(){return Ok(());}
        let channels=caps.structure(0).and_then(|s|s.get::<i32>("channels").ok()).ok_or_else(||anyhow!("entrada ainda não declarou canais de áudio"))?;
        if let Some(m)=self.coefficients(channels as usize)? {convert.set_property("mix-matrix",gst::Array::new(m.into_iter().map(gst::Array::new)));}
        Ok(())
    }
}

#[cfg(test)]mod tests {
    use super::*;
    fn route(mode:RoutingMode)->AudioRouting {AudioRouting{mode,..Default::default()}}
    #[test]fn modes_and_missing_pair(){
        assert_eq!(route(RoutingMode::Stereo3_4).coefficients(4).unwrap().unwrap(),vec![vec![0.,0.,1.,0.],vec![0.,0.,0.,1.]]);
        assert!(route(RoutingMode::Stereo3_4).coefficients(2).is_err());
        assert_eq!(route(RoutingMode::DownmixMono).coefficients(2).unwrap().unwrap(),vec![vec![0.5,0.5],vec![0.5,0.5]]);
        assert_eq!(route(RoutingMode::RightOnly).coefficients(2).unwrap().unwrap(),vec![vec![0.,1.],vec![0.,1.]]);
        assert!(route(RoutingMode::Default).coefficients(2).unwrap().is_none());
    }
    #[test]fn custom_validation(){
        for matrix in [vec![vec![];2],vec![vec![1.],vec![1.,0.]],vec![vec![f32::NAN];2],vec![vec![2.];2]] {assert!(AudioRouting{mode:RoutingMode::Matrix,matrix:Some(matrix),pairs:None}.validate().is_err());}
        let valid=AudioRouting{mode:RoutingMode::Matrix,matrix:Some(vec![vec![-1.,0.],vec![0.,1.]]),pairs:None};assert!(valid.coefficients(4).is_err());assert!(valid.coefficients(2).is_ok());
    }
    #[test]fn legacy_pair_mix_is_normalized_and_requires_all_selected_pairs(){
        let r=AudioRouting{mode:RoutingMode::PairMix,pairs:Some(vec![0,1]),matrix:None};
        assert_eq!(r.coefficients(4).unwrap().unwrap(),vec![vec![0.5,0.,0.5,0.],vec![0.,0.5,0.,0.5]]);assert!(r.coefficients(2).is_err());
    }
    #[test]fn real_gstreamer_samples_follow_matrix_before_gain_and_measurement(){
        gst::init().unwrap();
        let caps=gst::Caps::builder("audio/x-raw").field("format","F32LE").field("layout","interleaved").field("rate",48000i32).field("channels",4i32).field("channel-mask",gst::Bitmask::new(0)).build();
        let routes=[
            (route(RoutingMode::Stereo3_4),[0.3,0.4]),
            (route(RoutingMode::Stereo1_2),[0.1,0.2]),
            (route(RoutingMode::DownmixMono),[0.15,0.15]),
            (route(RoutingMode::LeftOnly),[0.1,0.1]),
            (route(RoutingMode::RightOnly),[0.2,0.2]),
            (AudioRouting{mode:RoutingMode::Matrix,matrix:Some(vec![vec![0.,0.,-1.,0.],vec![0.5,0.5,0.,0.]]),pairs:None},[-0.3,0.15]),
        ];
        for (routing,expected) in routes {
            let pipeline=gst::Pipeline::new();
            let source=gst::ElementFactory::make("appsrc").build().unwrap().downcast::<gstreamer_app::AppSrc>().unwrap();source.set_caps(Some(&caps));
            let convert=gst::ElementFactory::make("audioconvert").build().unwrap();routing.configure(&convert,&caps).unwrap();
            let filter=gst::ElementFactory::make("capsfilter").build().unwrap();filter.set_property("caps",gst::Caps::builder("audio/x-raw").field("format","F32LE").field("layout","interleaved").field("rate",48000i32).field("channels",2i32).build());
            let sink=gst::ElementFactory::make("appsink").property("sync",false).build().unwrap().downcast::<gstreamer_app::AppSink>().unwrap();
            pipeline.add_many([source.upcast_ref(),&convert,&filter,sink.upcast_ref()]).unwrap();gst::Element::link_many([source.upcast_ref(),&convert,&filter,sink.upcast_ref()]).unwrap();
            pipeline.set_state(gst::State::Playing).unwrap();
            let bytes:Vec<u8>=(0..1024).flat_map(|_|[0.1f32,0.2,0.3,0.4].into_iter().flat_map(f32::to_le_bytes)).collect();
            source.push_buffer(gst::Buffer::from_mut_slice(bytes)).unwrap();source.end_of_stream().unwrap();
            let sample=sink.try_pull_sample(gst::ClockTime::from_seconds(3));
            pipeline.set_state(gst::State::Null).unwrap();
            let sample=sample.expect("audioconvert não produziu amostras estéreo");
            assert_eq!(sample.caps().unwrap().structure(0).unwrap().get::<i32>("channels").unwrap(),2);
            let map=sample.buffer().unwrap().map_readable().unwrap();
            for frame in map.as_slice().chunks_exact(8){for channel in 0..2{let value=f32::from_le_bytes(frame[channel*4..channel*4+4].try_into().unwrap());assert!((value-expected[channel]).abs()<0.00001,"{:?}: {channel}={value}, esperado {}",routing.mode,expected[channel]);}}
        }
    }
}
