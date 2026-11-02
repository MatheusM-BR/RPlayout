import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {constants,setPriority} from 'node:os'
import {z} from 'zod'
import {graphicProbeComposition} from './graphic-viewport.js'
import {localFileStamp,probeRuntimeHash} from './ha-local-probe.js'
import {mediaProcessEnvironment} from './media-process-environment.js'

const headerSchema=z.object({version:z.literal(1),ok:z.literal(true),width:z.number().int().min(2).max(3840),height:z.number().int().min(2).max(2160),format:z.literal('RGBA'),decodedFrames:z.literal(1),pixelBytes:z.number().int().positive().max(3840*2160*4)}).strict().refine(v=>v.pixelBytes===v.width*v.height*4)
const sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
/** Bounded binary frame protocol. A JSON success without actual exact pixels
 * is not render evidence; pixel hashes remain independent from editorial QC. */
export function readLocalGraphicFrame(bytes:Buffer,width:number,height:number){
  const newline=bytes.indexOf(10)
  if(newline<0||newline>4096)throw new Error('Sonda não forneceu cabeçalho de quadro válido.')
  const header=headerSchema.parse(JSON.parse(bytes.subarray(0,newline).toString('utf8')))
  if(header.width!==width||header.height!==height||bytes.length!==newline+1+header.pixelBytes)throw new Error('Quadro gráfico difere da geometria ou está truncado/excessivo.')
  const pixels=bytes.subarray(newline+1);let nonBlackPixels=0
  for(let offset=0;offset<pixels.length;offset+=4)if(pixels[offset]||pixels[offset+1]||pixels[offset+2])nonBlackPixels++
  return {...header,pixelHash:sha(pixels),nonBlackPixels,editorialApproved:false as const,publicationAuthorized:false as const}
}
/** Private caller only: no HTTP path/SVG command, no on-air engine, no files.
 * Resolves on clean child close; cancellation/ownership never guesses by PID. */
export async function runLocalGraphicProbe(binary:string,svg:string,width:number,height:number,signal:AbortSignal,alive:()=>void,timeoutMs=30_000){
  signal.throwIfAborted();alive()
  if(!binary||Buffer.byteLength(svg)>4*1024*1024||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<2||width>3840||height<2||height>2160)throw new Error('Sonda/SVG/geometria não admitidos.')
  const composition=graphicProbeComposition(svg)
  if(Buffer.byteLength(composition)>4*1024*1024)throw new Error('Composição excede limite.')
  const before=await localFileStamp(binary),runtimeHash=await probeRuntimeHash(binary)
  signal.throwIfAborted();alive()
  const bytes=await new Promise<Buffer>((done,fail)=>{
    const child=spawn(binary,[],{windowsHide:true,env:mediaProcessEnvironment(),stdio:['pipe','pipe','pipe']})
    let failure=false,count=0
    const chunks:Buffer[]=[],stop=()=>{failure=true;child.kill()},abort=()=>stop()
    const timeout=setTimeout(stop,timeoutMs)
    const ownership=setInterval(()=>{try{alive();signal.throwIfAborted()}catch{stop()}},250)
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
    child.once('spawn',()=>{try{if(child.pid)setPriority(child.pid,constants.priority.PRIORITY_LOW)}catch{}})
    child.once('error',()=>{failure=true})
    child.stdin.once('error',stop)
    child.stdout.on('data',(chunk:Buffer)=>{count+=chunk.length;if(count>width*height*4+4097)stop();else chunks.push(chunk)})
    child.stderr.resume()
    child.once('close',code=>{
      clearTimeout(timeout);clearInterval(ownership);signal.removeEventListener('abort',abort)
      if(failure||code!==0)return fail(new Error('Renderização gráfica local não comprovada.'))
      done(Buffer.concat(chunks))
    })
    child.stdin.end(JSON.stringify({version:1,svg:composition,width,height}))
  })
  signal.throwIfAborted();alive()
  if(await localFileStamp(binary)!==before||await probeRuntimeHash(binary)!==runtimeHash)throw new Error('Runtime gráfico mudou durante análise.')
  const frame=readLocalGraphicFrame(bytes,width,height)
  return {...frame,compositionHash:sha(composition),runtimeHash,checkedAt:new Date().toISOString(),nativePrepared:false as const,authorityTransferred:false as const}
}
