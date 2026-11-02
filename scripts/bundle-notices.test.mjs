import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {writeBundleNotices} from './bundle-notices.mjs'

async function fixture(){
  const base=await mkdtemp(join(fileURLToPath(new URL('../scratch/',import.meta.url)),'bundle-notice-test-'))
  const pkg=join(base,'node_modules','used'),output=join(base,'dist','server.cjs')
  await mkdir(pkg,{recursive:true});await mkdir(join(base,'dist'))
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'used',version:'1.0.0',license:'MIT'}))
  await writeFile(output,'// synthetic compiled fixture')
  return {base,pkg,output,result:{metafile:{inputs:{'node_modules/used/index.js':{},'src/index.ts':{}},outputs:{'dist/server.cjs':{imports:[{path:'native-external',external:true}]}}}}}
}
test('copies direct notice and binds report to exact artifact',async()=>{
  const f=await fixture();await writeFile(join(f.pkg,'LICENSE'),'Synthetic notice — ação')
  await writeBundleNotices(f.result,{absWorkingDir:f.base,outfile:f.output})
  const report=JSON.parse(await readFile(join(f.base,'dist/third-party/server.cjs.json'),'utf8'))
  assert.equal(report.packages.length,1);assert.deepEqual(report.missingNotices,[])
  assert.equal(await readFile(join(f.base,'dist',report.packages[0].notices[0].file),'utf8'),'Synthetic notice — ação')
  assert.equal(report.artifactSha256,createHash('sha256').update(await readFile(f.output)).digest('hex'))
  assert.deepEqual(report.externalImports,['native-external']);assert.equal(report.publicationApproved,false)
})
test('never credits a nested dependency notice to its parent',async()=>{
  const f=await fixture();const nested=join(f.pkg,'node_modules','child')
  await mkdir(nested,{recursive:true});await writeFile(join(nested,'LICENSE'),'Child only')
  await writeBundleNotices(f.result,{absWorkingDir:f.base,outfile:f.output})
  const report=JSON.parse(await readFile(join(f.base,'dist/third-party/server.cjs.json'),'utf8'))
  assert.deepEqual(report.missingNotices,['used']);assert.deepEqual(report.packages[0].notices,[])
})
test('accepts pinned matching override and refuses modified text',async()=>{
  const f=await fixture(),overrides=join(f.base,'overrides'),text='Pinned synthetic notice',commit='1'.repeat(40)
  await mkdir(overrides);await writeFile(join(overrides,'LICENSE.txt'),text)
  await writeFile(join(overrides,'result.json'),JSON.stringify({results:[{name:'used',version:'1.0.0',noticeFound:true,immutableCommitVerified:true,commit,source:'https://raw.githubusercontent.com/example/used/'+commit+'/LICENSE',file:'LICENSE.txt',sha256:createHash('sha256').update(text).digest('hex')}]}))
  const options={absWorkingDir:f.base,outfile:f.output,noticeOverridesDirectory:overrides}
  await writeBundleNotices(f.result,options)
  const report=JSON.parse(await readFile(join(f.base,'dist/third-party/server.cjs.json'),'utf8'))
  assert.deepEqual(report.missingNotices,[]);assert.equal(report.packages[0].notices[0].commit,commit)
  await writeFile(join(overrides,'LICENSE.txt'),'Modified')
  await assert.rejects(writeBundleNotices(f.result,options),/hash mismatch/)
})
