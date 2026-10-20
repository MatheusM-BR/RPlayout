import {
  effectiveGainDb,
  durationIn,
  isStill,
  secondsToFrames,
  STILL_DEFAULT_SECONDS,
  qcApproved,
  assessQc,
  inferLiveSourceType,
  resolveAudio,
  audioCutIdentity,
  hasMatchingAudioMeasurement,
  resolveTrim,
  trimDuration,
  type AudioLevel,
  type Channel,
  type Frames,
  type MediaAsset,
  type PlanItem,
  type Rate,
  type ResolveResult,
  type Rundown,
  type RundownItem,
  type Trim,
  type ValueSource,
  type OnAirState,
} from '@rplayout/protocol'
import { resolve } from '@rplayout/scheduler'
import {executionTrim,declaredFileTrim} from './execution-trim.js'

/**
 * Duração no ar do item: o corte manda quando existe arquivo; sem arquivo,
 * vale a duração declarada ou estimada do live. É esta a duração que o scheduler recebe.
 */
export function itemDuration(
  item: RundownItem,
  asset: MediaAsset | undefined,
  rate: Rate,
): Frames {
  if (item.type === 'LIVE' || item.eventType === 'LIVE') {
    const liveEst = item.liveConfig?.estimatedDuration ?? item.liveEstimatedDuration
    if (liveEst && liveEst > 0) return liveEst
    if (item.durationOverride !== null && item.durationOverride > 0) return item.durationOverride
    return 0
  }
  if (!asset) return item.durationOverride ?? 0
  if (item.durationOverride !== null) return item.durationOverride
  if (isStill(asset)) return secondsToFrames(STILL_DEFAULT_SECONDS,rate)
  return trimDuration(resolveTrim(item.trim, asset, rate).value)
}

export function toPlanItem(
  item: RundownItem,
  asset: MediaAsset | undefined,
  rate: Rate,
): PlanItem {
  const duration = itemDuration(item, asset, rate)
  const eventType =
    item.eventType ??
    (item.type === 'LIVE'
      ? 'LIVE'
      : item.type === 'FILLER'
        ? 'FILLER'
        : item.anchor.kind === 'HARD_TIME'
          ? 'HARD_TIME'
          : item.anchor.kind === 'FIXED'
            ? 'FIXED'
            : 'SEQUENTIAL')

  const timingFlags = item.timingFlags ?? {
    trimmable: item.trimmable ?? item.onOverrun === 'TRIM_PREV',
    optional: item.optional ?? (item.onOverrun === 'DROP_FILLER' || item.onOverrun === 'SKIP'),
    protected: item.protected ?? item.locked,
  }

  const liveConfig =
    item.liveConfig ??
    (item.type === 'LIVE' || item.sourceRef || item.liveEndpoint
      ? {
          sourceType: item.liveSourceType ?? inferLiveSourceType(item.liveEndpoint ?? item.sourceRef ?? ''),
          sourceEndpoint: item.liveEndpoint ?? item.sourceRef ?? '',
          estimatedDuration: item.liveEstimatedDuration ?? item.durationOverride ?? 0,
          maxDuration: item.liveMaxDuration ?? null,
          autoFollowOnEnd: item.liveAutoFollowOnEnd ?? false,
          fallbackMediaId: item.liveFallbackMediaId ?? null,
        }
      : null)

  return {
    id: item.id,
    order: item.order,
    title: item.title,
    duration,
    // Um mínimo maior que a duração travaria o corte; o piso nunca passa dela.
    minDuration: Math.min(item.minDuration, duration),
    anchor: item.anchor,
    onOverrun: item.onOverrun,
    elastic: item.elastic,
    isFiller: item.type === 'FILLER' || eventType === 'FILLER',
    locked: item.locked || timingFlags.protected,
    eventType,
    timingFlags,
    liveConfig,
  }
}

/** O item com tudo que a interface precisa mostrar já resolvido. */
export interface ItemView {
  readonly editorialRevision?:number
  readonly item: RundownItem
  readonly asset: MediaAsset | null
  readonly trim: Trim
  readonly trimSource: ValueSource
  readonly audio: AudioLevel
  readonly audioSource: ValueSource
  /** Ganho que o engine aplicaria neste item agora. */
  readonly gainDb: number
  /** Quantos outros itens usam o mesmo arquivo — habilita o escopo em lote. */
  readonly siblingCount: number
}

export interface RundownView {
  readonly editorialRevision?:number
  readonly rundown: Rundown
  readonly channel: Channel
  readonly items: readonly ItemView[]
  readonly schedule: ResolveResult
}
export function assertTrimAudio(entry:Pick<ItemView,'item'|'asset'|'audio'>,cut:Trim,rate:Rate):void {
  const level=entry.item.audio??entry.asset?.defaultAudio
  if(level?.mode==='AUTO'&&level.measured?.scope==='TRIM'&&!hasMatchingAudioMeasurement(level,entry.asset?.contentHash,entry.item.audioTrack??0,audioCutIdentity(cut,rate)))throw new Error('O corte operacional não corresponde à medição de áudio. Meça este trecho novamente ou use ganho manual; o PGM será preservado.')
}

export function buildView(
  rundown: Rundown,
  channel: Channel,
  items: readonly RundownItem[],
  assets: ReadonlyMap<string, MediaAsset>,
  now: Frames | null,
  onAir: OnAirState | null,
): RundownView {
  const ordered = [...items].sort((a, b) => a.order - b.order)

  const usage = new Map<string, number>()
  for (const item of ordered) {
    if (item.mediaId) usage.set(item.mediaId, (usage.get(item.mediaId) ?? 0) + 1)
  }

  const views: ItemView[] = ordered.map((item) => {
    const asset = item.mediaId ? (assets.get(item.mediaId) ?? null) : null

    if (!asset) {
      const audio = item.audio ?? { mode: 'OFF' as const, gainDb: 0, measured: null }
      return {
        item,
        asset: null,
        trim: { in: 0, out: item.durationOverride ?? 0 },
        trimSource: 'NONE',
        audio,
        audioSource: item.audio ? 'ITEM' : 'NONE',
        gainDb: effectiveGainDb(audio, channel.targetLufs, channel.ceilingDbtp),
        siblingCount: 0,
      }
    }

    const trim = resolveTrim(item.trim, asset, channel.rate)
    let boundCut:ReturnType<typeof audioCutIdentity>|undefined
    try{boundCut=audioCutIdentity(isStill(asset)?trim.value:declaredFileTrim(item,asset,channel.rate),channel.rate)}catch{}
    const audio = resolveAudio(item.audio, asset,item.audioTrack??0,boundCut)
    return {
      item,
      asset,
      trim: trim.value,
      trimSource: trim.source,
      audio: audio.value,
      audioSource: audio.source,
      gainDb: effectiveGainDb(audio.value, channel.targetLufs, channel.ceilingDbtp),
      siblingCount: usage.get(asset.id) ?? 1,
    }
  })

  // Alinha o início planejado da grade com a hora real atual:
  // Se a grade está em loop contínuo ou o início planejado já passou em relação a agora,
  // projeta a grade a partir do horário real corrente (now ou onAir.startedAt).
  const effectivePlannedStart = (() => {
    if (now === null) return rundown.plannedStart
    if (onAir) return onAir.startedAt
    if (now < 0) return rundown.plannedStart
    if (
      rundown.loop ||
      rundown.plannedStart < now ||
      Math.abs(rundown.plannedStart - now) > 12 * 3600 * (channel.rate.num / channel.rate.den)
    ) {
      return now
    }
    return rundown.plannedStart
  })()

  // Invalid declared cuts reserve no time. Elastic growth is bounded by actual
  // file capacity, so unfillable gaps remain visible instead of fabricated.
  const timingUnavailable=views.flatMap(entry=>{
    if(!entry.asset||entry.item.sourceRef||entry.item.liveEndpoint||entry.item.type==='LIVE'||entry.item.id===onAir?.itemId)return []
    try{
      const cut=executionTrim(entry,undefined,channel.rate)
      assertTrimAudio(entry,cut,channel.rate)
      if(!isStill(entry.asset)&&entry.item.elastic&&entry.item.elastic.min>durationIn(entry.asset,channel.rate)-cut.in)throw new Error('O mínimo elástico excede os quadros disponíveis no arquivo.')
      return []
    }catch(error){return [{entry,message:error instanceof Error?error.message:'Corte operacional inválido.'}]}
  })
  const invalidCuts=new Set(timingUnavailable.map(row=>row.entry.item.id))
  const schedule = resolve({
    rate: channel.rate,
    items: ordered.map((item) => {
      const asset = item.mediaId ? assets.get(item.mediaId) : undefined
      const plan = toPlanItem(item, asset, channel.rate)
      if (item.id !== onAir?.itemId && item.mediaId && (invalidCuts.has(item.id)||!asset || asset.probeError || asset.ignored || !qcApproved(asset.qcStatus ?? 'APPROVED') || (channel.qcProfile && !assessQc(asset, channel.qcProfile).playable))) {
        return { ...plan, duration: 0, minDuration: 0, elastic:null, anchor: { kind: 'FLOW' as const }, locked: false }
      }
      if(asset&&!isStill(asset)&&plan.elastic){
        const available=durationIn(asset,channel.rate)-resolveTrim(item.trim,asset,channel.rate).value.in
        if(Number.isFinite(available))return {...plan,elastic:{...plan.elastic,max:Math.min(plan.elastic.max,available)}}
      }
      return plan
    }),
    now,
    onAir,
    plannedStart: effectivePlannedStart,
    rundownId: rundown.id,
    protectedZones: rundown.protectedZones,
  })

  const unavailable = views.filter((entry) => entry.item.id !== onAir?.itemId &&
    entry.item.mediaId && (!entry.asset || entry.asset.probeError || entry.asset.ignored || !qcApproved(entry.asset.qcStatus ?? 'APPROVED') || (channel.qcProfile && !assessQc(entry.asset, channel.qcProfile).playable)))
  for(const entry of views){
    const level=entry.item.audio??entry.asset?.defaultAudio
    if(!entry.asset||level?.mode!=='AUTO'||level.measured?.scope!=='TRIM'||invalidCuts.has(entry.item.id)||entry.item.id===onAir?.itemId)continue
    try{assertTrimAudio(entry,executionTrim(entry,schedule.items.find(row=>row.id===entry.item.id),channel.rate,{items:views,schedule}),channel.rate)}catch(error){timingUnavailable.push({entry,message:error instanceof Error?error.message:'Corte de áudio inválido.'})}
  }
  const unavailableIds = new Set([...unavailable.map((entry) => entry.item.id),...timingUnavailable.map(row=>row.entry.item.id)])
  return { rundown, channel, items: views, schedule: {
    ...schedule,
    items: schedule.items.map((entry) => unavailableIds.has(entry.id) ? { ...entry, state: 'DROPPED' as const } : entry),
    conflicts: [...schedule.conflicts,...timingUnavailable.map(({entry,message})=>({kind:'MEDIA_UNAVAILABLE' as const,itemId:entry.item.id,frames:0,severity:'ERROR' as const,message:`Será pulado: ${message}`})), ...unavailable.map((entry) => ({
      kind: 'MEDIA_UNAVAILABLE' as const, itemId: entry.item.id, frames: 0,
      severity: 'ERROR' as const, message: `Será pulado: ${(entry.asset?.probeError ?? (entry.asset && channel.qcProfile && assessQc(entry.asset, channel.qcProfile).errors.join(' '))) || (!qcApproved(entry.asset?.qcStatus ?? 'APPROVED') ? 'arquivo sem aprovação de QC' : 'arquivo removido do acervo')}`,
    }))],
  } }
}
