import {expect,it} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {createElement} from 'react'
import type {IncidentContext} from '@rplayout/protocol'
import {IncidentContextDetails} from '../components/IncidentContextDetails.js'
it('contexto ausente não é apresentado como fonte sem sinal ou canal saudável',()=>{
  expect(renderToStaticMarkup(createElement(IncidentContextDetails,{context:null}))).toContain('Contexto não registrado')
})
it('mostra contexto histórico sem transformar seleção cadastral/prontidão em prova física',()=>{
  const context:IncidentContext={version:1,capturedAt:'2026-10-10T00:00:00.000Z',channelId:'a',rundownId:'rd',revisionId:'edition-one',executionId:'execution-one',itemId:'item-one',itemName:'Jornal São José',elapsedFrames:50,engine:{ready:true,processPresent:false},sources:[{identity:'protected-source',name:'Estúdio Çãó',state:'ON_PGM',pgm:'SIGNAL_OK',pvw:null,pgmSelection:{identity:'protected-profile',name:'Estúdio Çãó',basis:'PUBLISHED_ITEM'}}],outputs:[],sourcesTruncated:true,outputsTruncated:false,physicalSignalValidated:false}
  const markup=renderToStaticMarkup(createElement(IncidentContextDetails,{context}))
  for(const text of ['Jornal São José','edition-one','execution-one','vínculo editorial, não sinal confirmado','Contexto histórico; não confirma sinal atual','não homologa saída física','Listas limitadas'])expect(markup).toContain(text)
})
