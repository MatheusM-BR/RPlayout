import {createHash} from 'node:crypto'
import {lstatSync,openSync,readSync,writeSync,closeSync,fstatSync,fsyncSync,existsSync} from 'node:fs'
import {basename,dirname,resolve} from 'node:path'

/** Private-worker copy primitive; both paths are backend-generated. No source
 * overwrite, sidecars, links, UNC or reuse of an existing populated target. */
export function copySealedReturnDatabase(source:string,target:string,seal:{hash:string;bytes:number;sourceId:string;targetId:string;sourceName:'candidate.db'|'bound.db';targetName:'bound.db'|'media.db'}){
  const inputFile=resolve(source),file=resolve(target),before=lstatSync(inputFile),empty=lstatSync(file)
  if(!/^[a-f0-9]{64}$/.test(seal.hash)||!Number.isSafeInteger(seal.bytes)||seal.bytes<=0||seal.bytes>256*1024*1024||inputFile===file||inputFile.startsWith('\\\\')||file.startsWith('\\\\')||basename(inputFile)!==seal.sourceName||basename(dirname(inputFile))!=='.ha-execution.private-'+seal.sourceId||basename(file)!==seal.targetName||basename(dirname(file))!=='.ha-execution.private-'+seal.targetId||!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size!==seal.bytes||!empty.isFile()||empty.isSymbolicLink()||empty.nlink!==1||empty.size!==0)throw new Error('Cópia exige fonte selada e destino privado novo.')
  for(const path of [inputFile,file]){if(['-wal','-shm','-journal'].some(suffix=>existsSync(path+suffix)))throw new Error('Banco não consolidado.');let cursor=dirname(path);for(;;){const info=lstatSync(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Link/junção não permitido.');const parent=dirname(cursor);if(parent===cursor)break;cursor=parent}}
  const same=(a:typeof before,b:typeof before)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1
  const input=openSync(inputFile,'r');let output:number|undefined
  try{
    output=openSync(file,'r+');if(!same(before,fstatSync(input))||!same(empty,fstatSync(output)))throw new Error('Identidade mudou antes de copiar.')
    const digest=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0
    while(offset<before.size){const count=readSync(input,buffer,0,Math.min(buffer.length,before.size-offset),offset);if(!count)throw new Error('Fonte truncada.');digest.update(buffer.subarray(0,count));let written=0;while(written<count){const size=writeSync(output,buffer,written,count-written,offset+written);if(!size)throw new Error('Cópia truncada.');written+=size}offset+=count}
    fsyncSync(output);if(digest.digest('hex')!==seal.hash||!same(before,fstatSync(input))||!same(before,lstatSync(inputFile)))throw new Error('SHA/identidade da fonte divergentes.')
  }finally{closeSync(input);if(output!==undefined)closeSync(output)}
  const final=lstatSync(file);if(final.dev!==empty.dev||final.ino!==empty.ino||final.nlink!==1||final.size!==seal.bytes)throw new Error('Destino perdeu identidade.')
  return {empty,verifySource(){if(!same(before,lstatSync(inputFile))||['-wal','-shm','-journal'].some(suffix=>existsSync(inputFile+suffix)))throw new Error('Fonte mudou após cópia.')},verifyTarget(){const info=lstatSync(file);if(info.dev!==empty.dev||info.ino!==empty.ino||info.nlink!==1||!info.isFile()||info.isSymbolicLink()||info.size>256*1024*1024)throw new Error('Destino mudou ou excedeu limite.')}}
}
