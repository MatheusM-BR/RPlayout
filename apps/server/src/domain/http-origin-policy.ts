/** CORS configuration is authority, not arbitrary URL text. Invalid entries
 * fail closed before creating the app/DB/runtime; never echo supplied values. */
export function parseAllowedOrigins(raw:string|undefined):string[]{
  if(raw===undefined||!raw.trim())return []
  const entries=raw.split(',')
  if(entries.length>64)throw new Error('RPLAYOUT_ALLOWED_ORIGINS aceita no máximo 64 origens explícitas.')
  const accepted=new Set<string>()
  for(const [index,entry]of entries.entries()){
    const candidate=entry.trim()
    const invalid=()=>new Error(`RPLAYOUT_ALLOWED_ORIGINS: entrada ${index+1} inválida. Use somente origem HTTP/HTTPS (protocolo, host e porta), sem credenciais, caminho, query, fragmento ou curingas.`)
    if(!candidate||candidate.length>2048||/[\s\\?#@*\u0000-\u001f\u007f]/u.test(candidate)||!/^https?:\/\//i.test(candidate))throw invalid()
    let parsed:URL
    try{parsed=new URL(candidate)}catch{throw invalid()}
    if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.hostname.includes('*')||parsed.pathname!=='/'||parsed.username||parsed.password||parsed.search||parsed.hash)throw invalid()
    accepted.add(parsed.origin)
  }
  return [...accepted]
}

/** Browser Origin is already serialized: unlike configuration, do not
 * normalize malformed request headers or permit opaque `null` origins. */
export function trustedHttpOrigin(origin:string|undefined,host:string|undefined,extras:readonly string[]=[]):boolean{
  if(origin===undefined)return true // Service/CLI still require authentication.
  if(typeof origin!=='string'||!origin||origin.length>2048||/[\s\\]/u.test(origin))return false
  try{
    const parsed=new URL(origin)
    if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)return false
    if(extras.includes(origin))return true
    if(!host||/[\s\\/?#@]/u.test(host))return false
    const authority=new URL(`${parsed.protocol}//${host}`)
    return authority.host===parsed.host&&authority.pathname==='/'&&!authority.username&&!authority.password
  }catch{return false}
}
