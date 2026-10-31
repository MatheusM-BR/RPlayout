export function interruptionResultMessage(action:'RESUME'|'DISCARD',run:{phase:string;nativeProgramConfirmed:boolean;message:string|null}):string{
  const detail=run.message?` ${run.message}`:''
  if(run.phase==='CONFIRMED'){
    if(action==='DISCARD')return `Retorno descartado; histórico e PGM preservados.${detail}`
    return (run.nativeProgramConfirmed?'Retorno confirmado pelo engine; confira o sinal no destino.':'Retorno somente simulado; não confirma programa nativo.')+detail
  }
  if(run.phase==='FAILED')return `Retorno falhou antes do TAKE. Confira a causa e a posição antes de decidir novamente.${detail}`
  if(run.phase==='PREPARING'||run.phase==='SWITCHING')return `Retorno em andamento; aguarde a conferência do registro, sem repetir TAKE.${detail}`
  if(run.phase==='CLOSED_UNCERTAIN')return `Pendência encerrada sem confirmar sucesso ou sinal físico. Cursor não foi reaberto para repetição.${detail}`
  return `Retorno inconclusivo. Confira PGM e registro; nenhum TAKE será repetido automaticamente.${detail}`
}
export function interruptionFailureMessage(error:unknown,sent:boolean):string{
  const detail=error instanceof Error?error.message:String(error)
  return sent?`Resultado não confirmado nesta tela. Consulte o registro antes de repetir TAKE ou outra decisão. ${detail}`:detail
}
