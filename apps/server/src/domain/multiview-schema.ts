import {z} from 'zod'
const frames=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const multiviewTelemetrySchema=z.object({timestamp:z.string().optional(),rttMs:z.number().finite().min(0),packetLossPercent:z.number().finite().min(0).max(100),bitrateKbps:z.number().finite().min(0),packetsDropped:frames,packetsRetransmitted:frames,linkBandwidthKbps:z.number().finite().min(0).optional(),bufferMs:z.number().finite().min(0).optional(),linkState:z.enum(['OPTIMAL','DEGRADED','CRITICAL','DISCONNECTED']),reconnectCount:frames}).strict()
export const multiviewCellSchema=z.object({id:z.string().min(1),name:z.string(),sourceUrl:z.string(),tally:z.enum(['ON_AIR','NEXT','CUED','OFFLINE']),audioPeakDb:z.tuple([z.number().finite(),z.number().finite()]),syncState:z.enum(['LOCKED','DRIFT','LOST']),srtTelemetry:multiviewTelemetrySchema.optional()}).strict()
export const multiviewCellsSchema=z.array(multiviewCellSchema).refine(cells=>new Set(cells.map(cell=>cell.id)).size===cells.length)
export const multiviewLayoutSchema=z.enum(['GRID_2X2','GRID_1_PLUS_3','COMPACT_LIST'])
export const multiviewEditSchema=z.object({channelId:z.string().min(1).optional(),layout:multiviewLayoutSchema,cells:z.array(multiviewCellSchema).max(64).refine(cells=>new Set(cells.map(cell=>cell.id)).size===cells.length).optional()}).strict()
