import {randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {operatorDecisions,sessions} from '../db/schema.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'

/** Maintenance, never a side effect of a permission/read check. Expiry denies
 * access immediately; bounded cleanup/audit runs separately. No session token
 * or digest appears in audit. An audit failure rolls back deletion. */
export function expireSessions(db:Db,at=new Date().toISOString(),limit=100):number{
  if(!Number.isFinite(Date.parse(at))||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('Parâmetros de expiração inválidos.')
  if(isRecoveryRehearsal(db.$client))return 0
  return db.transaction(tx=>{
    if(isRecoveryRehearsal(db.$client))return 0
    const expired=db.$client.prepare(`SELECT s.token,s.user_id AS userId,s.created_at AS createdAt,s.expires_at AS expiresAt,u.username
      FROM sessions s LEFT JOIN users u ON u.id=s.user_id
      WHERE julianday(s.expires_at) IS NULL OR julianday(s.expires_at)<=julianday(?)
      ORDER BY s.expires_at,s.token LIMIT ?`).all(at,limit) as Array<{token:string;userId:string;createdAt:string;expiresAt:string;username:string|null}>
    for(const row of expired){
      tx.delete(sessions).where(eq(sessions.token,row.token)).run()
      tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@security',kind:'SESSION_EXPIRED',actorUsername:row.username,createdAt:at,payload:{userId:row.userId,sessionCreatedAt:row.createdAt,expiresAt:row.expiresAt,invalidExpiration:!Number.isFinite(Date.parse(row.expiresAt)),automatic:true}}).run()
    }
    return expired.length
  },{behavior:'immediate'})
}
