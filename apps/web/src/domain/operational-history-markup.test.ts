import {afterEach,expect,it,vi} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {OperationalHistoryPanel,OperationalHistoryTable} from '../components/broadcast/OperationalHistoryPanel.js'
import {api,type OperationalMetricHistory} from '../api.js'
afterEach(()=>vi.restoreAllMocks())
function fixture():OperationalMetricHistory{
  return {channelId:'ch',since:'2026-10-09T00:00:00Z',retainedDays:14,totalSamples:1,truncated:false,samples:[{sampledAt:'2026-10-09T12:00:00Z',operations:{version:1,capturedAt:'2026-10-09T12:00:00Z',available:true,channelsTruncated:false,channels:[{channelId:'ch',rundownId:'rd',revisionId:'edition',executionId:'execution',itemId:'live',elapsedFrames:50,mode:'NATIVE',engine:{pid:123,ready:true,restarts:1,deaths:0,stalls:0,hasError:false,cpuTimeMs:null,memoryBytes:null},sources:[{sourceId:'opaque-source',itemId:'live',state:'ON_PGM',busItemIds:{pgm:'live'},busSignals:{pgm:{status:'NO_AUDIO',videoRecent:true,audioRecent:false,sampleAgeMs:0}}}],outputs:[{outputId:'opaque-output',state:'retrying',attempts:2,delivered:0,hasError:true}],sourcesTruncated:false,outputsTruncated:false}]}}]}
}
it('SSR começa sem dados inventados e oferece canal e janela',()=>{
  const html=renderToStaticMarkup(createElement(OperationalHistoryPanel,{channels:[{id:'ch',name:'Canal autorizado'}],initialChannelId:'ch'}))
  expect(html).toContain('Carregando histórico do canal');expect(html).toContain('Canal autorizado');expect(html).toContain('14 dias');expect(html).not.toContain('Engine pronto')
  expect(html).toContain('Registros anteriores');expect(html).toContain('Mais recentes');expect(html).toContain('Página anterior')
  expect(html).toContain('Consultando…')
})
it('distingue CPU acumulada/N-D de zero e não converte áudio ausente em sucesso',()=>{
  const html=renderToStaticMarkup(createElement(OperationalHistoryTable,{history:fixture()}))
  expect(html).toContain('CPU acumulada: N/D');expect(html).toContain('RAM: N/D');expect(html).toContain('NO_AUDIO');expect(html).toContain('retrying');expect(html).toContain('Edição: edition');expect(html).not.toContain('CPU acumulada: 0 s')
})
it('exibe nomes congelados da coleta e distingue histórico sem rótulos',()=>{
  const history=fixture(),channel=history.samples[0]!.operations!.channels[0]!
  expect(renderToStaticMarkup(createElement(OperationalHistoryTable,{history}))).toContain('Nome histórico não registrado')
  channel.itemName='Jornal';channel.sources[0]!.sourceName='Câmera São José';channel.outputs[0]!.outputName='<Saída principal>'
  const html=renderToStaticMarkup(createElement(OperationalHistoryTable,{history}))
  expect(html).toContain('Jornal');expect(html).toContain('Câmera São José');expect(html).toContain('&lt;Saída principal&gt;');expect(html).not.toContain('<Saída principal>')
})
it('mostra ambiguidade de cadastro sem afirmar identidade de perfil pelo endereço',()=>{
  const history=fixture(),channel=history.samples[0]!.operations!.channels[0]!
  channel.sources[0]!.nameAmbiguous=true;channel.outputs[0]!.nameAmbiguous=true;channel.outputs[0]!.identityType='ENDPOINT'
  const html=renderToStaticMarkup(createElement(OperationalHistoryTable,{history}))
  expect(html).toContain('Cadastros compartilham o endereço; nome não atribuído');expect(html).toContain('perfil não confirmado')
})
it('histórico antigo/indisponível e consulta truncada permanecem explícitos',()=>{
  const history=fixture();history.samples[0]!.operations=null;history.truncated=true
  let html=renderToStaticMarkup(createElement(OperationalHistoryTable,{history}));expect(html).toContain('Sem correlação nesta versão');expect(html).toContain('não cobre toda a janela');expect(html).not.toContain('Engine pronto')
  history.samples[0]!.operations={version:1,capturedAt:'2026-10-09T12:00:00Z',available:false,channelsTruncated:false,channels:[]}
  html=renderToStaticMarkup(createElement(OperationalHistoryTable,{history}));expect(html).toContain('Coleta operacional indisponível')
})
it('nenhum canal autorizado não abre consulta nem presume ausência de sinal',()=>{
  const html=renderToStaticMarkup(createElement(OperationalHistoryPanel,{channels:[]}));expect(html).toContain('Selecione um canal autorizado');expect(html).not.toContain('Carregando histórico do canal')
})
it('API envia seleção codificada e limites, sem criar engine ou enviar comandos',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(fixture()),{status:200}))
  await api.operationalMetricHistory('ação/a',6,120)
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/channels/a%C3%A7%C3%A3o%2Fa/operational-metrics/history?hours=6&limit=120')
  expect(fetcher.mock.calls[0]?.[1]?.method??'GET').toBe('GET')
})
it('API transmite limite temporal e cursor codificados para navegar sem offset mutável',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(fixture()),{status:200}))
  await api.operationalMetricHistory('ch',336,120,{until:'2026-10-09T12:00:00.000Z',before:'2026-10-09T11:00:00.000Z'})
  const url=new URL(String(fetcher.mock.calls[0]?.[0]),'http://localhost')
  expect(url.searchParams.get('until')).toBe('2026-10-09T12:00:00.000Z');expect(url.searchParams.get('before')).toBe('2026-10-09T11:00:00.000Z');expect(url.searchParams.get('hours')).toBe('336')
})
it('API propaga cancelamento sem perder cursor da página histórica',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(fixture()),{status:200})),controller=new AbortController()
  await api.operationalMetricHistory('ch',24,120,{until:'2026-10-09T12:00:00.000Z',before:'2026-10-09T11:00:00.000Z'},controller.signal)
  expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('before=2026-10-09T11%3A00%3A00.000Z')
})
