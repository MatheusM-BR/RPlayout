import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,readdir,mkdtemp,mkdir,writeFile} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

const root=fileURLToPath(new URL('..',import.meta.url)),engine=join(root,'apps/engine')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const lock=await readFile(join(engine,'Cargo.lock'))
const {stdout}=await promisify(execFile)('cargo',['metadata','--offline','--locked','--format-version','1','--filter-platform','x86_64-pc-windows-msvc'],{cwd:engine,windowsHide:true,timeout:60000,maxBuffer:32*1024*1024})
const metadata=JSON.parse(stdout),resolved=new Set(metadata.resolve.nodes.map(node=>node.id))
const directory=await mkdtemp(join(root,'scratch','rust-notices-')),packages=[]
for(const pkg of metadata.packages.filter(pkg=>resolved.has(pkg.id)&&!metadata.workspace_members.includes(pkg.id))){
  const source=dirname(pkg.manifest_path),notices=[]
  const noticeNames=new Set((await readdir(source,{withFileTypes:true})).filter(entry=>entry.isFile()&&/^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)([._-].*|$)/i.test(entry.name)).map(entry=>entry.name))
  // Explicit package license_file may have a non-standard name.
  if(pkg.license_file)noticeNames.add(pkg.license_file)
  for(const name of noticeNames){
    const bytes=await readFile(join(source,name))
    const file='packages/'+hash(pkg.id)+'/'+hash(name)+'.txt'
    await mkdir(dirname(join(directory,file)),{recursive:true})
    await writeFile(join(directory,file),bytes,{flag:'wx'})
    notices.push({originalName:name,file,sha256:hash(bytes)})
  }
  packages.push({name:pkg.name,version:pkg.version,source:pkg.source,declaredLicense:pkg.license,notices})
}
const report={status:'REVIEW_REQUIRED',scope:'Conservative resolved Windows Cargo graph; includes build/test dependencies, not proof of linked binary contents',cargoLockSha256:hash(lock),packages,missingNotices:packages.filter(pkg=>!pkg.notices.length).map(pkg=>pkg.name+'@'+pkg.version),publicationApproved:false}
await writeFile(join(directory,'inventory.json'),JSON.stringify(report,null,2),{flag:'wx'})
console.log(JSON.stringify({directory,status:report.status,packages:packages.length,noticeFiles:packages.reduce((sum,pkg)=>sum+pkg.notices.length,0),missingNotices:report.missingNotices,cargoLockSha256:report.cargoLockSha256,publicationApproved:false}))
