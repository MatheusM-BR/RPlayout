// NOT_RUN: journal/contracts with fake evidence, no files/probe/native checks.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {HaReturnMediaReviews,haReturnMediaReviewRequest,decodePrivateReturnMediaEvidence,HA_RETURN_MEDIA_REVIEW_RESERVE} from './ha-return-media-review.js'
import type {inspectReturnLocalMedia} from './ha-return-local-media.js'
const request=()=>({mediaReviewId:randomUUID(),applicationId:randomUUID(),channelId:'ch'})
it('pedido só IDs; UUID consulta; nenhuma análise em paralelo com intenção pendente — NOT_RUN',()=>{
  const db=new Database(':memory:'),body=request()
  try{
    const journal=new HaReturnMediaReviews(db,'media-contract','boot-a');expect(haReturnMediaReviewRequest.safeParse({...body,file:'foreign.mp4'}).success).toBe(false)
    const first=journal.accept(body);expect(journal.accept(body)).toEqual(first);expect(first.operationalReady).toBe(false)
    expect(()=>journal.accept(request())).toThrow('ativa/interrompida');expect(()=>journal.accept({...body,applicationId:randomUUID()})).toThrow('outra intenção')
    const next=new HaReturnMediaReviews(db,'media-contract','boot-b');expect(next.query(body.mediaReviewId,'ch').ownedHere).toBe(false);expect(()=>next.fail(body)).toThrow('estrangeira')
    journal.fail(body);expect(journal.query(body.mediaReviewId,'ch').phase).toBe('FAILED');expect(journal.reservedBytes()).toBe(HA_RETURN_MEDIA_REVIEW_RESERVE)
  }finally{db.close()}
})
it('escolhas exigem inventário e SHA único, não arquivo arbitrário — NOT_RUN',()=>{
  const base=request(),choice={contentHash:'a'.repeat(64),localAssetId:'local-asset'}
  expect(haReturnMediaReviewRequest.safeParse({...base,mediaChoices:[choice]}).success).toBe(false)
  expect(haReturnMediaReviewRequest.safeParse({...base,inventoryMac:'a'.repeat(43),mediaChoices:[choice]}).success).toBe(true)
  expect(haReturnMediaReviewRequest.safeParse({...base,inventoryMac:'a'.repeat(43),mediaChoices:[choice,choice]}).success).toBe(false)
  expect(haReturnMediaReviewRequest.safeParse({...base,inventoryMac:'a'.repeat(43),mediaChoices:[{...choice,path:'foreign.mp4'}]}).success).toBe(false)
})
it('evidência protegida não aparece na consulta e revisão não autoriza operação — NOT_RUN',async()=>{
  const db=new Database(':memory:'),body=request()
  try{
    const journal=new HaReturnMediaReviews(db,'media-contract','boot-a');journal.accept(body)
    // Intentionally historical evidence: later audio/graphics fields absent.
    const proof={checkedAt:new Date().toISOString(),runtimeHash:'a'.repeat(64),inventoryIdentity:'PRIVATE_MEDIA_PATH',required:new Map(),evidence:new Map(),localAssets:new Map(),mounts:[],reviewCompleted:true,requiredHashes:0,verifiedHashes:0,bytesAndDecodeComplete:true,publicationAuthorized:false,operationalReady:false} as unknown as Awaited<ReturnType<typeof inspectReturnLocalMedia>>
    let checks=0
    const result=await journal.run(body,'b'.repeat(64),async()=>proof,async()=>{checks++})
    expect(checks).toBe(2);expect(result.phase).toBe('REVIEWED');expect(result.result?.operationalReady).toBe(false);expect(result.result?.publicationAuthorized).toBe(false)
    expect(JSON.stringify(result)).not.toContain('PRIVATE_MEDIA_PATH');expect('privateEvidence' in result).toBe(false)
    expect(result.result?.graphics).toBeUndefined() // legacy receipt stays legacy
    expect((db.prepare('SELECT payload FROM ha_return_media_reviews').get() as {payload:string}).payload).not.toContain('PRIVATE_MEDIA_PATH')
    const privateProof=journal.privateEvidence(body.mediaReviewId,'ch','b'.repeat(64));expect(privateProof.evidence.inventoryIdentity).toBe('PRIVATE_MEDIA_PATH');expect(privateProof.operationalReady).toBe(false)
    expect(decodePrivateReturnMediaEvidence(privateProof.request,privateProof.result,privateProof.encodedEvidence,'b'.repeat(64)).result.evidenceMac).toBe(privateProof.result.evidenceMac)
    expect(()=>decodePrivateReturnMediaEvidence(privateProof.request,privateProof.result,privateProof.encodedEvidence+' ','b'.repeat(64))).toThrow('divergente')
    expect(()=>journal.privateEvidence(body.mediaReviewId,'ch','c'.repeat(64))).toThrow('divergente')
    const successor=new HaReturnMediaReviews(db,'media-contract','boot-b');expect(()=>successor.privateEvidence(body.mediaReviewId,'ch','b'.repeat(64))).toThrow('própria')
    expect(()=>journal.fail(body)).toThrow('confirmada');expect(journal.accept(request()).phase).toBe('ACCEPTED')
  }finally{db.close()}
})
it('graphic receipts are encrypted and only aggregate counts reach the query — NOT_RUN',async()=>{
  const db=new Database(':memory:'),body=request()
  try{
    const journal=new HaReturnMediaReviews(db,'graphic-contract','boot-a');journal.accept(body)
    const entries=[{key:'c'.repeat(64),revisionId:'rev',itemId:'graphic',compositionHash:'d'.repeat(64),status:'UNAVAILABLE',frame:null}]
    const summary={required:1,rendered:0,failed:0,unavailable:1,blocked:0,visualApprovalPending:1,publicationAuthorized:false}
    // Historical graphic receipt predates rendered-audio evidence.
    const proof={checkedAt:new Date().toISOString(),runtimeHash:'a'.repeat(64),inventoryIdentity:'PRIVATE_MEDIA_PATH',required:new Map(),evidence:new Map(),localAssets:new Map(),mounts:[{revisionId:'rev',itemId:'graphic',errors:[],warnings:['LOCAL_GRAPHIC_RENDER_PENDING','LOCAL_GRAPHIC_RUNTIME_UNAVAILABLE'],livePending:false}],graphics:{evidence:{version:1,runtimeHash:null,entries},summary},reviewCompleted:true,requiredHashes:0,verifiedHashes:0,bytesAndDecodeComplete:true,publicationAuthorized:false,operationalReady:false} as unknown as Awaited<ReturnType<typeof inspectReturnLocalMedia>>
    const result=await journal.run(body,'b'.repeat(64),async()=>proof,async()=>{})
    expect(result.result?.graphics).toEqual(summary)
    expect(JSON.stringify(result)).not.toContain('compositionHash')
    const receipt=journal.privateEvidence(body.mediaReviewId,'ch','b'.repeat(64))
    expect(receipt.evidence.graphics?.entries).toEqual(entries)
    expect(()=>decodePrivateReturnMediaEvidence(receipt.request,{...receipt.result,graphics:{...summary,unavailable:0,rendered:1}},receipt.encodedEvidence,'b'.repeat(64))).toThrow('gráfica')
  }finally{db.close()}
})
