/**
 * Partida e encerramento do servidor como incidentes (componente SERVER).
 *
 * Os logs técnicos ficam em memória e somem no reinício. No reteste, um
 * reinício do servidor com o canal no ar tirou o PGM por 18 s e a tela técnica
 * só mostrava "Engine pronto": nada dizia que o servidor tinha caído nem que o
 * PGM parou junto. Estes eventos vão para `health_events`, que sobrevive.
 */
export interface ServerLifecycleRow { component: 'SERVER'; state: 'started' | 'shutdown'; severity: 'INFO' | 'WARN'; message: string }

export function serverStartedEvent(pid: number, version: string): ServerLifecycleRow {
  return { component: 'SERVER', state: 'started', severity: 'INFO', message: `Servidor iniciado (PID ${pid}, ${version}). Logs técnicos anteriores ao reinício não ficam na tela; itens cortados pelo encerramento aparecem no as-run com saída SHUTDOWN.` }
}

export function serverShutdownEvent(reason: string, onAirChannels: string[]): ServerLifecycleRow {
  const onAir = onAirChannels.filter(Boolean)
  return onAir.length
    ? { component: 'SERVER', state: 'shutdown', severity: 'WARN', message: `Servidor encerrado (${reason}) com PGM no ar em ${onAir.join(', ')}: o engine parou junto e o canal fica fora até o servidor voltar.` }
    : { component: 'SERVER', state: 'shutdown', severity: 'INFO', message: `Servidor encerrado (${reason}) sem canal no ar.` }
}
