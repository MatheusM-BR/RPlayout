import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

/** Windows reports NTSTATUS codes as unsigned exit codes. The ones that a
 * native media process actually ends with get a readable name; everything
 * else keeps its hexadecimal value so it can be looked up. */
const knownStatus:Record<number,string>={
  0xC0000409:'STATUS_STACK_BUFFER_OVERRUN: encerramento imediato (panic do Rust em callback nativo, abort() ou proteção de pilha)',
  0xC0000005:'STATUS_ACCESS_VIOLATION: acesso inválido à memória',
  0xC00000FD:'STATUS_STACK_OVERFLOW: estouro de pilha',
  0xC0000017:'STATUS_NO_MEMORY: memória insuficiente',
  0x80000003:'STATUS_BREAKPOINT: g_error/abort de biblioteca nativa',
  0xC000013A:'STATUS_CONTROL_C_EXIT: encerrado pelo console',
}
export function describeEngineExit(code:number|null,signal:string|null):string{
  if(signal)return `sinal ${signal}`
  if(code===null)return 'código desconhecido'
  const unsigned=code<0?code>>>0:code
  const hex='0x'+unsigned.toString(16).toUpperCase().padStart(8,'0')
  const known=knownStatus[unsigned]
  if(known)return `código ${unsigned} (${hex}, ${known})`
  return unsigned>255?`código ${unsigned} (${hex})`:`código ${unsigned}`
}

/** Last stderr lines of one engine process. The engine writes its own
 * diagnostics, Rust panic messages and backtraces there; when the process
 * dies the tail is what explains why. */
export class StderrTail {
  private readonly lines:string[]=[]
  constructor(private readonly limit=300){}
  push(line:string):void{this.lines.push(line);if(this.lines.length>this.limit)this.lines.shift()}
  snapshot():string[]{return [...this.lines]}
}

export interface EngineCrash {channelId:string;channelName:string;code:number|null;signal:string|null;pid:number|null;startedAt:number|null;at:number;stderr:readonly string[];memory?:{freeBytes:number;totalBytes:number}}
export function engineCrashReport(crash:EngineCrash):string{
  const uptime=crash.startedAt===null?'desconhecido':`${Math.round((crash.at-crash.startedAt)/1000)} s`
  const memory=crash.memory?`${Math.round(crash.memory.freeBytes/2**20)} MiB livres de ${Math.round(crash.memory.totalBytes/2**20)} MiB`:'não medida'
  return [
    'RPlayout · encerramento inesperado do engine',
    `quando: ${new Date(crash.at).toISOString()}`,
    `canal: ${crash.channelName} (${crash.channelId})`,
    `processo: ${crash.pid??'desconhecido'} · tempo no ar: ${uptime}`,
    `saída: ${describeEngineExit(crash.code,crash.signal)}`,
    `memória do computador no momento: ${memory}`,
    '',
    `últimas ${crash.stderr.length} linhas de diagnóstico do engine:`,
    ...crash.stderr,
    '',
  ].join('\n')
}
/** Best effort: a full disk must not turn a crash into a second failure. */
export function writeEngineCrashReport(directory:string,crash:EngineCrash):string|null{
  try{
    mkdirSync(directory,{recursive:true})
    const stamp=new Date(crash.at).toISOString().replace(/[:.]/g,'-')
    const file=join(directory,`engine-crash-${stamp}-${crash.channelId.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,40)}.txt`)
    writeFileSync(file,engineCrashReport(crash),{encoding:'utf8',flag:'wx'})
    return file
  }catch{return null}
}
