/** O que é credencial de verdade num valor guardado.
 *
 * O cofre só cifra o que abriria um serviço para quem lesse o banco: chave de
 * stream, passphrase SRT, usuário/senha em URL, token de webhook. Endereço de
 * fonte NDI/OMT, caminho de arquivo, grade, auditoria e alertas vão em claro.
 *
 * A detecção é conservadora: na dúvida (URL que não se deixa analisar, RTMP com
 * caminho, HTTP com caminho ou consulta) o valor conta como credencial e
 * continua cifrado. Errar para o lado do claro vazaria um segredo; errar para o
 * lado do cifrado só mantém o comportamento antigo. */
const secretQuery=/^(?:passphrase|password|passwd|pwd|pass|secret|token|auth|authorization|stream[_-]?key|streamid|key|api[_-]?key|access[_-]?token|sig|signature)$/i
// Também pega JSON serializado dentro de outro JSON (aspas escapadas).
const secretJsonKey=/\\?"(?:passphrase|password|passwd|secret|token|accessToken|access_token|apiKey|api_key|streamKey|stream_key|authorization|credentials?)\\?"\s*:\s*(?:\\?"(?!\\?")|\{|\[(?!\]))/i
const urlPattern=/\b(?:https?|srt|rtmps?|rtsp|udp|tcp|wss?|rist):\/\/[^\s<>"'`\\]+/gi

function urlHasCredential(raw:string):boolean{
  const address=raw.replace(/[),.;\]}]+$/,'')
  let url:URL
  try{url=new URL(address)}catch{return true}
  if(url.username||url.password)return true
  for(const key of url.searchParams.keys())if(secretQuery.test(key))return true
  const path=url.pathname.replace(/^\/+|\/+$/g,'')
  if(/^rtmps?:$/.test(url.protocol)&&path)return true
  // Webhooks costumam levar o token no caminho, não na consulta.
  if(/^(?:https?|wss?):$/.test(url.protocol)&&(path||url.search))return true
  return false
}

export function containsCredential(value:string):boolean{
  if(/\bBearer\s+\S/i.test(value)||secretJsonKey.test(value))return true
  for(const match of value.matchAll(urlPattern))if(urlHasCredential(match[0]))return true
  return false
}
