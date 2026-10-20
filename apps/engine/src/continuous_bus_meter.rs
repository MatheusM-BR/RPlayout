//! Attribute compensated PCM to declared cuts without resetting shared DSP.
//! Source coverage and real transitions must be proven by the renderer.
use anyhow::{anyhow,Result};
use crate::{continuous_bus::ContinuousBus,loudness::Meter};

pub struct ContinuousBusMeter{
    bus:ContinuousBus,channels:usize,frames:Vec<u64>,output_segment:usize,
    segment_output:u64,output:u64,segment_meters:Vec<Meter>,total_meters:Vec<Meter>,
    readings:Vec<serde_json::Value>,finished:bool,
}
impl ContinuousBusMeter{
    pub fn new(channels:usize,ceiling:f64,frames:Vec<u64>)->Result<Self>{
        if frames.iter().any(|frames|*frames<19200){return Err(anyhow!("corte contínuo exige ao menos 400 ms para loudness"));}
        let bus=ContinuousBus::new(channels,ceiling,frames.clone())?;
        let meters=|| (0..channels/2).map(|_|Meter::new(48000,2)).collect();
        Ok(Self{bus,channels,frames,output_segment:0,segment_output:0,output:0,segment_meters:meters(),total_meters:meters(),readings:Vec::new(),finished:false})
    }
    fn pairs(meters:&mut[Meter],frames:u64)->Vec<serde_json::Value>{
        meters.iter_mut().enumerate().map(|(index,meter)|{let reading=meter.read();serde_json::json!({"outputPair":index+1,"sampleFrames":frames,"integratedLufs":reading.integrated_lufs,"lra":reading.range_lu,"truePeakDbtp":reading.true_peak_dbtp})}).collect()
    }
    fn measure(&mut self,first:u64,values:&[f32])->Result<()>{
        if first!=self.output||values.len()%self.channels!=0{return Err(anyhow!("ordinal PCM compensado divergente"));}
        let mut cursor=0;
        while cursor<values.len(){
            let expected=*self.frames.get(self.output_segment).ok_or_else(||anyhow!("PCM ultrapassou sequência"))?;
            let frames=((values.len()-cursor)/self.channels).min((expected-self.segment_output)as usize);
            let chunk=&values[cursor..cursor+frames*self.channels];
            for pair in 0..self.channels/2{
                let stereo:Vec<f32>=chunk.chunks_exact(self.channels).flat_map(|frame|frame[pair*2..pair*2+2].iter().copied()).collect();
                self.segment_meters[pair].push(&stereo);self.total_meters[pair].push(&stereo);
            }
            self.output+=frames as u64;self.segment_output+=frames as u64;cursor+=frames*self.channels;
            if self.segment_output==expected{
                let pairs=Self::pairs(&mut self.segment_meters,expected);
                self.readings.push(serde_json::json!({"segmentIndex":self.output_segment,"firstFrame":self.output-expected,"sampleFrames":expected,"pairs":pairs}));
                self.output_segment+=1;self.segment_output=0;
                self.segment_meters=(0..self.channels/2).map(|_|Meter::new(48000,2)).collect();
            }
        }Ok(())
    }
    pub fn push(&mut self,index:usize,values:&mut[f32])->Result<()>{
        if self.finished{return Err(anyhow!("medição contínua encerrada"));}
        let output=self.bus.push(index,values)?;
        if let Err(error)=self.measure(output.first_frame,output.pcm){self.finished=true;return Err(error);}Ok(())
    }
    pub fn finish(&mut self)->Result<serde_json::Value>{
        if self.finished{return Err(anyhow!("medição contínua encerrada"));}
        let tail=self.bus.finish()?;self.finished=true;self.measure(tail.first_frame,&tail.pcm)?;
        if self.output_segment!=self.frames.len()||self.output!=tail.total_frames||self.segment_output!=0{return Err(anyhow!("medição não cobre sequência integral"));}
        let pairs=Self::pairs(&mut self.total_meters,self.output);
        Ok(serde_json::json!({"kind":"CONTINUOUS_DSP_SEQUENCE","rate":48000,"channels":self.channels,"sampleFrames":self.output,"segments":self.readings,"pairs":pairs,"startupFramesRemoved":tail.startup_frames_removed,"flushedFrames":tail.flushed_frames,"limiterReductionDb":tail.limiter_reduction_db,"initialState":"RESET_ONCE","statePreservedAcrossCuts":true,"sourceCoverageConfirmed":false,"nativeTransitionQualified":false,"avQualified":false,"editorialApproved":false,"publicationAuthorized":false}))
    }
}

#[cfg(test)]mod tests{
    use super::*;
    // NOT_RUN: attribution contracts, not source/render/hardware proof.
    #[test]fn delayed_pcm_is_attributed_to_original_cut_without_extra_frames(){
        for channels in [2,8,16]{
            let mut meter=ContinuousBusMeter::new(channels,-1.0,vec![19200,24000]).unwrap();
            for(index,frames)in [19200usize,24000].into_iter().enumerate(){
                let mut input=vec![0.0;frames*channels];
                // Only the end of first cut has signal: its delayed PCM must
                // remain attributed to cut 0 even when emitted during cut 1.
                if index==0{input[(frames-240)*channels..].fill(0.25);}
                for chunk in input.chunks_mut(137*channels){meter.push(index,chunk).unwrap();}
            }
            let value=meter.finish().unwrap();assert_eq!(value["sampleFrames"].as_u64(),Some(43200));
            let segments=value["segments"].as_array().unwrap();assert_eq!(segments.len(),2);
            assert_eq!(segments[0]["firstFrame"].as_u64(),Some(0));assert_eq!(segments[0]["sampleFrames"].as_u64(),Some(19200));
            assert_eq!(segments[1]["firstFrame"].as_u64(),Some(19200));assert_eq!(segments[1]["sampleFrames"].as_u64(),Some(24000));
            assert!(segments[0]["pairs"][0]["truePeakDbtp"].as_f64().unwrap()>-20.0);
            assert!(segments[1]["pairs"][0]["truePeakDbtp"].as_f64().unwrap()<-50.0);
            assert_eq!(value["sourceCoverageConfirmed"],false);assert_eq!(value["publicationAuthorized"],false);assert!(meter.finish().is_err());
        }
    }
    #[test]fn incomplete_or_short_cut_never_has_complete_measurement(){
        assert!(ContinuousBusMeter::new(2,-1.0,vec![19199]).is_err());
        let mut meter=ContinuousBusMeter::new(2,-1.0,vec![19200]).unwrap();let mut pcm=vec![0.0;9600*2];meter.push(0,&mut pcm).unwrap();assert!(meter.finish().is_err());
    }
}
