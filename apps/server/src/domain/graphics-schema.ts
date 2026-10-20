import {z} from 'zod'
const field=z.object({key:z.string().regex(/^[a-zA-Z0-9_-]+$/),label:z.string().min(1),defaultValue:z.string()}).strict()
export const graphicFields=z.array(field).refine(values=>new Set(values.map(value=>value.key)).size===values.length)
export const graphicTemplateFields=z.object({name:z.string().min(1).refine(value=>value.trim().length>0),svg:z.string().min(1),fields:graphicFields,fadeMs:z.number().int().min(0).max(5000),holdSeconds:z.number().int().min(1).max(3600).nullable()})
export const validGraphicTemplate=graphicTemplateFields.passthrough()
export const createGraphicTemplate=graphicTemplateFields.extend({name:z.string().trim().min(1).max(200),svg:z.string().min(1).max(1_000_000),channelId:z.string().min(1).nullable().optional(),fields:graphicFields.optional(),fadeMs:graphicTemplateFields.shape.fadeMs.default(300),holdSeconds:graphicTemplateFields.shape.holdSeconds.default(null)}).strict()
export const updateGraphicTemplate=createGraphicTemplate.omit({channelId:true}).partial().strict().refine(value=>Object.keys(value).length>0)
