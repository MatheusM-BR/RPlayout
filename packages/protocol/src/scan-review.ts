import type {RootCatalogReview} from './root-review.js'
import type {ScanBatchDiagnostic} from './scan-diagnostic.js'
export interface ScanReview extends RootCatalogReview {
  batchRevision:number
  operationId:string
  available:boolean
  canStart:boolean
  activeBatches:ScanBatchDiagnostic[]
}
export interface ScanCommandResult {accepted:true;batchId:string;state:string;deduplicated:boolean;roots:string[];measure:boolean;startError?:string}
export const scanETag=(review:Pick<ScanReview,'revision'|'batchRevision'>)=>`"scan:${review.revision}:${review.batchRevision}"`
