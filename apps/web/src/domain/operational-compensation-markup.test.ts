import {it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {OperationalCompensationPanel} from '../components/broadcast/OperationalCompensationPanel.js'
it('apresenta quatro ações revisadas, sem prometer preenchimento ou TAKE automático',()=>{
  const html=renderToStaticMarkup(createElement(OperationalCompensationPanel,{channelId:'ch',items:[],rate:{num:25,den:1}}))
  for(const text of ['Estender/reduzir filler','Reduzir VT','Remover opcional','Aceitar atraso','Conferir ajuste','Confirmar compensação','não publica o rascunho nem executa TAKE'])expect(html).toContain(text)
  expect(html).not.toContain('100%')
})
