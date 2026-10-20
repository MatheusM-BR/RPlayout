import {mkdtemp,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

const directory=await mkdtemp(join(fileURLToPath(new URL('../scratch/',import.meta.url)),'js-notice-origin-'))
const observations=[]
async function get(url){
  const response=await fetch(url,{redirect:'error',headers:{'user-agent':'RPlayout-notice-inventory'},signal:AbortSignal.timeout(15000)})
  observations.push({url,status:response.status})
  return response.ok?await response.text():null
}
const registry=await get('https://registry.npmjs.org/abstract-logging/2.0.1')
const logging=JSON.parse(registry)
if(!/^[a-f0-9]{40}$/.test(logging.gitHead))throw Error('Missing immutable abstract-logging revision')
const abstractUrl=`https://raw.githubusercontent.com/jsumners/abstract-logging/${logging.gitHead}/LICENSE`
const abstractText=await get(abstractUrl)
const results=[{name:'abstract-logging',version:'2.0.1',gitHead:logging.gitHead,noticeFound:Boolean(abstractText),reviewRequired:true}]
if(abstractText)await writeFile(join(directory,'abstract-logging-LICENSE.txt'),abstractText,{flag:'wx'})
for(const tag of ['0.36.4','v0.36.4']){
  const refText=await get(`https://api.github.com/repos/drizzle-team/drizzle-orm/git/ref/tags/${tag}`)
  if(!refText)continue
  let object=JSON.parse(refText).object
  for(let depth=0;object.type==='tag'&&depth<4;depth++){
    const annotation=await get(`https://api.github.com/repos/drizzle-team/drizzle-orm/git/tags/${object.sha}`)
    if(!annotation)throw Error('Cannot resolve annotated tag')
    object=JSON.parse(annotation).object
  }
  if(object.type!=='commit'||!/^[a-f0-9]{40}$/.test(object.sha))throw Error('Tag not pinned to commit')
  const base=`https://raw.githubusercontent.com/drizzle-team/drizzle-orm/${object.sha}/`
  const metadataText=await get(base+'drizzle-orm/package.json')
  if(!metadataText)continue
  const metadata=JSON.parse(metadataText)
  if(metadata.name!=='drizzle-orm'||metadata.version!=='0.36.4')continue
  const text=await get(base+'LICENSE')
  if(!text)continue
  await writeFile(join(directory,'drizzle-orm-LICENSE.txt'),text,{flag:'wx'})
  results.push({name:metadata.name,version:metadata.version,file:'drizzle-orm-LICENSE.txt',source:base+'LICENSE',sourceRef:tag,commit:object.sha,immutableCommitVerified:true,sha256:createHash('sha256').update(text).digest('hex'),noticeFound:true,reviewRequired:true})
  break
}
await writeFile(join(directory,'result.json'),JSON.stringify({status:'REVIEW_REQUIRED',results,observations,publicationApproved:false},null,2),{flag:'wx'})
console.log(JSON.stringify({directory,results,observations}))
