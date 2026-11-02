import {afterEach,expect,it,vi} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {HostMetricHistoryPanel,HostMetricHistoryTable} from '../components/broadcast/HostMetricHistoryPanel.js'
import {api,type HostMetricHistory,type HostMetricSample} from '../api.js'

afterEach(()=>vi.restoreAllMocks())
function fixture():HostMetricHistory{
  return {since:'2026-10-18T11:00:00.000Z',until:'2026-10-18T12:00:00.000Z',retainedDays:14,totalSamples:500,truncated:true,nextBefore:'2026-10-18T11:59:00.000Z',samples:[{generatedAt:'2026-10-18T12:00:00.000Z',cpu:{percent:null},memory:{percent:0},gpu:{utilizationPercent:null},disk:{percentUsed:80},network:{receivedBytesPerSecond:0,sentBytesPerSecond:null}} as HostMetricSample]}
}
it('começa sem valores inventados e oferece navegação global independente do canal',()=>{
  const html=renderToStaticMarkup(createElement(HostMetricHistoryPanel))
  for(const text of ['Histórico global do servidor','Registros anteriores do servidor','Página anterior do servidor','Mais recentes do servidor','Carregando histórico do servidor','Últimos 14 dias','não dispara coleta'])expect(html).toContain(text)
  expect(html).not.toContain('0.0%')
})
it('mostra página parcial e distingue ausência de medição de zero',()=>{
  const html=renderToStaticMarkup(createElement(HostMetricHistoryTable,{history:fixture()}))
  expect(html).toContain('500 amostras');expect(html).toContain('1 nesta página');expect(html).toContain('não cobre toda a janela')
  expect(html).toContain('N/D');expect(html).toContain('0.0%');expect(html).toContain('0.00 Mbps');expect(html).toContain('80.0%')
})
it('página expirada não é apresentada como máquina sem sinal ou consumo zero',()=>{
  const history=fixture();history.samples=[]
  const html=renderToStaticMarkup(createElement(HostMetricHistoryTable,{history}))
  expect(html).toContain('retenção pode expirar');expect(html).toContain('não são estimados');expect(html).not.toContain('0.0%');expect(html).not.toContain('sem sinal')
})
it('API limita primeira página a120 amostras e encaminha cancelamento',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(fixture()),{status:200})),controller=new AbortController()
  await api.hostMetricHistory(6,120,undefined,controller.signal)
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/host-metrics/history?hours=6&limit=120')
  expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);expect(fetcher.mock.calls[0]?.[1]?.method??'GET').toBe('GET')
})
it('API conserva limite temporal e cursor nas páginas antigas sem enviar comandos',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(fixture()),{status:200}))
  const page={until:'2026-10-18T12:00:00.000Z',before:'2026-10-18T11:59:00.000Z'}
  await api.hostMetricHistory(336,120,page)
  const url=new URL(String(fetcher.mock.calls[0]?.[0]),'http://localhost')
  expect(url.searchParams.get('until')).toBe(page.until);expect(url.searchParams.get('before')).toBe(page.before);expect(url.searchParams.get('hours')).toBe('336');expect(fetcher.mock.calls[0]?.[1]?.method??'GET').toBe('GET')
})
