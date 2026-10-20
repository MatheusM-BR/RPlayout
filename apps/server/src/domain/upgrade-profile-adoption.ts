import type Database from 'better-sqlite3'
import type {App} from '../app.js'
import {createHash,randomUUID} from 'node:crypto'
import {lstatSync,readFileSync,existsSync} from 'node:fs'
import {dirname,isAbsolute,join,resolve} from 'node:path'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'
import {writePrivateConfig} from './private-config-file.js'
import {readRestoredActivations} from '../db/restored-activations.js'
import {readServerInstances} from '../db/server-instances.js'
const phases=['UPGRADE_PROFILE_STARTED','UPGRADE_PROFILE_CONFIRMED','UPGRADE_PROFILE_REFUSED','UPGRADE_PROFILE_UNCERTAIN'] as const
const absolute=z.string().min(1).refine(isAbsolute)
const profileSchema=z.object({version:z.literal(1),dataRoot:absolute,databaseFile:absolute.optional(),mediaRoot:absolute,vaultFile:absolute}).strict()
const norm=(value:string)=>process.platform==='win32'?resolve(value).toLowerCase():resolve(value)
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
function regularContent(file:string){const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>16384)throw new Error('Perfil deve ser arquivo regular, sem links, até 16 KB.');return readFileSync(file)}
const adoptionBinding=(value:Record<string,unknown>)=>JSON.stringify([value.id,value.activationId,value.requestId,value.previousHash,value.candidateHash,value.previousProfile])
export function pendingUpgradeProfiles(sqlite:Database.Database){
  const pending=new Map<string,Record<string,unknown>>()
  for(const row of sqlite.prepare('SELECT kind,payload FROM operator_decisions WHERE kind IN (?,?,?,?) ORDER BY rowid').iterate(...phases) as Iterable<{kind:string;payload:string}>){
    const value=JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload'))
    if(value.version!==1||typeof value.id!=='string'||value.phase!==row.kind)throw new Error('Diário de adoção de perfil inválido.')
    if(row.kind===phases[0]){if(pending.has(value.id))throw new Error('Intenção de perfil duplicada.');pending.set(value.id,value)}
    else{
      const initial=pending.get(value.id)
      if(!initial||adoptionBinding(initial)!==adoptionBinding(value))throw new Error('Resultado de perfil sem intenção correspondente.')
      if(row.kind!==phases[3])pending.delete(value.id)
    }
  }
  return pending
}
export function assertNoUncertainUpgradeProfile(sqlite:Database.Database){
  const pending=pendingUpgradeProfiles(sqlite)
  if(pending.size)throw new Error('Troca de perfil interrompida/incerta. Partida bloqueada; preserve perfis e diário para reconciliação explícita.')
}
/** Non-serializable startup closure. Capture predecessor BEFORE native
 * activation, publish only AFTER authenticated native activation confirmation. */
export function prepareUpgradeProfileAdoption(candidateFile:string,installRoot:string,databaseFile:string){
  const candidatePath=resolve(candidateFile),target=join(resolve(installRoot),'installation-profile.json')
  const candidate=regularContent(candidatePath),profile=profileSchema.parse(JSON.parse(candidate.toString('utf8')))
  const effectiveDatabase=profile.databaseFile??join(profile.dataRoot,'rplayout.db')
  if(norm(dirname(candidatePath))!==norm(profile.dataRoot)||norm(dirname(effectiveDatabase))!==norm(profile.dataRoot)||norm(effectiveDatabase)!==norm(databaseFile)||norm(profile.vaultFile)!==norm(process.env.RPLAYOUT_VAULT_FILE??'')||norm(profile.mediaRoot)!==norm(process.env.RPLAYOUT_MEDIA??''))throw new Error('Perfil candidato não corresponde aos caminhos efetivos desta ativação.')
  const previous=regularContent(target);profileSchema.parse(JSON.parse(previous.toString('utf8')))
  const baseline=hash(previous),candidateHash=hash(candidate),id=randomUUID(),archive=join(dirname(target),'installation-profile.previous-'+id+'.json')
  let consumed=false
  return async(app:App)=>{
    if(consumed)throw new Error('Adoção de perfil já utilizada; não será repetida.');consumed=true
    assertNoUncertainUpgradeProfile(app.sqlite)
    const activation=readRestoredActivations(app.sqlite).at(-1)
    const instance=activation&&readServerInstances(app.sqlite).find(row=>row.id===activation.instanceId)
    if(!activation||activation.phase!=='CONFIRMED'||!instance||instance.phase!=='OPEN'||instance.pid!==process.pid||!app.restoredAdmission||!app.hostFence)throw new Error('Perfil exige ativação nativa confirmada nesta instância.')
    const authorize=()=>{app.hostFence!.assertOwned();app.restoredAdmission!.maintenance.assertHeldOn(app.sqlite);if(readRestoredActivations(app.sqlite).at(-1)?.id!==activation.id)throw new Error('Ativação mudou.');if(hash(regularContent(candidatePath))!==candidateHash)throw new Error('Candidato mudou.');if(hash(regularContent(target))!==baseline)throw new Error('Perfil ativo mudou; não será substituído.')}
    const proof=async()=>{await app.hostFence!.freshProof();authorize()}
    const audit=(phase:typeof phases[number])=>app.sqlite.prepare('INSERT INTO operator_decisions(id,rundown_id,kind,payload,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),'@upgrade',phase,installationVault(false).encrypt(JSON.stringify({version:1,id,phase,activationId:activation.id,requestId:activation.requestId,previousHash:baseline,candidateHash,previousProfile:archive,automaticTake:false,physicalOutputValidated:false}),'operator_decisions.payload'),'@upgrade',new Date().toISOString())
    await proof();audit(phases[0])
    try{
      if(existsSync(archive))throw new Error('Arquivo anterior já existe; não será substituído.')
      await writePrivateConfig(archive,previous.toString('utf8'),authorize,proof)
      await writePrivateConfig(target,candidate.toString('utf8'),authorize,proof)
      app.hostFence.assertOwned();app.restoredAdmission.maintenance.assertHeldOn(app.sqlite)
      if(hash(regularContent(target))!==candidateHash)throw new Error('Publicação do perfil não confirmada.')
      audit(phases[1])
    }catch(error){
      try{app.hostFence.assertOwned();app.restoredAdmission.maintenance.assertHeldOn(app.sqlite);audit(hash(regularContent(target))===baseline?phases[2]:phases[3])}catch{}
      throw error
    }
  }
}
