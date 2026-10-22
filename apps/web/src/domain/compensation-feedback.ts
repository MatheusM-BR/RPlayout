export function compensationReceiptMessage(result:{revision:number;deduplicated:boolean;refreshError:string|null}):string{
  const committed=`Compensação ${result.deduplicated?'já aplicada':'gravada'} na revisão ${result.revision}.`
  return result.refreshError?`${committed} Atualização operacional exige atenção: ${result.refreshError}`:`${committed} PGM/CUE preservados.`
}
export function compensationFailureMessage(error:unknown,sent:boolean):string{
  const message=error instanceof Error?error.message:String(error)
  return sent?`Resultado ainda não confirmado nesta tela. Confira a mesma solicitação antes de outro ajuste. ${message}`:message
}
