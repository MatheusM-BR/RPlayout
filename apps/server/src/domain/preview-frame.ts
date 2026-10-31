export interface PreviewFrameObservation {itemId:string;decoderId:number;delivered:boolean;ageMs:number|null;pausedFile:boolean}
export function readPreviewFrame(value:unknown,expected:{itemId:string;decoderId?:number}|null):PreviewFrameObservation|null{
 if(!value||typeof value!=='object'||!expected)return null
 const row=value as PreviewFrameObservation
 if(row.itemId!==expected.itemId||row.decoderId!==expected.decoderId||!Number.isSafeInteger(row.decoderId)||row.decoderId<=0||typeof row.delivered!=='boolean'||typeof row.pausedFile!=='boolean'||!(row.ageMs===null||Number.isSafeInteger(row.ageMs)&&row.ageMs>=0)||row.delivered&&row.ageMs===null)return null
 return {itemId:row.itemId,decoderId:row.decoderId,delivered:row.delivered,ageMs:row.ageMs,pausedFile:row.pausedFile}
}
