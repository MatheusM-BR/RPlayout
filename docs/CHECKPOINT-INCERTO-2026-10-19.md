# 7.3 / 9.4 — parada do processo não confirma o último quadro salvo

## Entregue neste lote

O diagnóstico de posse do canal agora distingue parada local comprovada de
continuidade do cursor. Se há checkpoint nativo ativo e falta liberação final
com fechamento das observações, a consulta apresenta
`LOCAL_STOPPED_CHECKPOINT_UNCERTAIN`, como aviso de retomada. A interface não
apresenta essa situação apenas como “sem bloqueio constatado”.

Consulta somente leitura: não abre engine, não adquire posse, não altera cursor,
não confirma sinal e não exige revisão. **Decisão do operador: retomar
automaticamente do último ponto salvo, aceitando possível repetição.**
Não extrapolar o cursor usando relógio ou duração da indisponibilidade.
A recuperação dentro da mesma sessão, restauração admitida, HA, CUE, TAKE e
proteções de admissão existentes não foram relaxadas.

Após validar checkpoint/revisão/corte/posse, a recuperação registra
`CHECKPOINT_AUTO_RECOVERY_REQUESTED` antes de pedir a retomada ao engine:
posição exata salva, política LAST_SAVED_CHECKPOINT, risco de repetição,
sem confirmação do operador e sem alegar que o PGM já foi recuperado. Falha
ao persistir esse registro preserva o checkpoint e não envia a recuperação.
Revisão/corte incompatíveis e posse não comprovada continuam recusados: a
escolha por automação não autoriza ignorar essas proteções.

## Evidência existente conferida, sem repetir transmissão

`scratch/stale-checkpoint-evidence-AkEGKH/result.json`: PASS na leitura do
ensaio `normal-pgm-storage-timeout-vHiSFE`. Checkpoint52; cursor observado851;
799quadros, ou **31,96s a25fps**, não persistidos. Dono assinado ACTIVE, sem
finalRelease/observationClosed; instância assinada OPEN; as-run ainda aberto.
Os quatro processos originais estavam ausentes segundo a consulta local real.
A identidade local foi reconhecida, e a consulta exibiu o novo diagnóstico.

Banco e WAL permaneceram byte a byte iguais. Não houve claim, promoção,
retomada nativa nem repetição de conteúdo observada neste leitor. Portanto
isso comprova diferença de cursor, não uma reprodução duplicada efetivamente
ocorrida nem a correção completa de recuperação.

## Validação agrupada

- Primeiro lote69/69PASS. Após a escolha do operador, rodada final do backend
  66/66PASS (posse45/recuperação21) e da apresentação6/6PASS. São72testes únicos
  nesse escopo final, não soma das rodadas sobrepostas.
- Tipos do servidor, interface e leitor de evidência: PASS.
- Compilação isolada do servidor: PASS,14entradas.
- Primeira tentativa da interface: dependência Vite procurada no local errado,
  sem build. Tentativa seguinte a partir da raiz produziu aviso de configuração
  Tailwind e não foi selecionada. A rodada a partir de apps/web com configuração
  correta falhou com EPERM ao criar third-party. Nenhuma dessas saídas novas
  qualifica a interface ou deve entrar no instalador. Não houve alteração de
  ACL/política nem desvio da recusa.

Servidor novo:
`scratch/host-history-r88-auto-checkpoint-20261019/server.cjs`
SHA256 `1700da6a91b60882dbb9e46f1af100580c292ad64c8006a70425b8f000ad4840`.
O servidor intermediário178F0B2E foi preservado; não é a seleção atual.
BridgeC60C2EFD e serviço9EB4D10D inalterados. Interface EFDC03FF anterior não
contém este novo aviso de apresentação. Os ensaios nativos de encerramento do
lote anterior continuam evidência daquele fonte, não foram repetidos nem
reclassificados como homologação desta compilação.

## Falta para concluir

7.3: política automática definida e intenção auditada no fonte. Falta testar
uma próxima partida real com essa política e reconciliar cursor/histórico sem
fabricar o trecho que não foi persistido. Não inferir último quadro pelo relógio.

9.4: conferir aviso e política no fluxo operacional instalado; sinais físicos continuam
fora deste ensaio. A nova interface precisa compilar corretamente e ser
conferida no pacote instalado.

10.4: compilar/conferir nativos finais, validar seleção/cópia do pacote e gerar
instalador em D:\RPlayout-builds quando as permissões permitirem. **r88 não
gerada; r87 continua o último pacote instalado.**

Totais inalterados:10grupos/53verificações —8concluídas,34em andamento,
4pendentes,7adiadas para v3. Testes de software não equivalem a requisitos
amplos concluídos.
