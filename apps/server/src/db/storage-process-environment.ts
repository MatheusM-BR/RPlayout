/** SQLite IPC needs runtime/module lookup and local temp/locale settings,
 * not the backend's credentials, media settings, endpoints or Node hooks.
 * Keep an allowlist so new secret names cannot silently cross this boundary.
 * Does not change the parent environment or command-line permission flags. */
export function storageProcessEnvironment(environment:Readonly<NodeJS.ProcessEnv>=process.env):NodeJS.ProcessEnv{
  const allowed=new Set(['SYSTEMROOT','WINDIR','PATH','PATHEXT','TEMP','TMP','NODE_PATH','LANG','LC_ALL','LC_CTYPE','TZ'])
  const result:NodeJS.ProcessEnv={}
  for(const [key,value]of Object.entries(environment)){
    const normalized=key.toUpperCase()
    if(allowed.has(normalized)&&value!==undefined&&!Object.hasOwn(result,normalized))result[normalized]=value
  }
  return result
}
