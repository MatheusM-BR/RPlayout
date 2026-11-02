export type ScanOwnerState='WAITING'|'LOCAL_ALIVE'|'LOCAL_DEAD'|'REMOTE'|'UNKNOWN'|'UNCERTAIN'|'INVALID'
export interface ScanBatchDiagnostic {id:string;state:string;ownership:ScanOwnerState;message:string;canRecover:boolean}
