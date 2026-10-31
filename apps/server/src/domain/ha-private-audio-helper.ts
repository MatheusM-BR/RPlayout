import {spawn} from 'node:child_process'
import {constants,setPriority} from 'node:os'
import {mediaProcessEnvironment} from './media-process-environment.js'
/** Internal caller owns identity/bytes verification. Pipe survives until close. */
export async function runPrivateAudioHelper(binary:string,args:string[],signal:AbortSignal,alive:()=>void,timeoutMs:number,maxBytes=65536){
  signal.throwIfAborted();alive()
  if(!binary||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>16*60_000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>1024*1024)throw new Error('Limites do helper de áudio inválidos.')
  return await new Promise<unknown>((done,fail)=>{
    const child=spawn(binary,[...args,'--parent-pipe'],{windowsHide:true,env:mediaProcessEnvironment(),stdio:['pipe','pipe','pipe']})
    let failed=false,bytes=0;const chunks:Buffer[]=[]
    const stop=()=>{failed=true;child.kill()},timeout=setTimeout(stop,timeoutMs),ownership=setInterval(()=>{try{signal.throwIfAborted();alive()}catch{stop()}},250)
    signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop()
    child.once('spawn',()=>{try{if(child.pid)setPriority(child.pid,constants.priority.PRIORITY_LOW)}catch{}})
    child.once('error',()=>{failed=true});child.stdin.once('error',stop)
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>maxBytes)stop();else chunks.push(chunk)})
    child.stderr.resume()
    child.once('close',code=>{
      clearTimeout(timeout);clearInterval(ownership);signal.removeEventListener('abort',stop)
      if(failed||code!==0)return fail(new Error('Montagem de áudio não comprovada.'))
      try{done(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{fail(new Error('Medidor não forneceu resposta válida.'))}
    })
  })
}
