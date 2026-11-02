import {randomUUID} from 'node:crypto'
import {isIP} from 'node:net'
import {eq} from 'drizzle-orm'
import {z} from 'zod'
import {accountCatalogETag,accountETag,accountSessionsETag,type AccountCatalogReview,type AccountSessionsReview,type ReviewedAccount} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {accountRevision} from '../db/account-revisions.js'
import {operatorDecisions,sessions,users} from '../db/schema.js'
import {AccessControl,normalizedIp,sessionDigest,sessionToken,type AccessRequest} from './access.js'
import {can,canManageRole,parseRole} from './permissions.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {AUTH_USER,AUTH_PASSWORD} from '../config.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export interface AccountAuthority {request: AccessRequest; ownerId: string | null}
const reject = (status: number,error: string): never => {throw new CollaborativeEditError(status,{error})}
const local = (ip?: string) => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip ?? '')
export const createAccountBody = z.object({username:z.string().trim().min(1).max(80),password:z.string().min(8).max(1024),role:z.enum(['OPERATOR','PROGRAMMER','SUPERVISOR','GESTOR','ADMIN'])}).strict()
export const updateAccountBody = z.object({password:z.string().min(8).max(1024).optional(),role:z.enum(['OPERATOR','PROGRAMMER','SUPERVISOR','GESTOR','ADMIN']).optional(),enabled:z.boolean().optional()}).strict().refine(value=>Object.keys(value).length>0)
const accessBody = z.object({channelIds:z.array(z.string().min(1)).max(128).nullable(),stationIps:z.array(z.string().refine(value=>isIP(value)>0)).max(128).nullable()}).strict()
export function captureAccountAuthority(db: Db,request: AccessRequest): AccountAuthority {
  return {request,ownerId:new AccessControl(db.$client).identity(request)?.id ?? null}
}
function authorize(db: Db,authority: AccountAuthority): ReturnType<AccessControl['identity']> {
  const access = new AccessControl(db.$client),identity = access.identity(authority.request)
  if ((identity?.id ?? null)!==authority.ownerId || access.required()&&!identity || !can(access.role(authority.request),'USER_MANAGE_LOWER') || identity?.channelIds!==undefined&&identity.channelIds!==null) reject(403,'Seu papel não permite gerenciar contas (ou a sessão expirou). Nada foi alterado.')
  return identity
}
/** O servidor é a fonte da regra: GESTOR só mexe em contas de papéis abaixo de GESTOR
 * (e só pode atribuir esses papéis); ADMIN mexe em todas. */
function requireManageable(db: Db,authority: AccountAuthority,...targets: Array<string|undefined>): void {
  const actor=new AccessControl(db.$client).role(authority.request)
  for(const target of targets)if(target!==undefined&&!canManageRole(actor,parseRole(target)))reject(403,'Seu papel não permite criar, editar ou promover contas Gestor ou Administrador. Peça a um Administrador; nada foi alterado.')
}
function catalog(db: Db): AccountCatalogReview {
  const rows = db.$client.prepare('SELECT id,username,role,enabled,created_at AS createdAt FROM users ORDER BY username,id').all() as Array<Omit<ReviewedAccount,'channelIds'|'stationIps'|'revision'|'enabled'>&{enabled:number}>
  if(rows.some(row=>row.enabled!==0&&row.enabled!==1))reject(409,'Há situação de conta salva inválida; nenhuma situação foi presumida.')
  const access = new AccessControl(db.$client)
  let reviewed: ReviewedAccount[]
  try {reviewed = rows.map(row=>({...row,enabled:Boolean(row.enabled),...access.policy(row.id),revision:accountRevision(db.$client,'U:'+row.id)}))}
  catch {reject(409,'Há política de conta salva inválida. Corrija explicitamente; nenhuma conta foi omitida ou normalizada.')}
  return {revision:accountRevision(db.$client,'G'),users:reviewed!,bootstrapAllowed:false,canCreate:false}
}
function catalogFor(db: Db,authority: AccountAuthority): AccountCatalogReview {
  authorize(db,authority)
  const value=catalog(db),required=new AccessControl(db.$client).required()
  return {...value,bootstrapAllowed:!required&&value.users.length===0&&local(authority.request.ip),canCreate:required||local(authority.request.ip)}
}
export function readAccountCatalog(db: Db,authority: AccountAuthority): AccountCatalogReview {
  return db.transaction(()=>catalogFor(db,authority))
}
function sessionReview(db: Db,id: string,authority?: AccountAuthority): AccountSessionsReview {
  const user=db.$client.prepare('SELECT username,role FROM users WHERE id=?').get(id) as {username:string;role:string} | undefined
  if(!user)reject(404,'Conta não encontrada.')
  if(authority)requireManageable(db,authority,user!.role)
  return {userId:id,username:user!.username,accountRevision:accountRevision(db.$client,'U:'+id),revision:accountRevision(db.$client,'S:'+id),sessions:db.$client.prepare('SELECT created_at AS createdAt,expires_at AS expiresAt FROM sessions WHERE user_id=? ORDER BY created_at,expires_at,token').all(id) as AccountSessionsReview['sessions']}
}
export function readAccountSessions(db: Db,id: string,authority: AccountAuthority): AccountSessionsReview {
  return db.transaction(()=>{authorize(db,authority);return sessionReview(db,id,authority)})
}
function requireProof(header: unknown,expected: string,kind:'catalog'|'user'|'sessions',id?:string): void {
  if(header===undefined)reject(428,'Confira as contas/sessões antes de alterar. Revisão original obrigatória.')
  const pattern = kind==='catalog' ? /^"accounts:catalog:([1-9]\d*)"$/ : new RegExp(`^"accounts:${kind}:([^:]+):([1-9]\\d*):([1-9]\\d*)"$`)
  const match = typeof header==='string'?pattern.exec(header):null
  let owner: string | undefined;try {owner=kind==='catalog'?undefined:match?decodeURIComponent(match[1]!):undefined}catch{}
  const numbers = match?.slice(kind==='catalog'?1:2).map(Number)
  if(!match||kind!=='catalog'&&owner!==id||numbers?.some(value=>!Number.isSafeInteger(value)||value<1))reject(400,'Revisão de contas inválida ou de outra conta.')
  if(header!==expected)reject(409,'Contas, acesso ou sessões mudaram desde a conferência. Reabra explicitamente; seus campos não foram aplicados.')
}
function audit(tx: Tx,kind: string,actor: string|null,details: Record<string,unknown>): void {
  tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@security',kind,payload:details,actorUsername:actor,createdAt:new Date().toISOString()}).run()
}
function response(db: Db,canCreate=true) {const value=catalog(db);return {...value,canCreate,applied:true as const,eTag:accountCatalogETag(value)}}
const usableAdmin=(user:ReviewedAccount)=>user.enabled&&user.role==='ADMIN'&&user.channelIds===null&&(user.stationIps===null||user.stationIps.some(ip=>isIP(ip)>0))
export function checkCreateAccountReview(db: Db,header: unknown,authority: AccountAuthority) {
  return db.transaction(()=>{const before=catalogFor(db,authority);if(!before.canCreate)reject(403,'Crie a primeira conta pela página local do servidor.');requireProof(header,accountCatalogETag(before),'catalog');return before})
}
export function checkUpdateAccountReview(db: Db,id: string,header: unknown,authority: AccountAuthority) {
  return db.transaction(()=>{authorize(db,authority);const before=catalog(db);if(!before.users.some(user=>user.id===id))reject(404,'Conta não encontrada.');requireProof(header,accountETag(before,id),'user',id);return before})
}

export function createAccount(db: Db,input: z.infer<typeof createAccountBody>,passwordHash: string,header: unknown,authority: AccountAuthority) {
  return db.transaction(tx=>{
    const actor=authorize(db,authority),before=catalog(db)
    requireProof(header,accountCatalogETag(before),'catalog')
    requireManageable(db,authority,input.role)
    const bootstrap=!new AccessControl(db.$client).required()
    if(bootstrap&&(!local(authority.request.ip)||input.role!=='ADMIN'||before.users.length!==0))reject(403,'A primeira conta precisa ser Administrador, criada pela página local do servidor.')
    if(db.$client.prepare('SELECT 1 FROM users WHERE username=?').get(input.username))reject(409,'Esse usuário já existe; nada foi alterado.')
    const row={id:randomUUID(),username:input.username,passwordHash,role:input.role,enabled:true,createdAt:new Date().toISOString()}
    tx.insert(users).values(row).run()
    audit(tx,'USER_CREATED',actor?.username??null,{userId:row.id,username:row.username,role:row.role,station:authority.request.ip,reviewedRevision:before.revision,bootstrap})
    return {...response(db,!bootstrap),requiresLogin:bootstrap,user:{id:row.id,username:row.username,role:row.role,enabled:true}}
  },{behavior:'immediate'})
}
export function updateAccount(db: Db,id: string,input: z.infer<typeof updateAccountBody>,passwordHash: string|undefined,header: unknown,authority: AccountAuthority) {
  return db.transaction(tx=>{
    const actor=authorize(db,authority),before=catalog(db),target=before.users.find(user=>user.id===id)
    if(!target)reject(404,'Conta não encontrada.')
    requireManageable(db,authority,target!.role,input.role)
    requireProof(header,accountETag(before,id),'user',id)
    const nextRole=input.role??target!.role,nextEnabled=input.enabled??target!.enabled
    const policy=new AccessControl(db.$client).policy(id)
    if(nextRole==='ADMIN'&&policy.channelIds!==null)reject(409,'Remova a restrição de canais explicitamente antes de promover a Administrador.')
    if(target!.enabled&&target!.role==='ADMIN'&&(!nextEnabled||nextRole!=='ADMIN')&&!before.users.some(user=>user.id!==id&&usableAdmin(user)))reject(409,'Mantenha ao menos um administrador ativo e acessível para não bloquear a instalação.')
    if(input.password!==undefined&&!passwordHash)throw new Error('Hash preparado ausente; nenhuma alteração aplicada.')
    tx.update(users).set({...(input.role?{role:input.role}:{}),...(input.enabled===undefined?{}:{enabled:input.enabled}),...(passwordHash?{passwordHash}:{})}).where(eq(users.id,id)).run()
    const revoked=tx.delete(sessions).where(eq(sessions.userId,id)).run().changes
    audit(tx,'USER_UPDATED_SESSIONS_REVOKED',actor?.username??null,{userId:id,role:input.role,roleFrom:target!.role,roleTo:nextRole,enabled:input.enabled,enabledFrom:target!.enabled,enabledTo:nextEnabled,passwordChanged:input.password!==undefined,revokedCount:revoked,station:authority.request.ip,reviewedRevision:before.revision,reviewedAccountRevision:target!.revision})
    return {...response(db,actor?.id!==id),ok:true,requiresLogin:actor?.id===id}
  },{behavior:'immediate'})
}
export function changeAccountAccess(db: Db,id: string,body: unknown,header: unknown,authority: AccountAuthority) {
  const parsed=accessBody.safeParse(body);if(!parsed.success)reject(400,'Informe canais existentes e IPs válidos; vazio bloqueia, sem restrição permite todos.')
  const input=parsed.data!
  return db.transaction(tx=>{
    const actor=authorize(db,authority),before=catalog(db),target=before.users.find(user=>user.id===id)
    if(!target)reject(404,'Conta não encontrada.')
    requireManageable(db,authority,target!.role)
    requireProof(header,accountETag(before,id),'user',id)
    const channelIds=input.channelIds===null?null:[...new Set(input.channelIds)],stationIps=input.stationIps===null?null:[...new Set(input.stationIps.map(normalizedIp))]
    if(target!.role==='ADMIN'&&channelIds!==null)reject(409,'Administradores precisam conservar acesso a todos os canais.')
    if(channelIds?.some(id=>!db.$client.prepare('SELECT 1 FROM channels WHERE id=?').get(id)))reject(400,'Um dos canais selecionados não existe.')
    if(actor?.id===id&&stationIps!==null&&!stationIps.includes(normalizedIp(authority.request.ip??'')))reject(409,'Não remova sua estação atual da própria conta.')
    if(target!.enabled&&target!.role==='ADMIN'&&stationIps?.length===0&&!before.users.some(user=>user.id!==id&&usableAdmin(user)))reject(409,'Mantenha ao menos um administrador ativo e acessível.')
    db.$client.prepare('INSERT INTO user_access VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET channel_ids=excluded.channel_ids,station_ips=excluded.station_ips,updated_at=excluded.updated_at').run(id,channelIds===null?null:JSON.stringify(channelIds),stationIps===null?null:JSON.stringify(stationIps),new Date().toISOString())
    const revoked=tx.delete(sessions).where(eq(sessions.userId,id)).run().changes
    audit(tx,'USER_ACCESS_CHANGED_SESSIONS_REVOKED',actor?.username??null,{userId:id,channelIds,stationIps,revokedCount:revoked,station:authority.request.ip,reviewedRevision:before.revision,reviewedAccountRevision:target!.revision})
    return {...response(db,actor?.id!==id),ok:true,requiresLogin:actor?.id===id}
  },{behavior:'immediate'})
}
export function revokeAccountSessions(db: Db,id: string,header: unknown,authority: AccountAuthority) {
  return db.transaction(tx=>{
    const actor=authorize(db,authority),before=sessionReview(db,id,authority)
    requireProof(header,accountSessionsETag(before),'sessions',id)
    const revoked=tx.delete(sessions).where(eq(sessions.userId,id)).run().changes
    // Empty revocation must consume its proof too; otherwise a failed client
    // can reuse an old confirmation indefinitely (the audit is still atomic).
    if(!revoked)db.$client.prepare('UPDATE account_versions SET version=version+1 WHERE scope=?').run('S:'+id)
    audit(tx,'SESSIONS_REVOKED',actor?.username??null,{userId:id,revokedCount:revoked,station:authority.request.ip,reviewedAccountRevision:before.accountRevision,reviewedSessionsRevision:before.revision})
    const review=sessionReview(db,id)
    return {...review,ok:true,applied:true,revokedCount:revoked,eTag:accountSessionsETag(review),requiresLogin:actor?.id===id}
  },{behavior:'immediate'})
}
export function logoutAccount(db: Db,request: AccessRequest) {
  return db.transaction(tx=>{
    const token=sessionToken(request);if(!token||token.length>256)return {ok:true}
    const digest=sessionDigest(token),session=tx.select().from(sessions).where(eq(sessions.token,digest)).get()
    if(!session)return {ok:true}
    const user=tx.select().from(users).where(eq(users.id,session.userId)).get()
    tx.delete(sessions).where(eq(sessions.token,digest)).run()
    audit(tx,'SESSION_ENDED',user?.username??null,{userId:session.userId,station:request.ip})
    return {ok:true}
  },{behavior:'immediate'})
}
/** Explicit environment credentials are verified by the caller, not a role
 * header. Recheck absence after asynchronous hashing; never add a recovery
 * admin to an already configured/disabled/inconsistent installation. */
export function bootstrapConfiguredAccount(db: Db,username: string,passwordHash: string,station: string) {
  return db.transaction(tx=>{
    if(!AUTH_USER||!AUTH_PASSWORD||username!==AUTH_USER||db.$client.prepare('SELECT 1 FROM users LIMIT 1').get())reject(401,'A configuração de contas mudou. Entre com uma conta existente; nenhum administrador adicional foi criado.')
    const row={id:randomUUID(),username,passwordHash,role:'ADMIN',enabled:true,createdAt:new Date().toISOString()}
    tx.insert(users).values(row).run()
    audit(tx,'USER_BOOTSTRAPPED',null,{userId:row.id,username,role:row.role,station})
    return row
  },{behavior:'immediate'})
}
