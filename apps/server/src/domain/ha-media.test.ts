import Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import {mkdtemp,mkdir,readFile,writeFile,link,unlink,appendFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {HaMediaStore,haRequiredMedia,HA_CHUNK_BYTES,openHaMediaSource} from './ha-media.js'
import type {HaSnapshot} from './ha-replication.js'

let directory:string,db:Database.Database,store:HaMediaStore
const bytes=Buffer.from('EDIÇÃO ORIGINAL ÇÃO'),hash=createHash('sha256').update(bytes).digest('hex')
const snapshot=(assets:unknown[]=[{id:'asset',kind:'VIDEO',contentHash:hash,path:'Z:/não existe/ação.mp4'}]):HaSnapshot=>({version:1,capturedAt:new Date().toISOString(),channels:[{channelId:'ch',configuration:{},revisions:[{id:'pub',active:true,payload:{assets}}],checkpoint:null,transport:null,blockers:{}}],asRun:[],journals:[]})
const operation=(kind:'STATUS'|'WRITE'|'VERIFY',extra:object={})=>({version:1,operation:kind,hash,size:bytes.length,...extra})
const write=(data=bytes,offset=0)=>store.receive(operation('WRITE',{offset,data:data.toString('base64')}))
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'RPlayout-ha-media-unit-'));db=new Database(join(directory,'mirror.db'));store=new HaMediaStore(db,join(directory,'owned'),1024*1024);store.manifest(snapshot())})
afterEach(async()=>{store.close();await store.settled();store.release();db.close()})
const partial=()=>db.prepare('SELECT temporary FROM ha_media WHERE hash=?').get(hash) as {temporary:string}

describe('mídia HA por SHA e offsets duráveis, sem caminho remoto',()=>{
  it('copia por blocos e só publica após SHA; não usa caminho original remoto',async()=>{
    expect(await store.receive(operation('STATUS'))).toMatchObject({offset:0,ready:false})
    expect(await write(bytes.subarray(0,5))).toMatchObject({offset:5,ready:false})
    await expect(store.receive(operation('VERIFY'))).rejects.toThrow('incompleta')
    await write(bytes.subarray(5),5)
    expect(await store.receive(operation('VERIFY'))).toMatchObject({offset:bytes.length,ready:true})
    expect(await readFile(join(directory,'owned',hash+'.media'))).toEqual(bytes)
    expect((await readdir(join(directory,'owned'))).filter(name=>name.endsWith('.part'))).toEqual([])
    expect(store.status()).toMatchObject({required:1,verified:1,ready:false,bytesReserved:bytes.length})
  })
  it('bloco repetido confere bytes, recusa sobreposição e ordem incorreta',async()=>{
    await write(bytes.subarray(0,5));expect((await write(bytes.subarray(0,5))).offset).toBe(5)
    await expect(write(Buffer.from('xxxxx'))).rejects.toThrow('outro conteúdo')
    await expect(write(bytes.subarray(0,7))).rejects.toThrow('sobrepõe')
    await expect(write(bytes.subarray(7),7)).rejects.toThrow('fora de ordem')
    expect((await store.receive(operation('STATUS'))).offset).toBe(5)
  })
  it('retoma offset após reinício e descarta somente cauda não confirmada do próprio inode',async()=>{
    await write(bytes.subarray(0,5));const path=join(directory,'owned',partial().temporary)
    await appendFile(path,'CAUDA NÃO CONFIRMADA')
    store.close();await store.settled();store.release();db.close()
    db=new Database(join(directory,'mirror.db'));store=new HaMediaStore(db,join(directory,'owned'),1024*1024);store.manifest(snapshot())
    expect((await store.receive(operation('STATUS'))).offset).toBe(5);expect(await readFile(path)).toEqual(bytes.subarray(0,5))
    await write(bytes.subarray(5),5);expect((await store.receive(operation('VERIFY'))).ready).toBe(true)
  })
  it('SHA incorreto preserva parcial reprovado e não cria arquivo disponível',async()=>{
    await write(Buffer.alloc(bytes.length,65));const path=join(directory,'owned',partial().temporary)
    await expect(store.receive(operation('VERIFY'))).rejects.toThrow('SHA')
    expect(await readFile(path)).toEqual(Buffer.alloc(bytes.length,65));expect(store.status().verified).toBe(0)
    await expect(store.receive(operation('STATUS'))).rejects.toThrow('reprovada')
  })
  it('quota e hashes fora da publicação recusam escrita, sem apagar arquivos estrangeiros',async()=>{
    await mkdir(join(directory,'owned'));await writeFile(join(directory,'owned','documento.txt'),'PRESERVAR')
    await expect(store.receive({...operation('STATUS'),size:2*1024*1024})).rejects.toThrow('Quota')
    await expect(store.receive({...operation('STATUS'),hash:'b'.repeat(64)})).rejects.toThrow('edição')
    expect(await readFile(join(directory,'owned','documento.txt'),'utf8')).toBe('PRESERVAR')
  })
  it('não modifica parcial substituído por hardlink de arquivo alheio',async()=>{
    await store.receive(operation('STATUS'));const path=join(directory,'owned',partial().temporary),foreign=join(directory,'foreign.txt')
    await writeFile(foreign,'NÃO ALTERAR');await unlink(path);await link(foreign,path)
    await expect(write()).rejects.toThrow('substituído ou ligado')
    expect(await readFile(foreign,'utf8')).toBe('NÃO ALTERAR')
  })
  it('retoma publicação interrompida depois do link sem duplicar disco nem sobrescrever destino',async()=>{
    await write();const path=join(directory,'owned',partial().temporary);await link(path,join(directory,'owned',hash+'.media'))
    expect((await store.receive(operation('STATUS'))).ready).toBe(true)
    expect((await readdir(join(directory,'owned'))).filter(name=>name.endsWith('.part'))).toEqual([])
    await writeFile(join(directory,'owned',hash+'.media'),'ALTERADO')
    await expect(store.receive(operation('STATUS'))).rejects.toThrow('alterada/removida')
    expect(await readFile(join(directory,'owned',hash+'.media'),'utf8')).toBe('ALTERADO')
  })
  it('arquivo existente de outro conteúdo não é sobrescrito mesmo após VERIFY',async()=>{
    await mkdir(join(directory,'owned'));await writeFile(join(directory,'owned',hash+'.media'),'FOREIGN')
    await write();await expect(store.receive(operation('VERIFY'))).rejects.toThrow('preservado')
    expect(await readFile(join(directory,'owned',hash+'.media'),'utf8')).toBe('FOREIGN');expect(store.status().verified).toBe(0)
  })
  it('receptor vivo não perde posse e banco não muda de pasta',()=>{
    expect(()=>new HaMediaStore(db,join(directory,'owned'),1024*1024)).toThrow('Outro receptor')
    expect(()=>new HaMediaStore(db,join(directory,'other'),1024*1024)).toThrow('outra pasta')
  })
  it('nova edição remove autorização e encerramento aguarda fila sem escrever após close',async()=>{
    await write(bytes.subarray(0,5));store.manifest(snapshot([]))
    await expect(write(bytes.subarray(5),5)).rejects.toThrow('edição')
    store.manifest(snapshot());const pending=write(bytes.subarray(5),5);store.close()
    await expect(pending).rejects.toThrow('edição');await store.settled();expect(db.prepare('SELECT offset FROM ha_media').get()).toEqual({offset:5})
  })
  it('manifesto deduplica vídeo/áudio/imagem e não copia revisão apenas histórica ou rascunho',()=>{
    const state=snapshot([{id:'video',kind:'VIDEO',path:'v',contentHash:hash},{id:'dup',kind:'AUDIO',path:'a',contentHash:hash},{id:'audio',kind:'AUDIO',path:'a',contentHash:'b'.repeat(64)},{id:'still',kind:'STILL',path:'s',contentHash:'c'.repeat(64)}])
    state.channels[0]!.revisions.push({id:'history',active:false,payload:{assets:[{id:'old',kind:'VIDEO',path:'old',contentHash:'d'.repeat(64)}]}})
    expect([...haRequiredMedia(state).keys()].sort()).toEqual([hash,'b'.repeat(64),'c'.repeat(64)].sort())
    state.channels[0]!.checkpoint={value:{revisionId:'history'}};expect(haRequiredMedia(state).has('d'.repeat(64))).toBe(true)
  })
  it('source handle verifica original e lê somente blocos limitados, recusando alteração',async()=>{
    const data=Buffer.alloc(HA_CHUNK_BYTES+37,66),sourceHash=createHash('sha256').update(data).digest('hex'),path=join(directory,'AÇÃO.mp4'),cache=new Map<string,string>()
    await writeFile(path,data);const source=await openHaMediaSource(path,sourceHash,cache,new AbortController().signal)
    try{expect((await source.read(0)).length).toBe(HA_CHUNK_BYTES);expect(await source.read(HA_CHUNK_BYTES)).toEqual(data.subarray(HA_CHUNK_BYTES));await appendFile(path,'MODIFICADO');await expect(source.read(0)).rejects.toThrow('mudou')}finally{await source.close()}
    await expect(openHaMediaSource(path,sourceHash,cache,new AbortController().signal)).rejects.toThrow('mudou de conteúdo')
  })
})
