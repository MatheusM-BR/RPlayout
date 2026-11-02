// NOT_RUN: input-mapping/job/admission contracts, no files/workers/native checks.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {bindReturnInputs,haReturnBoundCandidateJob} from './ha-return-bound-candidate.js'
import {haSourceBindingKey} from './ha-bindings.js'
import type {OperationalPayload} from './operational-playlist.js'
import {assertNoUnboundReturnCandidate} from '../db/return-candidate-admission.js'
const payload=()=>({version:1,rundown:{id:'rd',channelId:'ch'},items:[{id:'live',type:'LIVE',title:'Estúdio',sourceRef:'ndi:RESERVE',liveEndpoint:'ndi:RESERVE',liveConfig:{sourceEndpoint:'ndi:RESERVE'}},{id:'vt',type:'VIDEO',title:'VT',mediaId:'asset'}],assets:[{id:'asset',path:'C:/foreign/VT.mp4',contentHash:'a'.repeat(64),qcStatus:'APPROVED'}],graphics:{templates:[{id:'foreign-graphic'}],cues:[]},secondaryEvents:[{id:'foreign-event'}],schedule:{}} as unknown as OperationalPayload)
const plan=()=>({planId:randomUUID(),bindingDigest:'b'.repeat(64),inputs:[{sourceKey:haSourceBindingKey('ndi:RESERVE'),local:{key:'configured:local-source',label:'ESTÚDIO-ÇÃO',family:'NDI',reference:'ndi:LOCAL-ÇÃO'}}],outputs:[]})
it('vínculo aplicado em clone e original/cortes preservados — NOT_RUN',()=>{
  const original=payload(),before=JSON.stringify(original),result=bindReturnInputs(original,plan())
  expect(JSON.stringify(original)).toBe(before)
  expect(result.payload.items[0]?.sourceRef).toBe('ndi:LOCAL-ÇÃO');expect(result.payload.items[0]?.liveEndpoint).toBe('ndi:LOCAL-ÇÃO');expect(result.payload.items[0]?.liveConfig?.sourceEndpoint).toBe('ndi:LOCAL-ÇÃO');expect(result.payload.items[0]?.configuredSourceId).toBe('local-source')
  expect(result.payload.assets?.[0]?.path).toBe('');expect(result.payload.assets?.[0]?.qcStatus).toBe('BLOCKED');expect(result.payload.graphics.templates).toEqual([]);expect(result.payload.secondaryEvents).toEqual([])
})
it('referência conflitante, protocolo errado, duplicata ou live sem referência recusados — NOT_RUN',()=>{
  const bad=payload();bad.items[0]={...bad.items[0]!,liveEndpoint:'ndi:OTHER'};expect(()=>bindReturnInputs(bad,plan())).toThrow('conflitantes')
  const wrong=plan();wrong.inputs[0]!.local.reference='omt:LOCAL';expect(()=>bindReturnInputs(payload(),wrong)).toThrow('protocolo')
  const duplicate=plan();duplicate.inputs.push(duplicate.inputs[0]!);expect(()=>bindReturnInputs(payload(),duplicate)).toThrow('duplicadas')
  const missing=payload();missing.items[0]={...missing.items[0]!,sourceRef:null,liveEndpoint:null,liveConfig:null};expect(()=>bindReturnInputs(missing,plan())).toThrow('referência explícita')
})
it('contrato interno não aceita arquivo/destino arbitrário ou autorização — NOT_RUN',()=>{
  const job={applicationId:randomUUID(),candidate:{candidateId:randomUUID(),planId:randomUUID(),channelId:'ch'},sourceDatabaseHash:'c'.repeat(64),sourceDatabaseBytes:1024,vaultFingerprint:'d'.repeat(64),recordedAt:new Date().toISOString(),plan:plan()}
  expect(haReturnBoundCandidateJob.safeParse(job).success).toBe(true)
  for(const extra of [{file:'active.db'},{publicationAuthorized:true},{nativePrepared:true}])expect(haReturnBoundCandidateJob.safeParse({...job,...extra}).success).toBe(false)
})
it('marcador de derivada com vínculos também bloqueia bootstrap operacional — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{db.exec('CREATE TABLE ha_return_bound_origin(id INTEGER PRIMARY KEY,payload TEXT)');expect(()=>assertNoUnboundReturnCandidate(db)).toThrow('partida operacional bloqueada')}finally{db.close()}
})
