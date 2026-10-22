import {it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {OwnershipDiagnosticsPanel,OwnershipStatusCard,currentOwnershipViews} from '../components/OwnershipDiagnosticsPanel.js'

it('cursor inconclusivo aparece como aviso de retomada, sem exigir revisão ou indicar liberação operacional',()=>{
 const html=renderToStaticMarkup(createElement(OwnershipStatusCard,{label:'Execução',status:{state:'ACTIVE',ownedHere:false,ownerLocal:true,blocked:false,message:null,diagnostic:{code:'LOCAL_STOPPED_CHECKPOINT_UNCERTAIN',message:'O checkpoint pode estar atrás do conteúdo que foi ao ar.',repairRequired:true},physicalOutputValidated:false,promotionReady:false}}))
 expect(html).toContain('AVISO DE RETOMADA');expect(html).toContain('role="alert"');expect(html).not.toContain('REVISÃO NECESSÁRIA')
 expect(html).not.toContain('SEM BLOQUEIO CONSTATADO');expect(html).not.toContain('PROTEGIDA / BLOQUEADA')
 expect(html).not.toContain('<button')
})
it('reservas não consultadas não são canal livre; só controle de consulta',()=>{
 const html=renderToStaticMarkup(createElement(OwnershipDiagnosticsPanel,{channelId:'ch'}));expect(html).toContain('Reservas ainda não consultadas');expect(html).toContain('não é confirmação de canal livre');expect(html).toContain('Consultar reservas');expect(html).not.toMatch(/>Liberar|>Retomar|>Promover/)
})
it('status protegido conserva advertência de nenhuma admissão ou sinal comprovado',()=>{
 const html=renderToStaticMarkup(createElement(OwnershipStatusCard,{label:'Execução',status:{state:'ACTIVE',ownedHere:false,ownerLocal:false,blocked:true,message:'Nó remoto',diagnostic:{code:'OWNER_REMOTE',message:'Não inferir morte remota.',repairRequired:true},physicalOutputValidated:false,promotionReady:false}}))
 expect(html).toContain('PROTEGIDA / BLOQUEADA');expect(html).toContain('Não inferir morte remota');expect(html).toContain('não comprova sinal físico');expect(html).toContain('nem autoriza promoção')
})
it('troca de canal oculta imediatamente dados antigos antes de executar o efeito',()=>{
 const source={channelId:'old',channel:{state:'ACTIVE'} as any,distribution:{state:'ACTIVE'} as any}
 expect(currentOwnershipViews(source,'new')).toEqual({channelId:'new',channel:null,distribution:null});expect(currentOwnershipViews(source,'old')).toBe(source)
})
it('posse local não oculta falha de consulta nativa nem inventa detalhes de helper anterior',()=>{
 const html=renderToStaticMarkup(createElement(OwnershipStatusCard,{label:'Distribuição',status:{state:'ACTIVE',ownedHere:true,ownerLocal:true,blocked:false,message:null,diagnostic:{code:'OWNED_HERE',message:'Reserva confirmada.',repairRequired:false},nativeQueryFailure:{reason:'PORT_OWNERSHIP_UNAVAILABLE',operation:'ports',observedAt:'2026-10-18T00:00:00Z'},physicalOutputValidated:false,promotionReady:false}}))
 expect(html).toContain('DESTA INSTÂNCIA');expect(html).toContain('role="alert"');expect(html).toContain('propriedade das portas');expect(html).toContain('não informou detalhes');expect(html).toContain('não significa prontidão');expect(html).not.toContain('Código Windows:');expect(html).not.toMatch(/>Liberar|>Retomar|>Promover/)
})
it('falha nativa com código explícito mostra diagnóstico sem sugerir elevação ou matar outro processo',()=>{
 const html=renderToStaticMarkup(createElement(OwnershipStatusCard,{label:'Distribuição',status:{state:'ACTIVE',ownedHere:true,ownerLocal:true,blocked:false,message:null,diagnostic:{code:'OWNED_HERE',message:'Reserva confirmada.',repairRequired:false},nativeQueryFailure:{reason:'PORT_OWNERSHIP_UNAVAILABLE',operation:'process_ports',observedAt:'2026-10-18T00:00:00Z',socketDiagnostic:{table:'TCP6',phase:'SIZE',reason:'OS_ERROR',win32Code:5}},physicalOutputValidated:false,promotionReady:false}}))
 expect(html).toContain('Tabela TCP6');expect(html).toContain('Código Windows: 5');expect(html).toContain('nem encerre outro processo');expect(html).not.toMatch(/[Aa]dministrador|[Dd]esativar/)
})
