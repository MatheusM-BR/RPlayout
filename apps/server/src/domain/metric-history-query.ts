import {z} from 'zod'

const querySchema=z.object({
  hours:z.coerce.number().min(0.1).max(336).default(1),
  limit:z.coerce.number().int().min(1).max(5000).default(2000),
  until:z.string().datetime().optional(),before:z.string().datetime().optional(),
  channelId:z.string().min(1).optional(),
})

/** Exclusive timestamp cursor, not mutable OFFSET. Retention may expire old
 * rows; navigation must never silently move the historical window. */
export function parseMetricHistoryQuery(input:unknown,now=Date.now()){
  const query=querySchema.safeParse(input)
  if(!query.success||!Number.isFinite(now))return null
  const until=new Date(query.data.until??now).toISOString()
  const since=new Date(Date.parse(until)-query.data.hours*3600_000).toISOString()
  const before=query.data.before?new Date(query.data.before).toISOString():undefined
  if(Date.parse(until)>now||before&&(before<=since||before>until)||before&&!query.data.until)return null
  return {...query.data,since,until,before}
}
