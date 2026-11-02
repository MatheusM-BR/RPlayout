//! Streaming offline bus DSP for a declared sequence of already-rendered cuts.
//! One limiter state, one startup removal, one final flush. Not PGM/AV proof.
use anyhow::{anyhow,Result};
use crate::limiter::BusLimiter;

pub struct OutputChunk<'a>{pub first_frame:u64,pub pcm:&'a[f32]}
pub struct FinalChunk{pub first_frame:u64,pub pcm:Vec<f32>,pub total_frames:u64,pub startup_frames_removed:usize,pub flushed_frames:usize,pub limiter_reduction_db:f64}
pub struct ContinuousBus{
    channels:usize,limiter:BusLimiter,segments:Vec<u64>,segment:usize,
    segment_input:u64,total:u64,input:u64,output:u64,skip:usize,
    reduction:f64,finished:bool,
}
impl ContinuousBus{
    pub fn new(channels:usize,ceiling:f64,segments:Vec<u64>)->Result<Self>{
        if ![2,8,16].contains(&channels)||segments.is_empty()||segments.len()>100000||segments.contains(&0){return Err(anyhow!("sequência de bus inválida"));}
        let total=segments.iter().try_fold(0u64,|sum,frames|sum.checked_add(*frames)).ok_or_else(||anyhow!("sequência excede contagem"))?;
        let limiter=BusLimiter::new(48000,channels,ceiling,channels>2).map_err(|error|anyhow!("{error}"))?;
        let skip=limiter.delay_frames();
        Ok(Self{channels,limiter,segments,segment:0,segment_input:0,total,input:0,output:0,skip,reduction:0.0,finished:false})
    }
    /// Each buffer belongs to exactly one declared cut. No invented gap or
    /// crossfade; renderer must supply actual mixed PCM and source coverage.
    pub fn push<'a>(&mut self,index:usize,values:&'a mut[f32])->Result<OutputChunk<'a>>{
        if self.finished||index!=self.segment||self.segment>=self.segments.len()||values.is_empty()||values.len()%self.channels!=0||values.len()/self.channels>48000||values.iter().any(|value|!value.is_finite()){return Err(anyhow!("PCM/ordem da sequência inválidos"));}
        let frames=(values.len()/self.channels)as u64;
        if frames>self.segments[index]-self.segment_input{return Err(anyhow!("PCM ultrapassa o corte declarado"));}
        self.limiter.process(values).map_err(|error|anyhow!("{error}"))?;
        if values.iter().any(|value|!value.is_finite()){self.finished=true;return Err(anyhow!("bus contínuo não finito"));}
        self.reduction=self.reduction.max(self.limiter.take_reduction_db());
        self.segment_input+=frames;self.input+=frames;
        if self.segment_input==self.segments[index]{self.segment+=1;self.segment_input=0;}
        let skip=self.skip.min(frames as usize);self.skip-=skip;
        let first_frame=self.output;self.output+=frames-skip as u64;
        Ok(OutputChunk{first_frame,pcm:&values[skip*self.channels..]})
    }
    /// Flush only at the end of the entire declared sequence, not at each cut.
    pub fn finish(&mut self)->Result<FinalChunk>{
        if self.finished||self.segment!=self.segments.len()||self.input!=self.total{return Err(anyhow!("sequência incompleta ou encerrada"));}
        self.finished=true;let delay=self.limiter.delay_frames();
        let mut tail=vec![0.0;delay*self.channels];self.limiter.process(&mut tail).map_err(|error|anyhow!("{error}"))?;
        if tail.iter().any(|value|!value.is_finite()){return Err(anyhow!("cauda contínua não finita"));}
        self.reduction=self.reduction.max(self.limiter.take_reduction_db());
        let skip=self.skip.min(delay);self.skip-=skip;let pcm=tail[skip*self.channels..].to_vec();
        let first_frame=self.output;self.output+=(pcm.len()/self.channels)as u64;
        if self.skip!=0||self.output!=self.total{return Err(anyhow!("cobertura contínua divergente"));}
        Ok(FinalChunk{first_frame,pcm,total_frames:self.total,startup_frames_removed:delay,flushed_frames:delay,limiter_reduction_db:self.reduction})
    }
}

#[cfg(test)]mod tests{
    use super::*;
    // NOT_RUN: shared DSP contracts; not a native transition or hardware proof.
    #[test]fn cuts_preserve_one_limiter_state_and_exact_compensated_pcm(){
        for channels in [2,8,16]{
            let mut sequence=ContinuousBus::new(channels,-1.0,vec![1000,2000]).unwrap();
            let input:Vec<f32>=(0..3000*channels).map(|sample|if sample/channels<1000{3.0}else{0.1}).collect();
            let mut reference=input.clone();let mut limiter=BusLimiter::new(48000,channels,-1.0,channels>2).unwrap();
            limiter.process(&mut reference).unwrap();let mut tail=vec![0.0;240*channels];limiter.process(&mut tail).unwrap();
            let expected:[Vec<f32>;2]=[reference[240*channels..].to_vec(),tail];let expected=expected.concat();
            let mut actual=Vec::new();let mut cursor=0;
            for(index,frames)in [1000,2000].into_iter().enumerate(){
                let mut cut=input[cursor*channels..(cursor+frames)*channels].to_vec();
                for buffer in cut.chunks_mut(137*channels){let output=sequence.push(index,buffer).unwrap();assert_eq!(output.first_frame,(actual.len()/channels)as u64);actual.extend_from_slice(output.pcm);}
                cursor+=frames;
            }
            let tail=sequence.finish().unwrap();assert_eq!(tail.first_frame,(actual.len()/channels)as u64);actual.extend(tail.pcm);
            assert_eq!(actual,expected);assert_eq!(tail.total_frames,3000);assert_eq!(tail.startup_frames_removed,240);assert_eq!(tail.flushed_frames,240);assert!(tail.limiter_reduction_db>0.0);
            assert!(sequence.finish().is_err());
        }
    }
    #[test]fn rejects_reordering_partial_frames_overrun_and_incomplete_sequence(){
        let mut bus=ContinuousBus::new(8,-1.0,vec![10,10]).unwrap();
        assert!(bus.push(1,&mut[0.0;8]).is_err());assert!(bus.push(0,&mut[0.0;7]).is_err());assert!(bus.push(0,&mut[0.0;88]).is_err());
        bus.push(0,&mut[0.0;80]).unwrap();assert!(bus.finish().is_err());assert!(bus.push(0,&mut[0.0;8]).is_err());
        bus.push(1,&mut[0.0;80]).unwrap();assert_eq!(bus.finish().unwrap().total_frames,20);
    }
}
