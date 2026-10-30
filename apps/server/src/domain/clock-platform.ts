import {execFile} from 'node:child_process'

/**
 * Leitura complementar do que o sistema operacional diz sobre a hora.
 * Informação de apoio no status: NÃO substitui a medição SNTP, e qualquer
 * falha de leitura vira `error`/campos nulos, nunca exceção.
 */
export type ExecFn=(file:string,args:string[],options:{timeout:number;windowsHide:boolean;maxBuffer:number})=>Promise<{stdout:string;stderr:string}>
export interface PlatformClock {
  platform:string
  /** Windows: Source de `w32tm /query /status`. */
  source:string|null
  /** Windows: Last Successful Sync Time. Texto do sistema, no idioma dele. */
  lastSuccessfulSync:string|null
  /** Windows: serviço W32Time rodando? null = não foi possível saber. */
  serviceRunning:boolean|null
  /** Linux: NTPSynchronized (timedatectl) / "Leap status" normal (chrony). */
  synchronized:boolean|null
  /** Linux: serviço NTP habilitado (timedatectl NTP=yes). */
  ntpEnabled:boolean|null
  /** Linux/chrony: stratum e diferença reportada, quando existir. */
  chrony:{stratum:number|null;systemTimeSeconds:number|null;leapStatus:string|null}|null
  error:string|null
}

const defaultExec:ExecFn=(file,args,options)=>new Promise((resolve,reject)=>{
  execFile(file,args,{...options,shell:false,encoding:'utf8'},(error,stdout,stderr)=>{
    if(error)return reject(Object.assign(error,{stdout,stderr}))
    resolve({stdout,stderr})
  })
})
const OPTIONS={timeout:4000,windowsHide:true,maxBuffer:256*1024}
const empty=(platform:string):PlatformClock=>({platform,source:null,lastSuccessfulSync:null,serviceRunning:null,synchronized:null,ntpEnabled:null,chrony:null,error:null})
const message=(error:unknown)=>error instanceof Error?error.message.split('\n')[0]!.slice(0,200):String(error).slice(0,200)

/** `Chave: valor` com rótulo em inglês ou português (Windows localizado). */
export function parseW32tmStatus(output:string):{source:string|null;lastSuccessfulSync:string|null}{
  let source:string|null=null,lastSuccessfulSync:string|null=null
  for(const line of output.split(/\r?\n/)){
    const at=line.indexOf(':');if(at<0)continue
    const key=line.slice(0,at).trim().toLowerCase(),value=line.slice(at+1).trim()
    if(!value)continue
    if(/^(source|origem|fonte)$/.test(key))source=value
    else if(/last successful sync time|última sincronização|ultima sincronizacao|hora da última sincronização|hora da ultima sincronizacao/.test(key))lastSuccessfulSync=value
  }
  return {source,lastSuccessfulSync}
}

/** `sc query w32time`: o estado numérico/nome (RUNNING/STOPPED) não é traduzido. */
export function parseScState(output:string):boolean|null{
  const match=/STATE\s*:\s*\d+\s+(\w+)/i.exec(output)
  return match?match[1]!.toUpperCase()==='RUNNING':null
}

export function parseTimedatectl(output:string):{synchronized:boolean|null;ntpEnabled:boolean|null}{
  const map=new Map<string,string>()
  for(const line of output.split(/\r?\n/)){const at=line.indexOf('=');if(at>0)map.set(line.slice(0,at).trim(),line.slice(at+1).trim().toLowerCase())}
  const flag=(key:string)=>map.has(key)?map.get(key)==='yes':null
  return {synchronized:flag('NTPSynchronized'),ntpEnabled:flag('NTP')}
}

export function parseChronyTracking(output:string):PlatformClock['chrony']{
  const stratum=/^Stratum\s*:\s*(\d+)/mi.exec(output),system=/^System time\s*:\s*([\d.]+)\s+seconds\s+(fast|slow)/mi.exec(output),leap=/^Leap status\s*:\s*(.+)$/mi.exec(output)
  if(!stratum&&!system&&!leap)return null
  return {stratum:stratum?Number(stratum[1]):null,systemTimeSeconds:system?Number(system[1])*(system[2]!.toLowerCase()==='slow'?-1:1):null,leapStatus:leap?leap[1]!.trim():null}
}

export async function readPlatformClock(options:{exec?:ExecFn;platform?:NodeJS.Platform}={}):Promise<PlatformClock>{
  const exec=options.exec??defaultExec,platform=options.platform??process.platform
  const out=empty(platform)
  try{
    if(platform==='win32'){
      try{const {stdout}=await exec('sc.exe',['query','w32time'],OPTIONS);out.serviceRunning=parseScState(stdout)}
      catch(error){
        const text=String((error as {stdout?:string}).stdout??'')
        const state=parseScState(text)
        if(state!==null)out.serviceRunning=state
        else if(/1060/.test(text))out.serviceRunning=null // serviço inexistente
      }
      try{
        const {stdout}=await exec('w32tm',['/query','/status'],OPTIONS)
        Object.assign(out,parseW32tmStatus(stdout))
      }catch(error){
        const text=String((error as {stdout?:string;stderr?:string}).stdout??'')+String((error as {stderr?:string}).stderr??'')
        // 0x80070426: serviço não iniciado.
        if(/0x80070426/i.test(text))out.serviceRunning=false
        out.error=out.serviceRunning===false?'Serviço Horário do Windows (W32Time) parado.':message(error)
      }
      if(out.serviceRunning===false&&!out.error)out.error='Serviço Horário do Windows (W32Time) parado.'
    }else if(platform==='linux'){
      try{
        const {stdout}=await exec('timedatectl',['show','-p','NTPSynchronized','-p','NTP'],OPTIONS)
        Object.assign(out,parseTimedatectl(stdout))
      }catch(error){out.error=message(error)}
      try{
        const {stdout}=await exec('chronyc',['tracking'],OPTIONS)
        out.chrony=parseChronyTracking(stdout)
        if(out.chrony?.leapStatus&&out.synchronized===null)out.synchronized=/^normal$/i.test(out.chrony.leapStatus)
        if(out.chrony)out.error=null
      }catch{/* chrony pode não existir; timedatectl já cobre */}
    }
  }catch(error){out.error=message(error)}
  return out
}
