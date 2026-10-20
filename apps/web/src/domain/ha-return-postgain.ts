import type {HaReturnMediaApplicationReport,HaReturnPostGainReviewReport,HaReturnPostGainReviewRequest} from '../api.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/,mac=/^[A-Za-z0-9_-]{43}$/
const digest=(value:unknown)=>typeof value==='string'&&hash.test(value),seal=(value:unknown)=>typeof value==='string'&&mac.test(value),date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))
export function parseReturnPostGainIntent(raw:unknown,media:HaReturnMediaApplicationReport):HaReturnPostGainReviewRequest{
  const value=raw as HaReturnPostGainReviewRequest
  if(!value||Object.keys(value).sort().join(',')!=='channelId,mediaApplicationId,postGainReviewId'||typeof value.postGainReviewId!=='string'||!uuid.test(value.postGainReviewId)||value.mediaApplicationId!==media.request.mediaApplicationId||value.channelId!==media.request.channelId)throw new Error('Intenção pós-ganho inválida.')
  return {postGainReviewId:value.postGainReviewId,mediaApplicationId:value.mediaApplicationId,channelId:value.channelId}
}
/** Do not treat MEASURED/REVIEWED as editorial approval or transmission grant. */
export function readReturnPostGainReport(raw:unknown,expected:HaReturnPostGainReviewRequest,media:HaReturnMediaApplicationReport){
  const value=raw as HaReturnPostGainReviewReport
  if(!value||Object.keys(value).sort().join(',')!=='actor,capture,confirmationIsHistorical,operationalReady,ownedHere,phase,publicationAuthorized,quotaBytes,request,result,updatedAt,version'||JSON.stringify(parseReturnPostGainIntent(value.request,media))!==JSON.stringify(expected)||value.version!==1||!['ACCEPTED','MEASURING','REVIEWED','FAILED'].includes(value.phase)||typeof value.ownedHere!=='boolean'||value.confirmationIsHistorical!==true||value.operationalReady!==false||value.publicationAuthorized!==false||value.quotaBytes!==64*1024*1024||!date(value.updatedAt)||typeof value.actor!=='string'||!value.actor||value.actor.length>256)throw new Error('Resposta pós-ganho inválida.')
  const captured=value.capture,profile=captured?.profile
  if(!media.result||!captured||Object.keys(captured).sort().join(',')!=='autoDecisionId,evidenceMac,mediaDatabaseHash,mediaReviewId,profile,profileFingerprint'||captured.mediaReviewId!==media.request.mediaReviewId||captured.mediaDatabaseHash!==media.result.databaseHash||captured.evidenceMac!==media.result.evidenceMac||captured.autoDecisionId!==(media.request.autoDecisionId??null)||!digest(captured.profileFingerprint)||!profile||Object.keys(profile).sort().join(',')!=='audioChannels,ceilingDbtp,channelId,rate,targetLufs'||profile.channelId!==expected.channelId||!Number.isFinite(profile.targetLufs)||profile.targetLufs< -70||profile.targetLufs>0||!Number.isFinite(profile.ceilingDbtp)||profile.ceilingDbtp< -30||profile.ceilingDbtp>0||![2,8,16].includes(profile.audioChannels)||!profile.rate||Object.keys(profile.rate).sort().join(',')!=='den,num'||![profile.rate.num,profile.rate.den].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('Captura pós-ganho diverge da cópia.')
  const result=value.result
  if(value.phase==='REVIEWED'? !result:result!==null)throw new Error('Estado pós-ganho diverge da confirmação.')
  if(result){
    if(Object.keys(result).sort().join(',')!=='checkedAt,evidenceMac,runtimeHash,summary'||!digest(result.runtimeHash)||!seal(result.evidenceMac)||!date(result.checkedAt))throw new Error('Recibo pós-ganho inválido.')
    const summary=result.summary
    if(!summary||Object.keys(summary).sort().join(',')!=='busQualified,editorialApproved,failed,measured,planBlocked,postGainQualified,publicationAuthorized,required,transitionQualified'||![summary.required,summary.measured,summary.failed,summary.planBlocked].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000)||summary.required!==summary.measured+summary.failed||summary.postGainQualified!==false||summary.busQualified!==false||summary.transitionQualified!==false||summary.editorialApproved!==false||summary.publicationAuthorized!==false)throw new Error('Resumo não corresponde à medição isolada.')
  }
  return value
}
