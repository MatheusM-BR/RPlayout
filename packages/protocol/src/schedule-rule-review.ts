export interface ScheduleRuleRecord {
  id:string;channelId:string;name:string;weekdays:string;startMinute:number;endMinute:number;
  categories:string[];avoidHours:number;createdAt:string
}
/** Editorial bands, not a published playlist or permission to start playout. */
export interface ScheduleRuleReview {
  channelId:string;revision:number;rules:ScheduleRuleRecord[];editorialOnly:true;automaticTake:false
}
export function scheduleRuleETag(channelId:string,revision:number):string {
  if(!channelId||!Number.isSafeInteger(revision)||revision<1)throw new Error('Conferência de faixas inválida.')
  return `"rules:${encodeURIComponent(channelId)}:${revision}"`
}
