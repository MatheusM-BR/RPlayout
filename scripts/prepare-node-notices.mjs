import assert from 'node:assert/strict'
import {readFile,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'

const root=resolve(process.argv[2]??'')
assert.ok(process.argv[2],'Provide a package with bundled Node')
const manifest=JSON.parse(await readFile(join(root,'package-manifest.json'),'utf8'))
const binary=join(root,'runtime/node/node.exe'),entry=manifest.files.find(value=>value.file==='runtime/node/node.exe')
assert.ok(entry)
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const binarySha=sha(await readFile(binary))
assert.equal(binarySha.toUpperCase(),entry.sha256.toUpperCase())
const version=(await promisify(execFile)(binary,['--version'],{windowsHide:true,timeout:10000})).stdout.trim()
assert.equal(version,manifest.node);assert.match(version,/^v\d+\.\d+\.\d+$/)
const source=`https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`
const response=await fetch(source,{redirect:'error',signal:AbortSignal.timeout(30000)})
assert.equal(response.status,200)
const bytes=Buffer.from(await response.arrayBuffer())
assert.ok(bytes.length>10000&&bytes.length<2000000,'Unexpected notice size')
assert.match(bytes.toString('utf8'),/Node\.js/)
const directory=await mkdtemp(join(fileURLToPath(new URL('../scratch/',import.meta.url)),'node-notices-'))
await writeFile(join(directory,'LICENSE.txt'),bytes,{flag:'wx'})
const provenance={version,source,binarySha256:binarySha,licenseSha256:sha(bytes),bytes:bytes.length,publicationApproved:false}
await writeFile(join(directory,'provenance.json'),JSON.stringify(provenance,null,2),{flag:'wx'})
console.log(JSON.stringify({directory,...provenance}))
