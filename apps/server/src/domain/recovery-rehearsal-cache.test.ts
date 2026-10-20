import {randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {readRestoredActivations,restoredActivationSignature,type RestoredActivation} from '../db/restored-activations.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'

const databases:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.sqlite.close();vi.restoreAllMocks()})
function setup(){const db=openDatabase(':memory:');databases.push(db);return db}
function activation(phase:'STARTING'|'FAILED'):RestoredActivation{
  return {version:1,id:randomUUID(),requestId:randomUUID(),instanceId:randomUUID(),phase,startedAt:new Date().toISOString(),finishedAt:phase==='STARTING'?null:new Date().toISOString(),nativeReadyChannels:[],resumedChannels:[],message:null,originTable:null,automaticPromotion:false,physicalOutputValidated:false}
}
const insert=(sqlite:ReturnType<typeof openDatabase>['sqlite'],row:RestoredActivation)=>sqlite.prepare('INSERT INTO restored_activation_runs VALUES(?,?,?)').run(row.id,JSON.stringify(row),restoredActivationSignature(row))
/** Counts statements by SQL text; the hot path must stay at one fingerprint. */
function countPrepares(sqlite:ReturnType<typeof openDatabase>['sqlite']){
  const seen:string[]=[],original=sqlite.prepare.bind(sqlite)
  vi.spyOn(sqlite,'prepare').mockImplementation(((source:string)=>{seen.push(source);return original(source)}) as typeof sqlite.prepare)
  return seen
}

it('decisão sem mudança custa uma consulta e não revalida assinaturas',()=>{
  const db=setup()
  expect(isRecoveryRehearsal(db.sqlite)).toBe(false)
  const seen=countPrepares(db.sqlite)
  for(let i=0;i<50;i++)expect(isRecoveryRehearsal(db.sqlite)).toBe(false)
  expect(seen).toHaveLength(50)
  expect(seen.every(sql=>sql.includes('pragma_schema_version'))).toBe(true)
})
it('marcador de quarentena criado depois invalida a decisão (DDL muda schema_version)',()=>{
  const db=setup()
  expect(isRecoveryRehearsal(db.sqlite)).toBe(false)
  db.sqlite.exec('CREATE TABLE ha_recovery_origin(id INTEGER PRIMARY KEY,payload TEXT)')
  expect(isRecoveryRehearsal(db.sqlite)).toBe(true)
  db.sqlite.exec('DROP TABLE ha_recovery_origin')
  expect(isRecoveryRehearsal(db.sqlite)).toBe(false)
})
it('ativação nova, mudança de fase e adulteração sem assinatura são vistas na hora',()=>{
  const db=setup()
  expect(isRecoveryRehearsal(db.sqlite)).toBe(false)
  const started=activation('STARTING');insert(db.sqlite,started)
  expect(isRecoveryRehearsal(db.sqlite)).toBe(true)
  expect(readRestoredActivations(db.sqlite)).toEqual([started])
  const failed={...started,phase:'FAILED' as const,finishedAt:new Date().toISOString()}
  db.sqlite.prepare('UPDATE restored_activation_runs SET payload=?,signature=? WHERE id=?').run(JSON.stringify(failed),restoredActivationSignature(failed),started.id)
  expect(isRecoveryRehearsal(db.sqlite)).toBe(true)
  expect(readRestoredActivations(db.sqlite)).toEqual([failed])
  // Payload changed without a valid signature: full validation reruns and fails closed.
  db.sqlite.prepare('UPDATE restored_activation_runs SET payload=? WHERE id=?').run(JSON.stringify({...failed,message:'x'}),started.id)
  expect(isRecoveryRehearsal(db.sqlite)).toBe(true)
  expect(()=>readRestoredActivations(db.sqlite)).toThrow('inválido')
})
it('proteção removida ou marcador de migração apagado não ficam escondidos pelo cache',()=>{
  const db=setup()
  expect(readRestoredActivations(db.sqlite)).toEqual([])
  db.sqlite.exec('DROP TRIGGER restored_activation_delete')
  expect(()=>readRestoredActivations(db.sqlite)).toThrow('Proteção')
  expect(isRecoveryRehearsal(db.sqlite)).toBe(true)
  const other=setup();expect(readRestoredActivations(other.sqlite)).toEqual([])
  other.sqlite.prepare('DELETE FROM schema_migrations WHERE version=44').run()
  expect(()=>readRestoredActivations(other.sqlite)).toThrow('migração')
})
it('resultado devolvido é cópia: alterar o array não contamina a próxima leitura',()=>{
  const db=setup(),row=activation('FAILED');insert(db.sqlite,row)
  const first=readRestoredActivations(db.sqlite);first[0]!.nativeReadyChannels.push('x');first.pop()
  expect(readRestoredActivations(db.sqlite)).toEqual([row])
})
