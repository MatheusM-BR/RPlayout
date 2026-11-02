export interface IgnoredOverride {ignored:boolean;reviewedRevision:number;contentHash:string}
/** Feedback for our own successful decision is temporary, not an indefinite
 * approval overlay. A newer catalog/QC/removal always wins, even if the hash
 * happens to be unchanged. This never invents a fresh QC proof. */
export function catalogIgnored(asset:{ignored?:boolean;qcRevision?:number;contentHash:string},own:IgnoredOverride|undefined){
  return own&&Number.isSafeInteger(own.reviewedRevision)&&own.reviewedRevision>0&&asset.qcRevision===own.reviewedRevision&&asset.contentHash===own.contentHash?own.ignored:Boolean(asset.ignored)
}
