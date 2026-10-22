import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { monitorSize, type Channel, type Scan } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { outputProfiles } from '../db/schema.js'
import { MediaMtx, type ChannelPaths } from './mediamtx.js'
import { credentialAddress, sourceAddress } from './source-wire.js'

export type OutputRole = 'PROGRAM' | 'PREVIEW' | 'MONITOR' | 'EXTRA'
/**
 * Para onde uma saída vai.
 *
 * `SDI` é diferente das outras três: não passa por codificador nem por rede,
 * sai crua no formato do canal e quem faz o relógio é a placa. O que se
 * escolhe nela é o conector, não o bitrate.
 */
export type OutputKind = 'RTMP' | 'SRT' | 'FILE' | 'SDI' | 'NDI' | 'OMT'

/** Capacidades de publicação realmente implementadas pelo engine local. */
export function outputCapability(kind: OutputKind): { available: boolean; reason?: string } {
  // Capability means implemented. Availability/first delivery is reported by
  // the publisher; a missing DLL is an actionable engine error, not NMOS.
  return { available: true }
}

export interface OutputProfileRow {
  id: string
  channelId: string
  name: string
  kind: OutputKind
  target: string
  role: OutputRole
  width: number | null
  height: number | null
  rateNum: number | null
  rateDen: number | null
  scan: Scan | null
  bitrateKbps: number | null
  enabled: boolean
  createdAt: string
}

/**
 * O que o engine recebe por saída.
 *
 * Campo em branco herda do canal. É o que permite mudar só o bitrate de um
 * destino sem ter que repetir geometria e cadência -- e é o que faz o valor
 * herdado acompanhar quando o canal muda de formato.
 */
interface EngineProfile {
  /** Identidade estável: permite trocar somente esta ramificação no engine. */
  id?: string
  kind: 'rtmp' | 'srt' | 'file' | 'ndi' | 'omt'
  target: string
  width?: number
  height?: number
  rateNum?: number
  rateDen?: number
  scan?: 'progressive' | 'interlaced'
  bitrateKbps?: number
  /** "mon" marca um monitor: o engine sobe sob demanda e codifica em software. */
  role?: 'mon'
}

export async function listOutputs(db: Db, channelId: string): Promise<OutputProfileRow[]> {
  return (await db
    .select()
    .from(outputProfiles)
    .where(eq(outputProfiles.channelId, channelId))
    .orderBy(asc(outputProfiles.createdAt))) as OutputProfileRow[]
}

/**
 * Garante que o canal tenha os perfis que o sistema mantém.
 *
 * Programa e preview existem sempre que há servidor de mídia local: o operador
 * não escolhe o destino deles, mas escolhe como saem. Criar aqui, e não no
 * seed, é o que faz um canal novo já nascer com eles.
 */
export async function ensureManagedOutputs(
  db: Db,
  channel: Channel,
  path: ChannelPaths | undefined,
): Promise<void> {
  if (!path) return

  const existing = await listOutputs(db, channel.id)
  const managed: { role: OutputRole; name: string; defaults: Partial<OutputProfileRow> }[] = [
    { role: 'PROGRAM', name: 'Programa', defaults: {} },
    {
      role: 'PREVIEW',
      name: 'Preview',
      defaults: lowBandwidthMonitor(channel),
    },
  ]

  managed.push({
    role: 'MONITOR',
    name: 'Monitor do programa',
    // Mesmo conteúdo do ar, em 240p, para a janela do navegador. O engine só
    // liga esta saída quando alguém abre o monitor -- ver `on_demand` lá.
    defaults: lowBandwidthMonitor(channel),
  })

  for (const entry of managed) {
    const current = existing.find((row) => row.role === entry.role)
    if (current) {
      // Upgrade legacy full-resolution preview profiles too. Keep existing
      // settings when they consume even less bandwidth; never touch PGM.
      if (entry.role === 'PREVIEW' || entry.role === 'MONITOR') {
        const defaults = lowBandwidthMonitor(channel)
        const fps = current.rateNum !== null && current.rateDen !== null && current.rateDen > 0 ? current.rateNum / current.rateDen : Infinity
        const patch:Partial<OutputProfileRow>={
          width: Math.min(current.width ?? Infinity, defaults.width!),
          height: Math.min(current.height ?? Infinity, defaults.height!),
          ...(fps > 15 ? { rateNum: 15, rateDen: 1 } : {}),
          scan: 'PROGRESSIVE',
          bitrateKbps: Math.min(current.bitrateKbps ?? Infinity, defaults.bitrateKbps!),
        }
        // A refresh must not look like another operator changed the profile.
        const changed=Object.fromEntries(Object.entries(patch).filter(([key,value])=>current[key as keyof OutputProfileRow]!==value))
        if(Object.keys(changed).length)await db.update(outputProfiles).set(changed).where(eq(outputProfiles.id, current.id))
      }
      continue
    }
    await db.insert(outputProfiles).values({
      id: randomUUID(),
      channelId: channel.id,
      name: entry.name,
      kind: 'RTMP',
      // Destino dos gerenciados é derivado, não guardado: o caminho no servidor
      // muda quando o canal é renomeado, e um valor gravado ficaria para trás.
      target: '',
      role: entry.role,
      width: null,
      height: null,
      rateNum: null,
      rateDen: null,
      scan: null,
      bitrateKbps: null,
      // Saídas gerenciadas de programa e preview
      enabled: true,
      createdAt: new Date().toISOString(),
      ...entry.defaults,
    })
  }
}

/** Small network preview, independent of the broadcast/master profile. */
export function lowBandwidthMonitor(channel: Pick<Channel, 'width' | 'height'>): Partial<OutputProfileRow> {
  const [width, height] = monitorSize(channel.width, channel.height)
  return { width, height, rateNum: 15, rateDen: 1, scan: 'PROGRESSIVE', bitrateKbps: 450 }
}

/** Reject inconsistent edits before touching a publisher. Never silently turn
 * a network monitor into another full-resolution broadcast output. */
export function validateOutputProfile(row:OutputProfileRow,channel?:Pick<Channel,'width'|'height'>):void{
  if(row.role==='EXTRA'){
    if(row.kind==='RTMP' || row.kind==='SRT'){
      let url:URL
      try{url=new URL(row.target)}catch{throw new Error('Informe um endereço completo para o protocolo selecionado.')}
      if(!url.hostname || !(row.kind==='RTMP'?['rtmp:','rtmps:']:['srt:']).includes(url.protocol))throw new Error('O endereço não corresponde ao protocolo selecionado.')
    }
    if(row.kind==='SDI' && !/^\d+$/.test(row.target))throw new Error('Na SDI o destino é o número do conector: 0, 1, 2…')
    if(row.kind==='FILE' && /^[a-z][a-z0-9+.-]*:\/\//i.test(row.target))throw new Error('Gravação usa caminho de arquivo no servidor, não URL de streaming.')
  }
  if((row.rateNum===null)!==(row.rateDen===null))throw new Error('Informe numerador e denominador da cadência juntos, ou ambos automáticos.')
  if(row.role==='PREVIEW' || row.role==='MONITOR'){
    const limits=lowBandwidthMonitor(channel??{width:1920,height:1080})
    if(row.width===null || row.height===null || row.width>limits.width! || row.height>limits.height! || row.rateNum===null || row.rateDen===null || row.rateNum/row.rateDen>15 || row.scan!=='PROGRESSIVE' || row.bitrateKbps===null || row.bitrateKbps>450)throw new Error('Preview/monitor devem permanecer leves: tamanho reduzido, até 15 fps, progressivo e de 50 a 450 kbps, sem herdar o PGM.')
  }
}

/** Perfil olhado no navegador: preview e monitor do programa. */
const ehMonitor = (row: OutputProfileRow): boolean =>
  row.role === 'PREVIEW' || row.role === 'MONITOR'

/** Destino real de um perfil: derivado para os gerenciados, guardado nos demais. */
export function targetOf(row: OutputProfileRow, path: ChannelPaths | undefined): string | null {
  // O programa é o master usado pelos relays externos. Ele fica em RTMP/AAC:
  // o relay remuxa esse par H.264/AAC para RTMP ou SRT sem recodificar. Fazer
  // o master sair em SRT/Opus deixava o relay RTMP sem trilha de áudio aceita
  // e, na prática, derrubava ou fragmentava a distribuição inteira.
  if (row.role === 'PROGRAM') return path ? MediaMtx.loopback(path.program) : null
  // Preview e monitor são olhados no navegador, e por isso vão por SRT: é o
  // único caminho daqui até o servidor de mídia que carrega Opus. Veja
  // `MediaMtx.loopbackSrt`.
  if (row.role === 'PREVIEW') return path ? MediaMtx.loopbackSrt(path.preview) : null
  if (row.role === 'MONITOR') return path ? MediaMtx.loopbackSrt(path.monitor) : null
  // Na placa o "destino" é o número do conector, guardado no alvo.
  if (row.kind === 'SDI') return row.target || null
  return row.target || null
}

/** Traduz um perfil para o que o engine entende. Nulo quando não dá para sair. */
export function toEngineProfile(
  row: OutputProfileRow,
  path: ChannelPaths | undefined,
): EngineProfile | string | null {
  const target = targetOf(row, path)
  if (!target || !row.enabled) return null

  // A saída por placa não tem perfil: ela sai crua, no formato do canal, e o
  // que existe para escolher é qual conector. Vai pelo atalho `sdi:N`, que o
  // engine entende sem passar por JSON.
  if (row.kind === 'SDI') return `sdi:${target.replace(/^sdi:/, '')}`

  return {
    id: row.id,
    // Preview e monitor usam SRT/MPEG-TS com Opus para WHEP. O PGM é RTMP/AAC,
    // pois é a fonte de distribuição que os relays podem remuxar para RTMP e
    // SRT sem transcodificação.
    kind: ehMonitor(row) ? 'srt' : row.role === 'PROGRAM' ? 'rtmp' : (row.kind.toLowerCase() as EngineProfile['kind']),
    target,
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.height !== null ? { height: row.height } : {}),
    ...(row.rateNum !== null ? { rateNum: row.rateNum } : {}),
    ...(row.rateDen !== null ? { rateDen: row.rateDen } : {}),
    ...(row.scan !== null
      ? { scan: row.scan === 'INTERLACED' ? ('interlaced' as const) : ('progressive' as const) }
      : {}),
    ...(row.bitrateKbps !== null ? { bitrateKbps: row.bitrateKbps } : {}),
    // O engine trata "mon" como monitor: sobe sob demanda e codifica em
    // software, para não gastar sessão de placa numa janela de navegador.
    ...(row.role === 'MONITOR' ? { role: 'mon' as const } : {}),
  }
}

/** Atalho sai como está; perfil vira JSON. */
export const encodeProfile = (profile: EngineProfile | string): string =>
  typeof profile === 'string' ? profile : JSON.stringify(profile)

export async function createOutput(
  db: Db,
  channelId: string,
  values: Pick<OutputProfileRow, 'name' | 'kind' | 'target'> & Partial<OutputProfileRow>,
): Promise<OutputProfileRow> {
  const row=newOutputProfile(channelId,values)
  await db.insert(outputProfiles).values(row)
  return row
}

/** Pure construction lets configuration and audit commit in one transaction. */
export function newOutputProfile(channelId:string,values:Pick<OutputProfileRow,'name'|'kind'|'target'> & Partial<OutputProfileRow>):OutputProfileRow{
  return {
    id: randomUUID(),
    channelId,
    role: 'EXTRA' as const,
    width: null,
    height: null,
    rateNum: null,
    rateDen: null,
    scan: null,
    bitrateKbps: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...values,
    target: credentialAddress(values.target),
  }
}

export async function updateOutput(
  db: Db,
  id: string,
  values: Partial<OutputProfileRow>,
): Promise<void> {
  // Destino de perfil gerenciado não é do operador: ele vem do servidor de
  // mídia, e deixar editar só criaria um valor que o sistema ignora.
  const [row] = await db.select().from(outputProfiles).where(eq(outputProfiles.id, id)).limit(1)
  if (!row) return
  const patch = outputUpdatePatch(row as OutputProfileRow, values)
  await db.update(outputProfiles).set(patch).where(eq(outputProfiles.id, id))
}

/** Validate without writing: native hot replacement commits after its ACK. */
export function outputUpdatePatch(row: OutputProfileRow, values: Partial<OutputProfileRow>): Partial<OutputProfileRow> {
  const patch = { ...values }
  if (row.role === 'EXTRA' && patch.target !== undefined) {
    if (patch.kind !== undefined && patch.kind !== row.kind && patch.target === sourceAddress(row.target) && patch.target !== row.target) throw new Error('Informe o endereço completo ao trocar o protocolo; a conexão anterior contém credenciais protegidas.')
    patch.target = credentialAddress(patch.target, row.target)
  }
  if (row.role !== 'EXTRA') {
    delete patch.target
    delete patch.kind
  }
  delete patch.id
  delete patch.channelId
  delete patch.role
  return patch
}

/** Remove um perfil. Os gerenciados não saem: o canal precisa deles. */
export async function deleteOutput(db: Db, id: string): Promise<boolean> {
  const result = await db
    .delete(outputProfiles)
    .where(and(eq(outputProfiles.id, id), eq(outputProfiles.role, 'EXTRA')))
    .returning({ id: outputProfiles.id })
  return result.length > 0
}
