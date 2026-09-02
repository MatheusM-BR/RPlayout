import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import type { Anchor, AudioLevel, LoudnessMeasurement, Trim } from '@rplayout/protocol'
import { openDatabase } from './client.js'
import { channels, mediaAssets, rundownItems, rundowns } from './schema.js'
import { DB_FILE } from '../config.js'

const FPS = 50
const s = (n: number): number => Math.round(n * FPS)
const now = new Date().toISOString()

/**
 * A grade semeada começa daqui a pouco, não numa hora fixa do dia. Uma grade
 * cravada às 19:50 só faz sentido de noite; assim a demonstração fecha as
 * âncoras a qualquer hora em que alguém suba o servidor.
 */
const clockNow = new Date()
const START = s(
  clockNow.getHours() * 3600 + clockNow.getMinutes() * 60 + clockNow.getSeconds() + 90,
)
/** Deslocamento em segundos a partir do início da grade. */
const after = (seconds: number): number => START + s(seconds)

const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex')

const loudness = (
  integratedLufs: number,
  truePeakDbtp: number,
  lra = 6.2,
): LoudnessMeasurement => ({
  integratedLufs,
  truePeakDbtp,
  lra,
  scope: 'FILE',
  measuredAt: now,
})

const AUTO: AudioLevel = { mode: 'AUTO', gainDb: 0, measured: null }

/** O explorador monta a árvore a partir do caminho, então o caminho importa. */
const FOLDER: Record<string, string> = {
  vinheta: 'Vinhetas',
  comercial: 'Comerciais',
  reportagem: 'Reportagens',
  programa: 'Programas',
  quadro: 'Quadros',
  chamada: 'Chamadas',
  filler: 'Fillers',
}

/**
 * Onde estão os arquivos. Sem `RPLAYOUT_MEDIA_DIR`, o seed usa caminhos do
 * Windows como ilustração; com ele, aponta para arquivos que existem de fato,
 * que é o que permite exercitar o engine sem um acervo de verdade.
 */
const MEDIA_DIR = process.env.RPLAYOUT_MEDIA_DIR ?? ''

/**
 * Força o acervo de demonstração mesmo com pasta apontada.
 *
 * Só faz sentido quando os arquivos da pasta têm exatamente os nomes que este
 * seed inventa -- que é o caso de quem gerou material de teste para exercitar
 * o engine, e de mais ninguém.
 */
const DEMO = process.env.RPLAYOUT_SEED_DEMO === '1'

interface AssetSeed {
  key: string
  title: string
  seconds: number
  category: string
  loudness: LoudnessMeasurement
  defaultTrim?: Trim
  defaultAudio?: AudioLevel
  suggestedTrim?: Trim
}

/**
 * Acervo simulado com loudness deliberadamente desigual — é o problema que o
 * nivelamento existe para resolver, e sem ele a tela fica bonita e muda.
 */
const mediaPath = (asset: AssetSeed): string =>
  MEDIA_DIR
    ? `${MEDIA_DIR}/${asset.key}.mkv`
    : `D:/Media/${FOLDER[asset.category] ?? 'Diversos'}/${asset.key}.mxf`

const ASSETS: AssetSeed[] = [
  {
    key: 'vinheta-abertura',
    title: 'Vinheta de abertura',
    seconds: 12,
    category: 'vinheta',
    loudness: loudness(-20.1, -0.9, 3.1),
  },
  {
    key: 'previsao',
    title: 'Previsão do tempo',
    seconds: 90,
    category: 'quadro',
    loudness: loudness(-22.0, -2.4),
  },
  {
    key: 'esporte',
    title: 'VT Esporte — a rodada',
    seconds: 192,
    category: 'reportagem',
    loudness: loudness(-23.2, -3.1, 8.4),
  },
  {
    key: 'com-supermercado',
    title: 'Comercial — Supermercado Aurora',
    seconds: 30,
    category: 'comercial',
    loudness: loudness(-19.8, -1.2, 4.0),
    defaultAudio: AUTO,
  },
  {
    key: 'com-concessionaria',
    title: 'Comercial — Concessionária Vale',
    seconds: 30,
    category: 'comercial',
    loudness: loudness(-21.5, -2.0, 4.6),
    defaultAudio: AUTO,
  },
  {
    key: 'porto-seco',
    title: 'Reportagem — Porto Seco',
    seconds: 190,
    category: 'reportagem',
    // Dois segundos de preto na cabeça e vinte de barras na cauda.
    loudness: loudness(-18.4, -1.8, 9.1),
    defaultTrim: { in: s(2), out: s(170) },
    suggestedTrim: { in: s(2), out: s(170) },
  },
  {
    key: 'vinheta-bloco',
    title: 'Vinheta de bloco',
    seconds: 12,
    category: 'vinheta',
    loudness: loudness(-20.6, -1.1, 3.4),
  },
  {
    key: 'institucional',
    title: 'Institucional — Prefeitura',
    seconds: 20,
    category: 'filler',
    loudness: loudness(-27.6, -2.0, 5.0),
    defaultAudio: AUTO,
  },
  {
    key: 'vinheta-intervalo',
    title: 'Vinheta de intervalo',
    seconds: 8,
    category: 'vinheta',
    loudness: loudness(-21.0, -1.6, 2.8),
  },
  {
    key: 'documentario',
    title: 'Documentário — Serra do Cipó',
    seconds: 720,
    category: 'programa',
    loudness: loudness(-24.8, -5.5, 12.3),
  },
  {
    key: 'slate-intervalo',
    title: 'Slate de intervalo',
    seconds: 60,
    category: 'filler',
    loudness: loudness(-26.0, -9.0, 2.0),
  },
  {
    key: 'chamada',
    title: 'Chamada — programação de amanhã',
    seconds: 30,
    category: 'chamada',
    // Vem tão quente que o ganho automático não consegue chegar no alvo.
    loudness: loudness(-16.9, -0.4, 3.9),
    defaultAudio: AUTO,
  },
]

interface ItemSeed {
  title?: string
  asset?: string
  type: 'VT' | 'LIVE' | 'FILLER' | 'COMMERCIAL' | 'SLATE'
  sourceRef?: string
  durationOverride?: number
  minSeconds?: number
  anchor?: Anchor
  onOverrun?: 'TRIM_PREV' | 'DROP_FILLER' | 'PUSH' | 'SKIP'
  elastic?: { min: number; max: number }
  locked?: boolean
  /** Chave lógica do bloco no seed; vira um blockId de verdade na inserção. */
  block?: string
}

const ITEMS: ItemSeed[] = [
  { asset: 'vinheta-abertura', type: 'VT' },
  { asset: 'previsao', type: 'VT', minSeconds: 60, onOverrun: 'TRIM_PREV' },
  { asset: 'esporte', type: 'VT', minSeconds: 150, onOverrun: 'TRIM_PREV' },
  { asset: 'com-supermercado', type: 'COMMERCIAL', locked: true, block: 'comercial-1' },
  { asset: 'com-concessionaria', type: 'COMMERCIAL', locked: true, block: 'comercial-1' },
  { asset: 'porto-seco', type: 'VT', minSeconds: 140, onOverrun: 'TRIM_PREV' },
  // O filler vem antes da âncora: elástico só cobre folga do que está à frente
  // dele, então colocá-lo depois seria deixá-lo sem serventia.
  {
    asset: 'institucional',
    type: 'FILLER',
    onOverrun: 'DROP_FILLER',
    elastic: { min: s(10), max: s(300) },
  },
  {
    asset: 'vinheta-bloco',
    type: 'VT',
    anchor: { kind: 'SOFT', at: after(9 * 60 + 28), tolerance: s(90), priority: 3 },
  },
  {
    title: 'Estúdio ao vivo — SDI 1 (Quad 2)',
    type: 'LIVE',
    sourceRef: 'sdi:0',
    durationOverride: s(840),
    minSeconds: 600,
    anchor: { kind: 'FIXED', at: after(10 * 60) },
  },
  { asset: 'vinheta-intervalo', type: 'VT' },
  { asset: 'documentario', type: 'VT', minSeconds: 600, onOverrun: 'TRIM_PREV' },
  {
    asset: 'slate-intervalo',
    type: 'FILLER',
    onOverrun: 'DROP_FILLER',
    elastic: { min: s(30), max: s(300) },
  },
  {
    asset: 'chamada',
    type: 'VT',
    anchor: { kind: 'SOFT', at: after(40 * 60), tolerance: s(60), priority: 2 },
  },
  // Segunda ocorrência do mesmo arquivo: é o que dá sentido a "aplicar em todos
  // os itens com a mesma correspondência".
  { asset: 'porto-seco', title: 'Reprise — Porto Seco', type: 'VT', minSeconds: 140, onOverrun: 'TRIM_PREV' },
]

async function seed(): Promise<void> {
  const { db, sqlite } = openDatabase(DB_FILE)

  const existing = await db.select().from(channels)
  if (existing.length > 0) {
    console.log('Banco já tem canal. Apague o arquivo para semear de novo.')
    sqlite.close()
    return
  }

  const channelId = randomUUID()
  await db.insert(channels).values({
    id: channelId,
    name: 'Canal 1',
    rateNum: 50,
    rateDen: 1,
    width: 1920,
    height: 1080,
    scan: 'PROGRESSIVE',
    fieldOrder: 'TFF',
    targetLufs: -23,
    ceilingDbtp: -1,
    limiterLookaheadMs: 5,
    programSdiDeviceId: 'decklink:0',
    createdAt: now,
  })

  // Pasta de verdade apontada: o acervo é o que está no disco, lido pela
  // varredura com duração, loudness e miniatura de cada arquivo. Semear doze
  // nomes inventados aqui produziria uma grade bonita em que nenhum item toca
  // -- e o operador só descobriria no primeiro take.
  if (MEDIA_DIR && !DEMO) {
    await db.insert(rundowns).values({
      id: randomUUID(),
      channelId,
      name: 'Grade',
      plannedStart: START,
      loop: true,
      date: new Date().toISOString().slice(0, 10),
      createdAt: now,
      updatedAt: now,
    })
    console.log(
      `Semeado: canal ${channelId} e uma grade vazia.\n` +
        `Agora leia ${MEDIA_DIR} pela interface (botão LER PASTA) e monte a grade ` +
        `com "inserir item" ou "montar".\n` +
        'Para o acervo de demonstração em vez disto, rode com RPLAYOUT_SEED_DEMO=1.',
    )
    sqlite.close()
    return
  }

  const assetIds = new Map<string, string>()
  for (const asset of ASSETS) {
    const id = randomUUID()
    assetIds.set(asset.key, id)
    await db.insert(mediaAssets).values({
      id,
      contentHash: hash(asset.key),
      path: mediaPath(asset),
      title: asset.title,
      kind: 'VIDEO',
      durationFrames: s(asset.seconds),
      categoryId: asset.category,
      defaultTrim: asset.defaultTrim ?? null,
      defaultAudio: asset.defaultAudio ?? null,
      loudnessFile: asset.loudness,
      suggestedTrim: asset.suggestedTrim ?? null,
      createdAt: now,
    })
  }

  const rundownId = randomUUID()
  await db.insert(rundowns).values({
    id: rundownId,
    channelId,
    name: 'Grade — noite',
    plannedStart: START,
    loop: true,
    date: new Date().toISOString().slice(0, 10),
    createdAt: now,
    updatedAt: now,
  })

  const blockIds = new Map<string, string>()

  for (const [index, seedItem] of ITEMS.entries()) {
    const assetKey = seedItem.asset
    const asset = assetKey ? ASSETS.find((a) => a.key === assetKey) : undefined
    const duration = seedItem.durationOverride ?? (asset ? s(asset.seconds) : 0)

    await db.insert(rundownItems).values({
      id: randomUUID(),
      rundownId,
      sortOrder: (index + 1) * 10,
      type: seedItem.type,
      title: seedItem.title ?? asset?.title ?? 'Item',
      mediaId: assetKey ? (assetIds.get(assetKey) ?? null) : null,
      sourceRef: seedItem.sourceRef ?? null,
      trim: null,
      audio: null,
      durationOverride: seedItem.durationOverride ?? null,
      minDuration: seedItem.minSeconds ? s(seedItem.minSeconds) : duration,
      anchor: seedItem.anchor ?? { kind: 'FLOW' },
      onOverrun: seedItem.onOverrun ?? 'PUSH',
      elastic: seedItem.elastic ?? null,
      blockId: seedItem.block
        ? (blockIds.get(seedItem.block) ??
          blockIds.set(seedItem.block, randomUUID()).get(seedItem.block)!)
        : null,
      locked: seedItem.locked ?? false,
      autoNext: true,
      loop: false,
      notes: null,
    })
  }

  console.log(`Semeado: canal ${channelId}, ${ASSETS.length} assets, ${ITEMS.length} itens.`)
  sqlite.close()
}

seed().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
