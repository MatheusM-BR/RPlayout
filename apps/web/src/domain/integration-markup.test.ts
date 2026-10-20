import {it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntegrationEditor} from '../components/IntegrationEditor.js'
import {IntegrationsPanel} from '../components/IntegrationsPanel.js'
import {IntegrationDeliveryStatus} from '../components/IntegrationDeliveryStatus.js'
it.each(['UNKNOWN','UNCERTAIN','REMOTE','LOCAL_DEAD'] as const)('lista mostra diagnóstico %s sem exigir abrir conferência',ownership=>{
 const markup=renderToStaticMarkup(createElement(IntegrationDeliveryStatus,{delivery:{state:'SENDING',diagnostic:{ownership,message:'Diagnóstico sem coordenadas'}}}))
 expect(markup).toContain('role="status"');expect(markup).toContain('Diagnóstico sem coordenadas');expect(markup).not.toContain('CONFIRMADA')
 if(ownership==='UNKNOWN'||ownership==='UNCERTAIN')expect(markup).toContain('REENVIO BLOQUEADO')
 if(ownership==='REMOTE')expect(markup).toContain('EM OUTRO NÓ')
 if(ownership==='LOCAL_DEAD')expect(markup).toContain('RETOMADA PENDENTE')
})
it('editor não habilita gravação ou teste antes de conferir destino e escopo',()=>{
  const markup=renderToStaticMarkup(createElement(IntegrationEditor,{id:'gw',onClose:()=>{},onSaved:()=>{}}))
  expect(markup).toContain('ainda não conferido');expect(markup).toContain('URL privada não é devolvida')
  expect(markup).toMatch(/disabled=""[^>]*>Salvar integração conferida/);expect(markup).toMatch(/disabled=""[^>]*>Agendar teste conferido/)
})
it('fila ainda não consultada não é apresentada como vazia ou resposta de gateway',()=>{
  const markup=renderToStaticMarkup(createElement(IntegrationsPanel,{channelId:'ch',onMessage:()=>{}}))
  expect(markup).toContain('Fila ainda não consultada');expect(markup).not.toContain('Nenhuma entrega registrada');expect(markup).toContain('CONFERIR CADASTRO')
})
