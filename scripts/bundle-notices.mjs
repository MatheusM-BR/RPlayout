import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises'
import {dirname,join,parse,resolve,relative,basename,sep} from 'node:path'
import {createHash} from 'node:crypto'

// Record exact contributing packages, not all declared dependencies.
export async function writeBundleNotices(result,options){
  const base=options.absWorkingDir,output=resolve(options.outfile)
  const outputRoot=dirname(output),packages=new Map(),visited=new Set()
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
  const overrideRoot=options.noticeOverridesDirectory?resolve(options.noticeOverridesDirectory):null
  const overrides=overrideRoot?JSON.parse(await readFile(join(overrideRoot,'result.json'),'utf8')).results:[]
  for(const input of Object.keys(result.metafile.inputs)){
    const path=resolve(base,input)
    if(!path.replaceAll('\\','/').includes('/node_modules/'))continue
    let directory=dirname(path)
    while(directory!==parse(directory).root){
      if(visited.has(directory))break
      visited.add(directory)
      let metadata
      try{metadata=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))}catch{directory=dirname(directory);continue}
      if(!metadata.name||!metadata.version)break
      const key=metadata.name+'@'+metadata.version
      if(packages.has(key))break
      const assetDirectory=join('third-party','packages',sha(key))
      const notices=[]
      for(const entry of await readdir(directory,{withFileTypes:true})){
        if(!entry.isFile()||!/^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)([._-].*|$)/i.test(entry.name))continue
        const bytes=await readFile(join(directory,entry.name)),asset=join(assetDirectory,entry.name)
        await mkdir(join(outputRoot,assetDirectory),{recursive:true})
        await writeFile(join(outputRoot,asset),bytes)
        notices.push({file:asset.replaceAll('\\','/'),sha256:sha(bytes)})
      }
      const override=overrides.find(entry=>entry.name===metadata.name&&entry.version===metadata.version&&entry.noticeFound)
      if(!notices.length&&override){
        if(!override.immutableCommitVerified||!/^[a-f0-9]{40}$/.test(override.commit)||!override.source.includes('/'+override.commit+'/'))throw Error('Notice override without immutable provenance: '+key)
        const sourceFile=resolve(overrideRoot,override.file)
        if(!sourceFile.startsWith(overrideRoot+sep))throw Error('Notice outside override directory')
        const bytes=await readFile(sourceFile)
        if(sha(bytes)!==override.sha256)throw Error('Notice override hash mismatch: '+key)
        const asset=join(assetDirectory,'UPSTREAM-LICENSE.txt')
        await mkdir(join(outputRoot,assetDirectory),{recursive:true});await writeFile(join(outputRoot,asset),bytes)
        notices.push({file:asset.replaceAll('\\','/'),sha256:sha(bytes),source:override.source,commit:override.commit})
      }
      packages.set(key,{name:metadata.name,version:metadata.version,declaredLicense:metadata.license??null,metadata:relative(base,join(directory,'package.json')).replaceAll('\\','/'),notices})
      break
    }
  }
  const list=[...packages.values()].sort((a,b)=>(a.name+'@'+a.version).localeCompare(b.name+'@'+b.version))
  const externalImports=[...new Set(Object.values(result.metafile.outputs).flatMap(entry=>entry.imports.filter(item=>item.external).map(item=>item.path)))].sort()
  const report={status:'REVIEW_REQUIRED',scope:'Contributing packages of this compiled server artifact; not legal clearance',artifact:basename(output),artifactSha256:sha(await readFile(output)),packages:list,externalImports,missingNotices:list.filter(pkg=>!pkg.notices.length).map(pkg=>pkg.name),publicationApproved:false}
  await mkdir(join(outputRoot,'third-party'),{recursive:true})
  await writeFile(join(outputRoot,'third-party',basename(output)+'.json'),JSON.stringify(report,null,2))
}
