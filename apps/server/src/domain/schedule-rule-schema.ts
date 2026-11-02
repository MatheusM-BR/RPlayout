import {z} from 'zod'
export const scheduleRuleFields=z.object({
  name:z.string().min(1).refine(value=>value.trim().length>0),
  weekdays:z.string().regex(/^[0-6]{1,7}$/).refine(value=>new Set(value).size===value.length),
  startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(1).max(1440),
  categories:z.array(z.string()),avoidHours:z.number().int().min(0).max(240),
})
export const validScheduleRule=scheduleRuleFields.passthrough().refine(row=>row.endMinute>row.startMinute)
const editable=scheduleRuleFields.extend({name:z.string().trim().min(1).max(200),categories:z.array(z.string().min(1).max(200)).max(128).refine(values=>new Set(values).size===values.length)})
export const createScheduleRule=editable.extend({avoidHours:editable.shape.avoidHours.default(6)}).strict()
export const updateScheduleRule=editable.partial().strict().refine(value=>Object.keys(value).length>0)
