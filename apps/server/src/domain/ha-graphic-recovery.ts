import {z} from 'zod'
import {graphicDisplaySchema,graphicLayers,type GraphicDisplaySnapshot} from './graphic-composition.js'
import {hasExternalGraphicResource} from './ha-local-payload.js'

export const haGraphicRecoverySchema=z.object({version:z.literal(1),status:z.enum(['CONFIRMED','CLEAR','BLOCKED']),
  sourceReceiptId:z.string().min(1).nullable(),display:graphicDisplaySchema.nullable(),reason:z.string().max(1000).nullable(),
}).strict().superRefine((value,context)=>{
  if(value.status==='CONFIRMED'&&(!value.sourceReceiptId||!value.display||value.reason!==null))context.addIssue({code:'custom',message:'Composição HA sem vínculo/recibo confirmado.'})
  if(value.status==='CLEAR'&&(value.sourceReceiptId!==null||!value.display||value.reason!==null||value.display.emergencySvg!==null||graphicLayers.some(key=>value.display!.layers[key].active)))context.addIssue({code:'custom',message:'Composição vazia HA inconsistente.'})
  if(value.status==='BLOCKED'&&(!value.reason||value.display!==null))context.addIssue({code:'custom',message:'Bloqueio gráfico HA sem motivo.'})
})
export type HaGraphicRecovery=z.infer<typeof haGraphicRecoverySchema>
/** Frozen foreign display is input, never a local receipt/automation command.
 * Missing legacy evidence stays UNVERIFIED; preparation may inventory it but
 * no native activation may interpret absence as a confirmed empty composition. */
export function prepareHaGraphicRecovery(value:unknown,expectedReceiptId:string|null){
  if(value===undefined)return {status:'UNVERIFIED' as const,sourceReceiptId:expectedReceiptId,display:null,reason:'Espelho anterior sem composição confirmada; capture nova edição HA.'}
  const saved=haGraphicRecoverySchema.parse(value)
  if(saved.sourceReceiptId!==expectedReceiptId)throw new Error('Composição do espelho não corresponde ao checkpoint gráfico original.')
  if(saved.status==='BLOCKED')return structuredClone(saved)
  const display=structuredClone(saved.display!)
  for(const key of graphicLayers)if(display.layers[key].svg&&hasExternalGraphicResource(display.layers[key].svg!))throw new Error('Composição HA contém recurso externo sem vínculo local.')
  if(display.emergencySvg&&hasExternalGraphicResource(display.emergencySvg))throw new Error('Overlay de emergência HA contém recurso externo sem vínculo local.')
  // Foreign event ownership cannot authorize dismiss/replay on this machine.
  // Original receipt remains provenance outside the executable display.
  display.owners={}
  return {...saved,display} as HaGraphicRecovery & {display:GraphicDisplaySnapshot}
}
