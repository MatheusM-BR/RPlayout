// QA entry only. Private fixture paths come from an owned sidecar, not backend
// environment exceptions. Legacy proxy source stays immutable for old evidence.
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {join,resolve,isAbsolute}=require('node:path')
const {createHash}=require('node:crypto')
const context=JSON.parse(readFileSync(join(__dirname,'qa-storage-context.json'),'utf8'))
assert.equal(context.kind,'RPlayout-owned-storage-proxy-v2')
assert.equal(context.proxyFile,'qa-proxy.cjs');assert.ok(isAbsolute(context.realService))
assert.ok(context.realService.endsWith('\\storage-service.cjs'));assert.ok(process.send&&process.env.RPLAYOUT_STORAGE_FILE)
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex')
assert.equal(hash(context.realService),context.realServiceSha256)
assert.equal(hash(join(__dirname,context.proxyFile)),context.proxySha256)
// These three QA-only paths are generated HERE, after the production filter.
// No backend key or exception to storageProcessEnvironment is introduced.
process.env.RPLAYOUT_QA_STORAGE_FAULT_ROOT=resolve(__dirname)
process.env.RPLAYOUT_QA_STORAGE_OBSERVER_ROOT=resolve(__dirname)
process.env.RPLAYOUT_QA_STORAGE_REAL_SERVICE=context.realService
require(join(__dirname,context.proxyFile))
