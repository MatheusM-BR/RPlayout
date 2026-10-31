import {randomUUID} from 'node:crypto'
import {mkdir,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {gzipSync} from 'node:zlib'

/**
 * Quadros exatos do original para o QC.
 *
 * Cada quadro custa uma abertura do arquivo e uma busca ACCURATE na sonda
 * (fração de segundo a alguns segundos num GOP longo). Por isso o custo é
 * limitado aqui: no máximo {@link QC_FRAME_CONCURRENCY} extrações ao mesmo
 * tempo no servidor inteiro, fila curta (o que passar disso recebe 503 e o
 * cliente tenta de novo quando o operador parar de navegar), pedidos iguais
 * compartilham a mesma extração e o resultado fica num cache em memória
 * limitado por bytes -- nada vai para o disco além do arquivo temporário da
 * sonda, então navegar quadro a quadro num VT de uma hora não enche a pasta
 * de miniaturas.
 */
export const QC_FRAME_CONCURRENCY=2
export const QC_FRAME_QUEUE=6
export const QC_FRAME_CACHE_BYTES=64*1024*1024

export interface QcFrame {jpg:Buffer;ycc:Buffer;yccGzip:Buffer;ptsNs:number|null;bytes:number}

/** Mira o MEIO do quadro: a busca ACCURATE cai nele, nunca no vizinho por
 * arredondamento de nanossegundo na borda. */
export function qcFramePositionNs(frame:number,rate:{num:number;den:number}):number{
  return Math.round((frame+0.5)*rate.den*1e9/rate.num)
}

/** Último índice de quadro válido para uma duração e cadência. */
export function qcLastFrame(durationNs:number|null,rate:{num:number;den:number}):number|null{
  if(durationNs==null||!Number.isFinite(durationNs)||durationNs<=0)return null
  return Math.max(0,Math.ceil(durationNs*rate.num/(rate.den*1e9)-1e-6)-1)
}

export class QcFrameBusy extends Error {}

export class QcFrames {
  private cache=new Map<string,QcFrame>()
  private bytes=0
  private inflight=new Map<string,Promise<QcFrame|null>>()
  private running=0
  private waiting:Array<()=>void>=[]
  constructor(private readonly tempDir:string,private readonly limitBytes=QC_FRAME_CACHE_BYTES){}

  get(key:string,run:(prefixo:string)=>Promise<{ptsNs:number|null}|null>):Promise<QcFrame|null>{
    const cached=this.cache.get(key)
    if(cached){this.cache.delete(key);this.cache.set(key,cached);return Promise.resolve(cached)}
    const pending=this.inflight.get(key)
    if(pending)return pending
    if(this.running>=QC_FRAME_CONCURRENCY&&this.waiting.length>=QC_FRAME_QUEUE)return Promise.reject(new QcFrameBusy('Extração de quadros ocupada; tente de novo em instantes.'))
    const work=this.slot(async()=>{
      const prefixo=join(this.tempDir,`qc-${randomUUID()}`)
      try{
        await mkdir(this.tempDir,{recursive:true})
        const result=await run(prefixo)
        if(!result)return null
        const [jpg,ycc]=await Promise.all([readFile(`${prefixo}.jpg`),readFile(`${prefixo}.ycc`)])
        const yccGzip=gzipSync(ycc,{level:1})
        const frame:QcFrame={jpg,ycc,yccGzip,ptsNs:result.ptsNs,bytes:jpg.length+ycc.length+yccGzip.length}
        this.remember(key,frame)
        return frame
      }catch{return null}
      finally{await Promise.all([rm(`${prefixo}.jpg`,{force:true}),rm(`${prefixo}.ycc`,{force:true})])}
    }).finally(()=>this.inflight.delete(key))
    this.inflight.set(key,work)
    return work
  }

  private remember(key:string,frame:QcFrame){
    if(frame.bytes>this.limitBytes)return
    this.cache.set(key,frame);this.bytes+=frame.bytes
    for(const [oldKey,old] of this.cache){
      if(this.bytes<=this.limitBytes)break
      this.cache.delete(oldKey);this.bytes-=old.bytes
    }
  }

  private async slot<T>(task:()=>Promise<T>):Promise<T>{
    if(this.running>=QC_FRAME_CONCURRENCY)await new Promise<void>(resolve=>this.waiting.push(resolve))
    this.running++
    try{return await task()}
    finally{this.running--;this.waiting.shift()?.()}
  }
}
