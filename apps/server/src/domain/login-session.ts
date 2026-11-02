import {randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {operatorDecisions,sessions,users} from '../db/schema.js'
import {AccessControl,normalizedIp,sessionDigest} from './access.js'
import {parseRole} from './permissions.js'
import {CollaborativeEditError} from './collaborative-edit.js'

/** Called only after password verification. The verified account/hash is the
 * original proof; re-reading a new hash must never authorize an old password. */
export function issueLoginSession(db:Db,verified:{id:string;username:string;passwordHash:string},station:string){
  return db.transaction(tx=>{
    const account=tx.select().from(users).where(eq(users.id,verified.id)).get()
    const role=parseRole(account?.role)
    if(!account?.enabled||account.username!==verified.username||account.passwordHash!==verified.passwordHash||role==='DENIED'){
      throw new CollaborativeEditError(401,{error:'Conta ou credenciais mudaram. Confira o acesso antes de entrar novamente.'})
    }
    let policy:ReturnType<AccessControl['policy']>
    // Drizzle's transaction has no $client; the parent database owns the same
    // synchronous SQLite connection, already locked by this IMMEDIATE txn.
    try{policy=new AccessControl(db.$client).policy(account.id)}catch{
      throw new CollaborativeEditError(403,{error:'Política de acesso inválida. Peça ao administrador para revisar a conta.'})
    }
    if(policy.stationIps!==null&&!policy.stationIps.includes(normalizedIp(station))){
      throw new CollaborativeEditError(403,{error:'Esta estação não está autorizada para a conta. Peça ao administrador para revisar os endereços permitidos.'})
    }
    const token=randomUUID()+randomUUID(),now=new Date(),expiresAt=new Date(now.getTime()+43_200_000).toISOString()
    tx.insert(sessions).values({token:sessionDigest(token),userId:account.id,expiresAt,createdAt:now.toISOString()}).run()
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@security',kind:'SESSION_CREATED',payload:{userId:account.id,station},actorUsername:account.username,createdAt:now.toISOString()}).run()
    return {token,role,expiresAt}
  },{behavior:'immediate'})
}
