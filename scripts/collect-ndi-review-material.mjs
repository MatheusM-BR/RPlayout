import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

// Public review documents only: no SDK installer, form submission, agreement
// acceptance, package mutation or claim of permission to redistribute.
assert.equal(process.argv.length,2)
const root=fileURLToPath(new URL('..',import.meta.url))
const directory=await mkdtemp(join(root,'scratch','ndi-review-material-'))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const binary=await readFile(join(root,'release/runtime-base-r30/Processing.NDI.Lib.x64.dll'))
assert.equal(sha(binary),'2b6602075868ba4401f82f417d72424805d69b11ca86078023d0d489ff45dd84')
const result={status:'REVIEW_REQUIRED',directory,observedAt:new Date().toISOString(),referenceRuntime:{file:'release/runtime-base-r30/Processing.NDI.Lib.x64.dll',bytes:binary.length,sha256:sha(binary)},reviewMaterialsOnly:true,runtimeTermsBindingVerified:false,termsAcceptedOnUserBehalf:false,sdkDownloaded:false,publicationApproved:false,sources:[]}
let failure
try{
 for(const [file,url]of[
  ['NDI-SDK-agreement-current-review.pdf','https://downloads.ndi.tv/SDK/NDI_SDK/NDI%20SDK%20License%20Agreement.pdf'],
  ['NDI-agreement-alternate-review.pdf','https://downloads.ndi.tv/SDK/NDI_SDK/NDI%20License%20Agreement.pdf'],
 ]){
  const observation={url,file,startedAt:new Date().toISOString()};result.sources.push(observation)
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'user-agent':'RPlayout-public-license-review'}})
  observation.status=response.status;assert.equal(response.status,200)
  observation.contentType=response.headers.get('content-type');assert.match(observation.contentType??'',/^application\/pdf(?:;|$)/i)
  const parts=[];let length=0
  for await(const part of response.body){length+=part.length;assert.ok(length<=2*1024*1024,'Unexpected review document size');parts.push(part)}
  const bytes=Buffer.concat(parts);assert.ok(bytes.length>=10000);assert.equal(bytes.subarray(0,5).toString('ascii'),'%PDF-')
  await writeFile(join(directory,file),bytes,{flag:'wx'})
  Object.assign(observation,{bytes:bytes.length,sha256:sha(bytes),lastModified:response.headers.get('last-modified'),etag:response.headers.get('etag'),retrieved:true})
 }
 assert.notEqual(result.sources[0].sha256,result.sources[1].sha256,'Distinct official filenames must not silently be treated as the same agreement')
}catch(error){
 failure=error;result.status='COLLECTION_FAILED';result.error=String(error)
 const code=error?.cause?.code
 if(['ENOTFOUND','EAI_AGAIN','EACCES','EPERM','ECONNREFUSED','ETIMEDOUT'].includes(code))result.networkFailureCode=code
}
await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
console.log(JSON.stringify(result))
if(failure)throw failure
