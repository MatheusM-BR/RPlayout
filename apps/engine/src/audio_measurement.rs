//! Sample-exact cuts and original PCM coverage shared by offline renderers.
//! Mixer-produced padding is never evidence that a source covered the cut.
use anyhow::{anyhow,Result};
#[derive(Clone,Copy,serde::Deserialize,serde::Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct MeasureTrim {pub in_ns:u64,pub out_ns:u64}
impl MeasureTrim {
    pub fn validate(self)->Result<()>{if self.out_ns<=self.in_ns||self.out_ns-self.in_ns<400_000_000{return Err(anyhow!("trecho inválido ou menor que 400 ms"));}Ok(())}
    pub fn expected_frames(self)->u64{(((self.out_ns-self.in_ns)as u128*48000)/1_000_000_000)as u64}
    pub fn slice(self,pts:u64,frames:usize)->(usize,usize){
        let offset=|boundary:u64|->usize{(((boundary.saturating_sub(pts)as u128*48000).div_ceil(1_000_000_000)).min(frames as u128))as usize};
        (offset(self.in_ns),offset(self.out_ns))
    }
}
#[derive(Default)]pub struct SampleClock {base:Option<u64>,frames:u64,rate:Option<u32>}
impl SampleClock {
    pub fn advance(&mut self,pts:u64,frames:usize,discont:bool)->Result<u64>{self.advance_at_rate(pts,frames,discont,48000)}
    pub fn advance_at_rate(&mut self,pts:u64,frames:usize,discont:bool,rate:u32)->Result<u64>{
        if rate==0||self.rate.is_some_and(|before|before!=rate){return Err(anyhow!("taxa PCM mudou durante medição"));}
        self.rate=Some(rate);let base=*self.base.get_or_insert(pts);
        let expected=base.checked_add(((self.frames as u128*1_000_000_000)/rate as u128)as u64).ok_or_else(||anyhow!("timeline de áudio excedeu limite"))?;
        // Container PTS may be quantized to milliseconds. Use actual sample
        // ordinal, reject declared discontinuities or drift >1ms, insert none.
        if self.frames>0&&(discont||pts.abs_diff(expected)>1_000_000){return Err(anyhow!("áudio descontínuo no trecho; medição descartada"));}
        self.frames=self.frames.checked_add(frames as u64).ok_or_else(||anyhow!("contagem de áudio excedeu limite"))?;Ok(expected)
    }
}
#[derive(Default)]pub struct RawPcmCoverage {clock:SampleClock,first:Option<u64>,end:Option<u64>,rate:Option<u32>}
impl RawPcmCoverage {
    pub fn push(&mut self,pts:u64,frames:usize,rate:u32,discont:bool,gap:bool)->Result<()>{
        if gap||frames==0{return Err(anyhow!("origem declarou gap ou PCM vazio"));}
        let time=self.clock.advance_at_rate(pts,frames,discont,rate)?;
        self.first.get_or_insert(time);self.rate=Some(rate);
        self.end=Some(time.checked_add(((frames as u128*1_000_000_000)/rate as u128)as u64).ok_or_else(||anyhow!("PCM excedeu timeline"))?);Ok(())
    }
    pub fn confirm(&self,trim:MeasureTrim)->Result<()>{
        trim.validate()?;let(first,end,rate)=match(self.first,self.end,self.rate){(Some(first),Some(end),Some(rate))=>(first,end,rate),_=>return Err(anyhow!("origem sem cobertura PCM"))};
        if first>trim.in_ns||end.saturating_add(1_000_000_000u64.div_ceil(rate as u64))<trim.out_ns{return Err(anyhow!("origem não cobre o corte; padding do mixer não comprova sinal"));}Ok(())
    }
}
#[cfg(test)]mod tests{
    use super::*;
    // NOT_RUN: timeline contracts, not native/hardware qualification.
    #[test]fn original_coverage_refuses_padding_gaps_and_rate_changes(){
        let trim=MeasureTrim{in_ns:0,out_ns:1_000_000_000};let mut source=RawPcmCoverage::default();
        source.push(0,24000,48000,true,false).unwrap();assert!(source.confirm(trim).is_err());
        assert!(source.push(500_000_000,24000,44100,false,false).is_err());
        source.push(500_000_000,24000,48000,false,false).unwrap();assert!(source.confirm(trim).is_ok());
        assert!(source.push(1_000_000_000,1,48000,false,true).is_err());
    }
}
