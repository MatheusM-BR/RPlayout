import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,dirname,join} from 'node:path'

// Read-only assertions over an already stopped QA fixture. No network, DB,
// product writes, process termination or inferred browser validation.
const file=resolve(process.argv[2]??''),mode=process.argv[3]
assert.ok(['installed-editorial','bootstrap','scan','editors-media','editors-graphics'].includes(mode))
const result=JSON.parse(await readFile(file,'utf8'))
assert.equal(result.result,'FIXTURE_FINISHED');assert.equal(result.error,null)
assert.equal(result.serverExitObserved,true);assert.equal(result.engineDisabled,true)
assert.equal(result.asRun.count,0);assert.equal(result.accountMutations,0)
const count=kind=>result.audits.filter(row=>row.kind===kind).length
const faults=result.events.filter(row=>row.fault)
const bounded=kinds=>{
  for(const kind of kinds){
    const entries=faults.filter(row=>row.kind===kind);assert.ok(entries.length>0,kind)
    for(const entry of entries){assert.equal(entry.status,undefined);assert.equal(entry.finished,false);assert.ok(entry.durationMs>=9000&&entry.durationMs<12000,`${kind}: ${entry.durationMs}`)}
  }
}
let report
if(mode==='installed-editorial'){
  assert.notEqual(result.sourceWebOverride,true)
  assert.equal(count('INTEGRATION_CHANGED'),1);assert.equal(count('INTEGRATION_TEST_QUEUED'),1);assert.equal(count('INTEGRATION_RETRY'),1)
  assert.equal(count('API_MUTATION'),4)
  const tests=result.events.filter(row=>row.method==='POST'&&row.kind==='/api/integrations/qa-gateway/test')
  assert.equal(tests.length,2);assert.ok(tests.every(row=>row.status>=200&&row.status<300))
  assert.equal(result.received.length,2);assert.equal(new Set(result.received.map(row=>row.id)).size,2)
  assert.equal(result.deliveries.length,2)
  for(const delivery of result.deliveries){
    assert.equal(delivery.state,'DELIVERED');assert.equal(delivery.manualTest,true)
    const received=result.received.filter(row=>row.id===delivery.id)
    assert.equal(received.length,1);assert.equal(received[0].idempotencyKey,delivery.id);assert.equal(received[0].type,'rplayout.test')
  }
  assert.deepEqual(result.integrations,[{id:'qa-gateway',name:'Gateway QA revisado Çãó',enabled:false}])
  bounded(['CATEGORY_REVIEW','ROOT_BROWSE','INTEGRATION_LIST','DELIVERY_LIST','INTEGRATION_REVIEW','DELIVERY_REVIEW'])
  for(const key of ['root-browse-timeout:ROOT_BROWSE','integration-list-timeout:INTEGRATION_LIST','integration-list-timeout:DELIVERY_LIST'])assert.equal(result.maximum[key],1)
  assert.ok(faults.some(row=>row.kind==='CATEGORY_LIST'&&row.status===504))
  assert.equal(result.maximum['category-list-timeout:CATEGORY_LIST'],2)
  report={result:'PARTIAL_PASS',scope:'Installed editorial review deadlines, test deduplication and local retry',knownFailure:'Global library bootstrap: category GETs reach 25s/504, maximum concurrency 2; not certified',receivedPosts:2,uniqueDeliveries:2}
}else if(mode==='bootstrap'){
  assert.equal(result.sourceWebOverride,true)
  assert.equal(count('API_MUTATION'),0);assert.equal(result.received.length,0)
  bounded(['CATEGORY_LIST']);assert.equal(result.maximum['category-list-timeout:CATEGORY_LIST'],1)
  const fault=faults.find(row=>row.kind==='CATEGORY_LIST')
  const snapshot=result.events.find(row=>row.kind==='/api/rundowns/rd'&&row.status===200)
  assert.ok(snapshot?.closedAt<fault.closedAt,'Operational snapshot must finish before failed library read')
  assert.ok(result.events.some(row=>row.phase==='bootstrap-recover'&&row.kind==='CATEGORY_LIST'&&row.status===200))
  assert.equal(result.events.filter(row=>row.kind==='/api/auth/login').length,1)
  report={result:'PASS',scope:'Source web overlay bootstrap transport regression; not an installed-build qualification',sourceWebOverride:true,webAsset:result.webAsset,webSha:result.webSha,categoryMaximumConcurrency:1,mutations:0,receivedPosts:0}
}else if(mode==='scan'){
  const scan=JSON.parse(await readFile(join(dirname(file),'scan-evidence.json'),'utf8'))
  assert.equal(scan.emptyScanMode,true);assert.equal(scan.sourceWebOverride,true)
  assert.equal(scan.webSha,result.webSha);assert.equal(result.received.length,0)
  assert.equal(scan.commands.length,1);assert.equal(scan.commands[0].kind,'MEDIA_SCAN_QUEUED')
  assert.equal(count('MEDIA_SCAN_QUEUED'),1);assert.equal(count('MEDIA_SCAN_RECOVERY_REQUESTED'),0);assert.equal(count('API_MUTATION'),2)
  const posts=result.events.filter(row=>row.method==='POST'&&row.kind==='SCAN_COMMAND')
  assert.equal(posts.length,2);assert.equal(posts[0].upstreamStatus,200);assert.equal(posts[0].status,502)
  assert.equal(posts[0].responseReplacedAfterUpstreamCompleted,true);assert.equal(posts[1].status,200)
  assert.match(posts[0].requestBodySha256,/^[a-f0-9]{64}$/);assert.equal(posts[0].requestBodySha256,posts[1].requestBodySha256)
  const timeout=faults.find(row=>row.phase==='scan-review-timeout'&&row.kind==='SCAN_REVIEW')
  assert.ok(timeout&&timeout.durationMs>=9000&&timeout.durationMs<12000);assert.equal(timeout.status,undefined);assert.equal(timeout.finished,false)
  const closed=faults.find(row=>row.phase==='scan-close-pending'&&row.kind==='SCAN_REVIEW')
  assert.ok(closed&&closed.durationMs<9500);assert.equal(closed.status,undefined);assert.equal(closed.finished,false)
  assert.equal(result.maximum['scan-review-timeout:SCAN_REVIEW'],1)
  const manual=scan.batches.filter(row=>row.id===scan.commands[0].batchId)
  assert.equal(manual.length,1);assert.equal(manual[0].state,'COMPLETED');assert.equal(manual[0].measure,0)
  assert.deepEqual(JSON.parse(manual[0].roots),scan.commands[0].roots)
  report={result:'PASS',scope:'Source web scan UI transport, original command deduplication and owned empty-folder completion; not native media/recovery certification',sourceWebOverride:true,webAsset:result.webAsset,webSha:result.webSha,manualScanDecisions:1,manualBatchId:manual[0].id,manualBatchState:manual[0].state,scanPostRequests:2,identicalRequestBodies:true,reviewTimeoutMs:timeout.durationMs,closedPendingReadMs:closed.durationMs,otherAutomaticEmptyBatches:scan.batches.length-manual.length,recipientPosts:0}
}else{
  const editors=JSON.parse(await readFile(join(dirname(file),'editors-evidence.json'),'utf8'))
  assert.equal(editors.sourceWebOverride,true);assert.equal(editors.webSha,result.webSha)
  assert.equal(editors.actualMediaSha,editors.editorMediaHash);assert.equal(editors.asset.contentHash,editors.editorMediaHash)
  assert.equal(editors.asset.qcStatus,'PENDING');assert.equal(editors.asset.ignored,false);assert.equal(editors.scanBatches.count,0)
  assert.equal(result.received.length,0)
  const writes=result.events.filter(row=>!['GET','HEAD','OPTIONS'].includes(row.method)&&row.kind!=='/api/auth/login')
  assert.ok(writes.every(row=>row.method==='PATCH'&&row.status===200))
  if(mode==='editors-media'){
    bounded(['METADATA_REVIEW','REMOVAL_REVIEW','RULES_REVIEW'])
    assert.equal(count('ASSET_METADATA_CHANGED'),1);assert.equal(count('SCHEDULE_RULE_EDITED'),1);assert.equal(count('API_MUTATION'),2)
    assert.equal(writes.length,2);assert.equal(editors.asset.title,'Vídeo QA revisado Çãó');assert.equal(editors.rules.find(row=>row.id==='qa-rule').name,'Faixa QA revisada Çãó')
  }else{
    bounded(['GRAPHICS_REVIEW','GRAPHIC_COMMANDS'])
    assert.equal(writes.length,1);assert.equal(writes[0].kind,'/api/graphics/qa-art');assert.equal(count('API_MUTATION'),1)
    assert.equal(editors.templates.find(row=>row.id==='qa-art').name,'Arte QA revisada Çãó')
  }
  assert.equal(result.audits.filter(row=>row.actor==='editorial-verifier'&&row.kind==='GRAPHIC_COMMAND_REVIEWED').length,0)
  report={result:'PASS',scope:mode==='editors-media'?'Source web metadata/rule edits and removal read-only review':'Source web graphics catalog/history read deadlines and one template edit; no on-air/review command',sourceWebOverride:true,webAsset:result.webAsset,webSha:result.webSha,confirmedEditorWrites:writes.length,mediaHashPreserved:true,qcPreserved:true,scanBatches:0,recipientPosts:0,deletionExecuted:false}
}
const output={...report,fixture:file,serverSha:result.serverSha,physicalSignalValidated:false,browserValidation:'Manual evidence documented separately',serverExitObserved:true}
await writeFile(join(dirname(file),`assertions-${mode}.json`),JSON.stringify(output,null,2))
console.log(JSON.stringify(output))
