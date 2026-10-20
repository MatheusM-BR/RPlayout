import {AsyncLocalStorage} from 'node:async_hooks'
import {z} from 'zod'

export const graphicLayers=['STATION_LOGO','ONAIR_CLOCK','CRAWL_TICKER','LOWER_THIRD'] as const
const layer=z.enum(graphicLayers)
const state=z.object({layer,active:z.boolean(),templateId:z.string().optional(),name:z.string().optional(),payload:z.record(z.unknown()).optional(),svg:z.string().max(16*1024*1024).optional(),opacity:z.number().finite().min(0).max(1).optional(),updatedAt:z.string().optional(),expiresAtFrames:z.number().finite().nullable().optional()})
export const graphicDisplaySchema=z.object({
  version:z.literal(1),
  layers:z.object({STATION_LOGO:state,ONAIR_CLOCK:state,CRAWL_TICKER:state,LOWER_THIRD:state}),
  current:z.object({templateId:z.string(),name:z.string(),values:z.record(z.string()),endsAt:z.number().finite().nullable()}).nullable(),
  currentLayer:layer.nullable(),
  deadlines:z.record(layer,z.number().finite().nonnegative()),
  versions:z.record(layer,z.number().int().nonnegative()),
  owners:z.record(layer,z.object({eventId:z.string(),version:z.number().int().nonnegative()})),
  emergencySvg:z.string().max(16*1024*1024).nullable(),
}).superRefine((value,context)=>{
  for(const key of graphicLayers){
    if(value.layers[key].layer!==key)context.addIssue({code:'custom',message:'Identidade da camada incompatível.'})
    const owner=value.owners[key]
    if(owner&&(!value.layers[key].active||owner.version!==value.versions[key]))context.addIssue({code:'custom',message:'Dono da camada incompatível com composição.'})
  }
})
export type GraphicDisplaySnapshot=z.infer<typeof graphicDisplaySchema>
/** Captured inside the command's async scope, not a global last-command slot.
 * A second queued command cannot replace the first receipt's composition. */
export const graphicCapture=new AsyncLocalStorage<{display?:GraphicDisplaySnapshot}>()
export function captureGraphicDisplay(value:GraphicDisplaySnapshot):void {
  const command=graphicCapture.getStore()
  if(command)command.display=graphicDisplaySchema.parse(structuredClone(value))
}
