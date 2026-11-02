# 6.2 — troca de fonte da mesma live: implementação nativa em fonte

Estado: **SOURCE_IMPLEMENTED / NATIVE_BUILD_NOT_RUN / NOT_INTEGRATED**.
Não é failover entregue, redundância de máquina, homologação de sinal ou r88.
O servidor continua com o caminho de metadados anterior; nenhum endpoint foi
ligado aos comandos abaixo. Grupo8 permanece adiado para v3.

## Alterações deste lote

Arquivos: apps/engine/src/live_replacement.rs, channel.rs, protocol.rs e main.rs.
Preservadas as demais alterações existentes no worktree.

- Terceira superfície permanente de vídeo/áudio. A alternativa não consome o
  decoder armado do próximo item nem a abertura independente de PVW/QC.
  LOAD deixa de calcular `1 - slot`: procura uma superfície não selecionada.
- PREPARE recebe transação, geração UUID do processo, revisão de seleção,
  item/decoder/fonte atuais e fonte alternativa. URI somente no pipe/memória;
  recibos e representação Debug não contêm esse endereço privado.
- PREPARE copia ganho, corte e política de áudio/pares do PGM real. Não permite
  alterar essas políticas pelo pedido de troca e não toca no relógio da live.
- Prontidão requer vídeo recente e o áudio exigido pela política existente.
  Pode voltar de READY para PREPARING se o sinal desaparecer. Prazo absoluto
  de10s não é renovado por repetição do pedido. Nunca há commit automático tardio.
- COMMIT explícito exige geração, transação, decoder preparado e concessão
  nativa válida antes/depois do comando. Só registra COMMITTED depois de conferir
  os dois seletores e a prontidão. Preserva o relógio, medidor, CUE/QC e próximo.
- Falha de seleção tenta rollback mantendo o decoder anterior. Se os seletores
  não confirmarem o retorno, resultado UNCERTAIN, ambos decoders retidos e
  LOAD/TAKE bloqueados até STOP explícito. Não alegar continuidade nesse caso.
- Cancelamento, STOP, LOAD, TAKE, mudança de CUE/ganho ou reabertura de PGM
  invalidam a preparação. Recuperação automática da fonte primária não disputa
  a preparação da alternativa; volta a ser permitida após seu término.
- Journal somente da instância: repetição devolve recibo, sem abrir/cortar de
  novo. Até256 transações, sem expulsar chaves antigas para reexecutá-las.
  Ao atingir o limite, nova transação é recusada sem reiniciar engine no ar.
- Ready anuncia liveReplacementProtocol1 e engineGeneration; eventos de recibo
  correlacionados ao comando e eventos espontâneos de mudança/expiração.
  State informa programSelectionUncertain. ACK aceito não significa COMMITTED.

## Verificação efetivamente feita

Rustfmt leu os quatro arquivos, com edition2021/skip_children e saída somente
em stdout: exit0, sem erro de sintaxe. O novo arquivo foi formatado; os outros
não sofreram reformatação integral. A API GLib uuid_string_random foi localizada
na dependência glib0.20.12 instalada.

Isso é análise sintática, **não** compilação, conferência de tipos, ligação
GStreamer, execução dos testes ou prova de pixels/PCM.

Foram escritos12 testes novos:9 do journal/validação,1 de escolha das três
superfícies e2 de contrato JSON. Todos **NOT_RUN** nesta etapa. Não somá-los aos
PASS dos lotes anteriores. Compilação/testes nativos continuam sujeitos ao
bloqueio de autorização registrado; não houve mudança de cache/destino para
contorná-lo. Nenhum binário, instalação ou ZIP foi substituído.

Hashes SHA256 dos fontes após o lote:

| Arquivo | SHA256 |
| --- | --- |
| live_replacement.rs | B0B3740A9EA2F84807EB39B0ACD803A7015F9AF5874E2C7DCEA8294D967E633D |
| channel.rs | 0ADA2C64F5642D2F2313AA3C801948AA977AC1D9064CA8EE9D09D2BACABF33B6 |
| protocol.rs | 95C0088BC2685EFB86834BACD20F455C4D48997F84A7C8B1686720F7BE8303C4 |
| main.rs | 95FD5A0F861C41BBAAF28916B7D251DEB419BE530EE0C0A476A6D85E049762B8 |

Os hashes incluem o bloqueio da disputa pela recuperação primária. Conferência
de whitespace do diff dos fontes: exit0; avisos de conversão LF/CRLF do Git não
são compilação nem validação de runtime.

## O que falta antes de ativar no produto

1. Compilar e executar o lote nativo completo em ambiente autorizado; tratar
   eventuais erros de tipos/ligação/regressões como trabalho pendente, não como PASS.
2. Integrar no servidor a geração/capacidade, decisão durável vinculada ao par,
   revisão/configuração/canal/ator/ocorrência, preparo/envio/recibo/incerteza e
   cancelamento. O token selectionRevision nativo é um vínculo opaco, **não**
   comprova que o par foi autorizado ou que sua configuração continua válida.
3. Atualizar bindings por barramento, tempo de início/as-run e observabilidade:
   mudança do decoder da mesma live não pode chamar confirmação de TAKE normal,
   limpar CUE, criar outra ocorrência ou atribuir sinal à fonte anterior.
4. Persistir a perna confirmada sem credenciais abertas, recuperar/reconciliar
   após crash e bloquear retomada silenciosa da perna errada em rollback antigo.
   O journal nativo é volátil, não substitui checkpoint ou log durável do servidor.
5. Ensaiar integrado vídeo/áudio publicados, ausência/perda de sinal, CUE/QC
   simultâneos, próximo preparado, política multicanal, cancelamento, deadline,
   perda de ACK, falha/rollback de seletores e reinício. Confirmar amostras da
   fonte correta na saída: propriedade active-pad não é medição física.
6. Depois integrar interface/nativos finais no instalador interno e qualificar
   pacote. Não misturar o novo protocolo em fonte com o engine0250 antigo e
   tratá-lo como capaz. Nenhuma r88 encontrada/gerada nesta etapa.

Totais mantidos:10grupos/53verificações —8concluídas,34em andamento,
4pendentes,7adiadas para v3.12testes escritos não são12verificações concluídas.
