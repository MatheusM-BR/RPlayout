// NOT_RUN: fixtures prepared for consolidated validation; not executed.
import Database from 'better-sqlite3'
import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {installationVault} from './secret-vault.js'
import {haRekeyReviewContext,inspectRekeyedFields} from './ha-rekeyed-fields-review.js'
import {haReturnReviewRequest} from './ha-return-store.js'

it('seleção da derivada aceita somente IDs, não caminhos/chaves — NOT_RUN',()=>{
  const request={reviewId:randomUUID(),transferId:randomUUID(),channelId:'ch',rekeyId:randomUUID()}
  expect(haReturnReviewRequest.safeParse(request).success).toBe(true)
  expect(haReturnReviewRequest.safeParse({...request,file:'foreign.db'}).success).toBe(false)
  expect(haReturnReviewRequest.safeParse({...request,rekeyId:'invalid'}).success).toBe(false)
  expect(haRekeyReviewContext.safeParse({exportId:randomUUID(),vaultFingerprint:'a'.repeat(64),installationKey:'secret'}).success).toBe(false)
})
it('confirma legibilidade sem retornar segredo/aprovar conteúdo — NOT_RUN',()=>{
  const db=new Database(':memory:'),vault=installationVault(false),exportId=randomUUID()
  try{
    db.exec('CREATE TABLE output_profiles(id TEXT PRIMARY KEY,target TEXT)')
    const secret='rtmp://private.invalid/live?token=never-return',cipher=vault.encrypt(secret,'output_profiles.target')
    db.prepare('INSERT INTO output_profiles VALUES(?,?)').run('p',cipher)
    const result=inspectRekeyedFields(db,{exportId,vaultFingerprint:vault.fingerprint})
    expect(result.fields).toBe(1);expect(result.encodingValidated).toBe(true)
    expect(result.contentApproved).toBe(false);expect(result.localExecutionAuthorized).toBe(false)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect((db.prepare('SELECT target FROM output_profiles').get() as {target:string}).target).toBe(cipher)
    expect(()=>inspectRekeyedFields(db,{exportId,vaultFingerprint:'a'.repeat(64)})).toThrow()
  }finally{db.close()}
})
it('ciphertext adulterado impede relatório de legibilidade — NOT_RUN',()=>{
  const db=new Database(':memory:'),vault=installationVault(false)
  try{
    db.exec('CREATE TABLE output_profiles(id TEXT PRIMARY KEY,target TEXT)')
    db.prepare('INSERT INTO output_profiles VALUES(?,?)').run('p','unprotected')
    expect(()=>inspectRekeyedFields(db,{exportId:randomUUID(),vaultFingerprint:vault.fingerprint})).toThrow()
  }finally{db.close()}
})
