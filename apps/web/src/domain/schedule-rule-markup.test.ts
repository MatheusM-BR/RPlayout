import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {ScheduleRulesEditor} from '../components/ScheduleRulesEditor.js'
import {AutoFillDialog} from '../components/AutoFillDialog.js'
describe('markup de faixas não equivale a interação em navegador',()=>{
  it('sem conferência não afirma pauta vazia e bloqueia formulário',()=>{
    const html=renderToStaticMarkup(createElement(ScheduleRulesEditor,{channelId:'a',categories:[],disabled:false,onReview:()=>{},onReadyChange:()=>{},onBusyChange:()=>{}}))
    expect(html).toContain('Conferindo faixas do canal');expect(html).toContain('Reabrir conferência das faixas');expect(html).toContain('<fieldset disabled=""')
    expect(html).not.toContain('Sem faixas configuradas');expect(html).toContain('Não repetir por (horas)')
  })
  it('editor permanece montado em aba oculta, sem renovar prova por troca de modo',()=>{
    const html=renderToStaticMarkup(createElement(AutoFillDialog,{rundownId:'rd',channelId:'a',revision:7,categories:[],rate:{num:25,den:1},onCancel:()=>{},onApplied:()=>{},onMessage:()=>{}}))
    expect(html).toContain('hidden=""');expect(html).toContain('Conferindo faixas do canal');expect(html).toContain('Propor Preenchimento')
  })
})
