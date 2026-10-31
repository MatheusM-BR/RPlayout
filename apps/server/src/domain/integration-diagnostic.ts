import type {IntegrationDeliveryDiagnostic} from '@rplayout/protocol'
import {executionHostIdentity} from './execution-host.js'
export const uncertainDelivery=(error:string|null)=>Boolean(error&&/^Envio (?:legado )?sem responsável identificável\./.test(error))
export interface DeliveryOwner {state:string;lastError:string|null;ownerHost:string|null;ownerPid:number|null;ownerBoot:string|null}
/** Read-only: discovery of a record or an operator checkbox is not death proof. */
export function diagnoseIntegrationOwner(row:DeliveryOwner):IntegrationDeliveryDiagnostic{
 const result=(ownership:IntegrationDeliveryDiagnostic['ownership'],message:string)=>({ownership,message})
 if(row.state!=='SENDING')return uncertainDelivery(row.lastError)?result('UNKNOWN','Registro legado inconclusivo. Não sabemos se o destino recebeu o POST; confirmação manual não comprova liberação. Reparo exige coordenação da instância anterior e deduplicação no gateway.'):result('INACTIVE','Nenhum envio em execução neste estado; isso não comprova entrega ao destinatário.')
 if(!row.ownerHost||!row.ownerBoot||!Number.isSafeInteger(row.ownerPid)||row.ownerPid!<1)return result('UNKNOWN','Envio sem responsável identificável. Pedido preservado e reenvio bloqueado; não presumir falha ou entrega.')
 if(row.ownerHost!==executionHostIdentity())return result('REMOTE','Envio pertence a outro nó. Um PID local não comprova encerramento remoto; pedido preservado.')
 try{process.kill(row.ownerPid!,0);return result('LOCAL_ALIVE','Processo local ainda existe; envio protegido. Não retomar nem matar por PID presumido.')}
 catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'?result('LOCAL_DEAD','Encerramento local comprovado. Recuperação automática conserva o ID; o destinatário deve deduplicar um possível POST anterior.'):result('UNCERTAIN','Sistema não comprovou encerramento. Pedido e posse preservados; reenvio bloqueado.')}
}
