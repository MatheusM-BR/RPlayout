import type {HostNativeQueryFailure} from '@rplayout/protocol'

export function nativeQueryFailureMessage(failure:HostNativeQueryFailure){
 const reasons:Record<HostNativeQueryFailure['reason'],string>={
  PARENT_MEMBERSHIP_UNKNOWN:'Não foi possível confirmar a inclusão do servidor na proteção nativa.',
  PROCESS_FAMILY_UNKNOWN:'Não foi possível consultar a família de processos protegidos.',
  PROCESS_FAMILY_INCONSISTENT:'A família de processos não corresponde à prova esperada.',
  PORT_OWNERSHIP_UNAVAILABLE:'Não foi possível consultar a propriedade das portas do computador.',
  PROCESS_IDENTITY_UNAVAILABLE:'Não foi possível confirmar a identidade do processo protegido.',
  REQUEST_TIMEOUT:'A consulta nativa não respondeu no prazo; o resultado permanece inconclusivo.',
 }
 const socket=failure.socketDiagnostic
 const details=socket?` Tabela ${socket.table}, etapa ${socket.phase}, motivo ${socket.reason}.${socket.win32Code!==undefined?` Código Windows: ${socket.win32Code}.`:''}`:' O componente nativo não informou detalhes adicionais.'
 return reasons[failure.reason]+details+' Posse reservada não significa prontidão para publicar. Não presuma que uma porta está livre nem encerre outro processo.'
}
