/** O que é credencial de verdade num valor guardado.
 *
 * O cofre só cifra o que abriria um serviço para quem lesse o banco: chave de
 * stream, passphrase SRT, usuário/senha em URL, token de webhook. Endereço de
 * fonte NDI/OMT, caminho de arquivo, grade, auditoria e alertas vão em claro.
 *
 * A detecção é conservadora: na dúvida (URL que não se deixa analisar, RTMP com
 * caminho, HTTP com caminho ou consulta, fragmento `#` numa URL de transporte)
 * o valor conta como credencial e continua cifrado. Errar para o lado do claro
 * vazaria um segredo; errar para o lado do cifrado só mantém o comportamento
 * antigo.
 *
 * O mascaramento de diagnóstico (`sanitize-diagnostic.ts`) usa os mesmos nomes
 * e o mesmo padrão de URL: o que ele devolve nunca conta como credencial. */

/** Nome de campo/parâmetro que carrega segredo: os nomes clássicos, `key`,
 * `streamid`, e qualquer nome terminado em token, passphrase, secret ou
 * password (`auth_token`, `srt_passphrase`, `client_secret`, `accessToken`). */
export const SECRET_NAME_SOURCE='(?:passphrase|password|passwd|pwd|pass|secret|token|auth|authorization|credentials?|key|stream[_-]?key|stream[_-]?id|(?:api|access|private|secret|auth|signing)[_-]?key|sig|signature|[a-z0-9]+[_.-]?(?:token|passphrase|secret|password|passwd))'
const secretName=new RegExp(`^${SECRET_NAME_SOURCE}$`,'i')
export const isSecretName=(name:string):boolean=>secretName.test(name)

/** Qualquer `esquema://…` (srt, rtmp, rtmps, rtmpt, rtmpe, rtsp, rtsps, ftp,
 * http, ws, rist, ndi, omt, file…). */
export const URL_PATTERN_SOURCE='\\b[a-z][a-z0-9+.-]*:\\/\\/[^\\s<>"\'`\\\\]+'
const urlPattern=new RegExp(URL_PATTERN_SOURCE,'gi')

const maskedValue=(value:string)=>!value||value==='REDACTED'
// Também pega JSON serializado dentro de outro JSON (aspas escapadas). Valor
// texto não vazio e não mascarado, objeto, lista não vazia ou número.
const secretJsonKey=new RegExp(`\\\\?"${SECRET_NAME_SOURCE}\\\\?"\\s*:\\s*(?:\\\\?"(?!\\\\?")(?!(?:REDACTED|\\[PROTEGIDO\\])\\\\?")|\\{|\\[(?!\\])|-?\\d)`,'i')

// `nome=valor` / `nome: valor` solto no texto (linha de comando, mensagem).
const secretAssignment=new RegExp(`(?:^|[\\s?&;,({\\[])${SECRET_NAME_SOURCE}\\s*[=:]\\s*(?!REDACTED(?![^\\s&,;}\\]]))(?!['"]?(?:REDACTED|\\[PROTEGIDO\\])['"]?(?![^\\s&,;}\\]]))[^\\s&,;}\\]]`,'i')

function urlHasCredential(raw:string):boolean{
  const address=raw.replace(/[),.;\]}]+$/,'')
  let url:URL
  try{url=new URL(address)}catch{return true}
  const scheme=url.protocol.slice(0,-1).toLowerCase()
  // Texto já mascarado pelo diagnóstico (REDACTED) não é credencial.
  if(!maskedValue(url.username)||!maskedValue(url.password))return true
  for(const [key,value] of url.searchParams)if(isSecretName(key)&&!maskedValue(value))return true
  // Fragmento: no SRT o streamid "#!::u=…,s=…" quebra a URL e o que vem depois
  // (inclusive a passphrase) cai no hash. Na dúvida, credencial.
  if(scheme!=='file'&&url.hash&&url.hash!=='#')return true
  const path=url.pathname.replace(/^\/+|\/+$/g,'')
  if(path.split('/').at(-1)==='REDACTED')return false
  if(/^rtmp[a-z]*$/.test(scheme)&&path)return true
  // Webhooks costumam levar o token no caminho, não na consulta.
  if(/^(?:https?|wss?)$/.test(scheme)&&(path||url.search))return true
  return false
}

export function containsCredential(value:string):boolean{
  if(/\bBearer\s+\S/i.test(value)||secretJsonKey.test(value)||secretAssignment.test(value))return true
  for(const match of value.matchAll(urlPattern))if(urlHasCredential(match[0]))return true
  return false
}
