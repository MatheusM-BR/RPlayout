import type Database from 'better-sqlite3'
import {installationVault} from './secret-vault.js'
import {readOperationalPayload} from './operational-playlist.js'
import {parseChannelCheckpoint} from './checkpoints.js'
import type {HaSnapshot} from './ha-replication.js'
import {returnMediaRequirements} from './ha-return-media-requirements.js'

/** Stable JSON comparison, including unknown payload fields. Comparison MACs
 * use the LOCAL vault, not public hashes of decrypted credentials/paths. */
function canonical(value:unknown,depth=0):unknown{
  if(depth>40)throw new Error('Conteúdo operacional excede profundidade de revisão.')
  if(value===null||typeof value==='string'||typeof value==='boolean')return value
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Número operacional inválido.');return value}
  if(Array.isArray(value))return ['array',value.map(entry=>entry===undefined?null:canonical(entry,depth+1))]
  if(value&&typeof value==='object')return ['object',Object.keys(value).sort().filter(key=>(value as Record<string,unknown>)[key]!==undefined).map(key=>[key,canonical((value as Record<string,unknown>)[key],depth+1)])]
  throw new Error('Conteúdo operacional não serializável.')
}
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Objeto operacional inválido.');return value as Record<string,unknown>}
const identifier=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>256)throw new Error('Identidade operacional inválida.');return value}
const fieldLabels=['version','editorialRevision','rate','audioChannels','rundown','items','assets','graphics','secondaryEvents','schedule','restoredFrom','operation']

/** Point-in-time diagnostic of a REKEYED readonly inspection copy. Does not
 * publish, merge, resolve commands, select a cursor or read foreign paths. */
export function inspectReturnContent(db:Database.Database,channelId:string,baseline:HaSnapshot){
  const vault=installationVault(false),primary=baseline.channels.find(row=>row.channelId===channelId)
  if(!primary)throw new Error('Canal do principal ausente.')
  const inspectMedia=returnMediaRequirements(primary),mediaDetails:Array<{revisionId:string;itemId:string;errors:string[];warnings:string[]}>=[]
  let mediaChecks=0,mediaBlocked=0,liveBindingsRequired=0
  let budget=0
  const encode=(value:unknown)=>{const raw=JSON.stringify(canonical(value));if(Buffer.byteLength(raw)>8*1024*1024||(budget+=Buffer.byteLength(raw))>128*1024*1024)throw new Error('Conteúdo operacional excede orçamento.');return raw}
  const mac=(raw:string)=>vault.reviewIdentity(raw,'ha-return-content-comparison:v1')
  const validatePayload=(raw:unknown,rundownId:string)=>{
    const record=object(raw),payload=readOperationalPayload(record)
    if(payload.rundown.id!==rundownId||payload.rundown.channelId!==channelId||payload.items.length>100000)throw new Error('Payload publicado pertence a outra grade/canal ou excede limite.')
    const itemIds=new Set<string>()
    for(const item of payload.items){const id=identifier(item.id);if(item.rundownId!==rundownId||itemIds.has(id))throw new Error('Identidade/referência de item publicado inválida.');itemIds.add(id)}
    return {record,itemIds}
  }
  const before=new Map<string,{rundownId:string;payloadMac:string;fieldMacs:Map<string,string>}>()
  for(const row of primary.revisions){
    const id=identifier(row.id),rundownId=identifier(row.rundownId??row.rundown_id)
    if(before.has(id)||before.size>=100000)throw new Error('Identidade/limite de edições do principal inválido.')
    const {record}=validatePayload(row.payload,rundownId),serialized=encode(record)
    const fieldMacs=new Map(fieldLabels.map(field=>[field,mac(encode(record[field]??null))]))
    before.set(id,{rundownId,payloadMac:mac(serialized),fieldMacs})
  }
  const primaryCount=before.size,received=new Map<string,{rundownId:string;itemIds:Set<string>}>(),candidates:Array<{id:string;rundownId:string;active:boolean}>=[],details:Array<{id:string;kind:'RECEIVED_ONLY'|'PRIMARY_ONLY'|'CHANGED';changedFields:string[]}>=[]
  let matched=0,changed=0,receivedOnly=0,primaryOnly=0
  const inventory:Array<[string,string,string|null,string|null]>=[]
  for(const row of db.prepare('SELECT p.id,p.rundown_id,p.active,p.payload FROM operational_playlist_revisions p JOIN rundowns r ON r.id=p.rundown_id WHERE r.channel_id=? ORDER BY p.id').iterate(channelId) as Iterable<{id:string;rundown_id:string;active:number;payload:string}>){
    const id=identifier(row.id),rundownId=identifier(row.rundown_id)
    if(received.has(id)||received.size>=100000||typeof row.payload!=='string'||row.payload.length>8*1024*1024)throw new Error('Edição recebida inválida/excede limite.')
    const {record,itemIds}=validatePayload(JSON.parse(vault.decrypt(row.payload,'operational_playlist_revisions.payload')),rundownId),payloadMac=mac(encode(record)),old=before.get(id)
    for(const check of inspectMedia(readOperationalPayload(record))){if(++mediaChecks>100000)throw new Error('Montagens excedem limite global de revisão.');if(check.errors.length)mediaBlocked++;if(check.livePending)liveBindingsRequired++;if(mediaDetails.length<1000)mediaDetails.push({revisionId:id,itemId:check.itemId,errors:check.errors,warnings:check.warnings})}
    received.set(id,{rundownId,itemIds})
    if(row.active!==0&&row.active!==1)throw new Error('Estado de ativação da edição inválido.')
    if(candidates.length<1000)candidates.push({id,rundownId,active:row.active===1})
    if(!old){receivedOnly++;inventory.push([id,'RECEIVED_ONLY',null,payloadMac]);if(details.length<1000)details.push({id,kind:'RECEIVED_ONLY',changedFields:[]})}
    else if(old.rundownId===rundownId&&old.payloadMac===payloadMac){matched++;inventory.push([id,'MATCHED',old.payloadMac,payloadMac])}
    else{changed++;inventory.push([id,'CHANGED',old.payloadMac,payloadMac]);if(details.length<1000)details.push({id,kind:'CHANGED',changedFields:fieldLabels.filter(field=>old.fieldMacs.get(field)!==mac(encode(record[field]??null)))})}
    before.delete(id)
  }
  for(const [id,row] of [...before].sort(([a],[b])=>a<b?-1:a>b?1:0)){primaryOnly++;inventory.push([id,'PRIMARY_ONLY',row.payloadMac,null]);if(details.length<1000)details.push({id,kind:'PRIMARY_ONLY',changedFields:[]})}
  const saved=db.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get(channelId) as {payload:string}|undefined
  if(saved&&saved.payload.length>1024*1024)throw new Error('Checkpoint excede limite.')
  const receivedRaw=saved?JSON.parse(saved.payload):null,primaryRaw=primary.checkpoint?object(primary.checkpoint).value:null
  const receivedCursor=receivedRaw===null?null:parseChannelCheckpoint(receivedRaw,channelId)
  if(primaryRaw!==null&&primaryRaw!==undefined)parseChannelCheckpoint(primaryRaw,channelId)
  const receivedMac=receivedRaw===null?null:mac(encode(receivedRaw)),primaryMac=primaryRaw==null?null:mac(encode(primaryRaw))
  const edition=receivedCursor?.revisionId?received.get(receivedCursor.revisionId):null
  const referencedEditionPresent=!receivedCursor?.revisionId||!!edition&&edition.rundownId===receivedCursor.rundownId
  const referencedItemPresent=!receivedCursor?.itemId||!!edition&&edition.itemIds.has(receivedCursor.itemId)
  const selectionBasis={candidates,candidatesTruncated:received.size>candidates.length,checkpoint:{revisionId:receivedCursor?.revisionId??null,rundownId:receivedCursor?.rundownId??null,itemId:receivedCursor?.itemId??null,contingencyRevisionIds:[receivedCursor?.contingency?.revisionId,receivedCursor?.contingency?.loopRevisionId].filter((id):id is string=>typeof id==='string')}}
  return {selectionBasis,version:1 as const,comparison:'LOCAL_KEYED_CANONICAL_PAYLOADS' as const,editions:{primaryCount,receivedCount:received.size,matched,changed,receivedOnly,primaryOnly,details,detailsTruncated:changed+receivedOnly+primaryOnly>details.length,inventoryMac:mac(encode(inventory)),payloadsApproved:false as const},mediaRequirements:{checked:mediaChecks,blocked:mediaBlocked,liveBindingsRequired,details:mediaDetails,detailsTruncated:mediaChecks>mediaDetails.length,localBytesValidated:false as const,localDecodeValidated:false as const,bindingsSelected:false as const},checkpoint:{receivedPresent:!!saved,primaryPresent:primaryRaw!=null,comparable:true as const,equal:receivedMac===primaryMac,receivedMac,primaryMac,referencedEditionPresent,referencedItemPresent,cursorSelected:false as const,foreignOwnershipAccepted:false as const},contentApproved:false as const,publicationAuthorized:false as const,authorityTransferred:false as const}
}
