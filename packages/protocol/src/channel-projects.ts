export const PROJECT_SECTIONS=['rundowns','items','outputs','presets','sources','rules','multiview','destinations','guests','graphics','cues','secondaryEvents'] as const
export type ProjectCounts=Record<typeof PROJECT_SECTIONS[number],number>
export interface ProjectRestoreReview {
  channelId:string;projectId:string;projectRevision:number;configurationRevision:number;token:string
  label:string;createdAt:string
  replacing:ProjectCounts;restoring:ProjectCounts
  removedRundowns:number;preservedPublications:number
  enabledOutputs:number;enabledDestinations:number;enabledGuests:number
  formatBefore:{width:number;height:number;rateNum:number;rateDen:number;audioChannels:number}
  formatAfter:{width:number;height:number;rateNum:number;rateDen:number;audioChannels:number}
  requiresStoppedProgram:true;automaticTake:false;physicalOutputValidated:false
}
export const projectRestoreETag=(review:Pick<ProjectRestoreReview,'channelId'|'projectId'|'projectRevision'>)=>
  `"project:${encodeURIComponent(review.channelId)}:${encodeURIComponent(review.projectId)}:${review.projectRevision}"`
