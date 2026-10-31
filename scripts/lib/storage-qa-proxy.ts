import assert from 'node:assert/strict'
import {copyFile,readFile,writeFile,readdir,lstat,realpath} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=fileURLToPath(new URL('../..',import.meta.url))
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const proxyNames=['storage-commit-fault-proxy.cjs','storage-transaction-timeout-proxy.cjs','storage-observer-proxy.cjs'] as const
export async function stageStorageQaProxy(directory:string,binaries:string,proxyName:typeof proxyNames[number]){
 assert.ok(resolve(directory).startsWith(join(root,'scratch')+'\\'));assert.ok(resolve(binaries).startsWith(join(root,'scratch','host-history-r88-')))
 for(const folder of[directory,binaries]){assert.equal((await lstat(folder)).isSymbolicLink(),false);assert.equal(resolve(await realpath(folder)).toLowerCase(),resolve(folder).toLowerCase(),'QA staging cannot traverse junction/symlink aliases')}
 assert.ok(proxyNames.includes(proxyName));assert.deepEqual(await readdir(directory),[],'Only a fresh owned QA directory may be staged')
 const proxy=join(root,'scripts/fixtures',proxyName),realService=join(binaries,'storage-service.cjs')
 const context={kind:'RPlayout-owned-storage-proxy-v2',proxyFile:'qa-proxy.cjs',realService,realServiceSha256:hash(await readFile(realService)),proxySha256:hash(await readFile(proxy))}
 await copyFile(join(binaries,'storage-bridge.cjs'),join(directory,'storage-bridge.cjs'),constants.COPYFILE_EXCL)
 await copyFile(proxy,join(directory,'qa-proxy.cjs'),constants.COPYFILE_EXCL)
 await copyFile(join(root,'scripts/fixtures/storage-sidecar-loader.cjs'),join(directory,'storage-service.cjs'),constants.COPYFILE_EXCL)
 await writeFile(join(directory,'qa-storage-context.json'),JSON.stringify(context,null,2),{flag:'wx'})
 return {version:2,proxyName,proxySha256:context.proxySha256,entrySha256:hash(await readFile(join(directory,'storage-service.cjs'))),contextSha256:hash(await readFile(join(directory,'qa-storage-context.json')))}
}
export async function assertStorageQaProxyEvidence(directory:string,binaries:string,metadata:Awaited<ReturnType<typeof stageStorageQaProxy>>){
 assert.equal(metadata.version,2);assert.ok(proxyNames.includes(metadata.proxyName))
 assert.equal(hash(await readFile(join(directory,'storage-service.cjs'))),metadata.entrySha256)
 assert.equal(hash(await readFile(join(directory,'qa-proxy.cjs'))),metadata.proxySha256)
 assert.equal(hash(await readFile(join(root,'scripts/fixtures',metadata.proxyName))),metadata.proxySha256)
 const bytes=await readFile(join(directory,'qa-storage-context.json'));assert.equal(hash(bytes),metadata.contextSha256)
 const context=JSON.parse(bytes.toString('utf8'));assert.equal(context.kind,'RPlayout-owned-storage-proxy-v2');assert.equal(context.proxyFile,'qa-proxy.cjs')
 assert.equal(resolve(context.realService),join(resolve(binaries),'storage-service.cjs'));assert.equal(hash(await readFile(context.realService)),context.realServiceSha256)
 assert.equal(context.proxySha256,metadata.proxySha256)
}
