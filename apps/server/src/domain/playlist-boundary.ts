import { randomUUID, timingSafeEqual } from 'node:crypto'
import { and, asc, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { channels, operationalPlaylistRevisions, operatorDecisions, qcDecisions, rundowns, users } from '../db/schema.js'
import { toChannel } from '../db/repo.js'
import { applyQcDecisionsNow } from './qc-workflow.js'
import { readOperationalPayload } from './operational-playlist.js'
import { assertOperationalCadence } from './operational-cadence.js'
import { buildView } from './plan.js'
import { rundownMidnight } from './rundown-clock.js'
import { liveDurationLimit } from './live-timing.js'
import { installationVault } from './secret-vault.js'
import { AccessControl } from './access.js'
import { can, parseRole } from './permissions.js'
import { CollaborativeEditError } from './collaborative-edit.js'
import { hostname } from 'node:os'

export interface BoundaryOwner { userId: string | null; username: string | null; policy?: { id:string; version:number } }
export interface BoundaryPlan {
  channelId: string; sourceRundownId: string; sourceRevisionId: string; targetRundownId: string; targetRevisionId: string
  sourceName: string; targetName: string; targetDate: string; firstItemId: string; firstItemTitle: string
  notBeforeMs: number; token: string; owner: BoundaryOwner
}
export type BoundaryState = 'QUEUED' | 'PREPARING' | 'SWITCHING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'UNCERTAIN'
export interface BoundaryRun { id: string; plan: BoundaryPlan; state: BoundaryState; createdAt: string; updatedAt: string; processOwner?: string; message?: string; previousItemId?: string; previousFrames?: number }
const terminal = (state: BoundaryState) => ['CONFIRMED','FAILED','CANCELLED'].includes(state)
const key = (id: string) => `playlist-boundary:${id}`

export function boundaryAuthority(db: Db, owner: BoundaryOwner, channelId: string) {
  let continuityPolicy: {version:number;maxLateMinutes:number}|undefined
  if(owner.policy){
    const row=db.select().from(operatorDecisions).where(eq(operatorDecisions.id,owner.policy.id)).get()
    const saved=row?.payload as {channelId?:string;version?:number;state?:string;maxLateMinutes?:number;owner?:BoundaryOwner;worker?:{host:string;pid:number}}|undefined
    if(row?.kind!=='PUBLISHED_CONTINUITY_POLICY'||saved?.channelId!==channelId||saved.version!==owner.policy.version||saved.state!=='ENABLED'||saved.owner?.userId!==owner.userId||saved.owner?.username!==owner.username||saved.worker?.host!==hostname()||saved.worker.pid!==process.pid)throw new Error('A política de continuidade foi suspensa, alterada ou pertence a outro servidor. Nenhum TAKE automático será autorizado.')
    continuityPolicy={version:saved.version,maxLateMinutes:saved.maxLateMinutes!}
  }
  if (!owner.userId) {
    const access = new AccessControl(db.$client)
    if (access.required() || !can(access.role({headers:{}}),'PLAYLIST_PUBLISH')) throw new Error('A passagem sem conta identificada foi invalidada pela política de autenticação/permissões.')
    return { localRole: access.role({headers:{}}),continuityPolicy }
  }
  const account = db.select().from(users).where(eq(users.id,owner.userId)).get()
  if (!account?.enabled || account.username !== owner.username || !can(parseRole(account.role),'PLAYLIST_PUBLISH')) throw new Error('A conta que autorizou a passagem não pode mais publicar neste canal.')
  const policy = new AccessControl(db.$client).policy(owner.userId)
  const ids = policy.channelIds
  if (ids && !ids.includes(channelId)) throw new Error('O canal não pertence mais à conta que autorizou a passagem.')
  return { userId: account.id, username: account.username, role: account.role, enabled: account.enabled, policy,continuityPolicy }
}

/** Review of two actual frozen editions, not their current editorial drafts.
 * A durable owner account authorizes this one EOS transition, not recurring
 * selection/publication of unreviewed future schedules or a second engine. */
export function inspectBoundary(db: Db, channelId: string, sourceRevisionId: string, targetRevisionId: string, owner: BoundaryOwner): BoundaryPlan {
  return db.transaction(tx => {
    const channelRow = tx.select().from(channels).where(eq(channels.id,channelId)).get()
    if (!channelRow || channelRow.archivedAt) throw new Error('Canal ativo não encontrado.')
    const channel = toChannel(channelRow), permission = boundaryAuthority(db,owner,channelId)
    const source = tx.select().from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.id,sourceRevisionId)).get()
    const target = tx.select().from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.id,targetRevisionId)).get()
    if (!source?.active || !target?.active || source.rundownId === target.rundownId) throw new Error('Selecione outra grade com revisão publicada atual; origem/destino substituídos não podem ser usados.')
    const from = readOperationalPayload(source.payload), to = readOperationalPayload(target.payload)
    for (const payload of [from,to]) {
      if (payload.rundown.channelId !== channelId) throw new Error('As duas revisões devem pertencer ao mesmo canal.')
      assertOperationalCadence(tx,channel,payload)
    }
    if (from.rundown.loop) throw new Error('A grade de origem está em loop. Desative o loop e publique antes de enfileirar a próxima grade.')
    const base = rundownMidnight(to.rundown.date), fromBase = rundownMidnight(from.rundown.date)
    if (base === null || fromBase === null || base < fromBase) throw new Error('A data publicada do destino é inválida ou anterior à grade de origem.')
    const last = from.items.filter(item => from.schedule.items.find(timing => timing.id === item.id)?.state !== 'DROPPED').at(-1)
    if (!last?.autoNext || last.loop || ((last.type === 'LIVE' || last.eventType === 'LIVE') && liveDurationLimit(last,from.schedule.items.find(row=>row.id===last.id)?.duration ?? 0) === null)) throw new Error('O fim da origem aguarda TAKE ou live aberto; defina encerramento automático e publique antes de enfileirar.')
    const assets = applyQcDecisionsNow(tx,new Map((to.assets ?? []).map(asset=>[asset.id,asset])),channelId)
    const view = buildView(to.rundown,channel,to.items,assets,null,null), first = view.items[0], timing = view.schedule.items[0]
    if (!first?.asset || first.item.type === 'LIVE' || first.item.sourceRef || first.item.liveEndpoint || first.item.liveConfig?.sourceEndpoint || timing?.state === 'DROPPED' || !timing || timing.duration <= 0) throw new Error('O primeiro item do destino deve ser um vídeo aprovado; não será substituído silenciosamente por outro item.')
    if (view.schedule.conflicts.some(conflict=>conflict.severity==='ERROR')) throw new Error('O destino possui conflito impeditivo ou mídia sem aprovação. Corrija e publique antes de enfileirar.')
    if(owner.policy && permission.continuityPolicy && Date.now()>base+timing.start*channel.rate.den/channel.rate.num*1000+permission.continuityPolicy.maxLateMinutes*60_000)throw new Error('A próxima grade ultrapassou o atraso autorizado pela política; nenhum TAKE automático será enviado.')
    const ids = [...assets.keys()]
    const decisions = [] as (typeof qcDecisions.$inferSelect & {ordinal:number})[]
    for(let offset=0;offset<ids.length;offset+=400) decisions.push(...tx.select({...getTableColumns(qcDecisions),ordinal:sql<number>`rowid`}).from(qcDecisions).where(inArray(qcDecisions.assetId,ids.slice(offset,offset+400))).orderBy(asc(sql`rowid`)).all())
    decisions.sort((a,b)=>a.ordinal-b.ordinal)
    const provenance = {channelId,sourceRevisionId,targetRevisionId,owner}
    const token = installationVault().reviewIdentity(JSON.stringify({provenance,channel,permission,source,target,assets:[...assets],decisions}),'playlist-boundary-review:v1')
    return {...provenance,sourceRundownId:source.rundownId,targetRundownId:target.rundownId,sourceName:from.rundown.name,targetName:to.rundown.name,targetDate:to.rundown.date,
      firstItemId:first.item.id,firstItemTitle:first.item.title,notBeforeMs:base+timing.start*channel.rate.den/channel.rate.num*1000,token}
  })
}
export function requireBoundaryReview(plan: BoundaryPlan, token?: string) {
  if (!token) throw new CollaborativeEditError(428,{error:'Confira as duas revisões antes de autorizar a passagem automática.'})
  const expected = Buffer.from(plan.token), received = Buffer.from(token)
  if (expected.length !== received.length || !timingSafeEqual(expected,received)) throw new CollaborativeEditError(409,{error:'A revisão, mídia, QC, canal ou permissão mudou. Confira novamente; nenhuma passagem foi enfileirada.'})
}

/** Mutable state + append-only phase audit share one encrypted transaction.
 * Compare/read/write under IMMEDIATE gives a single claimant across processes.
 * PREPARING/SWITCHING owned by another process is never retried automatically. */
export class PlaylistBoundaryLedger {
  constructor(private readonly db: Db, private readonly channelId: string) {}
  list(): BoundaryRun[] {
    return this.db.select({entry:operatorDecisions}).from(operatorDecisions).innerJoin(rundowns,eq(rundowns.id,operatorDecisions.rundownId))
      .where(and(eq(operatorDecisions.kind,'PLAYLIST_BOUNDARY'),eq(rundowns.channelId,this.channelId)))
      .orderBy(desc(sql`operator_decisions.rowid`)).all().map(({entry})=>entry.payload as unknown as BoundaryRun)
      .filter(run=>run.plan.channelId===this.channelId)
  }
  read(id: string): BoundaryRun | null {
    const row = this.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,key(id))).get()
    return row?.kind==='PLAYLIST_BOUNDARY' && (row.payload as unknown as BoundaryRun).plan.channelId===this.channelId ? row.payload as unknown as BoundaryRun : null
  }
  enqueue(id: string, plan: BoundaryPlan, guard:()=>boolean=()=>true): BoundaryRun {
    return this.db.transaction(tx=>{
      const existing = this.read(id)
      if (plan.channelId!==this.channelId || !guard()) throw new Error('Canal, execução ou permissão mudou; nenhum pedido enfileirado.')
      if (existing) {
        if (existing.plan.token!==plan.token || existing.plan.owner.userId!==plan.owner.userId || existing.plan.owner.username!==plan.owner.username) throw new Error('Identificador já usado para outro pedido. Nenhuma passagem repetida.')
        return existing
      }
      if (this.list().some(run=>!terminal(run.state))) throw new Error('Há passagem pendente ou incerta neste canal. Cancele ou confira antes de enfileirar outra.')
      const at=new Date().toISOString(),run:BoundaryRun={id,plan,state:'QUEUED',createdAt:at,updatedAt:at}
      tx.insert(operatorDecisions).values({id:key(id),rundownId:plan.sourceRundownId,kind:'PLAYLIST_BOUNDARY',payload:run as unknown as Record<string,unknown>,actorUsername:plan.owner.username,createdAt:at}).run()
      return run
    },{behavior:'immediate'})
  }
  phase(id: string, allowed: readonly BoundaryState[], state: BoundaryState, guard:()=>boolean, detail: Partial<Pick<BoundaryRun,'processOwner'|'message'|'previousItemId'|'previousFrames'>>={}, actor: string|null=null): BoundaryRun {
    return this.db.transaction(tx=>{
      const run = this.read(id)
      if (!run || !allowed.includes(run.state) || !guard()) throw new Error('A passagem mudou ou foi cancelada; nenhum TAKE adicional será enviado.')
      const updated={...run,...detail,state,updatedAt:new Date().toISOString()}
      tx.update(operatorDecisions).set({payload:updated as unknown as Record<string,unknown>}).where(eq(operatorDecisions.id,key(id))).run()
      tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:run.plan.sourceRundownId,kind:'PLAYLIST_BOUNDARY_PHASE',payload:{transitionId:id,channelId:this.channelId,sourceRevisionId:run.plan.sourceRevisionId,targetRevisionId:run.plan.targetRevisionId,from:run.state,to:state,...detail},actorUsername:actor,createdAt:updated.updatedAt}).run()
      return updated
    },{behavior:'immediate'})
  }
}

/** Conservative local reconciliation only. A remote/unknown owner cannot
 * be fenced by looking at this machine's PIDs. PID reuse blocks, never retries. */
export function boundaryProcessesGone(run:BoundaryRun):boolean {
  try {
    const owner=JSON.parse(run.processOwner ?? '')
    if(owner.host!==hostname() || !Number.isInteger(owner.pid) || owner.pid<=0 || !Number.isInteger(owner.enginePid) || owner.enginePid<=0)return false
    for(const pid of [owner.pid,owner.enginePid]) {
      try {process.kill(pid,0);return false}
      catch(error) {if((error as NodeJS.ErrnoException).code!=='ESRCH')return false}
    }
    return true
  } catch {return false}
}
