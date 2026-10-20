import {expect,it} from 'vitest'
import {parseMetricHistoryQuery} from './metric-history-query.js'

const until='2026-10-18T12:00:00.000Z',now=Date.parse(until)
it('fixa limite superior e janela com os mesmos defaults nos dois históricos',()=>{
  expect(parseMetricHistoryQuery({},now)).toEqual({hours:1,limit:2000,since:'2026-10-18T11:00:00.000Z',until,before:undefined})
  expect(parseMetricHistoryQuery({hours:'336',limit:'120',channelId:'ação'},now)?.since).toBe('2026-10-04T12:00:00.000Z')
})
it('normaliza cursor exclusivo mas exige o limite original da janela',()=>{
  expect(parseMetricHistoryQuery({until,before:'2026-10-18T11:30:00Z'},now)?.before).toBe('2026-10-18T11:30:00.000Z')
  expect(parseMetricHistoryQuery({before:until},now)).toBeNull()
  for(const before of ['2026-10-18T11:00:00Z','2026-10-18T10:59:59Z','2026-10-18T12:00:01Z'])expect(parseMetricHistoryQuery({until,before},now)).toBeNull()
})
it('recusa limites, datas e relógio inválidos antes de ler o banco',()=>{
  for(const query of [{hours:0},{hours:337},{limit:0},{limit:5001},{limit:1.5},{until:'invalid'},{before:'invalid'}, {until:'2026-10-18T12:00:01Z'},{channelId:''}])expect(parseMetricHistoryQuery(query,now)).toBeNull()
  expect(parseMetricHistoryQuery({},NaN)).toBeNull();expect(parseMetricHistoryQuery({},Infinity)).toBeNull()
})
