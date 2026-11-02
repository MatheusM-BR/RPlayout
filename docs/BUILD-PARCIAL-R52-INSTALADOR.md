# RPlayout r52 — instalador parcial para testes

Inclui as alterações da r51, reconciliação de comandos gráficos secundários
confirmados e correção da proteção de configuração em pastas Windows que concedem
Modify ao usuário, sem direito de trocar proprietário. Não reduz a segurança:
arquivo vazio próprio, ACL privada protegida com usuário atual e SYSTEM apenas.

Extraia TODO o ZIP e execute INSTALAR.cmd. Escolha pasta NOVA. Faça backup do banco
e do cofre antes de qualquer migração; não sobrescreva uma instalação em operação.
Abra RPlayout Server e depois Master/QC pelos atalhos. O servidor não inicia sozinho.

Node, módulos nativos e runtimes portáteis da base existente estão incluídos;
não precisa instalar globalmente pnpm, tsx, tsc ou GStreamer para iniciar.
DeckLink ainda exige driver oficial compatível. Não é Setup.exe assinado.
Instalação não testada, conforme solicitação de build parcial sem esse ensaio.

## Alterações desta edição

- Recibo novo de gráfico secundário vinculado à ocorrência exata.
- Reconciliação auditada de conclusão somente com recibo CONFIRMED/SIMULATED
  vinculado; sem reenviar o comando.
- Falha ao gravar a conclusão após efeito preserva a incerteza, não finge recusa.
- Evento antigo sem confirmação continua bloqueado. Reconhecer alerta não libera
  incerteza nem comprova recuperação do destino.
- Proteção Windows usa controle de ACL sem exigir troca do proprietário quando
  o arquivo já pertence ao usuário atual. Demais verificações continuam obrigatórias.

## Evidências e limites

53 testes de software e tipos aprovados no lote de reconciliação; compilação PASS.
Quatro testes nativos do auxiliar de segurança PASS. Processo próprio simulado
morreu/reabriu: conclusão vinculada recuperada, incerteza preservada, sem reenvio.

Ensaio local OcTLPd com engine nativo PASS: SRT próprio entrou em PGM; emergência
substituiu a imagem; RESET restaurou o vídeo sem reiniciar a ocorrência ou duplicar
as-run. SHOW antigo após RESET não reativou emergência. Captura de receptor limitada.

Server SHA256: EEAFE7B61D740C3CB9710D78D1FD39AFAB18CA9E8B17152618FED93C2C187E1A.
Engine SHA256: AEBDED621B60041206BA45C4122B7BAE48DBCEBC0465A4B023559FB78E31201B.
Auxiliar de segurança SHA256: F2EA9F86EF8C1A6EA5E3DC934177D042F0B7B372C0DD4A6311283C0DE3011BF7.

Não homologados: continuidade de áudio durante emergência, crash completo do
servidor/ACK, reconstrução de display, eventos legados sem vínculo, sinais físicos
NDI/OMT/DeckLink, navegador remoto, failover entre máquinas, operação prolongada,
instalação limpa, upgrade e rollback. Não usar como entrega final para ir ao ar.

Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações: 5 concluídas,
26 em andamento e 22 pendentes. Testes individuais não encerram esses marcos.
