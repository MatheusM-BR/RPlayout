import {z} from 'zod'

/** Bounded native diagnostics only: no IP, PID, path, nonce or process token. */
export const nativeSocketDiagnosticSchema=z.object({
 table:z.enum(['TCP4','TCP6','UDP4','UDP6']),
 phase:z.enum(['SIZE','READ','DECODE','OWNER']),
 reason:z.enum(['OS_ERROR','TABLE_BOUND','INCOMPLETE_TABLE','TABLE_CHANGED','LAYOUT_INVALID','UNKNOWN_OWNER']),
 win32Code:z.number().int().min(1).max(0xffffffff).optional(),
}).strict().superRefine((value,context)=>{
 if((value.reason==='OS_ERROR')!==(value.win32Code!==undefined))context.addIssue({code:z.ZodIssueCode.custom,message:'Only OS_ERROR requires a Windows code'})
 const phases:Record<typeof value.reason,readonly string[]>={OS_ERROR:['SIZE','READ'],TABLE_BOUND:['READ'],INCOMPLETE_TABLE:['READ','DECODE'],TABLE_CHANGED:['READ'],LAYOUT_INVALID:['DECODE'],UNKNOWN_OWNER:['OWNER']}
 if(!phases[value.reason].includes(value.phase))context.addIssue({code:z.ZodIssueCode.custom,message:'Inconsistent native query phase'})
})
export type NativeSocketDiagnostic=z.infer<typeof nativeSocketDiagnosticSchema>
export const hostNativeFailureReasonSchema=z.enum(['PARENT_MEMBERSHIP_UNKNOWN','PROCESS_FAMILY_UNKNOWN','PROCESS_FAMILY_INCONSISTENT','PORT_OWNERSHIP_UNAVAILABLE','PROCESS_IDENTITY_UNAVAILABLE','REQUEST_TIMEOUT'])
export type HostNativeQueryFailure={reason:z.infer<typeof hostNativeFailureReasonSchema>;operation:'assert'|'ports'|'pin'|'process_ports'|'release_process';observedAt:string;socketDiagnostic?:NativeSocketDiagnostic}
export interface OwnershipDiagnostic {code:string;message:string;repairRequired:boolean}
export interface OwnershipStatusView {state:string;ownedHere:boolean;ownerLocal:boolean|null;blocked:boolean;message:string|null;diagnostic:OwnershipDiagnostic;nativeQueryFailure?:HostNativeQueryFailure|null;physicalOutputValidated:false;promotionReady:false}
