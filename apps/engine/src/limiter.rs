//! Limiter de pico verdadeiro da saída de programa.
//!
//! É rede de proteção, não ferramenta de mixagem. Quem põe o programa no alvo
//! é o nivelamento por item, calculado com folga para o teto; o limiter existe
//! para o caso de alguém errar, de um item entrar sem medição, ou de uma fonte
//! ao vivo passar do ponto. Se ele estiver trabalhando o tempo todo, o problema
//! está no nivelamento -- e é por isso que a redução de ganho é uma métrica de
//! primeira classe na interface, e não um número escondido.
//!
//! Limita por **pico verdadeiro**, com o mesmo sobreamostrador do medidor: não
//! adianta medir por um critério e limitar por outro. Um limiter de pico de
//! amostra deixa passar o que o conversor do destino vai distorcer.
//!
//! O preço é `lookahead` de atraso no áudio: para baixar o ganho *antes* do
//! pico chegar, é preciso já ter visto o pico. Com cinco milissegundos, o áudio
//! fica cinco milissegundos atrás do vídeo -- menos do que a distância de um
//! metro e meio até a caixa de som, e muito dentro da tolerância da EBU R37
//! (+40 ms a -60 ms). Não vale compensar o vídeo por isso.

use std::collections::VecDeque;

use crate::loudness::TruePeak;

/// Shared defaults for live element and isolated qualification helper.
pub const DEFAULT_LOOKAHEAD_MS: f64 = 5.0;
pub const DEFAULT_RELEASE_MS: f64 = 50.0;

/// Margem abaixo do teto pedido.
///
/// O ataque é exponencial e não chega exatamente ao alvo dentro da janela de
/// lookahead; sobra da ordem de 0,06 dB. Um décimo de dB de folga cobre isso
/// com sobra, e é inaudível.
const HEADROOM_DB: f64 = 0.1;

/// Constante de ataque, como fração do lookahead. Um quinto dá cinco constantes
/// de tempo dentro da janela, que é o que faz o ganho chegar ao alvo a tempo.
const ATTACK_FRACTION: f64 = 0.2;

fn linear(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}

/// Coeficiente de um filtro de um polo para uma constante de tempo em amostras.
fn coefficient(samples: f64) -> f64 {
    if samples <= 0.0 {
        1.0
    } else {
        1.0 - (-1.0 / samples).exp()
    }
}

pub struct Limiter {
    channels: usize,
    /// Teto em linear, já com a margem de segurança descontada.
    ceiling: f64,
    /// Linha de atraso do sinal, por canal.
    delay: Vec<VecDeque<f32>>,
    /// Fila monotônica do mínimo deslizante: (índice, ganho desejado).
    pending: VecDeque<(u64, f64)>,
    window: u64,
    index: u64,
    gain: f64,
    attack: f64,
    release: f64,
    peak: TruePeak,
    /// Maior redução aplicada desde a última leitura, em dB.
    reduction_db: f64,
}

/// Shared interleaved bus kernel. Pair-linked buses protect each embedded
/// stereo pair independently; a hot auxiliary must not duck the master.
/// This is the actual streaming DSP, not a qualification/admission flag.
pub struct BusLimiter {
    channels:usize,
    link_channels:usize,
    limiters:Vec<Limiter>,
    pair:Vec<f32>,
}
impl BusLimiter {
    pub fn new(rate:u32,channels:usize,ceiling:f64,pair_linked:bool)->Result<Self,&'static str>{
        if rate==0||channels==0||channels>16||!ceiling.is_finite()||!(-30.0..=0.0).contains(&ceiling){return Err("caps/teto inválidos para limiter");}
        let link_channels=if pair_linked{2.min(channels)}else{channels};
        if channels%link_channels!=0{return Err("barramento de pares exige canais em número par");}
        Ok(Self{channels,link_channels,limiters:(0..channels/link_channels).map(|_|Limiter::new(rate,link_channels,ceiling,DEFAULT_LOOKAHEAD_MS,DEFAULT_RELEASE_MS)).collect(),pair:Vec::new()})
    }
    pub fn channels(&self)->usize{self.channels}
    pub fn delay_frames(&self)->usize{self.limiters[0].delay_frames()}
    pub fn set_ceiling(&mut self,ceiling:f64){for limiter in &mut self.limiters{limiter.set_ceiling(ceiling);}}
    pub fn take_reduction_db(&mut self)->f64{self.limiters.iter_mut().map(Limiter::take_reduction_db).fold(0.0,f64::max)}
    pub fn process(&mut self,samples:&mut[f32])->Result<(),&'static str>{
        if samples.len()%self.channels!=0{return Err("PCM não contém quadros completos do bus");}
        if self.limiters.len()==1{self.limiters[0].process(samples);return Ok(());}
        let frames=samples.len()/self.channels;
        self.pair.resize(frames*self.link_channels,0.0);
        for(index,limiter)in self.limiters.iter_mut().enumerate(){
            let start=index*self.link_channels;let end=start+self.link_channels;
            for(source,target)in samples.chunks_exact(self.channels).zip(self.pair.chunks_exact_mut(self.link_channels)){target.copy_from_slice(&source[start..end]);}
            limiter.process(&mut self.pair);
            for(target,source)in samples.chunks_exact_mut(self.channels).zip(self.pair.chunks_exact(self.link_channels)){target[start..end].copy_from_slice(source);}
        }
        Ok(())
    }
}

impl Limiter {
    /// Exact delay of this instance, shared with isolated tail measurement.
    pub fn delay_frames(&self) -> usize { self.window.saturating_sub(1) as usize }

    pub fn new(rate: u32, channels: usize, ceiling_dbtp: f64, lookahead_ms: f64, release_ms: f64) -> Self {
        let channels = channels.max(1);
        let lookahead = ((rate as f64) * lookahead_ms / 1000.0).round().max(1.0);

        Self {
            channels,
            ceiling: linear(ceiling_dbtp - HEADROOM_DB),
            delay: (0..channels)
                .map(|_| VecDeque::from(vec![0.0f32; lookahead as usize]))
                .collect(),
            pending: VecDeque::new(),
            // A janela cobre o lookahead inteiro mais a amostra atual: é o que
            // garante que o ganho da amostra que sai agora já viu o pico que
            // vai chegar daqui a `lookahead`.
            window: lookahead as u64 + 1,
            index: 0,
            gain: 1.0,
            attack: coefficient(lookahead * ATTACK_FRACTION),
            release: coefficient((rate as f64) * release_ms / 1000.0),
            peak: TruePeak::new(channels),
            reduction_db: 0.0,
        }
    }

    /// Processa no lugar, quadro a quadro, áudio intercalado.
    pub fn process(&mut self, samples: &mut [f32]) {
        for frame in samples.chunks_exact_mut(self.channels) {
            // Pico verdadeiro do quadro: o maior entre os canais, porque o
            // ganho é comum -- baixar só um canal moveria a imagem estéreo.
            let mut peak = 0.0f64;
            for (channel, sample) in frame.iter().enumerate() {
                let value = self.peak.push(channel, *sample as f64);
                if value > peak {
                    peak = value;
                }
            }

            let desired = if peak > self.ceiling && peak > 0.0 {
                self.ceiling / peak
            } else {
                1.0
            };

            // Mínimo deslizante em fila monotônica: O(1) amortizado, contra
            // O(janela) de varrer. Numa janela de 240 amostras a 48 kHz, a
            // diferença é entre custar nada e custar o dobro do encoder.
            while self.pending.back().is_some_and(|(_, value)| *value >= desired) {
                self.pending.pop_back();
            }
            self.pending.push_back((self.index, desired));
            while self
                .pending
                .front()
                .is_some_and(|(at, _)| self.index.saturating_sub(*at) >= self.window)
            {
                self.pending.pop_front();
            }
            let target = self.pending.front().map_or(1.0, |(_, value)| *value);

            // Ataque rápido, alívio lento. O ataque cabe dentro do lookahead,
            // então o ganho já está embaixo quando o pico chega.
            let rate = if target < self.gain { self.attack } else { self.release };
            self.gain += (target - self.gain) * rate;

            if self.gain < 1.0 {
                let reduction = -20.0 * self.gain.log10();
                if reduction > self.reduction_db {
                    self.reduction_db = reduction;
                }
            }

            for (channel, sample) in frame.iter_mut().enumerate() {
                let line = &mut self.delay[channel];
                line.push_back(*sample);
                let delayed = line.pop_front().unwrap_or(0.0);
                *sample = (delayed as f64 * self.gain) as f32;
            }

            self.index += 1;
        }
    }

    /// Maior redução desde a chamada anterior, em dB. Zero é o estado saudável.
    pub fn take_reduction_db(&mut self) -> f64 {
        std::mem::replace(&mut self.reduction_db, 0.0)
    }

    pub fn set_ceiling(&mut self, ceiling_dbtp: f64) {
        self.ceiling = linear(ceiling_dbtp - HEADROOM_DB);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::loudness::TruePeak;
    use std::f64::consts::PI;

    const RATE: u32 = 48_000;
    const CEILING: f64 = -1.0;

    // NOT_RUN in integration batch: shared bus kernel, no physical output proof.
    #[test] fn shared_bus_matches_independent_reference_pairs_across_buffers(){
        for channels in [2,8,16]{
            let mut bus=BusLimiter::new(RATE,channels,CEILING,channels>2).unwrap();
            let mut references:Vec<Limiter>=(0..channels/2).map(|_|Limiter::new(RATE,2,CEILING,DEFAULT_LOOKAHEAD_MS,DEFAULT_RELEASE_MS)).collect();
            assert_eq!(bus.delay_frames(),240);
            for frames in [64usize,512,97,1024]{
                let mut actual:Vec<f32>=(0..frames*channels).map(|sample|if sample%channels<2{0.1}else if sample%channels<4{3.0}else{0.0}).collect();
                let mut expected=actual.clone();
                for(pair,reference)in references.iter_mut().enumerate(){
                    let mut values:Vec<f32>=expected.chunks_exact(channels).flat_map(|frame|frame[pair*2..pair*2+2].iter().copied()).collect();
                    reference.process(&mut values);
                    for(frame,values)in expected.chunks_exact_mut(channels).zip(values.chunks_exact(2)){frame[pair*2..pair*2+2].copy_from_slice(values);}
                }
                bus.process(&mut actual).unwrap();assert_eq!(actual,expected);
                let reduction=references.iter_mut().map(Limiter::take_reduction_db).fold(0.0,f64::max);
                assert_eq!(bus.take_reduction_db(),reduction);
                if channels>2{assert!(actual.chunks_exact(channels).all(|frame|frame[0].abs()<=0.10001));}
            }
        }
    }
    #[test] fn bus_refuses_invalid_caps_and_partial_frames_before_processing(){
        for(rate,channels,ceiling,pairs)in [(0,2,-1.0,true),(48000,0,-1.0,true),(48000,17,-1.0,false),(48000,3,-1.0,true),(48000,8,f64::NAN,true),(48000,8,1.0,true)]{assert!(BusLimiter::new(rate,channels,ceiling,pairs).is_err());}
        let mut bus=BusLimiter::new(RATE,8,CEILING,true).unwrap();let mut invalid=vec![0.25;7];let original=invalid.clone();
        assert!(bus.process(&mut invalid).is_err());assert_eq!(invalid,original);
        assert_eq!(bus.take_reduction_db(),0.0);
    }

    fn sine(hz: f64, amplitude: f64, seconds: f64) -> Vec<f32> {
        let frames = (RATE as f64 * seconds) as usize;
        let mut out = Vec::with_capacity(frames * 2);
        for frame in 0..frames {
            let value = ((2.0 * PI * hz * frame as f64 / RATE as f64).sin() * amplitude) as f32;
            out.push(value);
            out.push(value);
        }
        out
    }

    /// Pico verdadeiro do trecho, pelo mesmo critério do limiter.
    fn true_peak_dbtp(samples: &[f32]) -> f64 {
        let mut oversampler = TruePeak::new(2);
        let mut peak = 0.0f64;
        for frame in samples.chunks_exact(2) {
            for (channel, sample) in frame.iter().enumerate() {
                peak = peak.max(oversampler.push(channel, *sample as f64));
            }
        }
        if peak > 0.0 {
            20.0 * peak.log10()
        } else {
            -90.0
        }
    }

    fn limit(samples: &mut [f32]) -> f64 {
        let mut limiter = Limiter::new(RATE, 2, CEILING, 5.0, 50.0);
        limiter.process(samples);
        limiter.take_reduction_db()
    }

    /// A razão de o limiter existir: o que sai não pode passar do teto.
    #[test]
    fn nada_passa_do_teto() {
        // Muito acima do teto, e numa frequência que não cai nas amostras --
        // é aí que o pico verdadeiro passa do pico de amostra.
        let mut hot = sine(11_700.0, 1.0, 1.0);
        limit(&mut hot);
        let out = true_peak_dbtp(&hot);
        assert!(out <= CEILING + 0.01, "saiu a {out:.3} dBTP, teto é {CEILING}");
    }

    /// E não pode mexer no que já estava abaixo do teto.
    #[test]
    fn sinal_comportado_passa_intacto() {
        let quiet = sine(1_000.0, 0.1, 0.5);
        let mut processed = quiet.clone();
        let reduction = limit(&mut processed);

        assert!(reduction < 0.01, "reduziu {reduction:.3} dB sem precisar");

        // O sinal sai atrasado pelo lookahead; comparar depois da janela.
        let lookahead = (RATE as f64 * 0.005) as usize;
        for (index, original) in quiet.chunks_exact(2).enumerate().skip(lookahead + 1) {
            let out = processed[index * 2];
            assert!(
                (out - original[0]).abs() < 1e-4,
                "amostra {index}: {out} contra {}",
                original[0]
            );
        }
    }

    /// O ganho tem que estar embaixo *antes* do pico chegar. Sem isso o
    /// limiter corta o transiente em vez de conduzi-lo, e isso se ouve.
    #[test]
    fn o_lookahead_chega_antes_do_transiente() {
        // Meio segundo baixo, depois um estouro.
        let mut samples = sine(1_000.0, 0.05, 0.5);
        samples.extend(sine(1_000.0, 1.0, 0.2));

        let lookahead = (RATE as f64 * 0.005) as usize;
        let boundary = (RATE as f64 * 0.5) as usize;

        let mut limiter = Limiter::new(RATE, 2, CEILING, 5.0, 50.0);
        limiter.process(&mut samples);

        // A saída está atrasada de `lookahead`: o estouro aparece na saída em
        // `boundary + lookahead`. Logo antes disso o ganho já tem que ter caído,
        // o que se vê no sinal baixo saindo mais baixo do que entrou.
        let before = samples[(boundary + lookahead - 20) * 2].abs();
        assert!(
            before < 0.05 * 0.9,
            "o ganho ainda não tinha caído quando o pico chegou: {before:.4}"
        );
    }

    /// Depois do estouro o ganho volta, senão o programa fica surdo.
    #[test]
    fn o_ganho_volta_depois_do_estouro() {
        let mut limiter = Limiter::new(RATE, 2, CEILING, 5.0, 50.0);

        let mut loud = sine(1_000.0, 1.0, 0.2);
        limiter.process(&mut loud);
        // Pico 1,0 contra teto de -1 dBTP pede pouco mais de 1 dB; o que
        // importa aqui é que reduziu, não quanto.
        assert!(limiter.take_reduction_db() > 0.5);

        // Meio segundo de alívio é dez constantes de tempo.
        let mut quiet = sine(1_000.0, 0.05, 0.5);
        limiter.process(&mut quiet);

        let last = quiet[(quiet.len() / 2 - 10) * 2].abs();
        let expected = 0.05;
        assert!(
            (last - expected).abs() < expected * 0.05,
            "o ganho não voltou: {last:.4} contra {expected:.4}"
        );
    }

    #[test]
    fn a_reducao_e_relatada_e_zerada() {
        let mut hot = sine(1_000.0, 1.0, 0.2);
        let mut limiter = Limiter::new(RATE, 2, CEILING, 5.0, 50.0);
        limiter.process(&mut hot);

        // Um seno de pico 1,0 contra teto de -1 dBTP pede cerca de 1 dB.
        let reduction = limiter.take_reduction_db();
        assert!((reduction - 1.1).abs() < 0.3, "reduziu {reduction:.3} dB");
        assert_eq!(limiter.take_reduction_db(), 0.0, "a leitura não zerou");
    }

    /// Ganho comum aos dois canais: baixar só um moveria a imagem estéreo.
    #[test]
    fn o_ganho_e_comum_aos_canais() {
        let frames = RATE as usize / 10;
        let mut samples = Vec::with_capacity(frames * 2);
        for frame in 0..frames {
            let phase = 2.0 * PI * 1_000.0 * frame as f64 / RATE as f64;
            // Esquerda estoura, direita não.
            samples.push((phase.sin() * 1.0) as f32);
            samples.push((phase.sin() * 0.2) as f32);
        }

        let original = samples.clone();
        limit(&mut samples);

        let lookahead = (RATE as f64 * 0.005) as usize;
        let index = frames / 2;
        let left = samples[index * 2] as f64 / original[(index - lookahead) * 2] as f64;
        let right = samples[index * 2 + 1] as f64 / original[(index - lookahead) * 2 + 1] as f64;
        assert!(
            (left - right).abs() < 1e-3,
            "canais com ganhos diferentes: {left:.4} contra {right:.4}"
        );
    }
}
