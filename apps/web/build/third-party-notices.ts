import {readFile,readdir} from 'node:fs/promises'
import {dirname,join,parse} from 'node:path'
import {createHash} from 'node:crypto'
import type {Plugin} from 'vite'

/** Collect only packages contributing modules to emitted browser chunks.
 * Notices are copied verbatim, never replaced with a guessed SPDX template.
 * This is a technical inventory, not redistribution clearance.
 */
export function thirdPartyNotices():Plugin{
  return {name:'rplayout-third-party-notices',apply:'build',async generateBundle(_options,bundle){
    const moduleIds=new Set(Object.values(bundle).flatMap(chunk=>chunk.type==='chunk'?Object.keys(chunk.modules):[]))
    const packages=new Map<string,{name:string;version:string;license:unknown;notices:{file:string;sha256:string}[]}>()
    const visited=new Set<string>()
    for(const id of moduleIds){
      const clean=id.replace(/^\0/,'').split('?')[0]!
      if(!clean.replaceAll('\\','/').includes('/node_modules/'))continue
      let directory=dirname(clean)
      while(directory!==parse(directory).root){
        if(visited.has(directory))break
        visited.add(directory)
        let metadata:{name?:string;version?:string;license?:unknown}
        try{metadata=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))}catch{directory=dirname(directory);continue}
        if(!metadata.name||!metadata.version)break
        const key=metadata.name+'@'+metadata.version
        if(packages.has(key))break
        const notices=[]
        const assetPrefix='third-party/'+encodeURIComponent(key)+'/'
        for(const entry of await readdir(directory,{withFileTypes:true})){
          if(!entry.isFile()||!/^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)([._-].*|$)/i.test(entry.name))continue
          const bytes=await readFile(join(directory,entry.name))
          const file=assetPrefix+entry.name
          this.emitFile({type:'asset',fileName:file,source:bytes})
          notices.push({file,sha256:createHash('sha256').update(bytes).digest('hex')})
        }
        packages.set(key,{name:metadata.name,version:metadata.version,license:metadata.license??null,notices})
        break
      }
    }
    const list=[...packages.values()].sort((a,b)=>(a.name+'@'+a.version).localeCompare(b.name+'@'+b.version))
    this.emitFile({type:'asset',fileName:'third-party/inventory.json',source:JSON.stringify({status:'REVIEW_REQUIRED',scope:'Packages contributing bundled frontend modules; not a legal opinion',packages:list,missingNotices:list.filter(pkg=>!pkg.notices.length).map(pkg=>pkg.name),publicationApproved:false},null,2)})
  }}
}
