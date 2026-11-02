import assert from 'node:assert/strict'
import {readFile,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

// Inventory evidence, not a legal opinion or a permission to redistribute.
const root=resolve(process.argv[2]??'')
assert.ok(process.argv[2],'Provide an extracted package')
const manifestBytes=await readFile(join(root,'package-manifest.json'))
const manifest=JSON.parse(manifestBytes)
assert.equal(manifest.version,1)
const files=new Map(manifest.files.map(entry=>[entry.file,entry]))
async function verifiedRead(name){
  const entry=files.get(name);assert.ok(entry,'Unmanifested '+name)
  const path=resolve(root,name);assert.ok(path.startsWith(root+sep),'Path outside package')
  const bytes=await readFile(path)
  assert.equal(bytes.length,entry.bytes,name)
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),entry.sha256.toUpperCase(),name)
  return bytes
}
const isNotice=name=>(name.startsWith('licenses/')&&!name.endsWith('.json'))||/^(license|licence|copying|notice|copyright)([._-].*|$)/i.test(name.split('/').at(-1))
const notices=[...files.keys()].filter(isNotice)
for(const name of notices)await verifiedRead(name)
const packages=[]
for(const name of [...files.keys()].filter(name=>name.startsWith('apps/server/node_modules/')&&name.endsWith('/package.json'))){
  const data=JSON.parse(await verifiedRead(name))
  if(!data.name||!data.version)continue
  const directory=name.slice(0,-'package.json'.length)
  // Only direct notices: never credit a dependency's license to its parent.
  const direct=notices.filter(path=>path.startsWith(directory)&&!path.slice(directory.length).includes('/'))
  packages.push({name:data.name,version:data.version,metadataPath:name,declaredLicense:data.license??null,noticeFiles:direct})
}
const issues=[]
const families=[
  ['Node','runtime/node/'],['GStreamer','runtime/gstreamer/'],
  ['MediaMTX','mediamtx/'],['OMT','licenses/omt/'],['NDI','licenses/ndi/'],
  ['MSVC','licenses/msvc/'],
]
const runtimeNotices=families.map(([component,prefix])=>{
  const matches=notices.filter(name=>name.startsWith(prefix)||(component==='GStreamer'&&name.startsWith('licenses/gstreamer/'))||(component==='Node'&&name.startsWith('licenses/node/')))
  if(matches.length===0)issues.push({component,code:'NOTICE_NOT_PRESENT_IN_EXPECTED_LOCATION',prefix})
  return {component,noticeFiles:matches}
})
for(const pkg of packages){
  if(!pkg.declaredLicense)issues.push({component:pkg.name,code:'LICENSE_METADATA_MISSING',path:pkg.metadataPath})
  if(!pkg.noticeFiles.length)issues.push({component:pkg.name,code:'DIRECT_NOTICE_NOT_FOUND',path:pkg.metadataPath})
}
issues.push({component:'native/Rust/frontend',code:'TRANSITIVE_AND_BUNDLED_LICENSE_AUDIT_REQUIRED'})
issues.push({component:'GStreamer/NDI/MSVC/codecs',code:'REDISTRIBUTION_TERMS_PROVENANCE_AND_SOURCE_OBLIGATIONS_REQUIRE_REVIEW'})
const directory=await mkdtemp(join(fileURLToPath(new URL('../scratch/',import.meta.url)),'license-inventory-'))
const report={status:'REVIEW_REQUIRED',scope:'Manifest-verified notice and npm metadata inventory; not legal clearance',package:root,manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),runtimeNotices,packages,noticeFiles:notices,issues,publicationApproved:false}
await writeFile(join(directory,'result.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify({directory,status:report.status,packages:packages.length,noticeFiles:notices.length,issues:issues.length,runtimeNotices:runtimeNotices.map(item=>({component:item.component,noticeFiles:item.noticeFiles.length})),publicationApproved:false}))
