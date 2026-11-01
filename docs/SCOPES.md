# Scopes do RPlayout (r88-36)

Scopes de engenharia (waveform, parade, vectorscope, histograma, diamante de
gamut, falsa cor) no QC e no monitor de PGM do Master, com **uma única
matemática** em Rust.

## Desenho

```
apps/engine/scopes  (crate rplayout-scopes, sem GStreamer, só std)
   ├── nativo ──► rplayout-probe: cabeçalho .ycc + medição do quadro do QC
   │              (recibo scopeStats → cabeçalho HTTP x-rplayout-scope-stats)
   └── wasm32 ──► apps/web/src/scopes/rplayout_scopes.wasm (29 KB, exports crus)
                   └── QC EXATO: .ycc do servidor → WASM → desenho CPU
apps/web/src/scopes
   ├── webgpu.ts   ao vivo, padrão  (compute + atomicAdd, render dos buffers)
   ├── webgl2.ts   ao vivo, fallback (pontos + blending aditivo em float)
   ├── cpu-js.ts   último recurso (mesma aritmética f32, sem WASM)
   ├── layout.ts / graticule.ts / cpu-render.ts  (comuns a todos)
   └── shaders.ts  WGSL/GLSL transcritos do crate, mesma ordem de operações
apps/web/src/components/scopes/ScopeDeck.tsx   painel (QC e PGM)
```

- **Matemática única.** Conversões BT.709 e BT.2020 NCL (faixa limitada e
  cheia, 8–16 bits), waveform de Y'/Cb/Cr/R'/G'/B', parade R'G'B' e Y'CbCr,
  vectorscope com alvos 75% e 100% calculados pela matriz, histograma,
  diamante Tektronix (B'−G'/B'+G' em cima, R'−G'/R'+G' embaixo), avisos de
  níveis e gamut (EBU R103: luma −1..103%, R'G'B' −5..105% com 1% de área;
  croma fora de 16–240) e falsa cor (exposição e gamut), tudo em
  `apps/engine/scopes/src/lib.rs`. Sem FMA nem funções transcendentais por
  pixel: nativo e WASM dão o mesmo resultado bit a bit.
- **WASM sem wasm-bindgen.** `extern "C"` + memória linear; o carregador
  (`wasm.ts`) tem ~200 linhas. O `.wasm` vai versionado com o SHA-256 das
  fontes (`rplayout_scopes.wasm.json`); o vitest e o `build-r88.ps1` (passo
  04b) falham se as fontes mudarem sem recompilar. Recompilar:
  `node scripts/build-scopes-wasm.mjs` (precisa de
  `rustup target add wasm32-unknown-unknown`).
- **EXATO × INDICATIVO.** O selo EXATO só aparece para o `.ycc` do servidor
  (Y'CbCr 4:4:4 do original, sem o navegador). O ao vivo (WHEP, proxy, JPEG)
  leva INDICATIVO: o navegador entrega o quadro comprimido, reduzido e
  convertido para RGB com conversão de cor não garantida; o painel reconverte
  para Y'CbCr BT.709. No EXATO o painel mostra **Rust=WASM** quando a medição
  da sonda (Rust nativo, cabeçalho HTTP) bate com a do WASM no mesmo quadro.
- **Ao vivo na GPU, sem readback.** Por quadro decodificado
  (`requestVideoFrameCallback`): `importExternalTexture` → um dispatch que
  acumula os 6 canais do waveform, vectorscope, histograma, diamante e
  medições com `atomicAdd` → um render pass que lê os storage buffers e
  desenha. Histograma e medições somam primeiro em memória de workgroup (um
  atômico global por workgroup). Nada volta para a CPU no desenho; as
  medições (64 B, 4 Hz) e o tempo de GPU (`timestamp-query`, 1 Hz) são
  lidos de forma assíncrona. Imagens (`<img>` do QC por quadros) usam
  `copyExternalImageToTexture` (cópia GPU→GPU) e a variante `texture_2d` do
  mesmo shader. Se o dispositivo cair (TDR/driver), o painel passa sozinho
  para WebGL2.
- **WebGL2.** Cada amostra vira um ponto (`gl_VertexID` → `texelFetch`)
  somado com blending aditivo em textura `R32F` (com `EXT_float_blend`) ou
  `R16F`. Acima de 1280 px de largura amostra 1 em 2 por eixo. Medições
  saem do histograma (6 KB lidos a 2 Hz; resolução de 0,46%).
- **CPU.** Sem GPU: WASM sobre 640×360 a 10 Hz; sem WASM, `cpu-js.ts`
  (mesmo resultado do WASM, teste exato).
- **Gratículo e cursor** num canvas 2D por cima, redesenhado só quando muda
  geometria, unidade, zoom ou cursor. As fórmulas de posição são as das
  células do crate (centro da célula), então gratículo e densidade coincidem
  em qualquer backend.

## Usabilidade

- Escala em **%**, **mV** (700 mV = 100%) e **IRE** (HD digital: 0 IRE =
  preto, sem setup). Cb/Cr: zero no centro (±350 mV).
- Zoom: roda do mouse no waveform/histograma (faixa de níveis, ancorada no
  cursor) e no vectorscope (ganho); duplo clique ou `0` volta a 1:1. O zoom
  muda a acumulação (as células cobrem só a faixa visível), não estica pixels.
- Lupa em região: botão LUPA (ou `a`) e arrastar sobre a imagem; `Esc` limpa.
- Intensidade (`[`/`]`), brilho do gratículo, alvos 75/100/ambos (`t`),
  linha de pele (`s`), canal do waveform Y/Cb/Cr/R/G/B (`c`), parade
  R'G'B'/Y'CbCr (`Shift+C`), unidade (`u`), falsa cor exposição/gamut (`f`).
- Leitura por cursor: nível em % e mV; no vectorscope Cb/Cr, ângulo,
  magnitude e erro de fase/ganho para o alvo mais próximo; no diamante os
  dois componentes.
- Congelar (`z`) e referência (`x` guarda, `Shift+X` limpa): a referência
  aparece em âmbar por baixo do quadro corrente.
- Atalhos só com o foco no painel de scopes (`tabIndex`), e com
  `stopPropagation`: não disputam J/K/L, Espaço (TAKE), setas, Home/End,
  `i`, `n`, Delete nem as teclas F do QC e do Master. `?` mostra a lista.
- PGM do Master: botão **SCOPES** no cabeçalho do monitor de PGM —
  desligado → **sobre a imagem** (translúcido, compacto) → **janela**
  flutuante redimensionável. Nenhum modo muda o tamanho do monitor nem da
  grade. Usa o `<video>` do WHEP por `onVideoElement` (Whep sem alteração).

### Falsa cor (exposição, Y')

| faixa | cor | leitura |
|---|---|---|
| < −1% | violeta | sub-black ilegal (R103) |
| −1..0% | roxo | abaixo do preto |
| 0..2,5% | azul | preto esmagado |
| 38..44% | verde | cinza 18% (≈41% em BT.709) |
| 52..58% | rosa | pele clara |
| 97..100% | amarelo | perto do branco |
| 100..103% | laranja | super-white tolerado |
| > 103% | vermelho | super-white ilegal (R103) |

Modo gamut: vermelho = luma fora de R103, magenta = R'G'B' fora de R103,
amarelo = fora de 0..100% mas dentro da tolerância, resto em cinza escuro.

## Tolerâncias (testes)

| teste | onde | tolerância |
|---|---|---|
| nossa quantização × ffmpeg (barras EBU 75/100, BT.709 e BT.2020) | `cargo test` do crate | ±1 código |
| barras no alvo do vectorscope | idem | fase ≤ 0,5°, ganho ≤ 1,5% |
| nível de cada barra no waveform | idem | ±(meia linha + 0,5%) |
| barras SMPTE RP 219 75% (`smptehdbars`) | idem | ±1 código dos valores da norma |
| barras 75%/100% dentro do gamut | idem | 0 amostra fora de R103 |
| rampa 0–255: sub-black/super-white | idem | contagem exata |
| Rust nativo × WASM (4 quadros × 2 configs + falsa cor) | `fixtures/golden.txt` (cargo) + `wasm.test.ts` (vitest) | **bit a bit** |
| JS × WASM (caminho RGBA) | `cpu-js.test.ts` | exato (médio de luma 1e-6) |
| GPU × WASM sobre o mesmo RGB | `scripts/bench-scopes.mjs` | ver números abaixo |
| loudness BS.1770-4 | `loudness.rs` (Tech 3341 casos 1–4, Tech 3342 casos 1–3, TP entre amostras) | I ±0,1 LU; LRA ±1 LU; TP +0,2/−0,4 dB |

Quadros de referência: `apps/engine/scopes/fixtures/*.ycc.rle`, gerados por
`node scripts/gen-scopes-fixtures.mjs` (ffmpeg), 1920×1080 4:4:4.

## Erro esperado do caminho INDICATIVO

PLACEHOLDER_ERROS

## Desempenho

PLACEHOLDER_DESEMPENHO

## Loudness do arquivo inteiro

Já existia: a sonda decodifica o áudio inteiro e mede com o mesmo
`loudness.rs` do engine (BS.1770-4, gate absoluto −70 e relativo −10 LU,
LRA pela Tech 3342 com gate −20 LU, true peak com sobreamostragem). O QC
mostra I, LRA e TP do arquivo inteiro com a faixa do perfil do canal e,
agora, **Δ ref** (diferença para a referência `targetLufs` do canal; âmbar
acima de 1 LU). Nesta rodada entraram os testes de conformidade EBU Tech
3341/3342 que provam o medidor.

## Limitações

- O INDICATIVO não vê abaixo de 0% nem acima de 100% com fidelidade: o
  navegador recorta na conversão para RGB. Luma ilegal e gamut só valem no
  EXATO (marcados com `*` no INDICATIVO).
- O `.ycc` do EXATO é 960 px de largura (decimação por vizinho mais
  próximo, sem overshoot inventado); o waveform tem resolução horizontal de
  960 colunas.
- WebGL2: 1 em 2 pixels por eixo acima de 1280 px; medições com resolução de
  uma faixa do histograma; gamut/croma não medidos (mostra "—").
- Falsa cor sobre a imagem na CPU (sem GPU) a 10 Hz e 640×360.
- O diamante mostra sub-black (soma negativa) colado ao centro.
