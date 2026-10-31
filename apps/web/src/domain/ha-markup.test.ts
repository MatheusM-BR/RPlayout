import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {HaReplicationPanel,HaMediaProgress,HaAuthority} from '../components/broadcast/HaReplicationPanel.js'
import {RedundancyFailoverPanel} from '../components/broadcast/RedundancyFailoverPanel.js'
describe('interface distingue espelho, fontes e autoridade de PGM',()=>{
  it('consulta de espelho não fabrica takeover pronto nem executa ação no render',()=>{
    const html=renderToStaticMarkup(createElement(HaReplicationPanel))
    expect(html).toContain('Espelho de operação entre nós');expect(html).toContain('Não há promoção automática')
    expect(html).not.toContain('button');expect(html).not.toContain('glitch-free')
  })
  it('par de fontes ausente não vira gráfico de dois hosts nem heartbeat inventado',()=>{
    const html=renderToStaticMarkup(createElement(RedundancyFailoverPanel))
    expect(html).toContain('não representa redundância de máquinas');expect(html).toContain('Nenhum par cadastrado')
    expect(html).not.toContain('100ms');expect(html).not.toContain('AUTO ARMED');expect(html).not.toContain('svg')
  })
  it('contagem de SHA não anuncia reserva pronta nem cria promoção',()=>{
    const html=renderToStaticMarkup(createElement(HaMediaProgress,{media:{enabled:true,required:2,verified:2,ready:false,mbit:8,error:null,bytesReserved:1024**3,quotaBytes:2*1024**3,note:'Promoção exige revalidar SHA/QC. Não autoriza PGM.'}}))
    expect(html).toContain('2 de 2');expect(html).toContain('8 Mbit/s');expect(html).toContain('1.00 / 2.00 GiB')
    expect(html).toContain('Não autoriza PGM');expect(html).not.toContain('button');expect(html).not.toContain('pronto para assumir')
  })
  it('testemunha não configura takeover nem certifica um destino físico',()=>{
    const html=renderToStaticMarkup(createElement(HaAuthority,{authority:{configured:true,nativeFencingRequired:true,physicalOutputValidated:false,leases:[{channelId:'ch',term:2,confirmedAt:'now',error:null}]}}))
    expect(html).toContain('Perda da concessão encerra');expect(html).toContain('último termo confirmado');expect(html).toContain('não comprova saída física');expect(html).not.toContain('button')
    expect(renderToStaticMarkup(createElement(HaAuthority,{}))).toContain('Testemunha não configurada')
  })
})
