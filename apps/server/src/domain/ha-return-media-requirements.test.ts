// NOT_RUN: fixtures only; no file/network/native signal verification.
import {it,expect} from 'vitest'
import {returnMediaRequirements} from './ha-return-media-requirements.js'
import type {OperationalPayload} from './operational-playlist.js'
import type {HaSnapshot} from './ha-replication.js'
const primary:HaSnapshot['channels'][number]={channelId:'ch',configuration:{mediaFacts:[],qc:[]},revisions:[],checkpoint:null,transport:null,blockers:{}}
const makePayload=(items:unknown[],assets:unknown[]=[])=>({version:1,rate:{num:25,den:1},audioChannels:2,rundown:{id:'r',channelId:'ch'},items,assets,schedule:{}} as unknown as OperationalPayload)
it('entrada recebida exige vínculo local, sem reutilizar endpoint estrangeiro — NOT_RUN',()=>{
  const check=returnMediaRequirements(primary)(makePayload([{id:'live',type:'LIVE',sourceRef:'ndi:foreign-private'}]))
  expect(check[0]!.errors).toContain('LIVE_LOCAL_BINDING_AND_SIGNAL_REQUIRED')
  expect(check[0]!.livePending).toBe(true)
  expect(JSON.stringify(check)).not.toContain('foreign-private')
})
it('mesmo asset com outro SHA não comprova versão local — NOT_RUN',()=>{
  const asset={id:'a',contentHash:'a'.repeat(64),path:'foreign-path',kind:'VIDEO'}
  const local={...primary,configuration:{mediaFacts:[{...asset,contentHash:'b'.repeat(64)}],qc:[]}}
  const checks=returnMediaRequirements(local)(makePayload([{id:'i',type:'VT',mediaId:'a'}],[asset]))
  expect(checks[0]!.errors).toContain('MEDIA_VERSION_NOT_IN_PRIMARY_SNAPSHOT')
  expect(JSON.stringify(checks)).not.toContain('foreign-path')
})
it('revogação global posterior invalida aprovação anterior do canal — NOT_RUN',()=>{
  const asset={id:'a',contentHash:'a'.repeat(64),kind:'VIDEO',probeError:'not-decoded'}
  const local={...primary,configuration:{mediaFacts:[asset],qc:[{assetId:'a',contentHash:asset.contentHash,channelId:'ch',status:'APPROVED'},{assetId:'a',contentHash:asset.contentHash,channelId:'@all',status:'REJECTED'}]}}
  const checks=returnMediaRequirements(local)(makePayload([{id:'i',type:'VT',mediaId:'a'}],[asset]))
  expect(checks[0]!.errors).toContain('PRIMARY_QC_NOT_APPROVED')
  expect(checks[0]!.warnings).toContain('LOCAL_BYTES_AND_DECODE_REVALIDATION_REQUIRED')
})
