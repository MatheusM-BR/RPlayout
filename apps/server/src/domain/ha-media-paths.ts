import {PORTS} from './mediamtx.js'
/** Resolve ONLY explicitly reviewed loopback destinations. No targetOf/env,
 * no original host/secret URL sent to the browser. Remote sinks remain remote. */
export function haLocalMediaPaths(outputs:{program:readonly string[];preview:string|null}){
  const paths=new Set<string>();let preview:string|null=null,monitor:string|null=null,programDependent=false
  const inspect=(encoded:string,bus:'program'|'preview')=>{
    if(!encoded.startsWith('{'))return
    const profile=JSON.parse(encoded) as {kind?:string;target?:string;role?:string}
    if(!['rtmp','srt'].includes(profile.kind??'')||typeof profile.target!=='string')return
    const url=new URL(profile.target)
    if(!['127.0.0.1','[::1]'].includes(url.hostname))return
    if(url.username||url.password||url.hash)throw new Error('Destino local MediaMtx não aceita credencial na URL.')
    let path:string
    if(profile.kind==='rtmp'){
      if(url.protocol!=='rtmp:'||Number(url.port||1935)!==PORTS.rtmp||url.search)throw new Error('Destino RTMP local diverge do servidor de mídia revisado.')
      path=url.pathname.slice(1)
      if(!path.includes('/'))throw new Error('Publicação RTMP exige app/stream explícitos.')
    }else{
      if(url.protocol!=='srt:'||Number(url.port)!==PORTS.srt||!['','/'].includes(url.pathname)||url.searchParams.getAll('streamid').length!==1)throw new Error('Destino SRT local exige porta e streamid explícitos.')
      const stream=url.searchParams.get('streamid')!
      if(!stream.startsWith('publish:')||[...url.searchParams.keys()].some(key=>!['streamid','mode','latency'].includes(key))||url.searchParams.has('mode')&&url.searchParams.get('mode')!=='caller')throw new Error('Destino SRT local não corresponde a publicação MediaMtx.')
      path=stream.slice('publish:'.length)
    }
    if(path.length>256||!/^[-A-Za-z0-9_]+(?:\/[-A-Za-z0-9_]+)*$/.test(path))throw new Error('Caminho MediaMtx local inválido.')
    if(paths.has(path))throw new Error('Dois publishers locais selecionaram o mesmo caminho MediaMtx.')
    paths.add(path)
    if(bus==='program'&&profile.role!=='mon')programDependent=true
    if(bus==='preview'){if(preview&&preview!==path)throw new Error('Preview local ambíguo.');preview=path}
    if(profile.role==='mon'){if(monitor&&monitor!==path)throw new Error('Monitor local ambíguo.');monitor=path}
  }
  for(const output of outputs.program)inspect(output,'program')
  if(outputs.preview)inspect(outputs.preview,'preview')
  if(preview&&preview===monitor)throw new Error('PVW e MON não podem publicar no mesmo caminho.')
  return {paths:[...paths],preview,monitor,webrtcPort:PORTS.webrtc,programDependent}
}
