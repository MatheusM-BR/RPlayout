import {scheduleRuleETag,type ScheduleRuleReview} from '@rplayout/protocol'
/** Never fetch a newer baseline to authorize fields from an older form. */
export function scheduleRuleHeaders(review:ScheduleRuleReview|null,channelId:string){
  if(!review||review.channelId!==channelId)throw new Error('Reabra a conferência das faixas deste canal antes de alterar.')
  return {'If-Match':scheduleRuleETag(channelId,review.revision)}
}
/** A proposed day must not pretend to use an unsaved or unconfirmed band. */
export function scheduleRulesReady(review:ScheduleRuleReview|null,proof:ScheduleRuleReview|null,state:{blocked:boolean;busy:boolean;dirty:boolean;intent:boolean}){
  return Boolean(review&&proof&&review.channelId===proof.channelId&&review.revision===proof.revision&&!state.blocked&&!state.busy&&!state.dirty&&!state.intent)
}
