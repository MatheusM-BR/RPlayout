import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {categoryETag} from '../packages/protocol/src/category-review.js'

// Test-only peer of the own settings fixture. Never inspect browser cookies.
// Check its own fixture identity/roots before any category mutation.
const port=Number(process.argv[2]),directory=process.argv[3]
assert.ok(Number.isInteger(port)&&port>0&&port<=65535)
assert.ok(directory?.includes('RPlayout-settings-browser-'))
const base=`http://127.0.0.1:${port}`,id='Jornal São José Çãó'
const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'settings-verifier',password:'Local-settings-20261009'}),signal:AbortSignal.timeout(5000)})
assert.equal(response.status,200)
const cookie=response.headers.get('set-cookie')!.split(';')[0]!
const read=async(path:string)=>{const response=await fetch(base+path,{headers:{cookie},signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);return response.json()}
const accounts=await read('/api/users/review') as {users:Array<{username:string}>}
assert.deepEqual(accounts.users.map(user=>user.username),['settings-verifier'])
const roots=await read('/api/library/roots/review') as {roots:Array<{path:string}>}
assert.ok(roots.roots.length>0&&roots.roots.every(root=>root.path.startsWith(directory!+'\\')))
const original=await read('/api/categories/'+encodeURIComponent(id)+'/review')
assert.equal(original.id,id);assert.equal(original.color,'#5b8fd6')
const saved=await fetch(base+'/api/categories/'+encodeURIComponent(id),{method:'PUT',headers:{cookie,'content-type':'application/json','if-match':categoryETag(original)},body:JSON.stringify({color:original.color}),signal:AbortSignal.timeout(5000)})
assert.equal(saved.status,200)
const changed=await saved.json();assert.equal(changed.applied,true);assert.ok(changed.revision>original.revision);assert.equal(changed.color,original.color)
const result={result:'PASS',directory,scope:'Own synthetic peer API commit only, not UI stale rejection',id,color:changed.color,beforeRevision:original.revision,afterRevision:changed.revision,sameValueEdit:true,tokenLogged:false}
await writeFile(join(fileURLToPath(new URL('..',import.meta.url)),'scratch','editorial-confirmation-20261014','peer-same-value.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
