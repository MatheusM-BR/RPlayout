# RPlayout r29 — build parcial não homologada

Solicitada em 09/10/2026 para testar o fluxo integrado, sem executar novos
testes antes do empacotamento. Compilação não é homologação operacional.

Inclui o histórico operacional por canal na interface de engenharia: seleção
de canal e período, item, edição, execução, engine, CPU acumulada, memória,
fontes e saídas. Coleta automática no servidor e acesso por permissões de canal.
Valores indisponíveis e histórico incompleto são indicados, sem inventar sinal.
Exibe até 120 amostras recentes; não representa navegação completa de 14 dias.

Inclui também as correções de retomada de live restaurada e a ferramenta
recover-restored-reservation.cjs para recuperação explícita de reserva após
queda. Consultar RESTAURACAO-DE-BACKUP.md antes de restaurar dados. Retomada
pausada/congelada continua recusada; não remover reservas manualmente.

Extraia TODO o ZIP e execute INSTALAR.cmd. Instale em uma pasta nova; faça
backup antes de migrar dados. Instalação por usuário com atalhos, sem iniciar
automaticamente o servidor. Não é Setup.exe assinado. Abra RPlayout Server,
depois Master ou QC.

Node, dependências de produção/SQLite, servidor e interface compilados,
engine, auxiliares, GStreamer e runtimes NDI/OMT/MSVC estão incluídos.
Não exige instalar pnpm, tsx ou tsc na máquina de operação. DeckLink ainda
exige o driver oficial Blackmagic Desktop Video e homologação na placa real.

Manifesto: NOT_RUN_PARTIAL_BUILD. Instalação limpa, interação no navegador,
histórico com engine real, retenção/carga e sinais físicos permanecem pendentes.
Esta parcial não encerra nenhum grupo. Releases anteriores preservados.

Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações de fechamento:
5 concluídas, 23 em andamento e 25 pendentes.

Registro externo após gerar o ZIP (não consta do LEIA-ME interno):
536190650 bytes; SHA-256
7139917D4A9920EBA74FC5D27C42F7BEA494EB893BE3BF210377E86DCB436B2B.
Servidor incluído: AE64858753C633593921027D1D5619E8C6B899FD45A9F5681B4AB885008F40B3.
Interface incluída: index-BMKW68WV.js,
AB648AC3446EE44EBCB52A0D4BACC3A7F56ADE5900488B5B9146DA3912362E90.
