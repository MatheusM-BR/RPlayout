# 6.2 / 7.3 — pipe próprio e confirmação atômica da troca de live

Estado: SOURCE_IMPLEMENTED / LOCAL_TESTED; fluxo operacional e instalador ainda
incompletos. Não é homologação de mídia/hardware nem ativação de controles.
Uso interno e testes, sem distribuição.

## Alterações do lote

- EngineTransport usa o mesmo filho, stdin e sequência de RPC do canal para
  PREPARE/COMMIT/CANCEL/STATUS. A geração/capacidade vem do Ready real. A fila
  existente serializa ações; validação de posse/contexto e intenção durável
  precedem os bytes. Não usa LOAD/TAKE como substituto de troca de fonte.
- Sessão captura revisão, execução, decoder e relógio da ocorrência. Recibo
  COMMITTED e State do decoder correspondente instalam o vínculo selecionado,
  conservando relógio, CUE, próximo armado e a ocorrência de as-run. A troca
  não chama onTakeConfirmed. Telemetria e catálogo do PGM antigo são limpos;
  não se fabrica medida de sinal da nova fonte.
- Um recibo sem seleção correspondente não confirma sucesso. Falha de SQL
  depois do corte conserva o resultado inconclusivo, bloqueia novas trocas e
  checkpoint. Consulta STATUS reconcilia a mesma transação sem outro COMMIT.
- commitNativeReplacementReceipt grava recibo, auditoria e checkpoint v2 na
  mesma transação SQLite. Ledger e Checkpoints conferem a identidade da conexão;
  conexões distintas são recusadas antes de escrever. Histórico atrasado não
  substitui o cursor atual.
- Repetição consulta o envelope existente, sem gerar nova conexão/nonce nem
  regravar o cursor. Mesmo nesse caminho, valida ocorrência ATUAL, conexão
  privada e recibo durável. Normalização de recibos elimina comparação
  dependente da ordem dos campos do objeto.
- STOP exige ACK, PGM vazio e o mesmo filho. A resolução SQL e o checkpoint
  parado são atômicos. Erro de persistência mantém o bloqueio até registrar
  o fato. Outra geração só resolve a transação se a saída do filho anterior
  realmente pertencente ao transporte tiver sido observada. Não basta PID,
  pedido de kill ou engine novo. STOP de outro canal é recusado.
- STOP não inventa recibo COMMITTED. Preserva recibos históricos, mas registra
  que seu vínculo antigo não pode ser usado para retomar automaticamente.
  Recuperar o vínculo A tampouco resolve uma troca B de resultado desconhecido.

## Evidência local do lote final

- Typecheck completo do servidor: PASS.
- 335 testes PASS / 0 FAIL em 10 arquivos, relatório:
  scratch/native-replacement-bridge-20261019/tests.json.
- Inclui 194 casos de EngineTransport com filho simulado; 25 de wire; 22 de
  ledger; 19 novos de commit/STOP com SQLite real, triggers de rejeição e rollback;
  23 de vínculo; 6 de checkpoint; 25 de recuperação; 10 de arquivo de canal;
  5 de cursor HA; 6 de contrato rollback.
- A rodada inicial encontrou três falhas: duas na reutilização do envelope
  devido à ordem dos campos e uma no próprio fixture de restauração do mock.
  Foram corrigidas antes da rodada consolidada final. Não são testes ocultados.
- Build isolada das 14 entradas JavaScript: PASS. Contrato CLI executado:
  50 migrações, formatos de checkpoint [1,2].
- Bundle isolado server.cjs SHA256:
  FF4784EE30AE34872FC018DDDB9D0D9D955354CF2A8DE86F4F2F551FE00D4BCC.

## Limites e próximo trabalho obrigatório

O helper atômico está validado em fonte/testes, mas AINDA NÃO foi ligado por uma
fábrica de sessão ao ChannelRuntime e às ações HTTP/interface. Nenhum endpoint
novo foi habilitado. A decisão de failover existente continua apenas metadados,
sem alegar mudança de PGM. O bundle isolado não prova que o helper já esteja
alcançável pelo fluxo de produção.

Falta a autorização atualizada por ação/sessão nessa fábrica e seus testes
integrados, além da resolução de journal de geração predecessora após reinício
completo do servidor. Os callbacks de STOP deste lote tratam sessões conhecidas
pelo transporte atual; não provam reconciliação entre processos do servidor.

Rust nativo continua NÃO compilado/testado neste lote; os 12 testes escritos
continuam NOT_RUN. Não houve IPC com esse binário novo, pixels/PCM da troca,
NDI/OMT externos, DeckLink, HTTP remoto, soak, instalação ou r88. Engine/web/r87
instalados e bancos operacionais não foram substituídos. A build de servidor
isolada não equivale a um pacote Windows completo.

Totais mantidos: 10 grupos / 53 verificações — 8 concluídas, 34 em andamento,
4 pendentes e 7 reservadas para v3. Nenhuma verificação ampla foi fechada apenas
pelos testes deste lote.
