/** Alvos de loudness integrado oferecidos nas Configurações do canal. O
 * rótulo diz de qual norma é cada número: EBU R128 é -23 LUFS; -24 é o
 * ATSC A/85 (B7: a tela chamava -24 de "EBU R128"). */
export const LOUDNESS_TARGETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: -23, label: '-23.0 LUFS (EBU R128)' },
  { value: -24, label: '-24.0 LUFS (ATSC A/85)' },
  { value: -16, label: '-16.0 LUFS (Podcasts / Apple)' },
  { value: -14, label: '-14.0 LUFS (Web / YouTube)' },
]
export const TRUE_PEAK_CEILINGS: ReadonlyArray<{ value: number; label: string }> = [
  { value: -1.0, label: '-1.0 dBTP (teto da EBU R128)' },
  { value: -2.0, label: '-2.0 dBTP (folga para codificação com perdas)' },
  { value: -0.5, label: '-0.5 dBTP (masterização)' },
]
