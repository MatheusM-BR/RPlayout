//! Medição de loudness pela ITU-R BS.1770-4 e EBU R128.
//!
//! Não existe elemento de EBU R128 nesta instalação do GStreamer -- só o
//! `level`, que entrega RMS, e RMS não é loudness: não tem a ponderação K nem
//! o gate, então dois programas com o mesmo RMS podem soar com volumes bem
//! diferentes. Como o nivelamento inteiro do RPlayout é em LUFS, medir errado
//! aqui contaminaria a única métrica que diz se o nivelamento está certo.
//!
//! Por isso a medição é feita aqui, sobre as amostras do mix.
//!
//! Memória fixa, de propósito: um canal de playout fica meses no ar, e guardar
//! um valor por bloco de 100 ms viraria gigabytes. O acumulado usa histograma
//! de 0,1 LU, que é como o gate e os percentis são calculados na prática --
//! o erro de quantização fica abaixo do que qualquer medidor mostra.

use std::collections::VecDeque;

/// Passo de análise: 100 ms. É a sobreposição de 75% do bloco de 400 ms.
const STEP_MS: usize = 100;
/// Bloco momentâneo: 400 ms.
const MOMENTARY_STEPS: usize = 4;
/// Bloco de curto prazo: 3 s.
const SHORT_STEPS: usize = 30;

/// Gate absoluto da R128. Bloco mais baixo que isto não entra na conta.
const ABSOLUTE_GATE: f64 = -70.0;
/// O gate relativo do integrado fica 10 LU abaixo da média não-gateada.
const INTEGRATED_RELATIVE: f64 = -10.0;
/// O da faixa de loudness, 20 LU.
const RANGE_RELATIVE: f64 = -20.0;

/// Piso do histograma, em LUFS, e resolução dos compartimentos.
const HIST_FLOOR: f64 = -70.0;
const HIST_STEP: f64 = 0.1;
const HIST_BINS: usize = 900;

/// Sobreamostragem do pico verdadeiro: 4x, 12 coeficientes por fase.
const OVERSAMPLE: usize = 4;
const PHASE_TAPS: usize = 12;

/// Deslocamento da BS.1770 entre potência ponderada e LUFS.
fn loudness(power: f64) -> f64 {
    if power <= 0.0 {
        return f64::NEG_INFINITY;
    }
    -0.691 + 10.0 * power.log10()
}

/// Biquad direto forma II transposta, em f64 para não acumular erro em horas.
#[derive(Clone, Copy)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Biquad {
    fn new(b0: f64, b1: f64, b2: f64, a1: f64, a2: f64) -> Self {
        Self { b0, b1, b2, a1, a2, z1: 0.0, z2: 0.0 }
    }

    fn run(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    /// Módulo da resposta em frequência. Serve para o teste provar que a
    /// ponderação K está de fato aplicada, sem depender de valor decorado.
    #[cfg(test)]
    fn magnitude(&self, hz: f64, rate: f64) -> f64 {
        use std::f64::consts::PI;
        let w = 2.0 * PI * hz / rate;
        let (cos1, sin1) = (w.cos(), w.sin());
        let (cos2, sin2) = ((2.0 * w).cos(), (2.0 * w).sin());
        let num_re = self.b0 + self.b1 * cos1 + self.b2 * cos2;
        let num_im = -(self.b1 * sin1 + self.b2 * sin2);
        let den_re = 1.0 + self.a1 * cos1 + self.a2 * cos2;
        let den_im = -(self.a1 * sin1 + self.a2 * sin2);
        ((num_re * num_re + num_im * num_im) / (den_re * den_re + den_im * den_im)).sqrt()
    }
}

/// Ponderação K: prateleira de agudos seguida do passa-altas RLB.
///
/// Os coeficientes da BS.1770 são tabelados para 48 kHz, que é a taxa do
/// canal. Reamostrar antes de medir seria pior do que medir na taxa certa.
#[derive(Clone, Copy)]
struct KWeighting {
    shelf: Biquad,
    highpass: Biquad,
}

impl KWeighting {
    fn new() -> Self {
        Self {
            shelf: Biquad::new(
                1.53512485958697,
                -2.69169618940638,
                1.19839281085285,
                -1.69065929318241,
                0.73248077421585,
            ),
            highpass: Biquad::new(1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621),
        }
    }

    fn run(&mut self, x: f64) -> f64 {
        self.highpass.run(self.shelf.run(x))
    }
}

/// Histograma de blocos por loudness, com a soma de potência de cada faixa.
///
/// Guardar a potência somada, e não só a contagem, é o que permite calcular a
/// média gateada exata dentro de cada faixa: o gate da R128 é média de
/// potência, não média de loudness.
struct Histogram {
    count: Vec<u64>,
    power: Vec<f64>,
    total_count: u64,
    total_power: f64,
}

impl Histogram {
    fn new() -> Self {
        Self {
            count: vec![0; HIST_BINS],
            power: vec![0.0; HIST_BINS],
            total_count: 0,
            total_power: 0.0,
        }
    }

    fn clear(&mut self) {
        self.count.iter_mut().for_each(|value| *value = 0);
        self.power.iter_mut().for_each(|value| *value = 0.0);
        self.total_count = 0;
        self.total_power = 0.0;
    }

    fn bin_for(level: f64) -> Option<usize> {
        if !level.is_finite() || level < ABSOLUTE_GATE {
            return None;
        }
        let index = ((level - HIST_FLOOR) / HIST_STEP).floor() as isize;
        if index < 0 {
            return None;
        }
        Some((index as usize).min(HIST_BINS - 1))
    }

    /// Só entra bloco acima do gate absoluto: o gate de -70 LUFS é aplicado
    /// aqui, na entrada, e não precisa ser refeito depois.
    fn add(&mut self, power: f64) {
        let Some(bin) = Self::bin_for(loudness(power)) else {
            return;
        };
        self.count[bin] += 1;
        self.power[bin] += power;
        self.total_count += 1;
        self.total_power += power;
    }

    /// Média de potência dos blocos acima de um limiar de loudness.
    fn mean_above(&self, threshold: f64) -> Option<f64> {
        let first = match Histogram::bin_for(threshold) {
            // O bloco tem que ser *maior* que o limiar, e a faixa do próprio
            // limiar é ambígua: começar na seguinte é o lado conservador.
            Some(bin) => bin + 1,
            None => 0,
        };
        if first >= HIST_BINS {
            return None;
        }
        let mut count = 0u64;
        let mut power = 0.0;
        for bin in first..HIST_BINS {
            count += self.count[bin];
            power += self.power[bin];
        }
        (count > 0).then(|| power / count as f64)
    }

    /// Loudness gateada: gate absoluto na entrada, relativo aqui.
    fn gated(&self, relative: f64) -> f64 {
        if self.total_count == 0 {
            return ABSOLUTE_GATE;
        }
        let absolute_mean = self.total_power / self.total_count as f64;
        let threshold = loudness(absolute_mean) + relative;
        match self.mean_above(threshold) {
            Some(mean) => loudness(mean),
            None => ABSOLUTE_GATE,
        }
    }

    /// Percentil das loudness dos blocos que passam do gate relativo.
    fn percentiles(&self, relative: f64, low: f64, high: f64) -> Option<(f64, f64)> {
        if self.total_count == 0 {
            return None;
        }
        let absolute_mean = self.total_power / self.total_count as f64;
        let threshold = loudness(absolute_mean) + relative;
        let first = Histogram::bin_for(threshold).map_or(0, |bin| bin + 1);
        if first >= HIST_BINS {
            return None;
        }

        let total: u64 = self.count[first..].iter().sum();
        if total == 0 {
            return None;
        }

        let at = |fraction: f64| -> f64 {
            let target = (total as f64 * fraction).ceil().max(1.0) as u64;
            let mut seen = 0u64;
            for bin in first..HIST_BINS {
                seen += self.count[bin];
                if seen >= target {
                    return HIST_FLOOR + (bin as f64 + 0.5) * HIST_STEP;
                }
            }
            HIST_FLOOR + (HIST_BINS as f64 - 0.5) * HIST_STEP
        };

        Some((at(low), at(high)))
    }
}

/// Sobreamostrador polifásico para o pico verdadeiro.
///
/// Pico de amostra não é pico verdadeiro: o sinal reconstruído passa por cima
/// das amostras, e é o valor reconstruído que estoura no conversor do destino.
struct TruePeak {
    phases: Vec<Vec<f64>>,
    history: Vec<VecDeque<f64>>,
}

impl TruePeak {
    fn new(channels: usize) -> Self {
        use std::f64::consts::PI;
        let length = OVERSAMPLE * PHASE_TAPS;
        let center = (length as f64 - 1.0) / 2.0;

        let mut taps = vec![0.0; length];
        for (index, tap) in taps.iter_mut().enumerate() {
            let position = (index as f64 - center) / OVERSAMPLE as f64;
            let sinc = if position.abs() < 1e-9 {
                1.0
            } else {
                (PI * position).sin() / (PI * position)
            };
            // Blackman: lóbulos laterais baixos o bastante para o pico
            // reconstruído não ganhar energia que não existe.
            let ratio = index as f64 / (length as f64 - 1.0);
            let window = 0.42 - 0.5 * (2.0 * PI * ratio).cos() + 0.08 * (4.0 * PI * ratio).cos();
            *tap = sinc * window;
        }

        // Cada fase é normalizada em separado: fase com ganho diferente das
        // outras produziria uma ondulação que o medidor leria como pico.
        let phases: Vec<Vec<f64>> = (0..OVERSAMPLE)
            .map(|phase| {
                let mut coefficients: Vec<f64> =
                    (0..PHASE_TAPS).map(|k| taps[phase + k * OVERSAMPLE]).collect();
                let sum: f64 = coefficients.iter().sum();
                if sum.abs() > 1e-12 {
                    coefficients.iter_mut().for_each(|value| *value /= sum);
                }
                coefficients
            })
            .collect();

        Self {
            phases,
            history: (0..channels).map(|_| VecDeque::from(vec![0.0; PHASE_TAPS])).collect(),
        }
    }

    fn push(&mut self, channel: usize, sample: f64) -> f64 {
        let history = &mut self.history[channel];
        history.push_front(sample);
        history.pop_back();

        let mut peak: f64 = 0.0;
        for phase in &self.phases {
            let mut sum = 0.0;
            for (tap, value) in phase.iter().zip(history.iter()) {
                sum += tap * value;
            }
            peak = peak.max(sum.abs());
        }
        peak
    }
}

/// O que o medidor entrega a cada leitura.
#[derive(Debug, Clone, Copy)]
pub struct Reading {
    /// Pico de amostra por canal, em dBFS.
    pub peak_dbfs: [f64; 2],
    pub momentary_lufs: f64,
    pub short_term_lufs: f64,
    /// Integrada gateada desde o último `reset`.
    pub integrated_lufs: f64,
    /// Faixa de loudness (EBU Tech 3342), em LU.
    pub range_lu: f64,
    pub true_peak_dbtp: f64,
    /// Correlação de fase do par estéreo. Negativo denuncia mono invertido.
    pub correlation: f64,
}

impl Reading {
    /// O que mostrar quando não há barramento aberto para medir.
    pub const SILENT: Reading = Reading {
        peak_dbfs: [-90.0, -90.0],
        momentary_lufs: ABSOLUTE_GATE,
        short_term_lufs: ABSOLUTE_GATE,
        integrated_lufs: ABSOLUTE_GATE,
        range_lu: 0.0,
        true_peak_dbtp: -90.0,
        correlation: 1.0,
    };
}

pub struct Meter {
    channels: usize,
    filters: Vec<KWeighting>,
    true_peak: TruePeak,

    step_len: usize,
    step_pos: usize,
    /// Soma de quadrados ponderados do passo atual, por canal.
    step_power: Vec<f64>,
    /// Potência ponderada dos últimos passos, somada entre canais.
    recent: VecDeque<f64>,

    integrated: Histogram,
    range: Histogram,

    /// Pico de amostra e pico verdadeiro desde a última leitura.
    peak_window: Vec<f64>,
    true_peak_window: f64,

    /// Acumuladores da correlação, também por janela de leitura.
    sum_lr: f64,
    sum_ll: f64,
    sum_rr: f64,
}

impl Meter {
    pub fn new(rate: u32, channels: usize) -> Self {
        let channels = channels.max(1);
        Self {
            channels,
            filters: vec![KWeighting::new(); channels],
            true_peak: TruePeak::new(channels),
            step_len: (rate as usize * STEP_MS / 1000).max(1),
            step_pos: 0,
            step_power: vec![0.0; channels],
            recent: VecDeque::with_capacity(SHORT_STEPS),
            integrated: Histogram::new(),
            range: Histogram::new(),
            peak_window: vec![0.0; channels],
            true_peak_window: 0.0,
            sum_lr: 0.0,
            sum_ll: 0.0,
            sum_rr: 0.0,
        }
    }

    /// Zera o acumulado. O integrado que interessa ao operador é o do item no
    /// ar, não o do canal desde que ligou.
    ///
    /// A janela deslizante também é esvaziada: sem isso os primeiros blocos do
    /// item novo ainda carregam áudio do item anterior, e como o gate relativo
    /// derruba tudo que fica 10 LU abaixo da média, três décimos de segundo de
    /// programa alto bastam para mascarar o item inteiro que veio depois.
    /// Medido: um item 20 dB mais baixo lia 12 LU de diferença em vez de 20.
    ///
    /// Os filtros continuam com o estado que têm. O áudio do canal não é
    /// interrompido no take, e zerar o biquad no meio do sinal criaria um
    /// transiente que o próprio medidor leria como pico.
    pub fn reset(&mut self) {
        self.integrated.clear();
        self.range.clear();
        self.recent.clear();
        self.step_power.iter_mut().for_each(|sum| *sum = 0.0);
        self.step_pos = 0;
    }

    /// Consome um trecho de áudio intercalado por canal.
    pub fn push(&mut self, samples: &[f32]) {
        for frame in samples.chunks_exact(self.channels) {
            for (channel, raw) in frame.iter().enumerate() {
                let sample = *raw as f64;
                let weighted = self.filters[channel].run(sample);
                self.step_power[channel] += weighted * weighted;

                let magnitude = sample.abs();
                if magnitude > self.peak_window[channel] {
                    self.peak_window[channel] = magnitude;
                }
                let true_peak = self.true_peak.push(channel, sample);
                if true_peak > self.true_peak_window {
                    self.true_peak_window = true_peak;
                }
            }

            if self.channels >= 2 {
                let (left, right) = (frame[0] as f64, frame[1] as f64);
                self.sum_lr += left * right;
                self.sum_ll += left * left;
                self.sum_rr += right * right;
            }

            self.step_pos += 1;
            if self.step_pos >= self.step_len {
                self.close_step();
            }
        }
    }

    /// Fecha o passo de 100 ms e alimenta os blocos que dependem dele.
    fn close_step(&mut self) {
        // Média de quadrados do passo, somada entre canais. O peso de canal da
        // BS.1770 é 1,0 para esquerda e direita; só surround pesa mais.
        let power: f64 = self
            .step_power
            .iter()
            .map(|sum| sum / self.step_len as f64)
            .sum();

        self.recent.push_back(power);
        if self.recent.len() > SHORT_STEPS {
            self.recent.pop_front();
        }

        if self.recent.len() >= MOMENTARY_STEPS {
            self.integrated.add(self.window_power(MOMENTARY_STEPS));
        }
        if self.recent.len() >= SHORT_STEPS {
            self.range.add(self.window_power(SHORT_STEPS));
        }

        self.step_power.iter_mut().for_each(|sum| *sum = 0.0);
        self.step_pos = 0;
    }

    /// Potência média dos últimos `steps` passos.
    fn window_power(&self, steps: usize) -> f64 {
        let available = self.recent.len().min(steps);
        if available == 0 {
            return 0.0;
        }
        self.recent.iter().rev().take(available).sum::<f64>() / available as f64
    }

    /// Lê e zera as janelas de pico e correlação. O acumulado não é tocado.
    pub fn read(&mut self) -> Reading {
        let dbfs = |value: f64| if value > 0.0 { 20.0 * value.log10() } else { -90.0 };

        let peak = [
            dbfs(self.peak_window.first().copied().unwrap_or(0.0)),
            dbfs(self.peak_window.get(1).copied().unwrap_or(0.0)),
        ];
        let true_peak = dbfs(self.true_peak_window);

        let correlation = if self.sum_ll > 0.0 && self.sum_rr > 0.0 {
            (self.sum_lr / (self.sum_ll * self.sum_rr).sqrt()).clamp(-1.0, 1.0)
        } else {
            // Sem energia não há fase a comparar. Um denuncia problema nenhum,
            // que é o certo para o silêncio.
            1.0
        };

        let floor = |value: f64| if value.is_finite() { value } else { ABSOLUTE_GATE };
        let momentary = floor(loudness(self.window_power(MOMENTARY_STEPS)));
        let short_term = floor(loudness(self.window_power(SHORT_STEPS)));

        let range = self
            .range
            .percentiles(RANGE_RELATIVE, 0.10, 0.95)
            .map_or(0.0, |(low, high)| (high - low).max(0.0));

        self.peak_window.iter_mut().for_each(|value| *value = 0.0);
        self.true_peak_window = 0.0;
        self.sum_lr = 0.0;
        self.sum_ll = 0.0;
        self.sum_rr = 0.0;

        Reading {
            peak_dbfs: peak,
            momentary_lufs: momentary,
            short_term_lufs: short_term,
            integrated_lufs: self.integrated.gated(INTEGRATED_RELATIVE),
            range_lu: range,
            true_peak_dbtp: true_peak,
            correlation,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    const RATE: u32 = 48_000;

    /// Seno estéreo, amplitude de pico `amplitude`, de `seconds` segundos.
    fn sine(hz: f64, amplitude: f64, seconds: f64, channels: usize) -> Vec<f32> {
        let frames = (RATE as f64 * seconds) as usize;
        let mut out = Vec::with_capacity(frames * channels);
        for frame in 0..frames {
            let value = (2.0 * PI * hz * frame as f64 / RATE as f64).sin() * amplitude;
            for _ in 0..channels {
                out.push(value as f32);
            }
        }
        out
    }

    fn measure(samples: &[f32], channels: usize) -> Reading {
        let mut meter = Meter::new(RATE, channels);
        meter.push(samples);
        meter.read()
    }

    /// A prova de que a ponderação K está aplicada, sem valor decorado: o
    /// esperado sai dos próprios coeficientes, pela resposta em frequência.
    #[test]
    fn seno_bate_com_a_resposta_do_filtro_k() {
        let amplitude = 0.5;
        let hz = 1_000.0;

        let weighting = KWeighting::new();
        let gain = weighting.shelf.magnitude(hz, RATE as f64)
            * weighting.highpass.magnitude(hz, RATE as f64);

        // Dois canais, cada um com potência A²/2 depois da ponderação.
        let power = 2.0 * (amplitude * amplitude / 2.0) * gain * gain;
        let expected = -0.691 + 10.0 * power.log10();

        let reading = measure(&sine(hz, amplitude, 4.0, 2), 2);
        assert!(
            (reading.short_term_lufs - expected).abs() < 0.05,
            "esperado {expected:.3} LUFS, medido {:.3}",
            reading.short_term_lufs
        );
    }

    #[test]
    fn dobrar_a_amplitude_sobe_seis_lu() {
        let baixo = measure(&sine(1_000.0, 0.25, 4.0, 2), 2).short_term_lufs;
        let alto = measure(&sine(1_000.0, 0.5, 4.0, 2), 2).short_term_lufs;
        assert!((alto - baixo - 6.0206).abs() < 0.01, "{baixo:.3} -> {alto:.3}");
    }

    #[test]
    fn um_canal_mede_tres_lu_abaixo_de_dois() {
        let estereo = measure(&sine(1_000.0, 0.5, 4.0, 2), 2).short_term_lufs;

        // Mesmo sinal, mas só no canal esquerdo.
        let mut mono = sine(1_000.0, 0.5, 4.0, 2);
        for frame in mono.chunks_exact_mut(2) {
            frame[1] = 0.0;
        }
        let so_esquerda = measure(&mono, 2).short_term_lufs;

        assert!(
            (estereo - so_esquerda - 3.0103).abs() < 0.01,
            "{estereo:.3} contra {so_esquerda:.3}"
        );
    }

    #[test]
    fn silencio_fica_no_piso() {
        let reading = measure(&vec![0.0f32; RATE as usize * 2 * 2], 2);
        assert_eq!(reading.integrated_lufs, ABSOLUTE_GATE);
        assert_eq!(reading.momentary_lufs, ABSOLUTE_GATE);
        assert_eq!(reading.peak_dbfs[0], -90.0);
    }

    /// O gate é a razão de a integrada existir: silêncio longo no meio do
    /// programa não pode puxar a medição para baixo.
    #[test]
    fn o_gate_ignora_o_silencio_do_meio() {
        let mut meter = Meter::new(RATE, 2);
        meter.push(&sine(1_000.0, 0.5, 3.0, 2));
        let so_tom = meter.read().integrated_lufs;

        meter.push(&vec![0.0f32; RATE as usize * 2 * 10]);
        meter.push(&sine(1_000.0, 0.5, 3.0, 2));
        let com_silencio = meter.read().integrated_lufs;

        // Não é zero e não deve ser: os três blocos de 400 ms que pegam a
        // borda entre tom e silêncio ficam a -1,25, -3 e -6 LU do tom, e o
        // gate relativo de -10 LU não derruba nenhum deles. Puxam a média em
        // torno de 0,2 LU, e isso é a R128 funcionando, não erro de conta.
        assert!(
            (so_tom - com_silencio).abs() < 0.3,
            "o silêncio mexeu na integrada: {so_tom:.3} -> {com_silencio:.3}"
        );
    }

    #[test]
    fn reset_esquece_o_acumulado() {
        let mut meter = Meter::new(RATE, 2);
        meter.push(&sine(1_000.0, 0.5, 3.0, 2));
        let alto = meter.read().integrated_lufs;

        meter.reset();
        meter.push(&sine(1_000.0, 0.05, 3.0, 2));
        let baixo = meter.read().integrated_lufs;

        // Vinte dB de diferença de amplitude têm que virar 20 LU de diferença
        // de medida: se sobrar história do sinal alto, não vira.
        assert!((alto - baixo - 20.0).abs() < 0.2, "{alto:.3} -> {baixo:.3}");
    }

    /// Pico verdadeiro não é pico de amostra: um seno em frequência que não
    /// cai nas amostras passa por cima delas, e é isso que estoura no destino.
    #[test]
    fn pico_verdadeiro_passa_do_pico_de_amostra() {
        // 11,7 kHz não é submúltiplo da taxa: as amostras nunca pegam o topo.
        let reading = measure(&sine(11_700.0, 1.0, 1.0, 2), 2);
        assert!(
            reading.true_peak_dbtp > reading.peak_dbfs[0] + 0.05,
            "pico verdadeiro {:.3} não passou do pico de amostra {:.3}",
            reading.true_peak_dbtp,
            reading.peak_dbfs[0]
        );
        // E não pode inventar energia: meio dB de folga cobre o filtro.
        assert!(reading.true_peak_dbtp < 0.5, "{:.3}", reading.true_peak_dbtp);
    }

    #[test]
    fn correlacao_denuncia_mono_invertido() {
        let igual = measure(&sine(1_000.0, 0.5, 1.0, 2), 2).correlation;
        assert!((igual - 1.0).abs() < 0.01, "{igual:.3}");

        let mut invertido = sine(1_000.0, 0.5, 1.0, 2);
        for frame in invertido.chunks_exact_mut(2) {
            frame[1] = -frame[1];
        }
        let oposto = measure(&invertido, 2).correlation;
        assert!((oposto + 1.0).abs() < 0.01, "{oposto:.3}");
    }

    /// Programa com trechos altos e baixos tem faixa; tom constante não tem.
    #[test]
    fn faixa_de_loudness_separa_programa_de_tom() {
        let constante = measure(&sine(1_000.0, 0.5, 20.0, 2), 2).range_lu;
        assert!(constante < 1.0, "tom constante não devia ter faixa: {constante:.3}");

        let mut variado = sine(1_000.0, 0.5, 12.0, 2);
        variado.extend(sine(1_000.0, 0.05, 12.0, 2));
        let faixa = measure(&variado, 2).range_lu;
        assert!(faixa > 10.0, "faixa medida foi {faixa:.3}");
    }
}
