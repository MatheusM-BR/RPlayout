export interface OperationalCompensationInput {
  itemId:string
  expectedFrames:number
  action:'FILLER'|'TRIM'|'DROP_OPTIONAL'|'ACCEPT_DELAY'
  deltaFrames:number
}
export interface OperationalCompensationReview {
  anchorChange?:{before:import('./rundown.js').Anchor;after:import('./rundown.js').Anchor}|null
  input:OperationalCompensationInput
  reviewToken:string
  sourceRevisionId:string
  title:string
  beforeFrames:number
  afterFrames:number
  beforeEffectiveFrames:number
  afterEffectiveFrames:number
  conflicts:readonly {kind:string;itemId:string;frames:number;severity:string;message:string}[]
  notice:string
}
