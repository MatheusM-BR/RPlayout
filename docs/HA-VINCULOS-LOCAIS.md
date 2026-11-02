# Preparação local do reserva — integração em revisão

Lote 8.2/8.3 adicional de 10/10, NOT_RUN: cursor parado de preparação não
carrega programTrim, ownerRunId ou graphicReceiptId estrangeiros. A intenção
de retomada fica cifrada em ha_recovery_cursor, ligada ao pedido, mapa de
edições e instante da origem; preserva o corte e offset confirmados, sem somar
tempo de relógio. Proveniência mantém dono/recibo do primário, nunca os usa
como confirmação de um engine/grafismo desta máquina. Corrige a recusa do
preparo de VT ativo com corte/posse nativos. Banco do primário não muda.

Ponte privada promotionCandidate seleciona workspace pelo ledger HA, nunca
pelo browser. Exige preparação RESTORED com análise/QC/montagens sem bloqueio,
plano local atual e testemunha configurada. Autentica origem/cursor/plano e
reproduz as variantes derivadas, incluindo edições ativas/em execução/contingência.
Confere cursor parado, cadência/bus, corte/versão/offset de VT e fonte local de
live. Revalida SHA/caminhos de mídia, runtime da sonda e inventário novo antes
do handoff. Callback verifyCurrent repete conferências antes da admissão; getter
retorna clone, sem deixar o consumidor alterar o candidato interno. Report não
é grant: nenhuma rota retorna paths, credenciais, origem ou callbacks.

Ainda falta o adaptador de ativação host/storage/engine com lease nativo vigente,
primeiro quadro local, mixes/grafismos, saídas selecionadas e diário auditado;
esta ponte não inicia processos nem publica. promotionReady/automaticTake/
physicalOutputValidated continuam falsos. Fixtures novas de cursor/origem/edição/
plano/saídas/tamper adicionadas para revisão consolidada, sem execução/build.

Implementação de lote em 10/10/2026, sem testes/build nesta etapa. Pendência 8.2
em andamento. Não autoriza execução, promoção, publicação ou hot standby.

No painel de espelho, o reserva oferece “Preparação local do reserva”. Um
administrador autorizado escolhe o canal espelhado, confere as entradas desta
máquina e configura ou desativa explicitamente cada saída, com motivo.

## Contrato

- O inventário local vem de descoberta nova e de entradas locais habilitadas
  do canal autorizado. Placa de entrada não é oferecida como placa de saída;
  saída SDI deve constar na descoberta separada de saídas.
- Referências primárias são apenas descritivas. Nunca se tornam configuração
  local por cópia, posição na lista ou coincidência de nome.
- A escolha de entrada preserva protocolo e identidade local. Nomes Unicode
  são apresentados como encontrados. Mapeamentos incompletos/duplicados ou
  fontes ausentes/ambíguas são recusados.
- Entradas necessárias são derivadas das edições ativas/em execução e das
  referenciadas por recuperação/contingência. Histórico puramente as-run não
  obriga o operador a vincular entradas antigas removidas.
- Cada saída exige um destino local compatível ou desativação com motivo.
  Endereço redigido não é aceito como configuração executável.
- Plano imutável cifrado no banco HA, com pedido UUID, ator, sequência de
  conferência e sequência confirmada, identidade do snapshot, configuração
  relevante, inventário e vínculos locais. INSERT/UPDATE/DELETE não substituem
  histórico. Pedido repetido só consulta; outro conteúdo com mesmo UUID recusa.
- Revisão autenticada detecta mudança de edição, configuração, inventário ou
  plano concorrente. Atualizações de telemetria/clock do espelho não invalidam
  sozinhas a conferência. O token continua vinculado à sequência em que foi
  emitido e à configuração que deve permanecer a mesma no salvamento.
- Conferência/salvamento executam com autorização fresca por canal. Mudança de
  sessão durante descoberta bloqueia gravação. O API nunca entrega endpoints
  secretos armazenados em claro.

Endpoints administrativos: `GET /api/ha/binding-channels`,
`GET /api/ha/bindings?channelId=...` e `POST /api/ha/bindings`.
Esse POST grava somente plano isolado; a exceção do bloqueio do reserva não
habilita outras mudanças, desarquivamento ou comandos de canal.

## Edição local derivada — lote NOT_RUN

`POST /api/ha/prepare` exige UUID, canal, sequência e plano exato registrado,
com descoberta e autorização novas. O snapshot é congelado em uma transação;
o relatório distingue a sequência pedida da sequência realmente capturada.
Telemetria normal pode avançar, mas mudança de edição/configuração/plano
interrompe a preparação. O cursor congelado não é autoridade para promoção.

O fluxo de recuperação isolada recebe o plano privado somente no domínio.
Edições necessárias ganham identidade `ha-local:` e proveniência; a edição
primária não é alterada. Mídias referenciadas usam cópias SHA locais e probe
local; metadados não usados não deixam paths estrangeiros executáveis.
Horários, itens, trims, tracks, mixes e nomes editoriais são preservados.
Cortes fora da mídia, tracks/routing inválidos e medição incompatível entram
no relatório de montagens. Mix selecionado ainda exige conferência/render;
descoberta live não é prova de sinal. Automação externa/SCTE permanece
bloqueada até possuir vínculo próprio, sem reutilizar equipamento primário.

Plano, destinos e correspondência de revisões permanecem cifrados no banco
isolado, com canal arquivado, cursor parado e nenhuma saída instalada. O painel
oferece preparar e consultar resultado; registra o tuple do pedido na sessão
antes do envio. Resposta perdida não gera outro UUID/reenvio automático.
Consulta ao histórico é somente leitura. Novo pedido exige encerrar
explicitamente uma consulta terminal. CHECKING interrompido exige reconciliação
do criador morto; não é repetido automaticamente.

Fixtures `ha-local-payload.test.ts` preparadas, **não executadas**. Nenhum
typecheck, build, teste físico ou instalador novo foi produzido neste lote.

Complemento do lote: arquivos de contingência de live passam pela inspeção
de montagem usando seus defaults, não o trim/track do live. A identidade
`configuredSourceId` é substituída pela seleção local configurada ou removida
na seleção descoberta, sem manter vínculo ao cadastro primário. Tracks de
arquivo somente áudio usam também declarações locais de áudio, sem exigir
geometria de vídeo fictícia. Templates ausentes e dependências externas SVG
entram no relatório; SVG embutido ainda exige render/fontes locais. Este
inventário não é validador XML, sandbox de SVG ou prova de fidelidade.
Eventos externos desabilitados não bloqueiam preparo; habilitados permanecem
sem autorização de execução. Relatório oferece nomes dos itens, revisão de
origem e motivos traduzidos, limitado a 200 detalhes com totais completos;
o registro isolado cifrado conserva todas as montagens. Fixtures novas de
fallback, identidade configurada e recursos gráficos permanecem NOT_RUN.

## Limites e revisão pendente

O plano ainda não é instalado em um runtime. Nenhuma entrada, dispositivo ou
saída é aberta por salvar ou consultar. `promotionReady=false`,
`automaticTake=false` e `physicalSignalValidated=false` permanecem obrigatórios.

Ainda faltam integração do plano à promoção, revisão da análise de mídia/QC
local e de tracks/mixes/trims, render dos mixes, prova de sinal,
runtime/plugin/driver, posse/fencing, ensaio
de partição, retorno e RPO/RTO. A seleção de um item descoberto não prova vídeo,
áudio ou exclusividade entre hosts.

Foram preparados cenários em `ha-bindings.test.ts`: avanço somente de
telemetria, configuração alterada, base concorrente, cifragem, idempotência,
histórico imutável e recusa de plano incompleto/redigido. **Não executados.**
Também faltam revisão de permissões, UI remota, discovery e compatibilidade
dos perfis. Pacotes anteriores, incluindo R55, não contêm este lote posterior.
