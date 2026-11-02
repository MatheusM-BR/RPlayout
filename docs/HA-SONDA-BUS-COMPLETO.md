# Sonda isolada de barramento completo — implementação NOT_RUN

## Escopo

O binário `rplayout-audio-bus-probe` recebe arquivo local e configuração JSON
explícita: trilha, canais reais de entrada, bus 2/8/16, roteamento master,
pares auxiliares, ganho master, teto de true peak e corte em nanossegundos.
Usa os ramos compartilhados de `audio_bus` (conversão, resampling, ganho,
expansão/mistura) e o kernel `BusLimiter` compartilhado com o engine.

O decoder começa no início do arquivo. O corte é aplicado depois da mistura;
o limiter começa RESET no corte. A medição remove seu atraso inicial e
descarrega a cauda, exigindo a mesma contagem de frames na entrada e saída.
Há medição independente por par estéreo e redução máxima do limiter.

## Cobertura original, não padding

`audio_measurement` compartilha corte/relógio com a análise estéreo existente.
Na sonda de bus, um probe antes dos ramos mede a cobertura PCM da trilha
original: caps, taxa, frames completos, PTS, continuidade e GAP.
A origem deve cobrir todo o corte; silêncio criado pelo mixer não comprova
essa cobertura. Mudança de caps/taxa, gap, corte incompleto e ausência de
trilha produzem falha, não recibo de sucesso.

## Limites explícitos

O resultado identifica `ISOLATED_RENDERED_BUS`, `AFTER_ITEM_MIX`, RESET,
cobertura original e cauda descarregada. Mantém `busQualified`,
`transitionQualified`, `avQualified` e `publicationAuthorized` falsos.
Não representa reprodução contínua entre itens, transição, alinhamento A/V,
saída física nem aprovação de QC. Não autoriza publicação ou retorno ao ar.

As receitas de pacote completo/parcial e sua verificação agora incluem o
binário. Nenhum pacote foi gerado: R55 permanece anterior a estas mudanças.

## Restante da integração

1. Runner servidor implementado em fonte, NOT_RUN: usa executor isolado
   existente, pipe de vida do servidor, baixa prioridade, limite 64 KiB,
   prazo máximo 16 minutos, cancelamento e confirmação de ownership.
   SHA/stamp de arquivo e runtime reconferidos antes/depois. Configuração
   exige montagem master correspondente; resposta estrita confere todas as
   decisões, pares ordenados/completos, cauda e cobertura. Config expõe
   AUDIO_BUS_PROBE_BINARY. Ainda não chamado pelo fluxo persistido.
2. Plano e recibos implementados em fonte, NOT_RUN: `ha-return-bus-plan`
   reaproveita o plano pós-ganho e suas decisões AUTO/OFF/MANUAL, perfil local,
   provas pre-gain e origem congelada. Captura canais reais e todos os pares
   auxiliares, recusando auxiliar sem prova correspondente. Chave inclui
   master, perfil, MAC pre-gain, decisão AUTO e configuração integral do bus.
   Medição serial reconfirma runtime do lote. `ha-return-bus-evidence`
   remove caminhos, recomputa chaves, exige recibos apenas para MEASURED,
   compara todo o plano/ordem/issues e mantém qualificações falsas.
   Ainda falta vínculo persistido com cópia STAGED/identidade do banco.
3. Diário implementado em fonte, NOT_RUN: `ha-return-bus-review` registra
   intenção ID-only, captura privada de cópia/perfil/MAC/decisão, owner/ator,
   fases ACCEPTED/MEASURING/REVIEWED/FAILED, reserva 64 MiB e prova até 16 MiB.
   Histórico não pode ser apagado/substituído; transições exigem estado exato.
   Evidência cifrada/MAC é conferida contra plano/runtime/resumo; consulta
   omite owner/prova e nunca afirma prontidão operacional. Interrupção exige
   fase/data exatas, ausência de prova e processo parado comprovado.
   Store cria o diário, soma sua quota e oferece consulta interna; namespace
   inclui tabela. Início/consulta agora ligados Store/Replication/API,
   NOT_RUN: cópia própria STAGED, decisão AUTO registrada e correspondente,
   perfil local capturado, preparação serial fora da fila de medição.
   Verificações reconferem bytes/QC/runtime base, mídia/banco/cópia/stamp,
   perfil/decisão, ownership/sessão/cancelamento antes e depois. Quota é
   reconferida na fila e intenção é registrada antes do runner. UUID existente
   é apenas consultado. GET/POST `/api/ha/returns/bus-review` aceitam somente
   IDs, têm canal/TRANSPORT/ator estável/auditoria/no-store, sem paths ou ganho
   arbitrários no corpo. Interface ligada em fonte, NOT_RUN: painel próprio
   junto da cópia STAGED, confirmação explícita, intenção salva antes de POST,
   consulta do mesmo UUID após erro e guardas contra resposta obsoleta.
   Leitor UI exige captura correspondente à cópia/decisão e resumo sem
   qualificação/aprovação. BUS_REVIEW ligado à listagem paginada e recuperação
   servidor/UI, consulta fresca com ID correspondente, fase MEASURING,
   encerramento apenas com processo parado/estado/data/owner e ausência de
   resultado comprovados. Não executa medição novamente ao recuperar.
4. Avaliador técnico de política explícita por par em fonte, NOT_RUN:
   `ha-return-bus-policy` exige canal/revisão/bus e todos os pares em ordem,
   limites de peak e faixa de loudness (ou avaliação somente de peak).
   Não infere loudness master para auxiliares. Reconfere recibos contra plano,
   informa erros por item/par, bloqueios e impressão digital da política.
   Plano vazio não comprova medição. Continua sem aprovação editorial ou
   qualificação contínua/transições/A-V/publicação. Falta capturar/configurar
   essa política à execução do diário, persistir avaliação e exibi-la;
   depois transições contínuas e alinhamento A/V.

   Configuração local em fonte NOT_RUN: `QcProfile.renderedBusPairs` aceita
   lista explícita 1/4/8 pares na API existente do perfil QC, com validação de
   ordem/faixas/peak. Campos na tela permitem configurar todos os pares,
   revisar peak e ativar faixa LUFS individualmente; nenhuma política é
   criada ao abrir a tela. `captureReturnBusPolicy` lê somente um canal local
   correspondente e revisão informada pelo armazenamento local; ausência ou
   quantidade incompatível é pendência, sem fallback. Ainda falta ligar essa
   validação integrada do novo fluxo.

   Captura/avaliação agora ligadas em fonte NOT_RUN: Store lê revisão local
   de channel_configuration_versions e captura política (ou ausência explícita),
   reconferindo ambas em cada fronteira. Diário armazena política capturada
   opcional para compatibilidade histórica e calcula resumo técnico dos
   recibos exatos; leitura privada recomputa avaliação contra política.
   UI valida política/contagens/revisão e exibe dentro/fora do perfil ou ausência
   de avaliação. Recibo legado não recebe avaliação retroativa. Nunca muda
   QC editorial, prontidão operacional ou autorização PGM. Falta teste
   consolidado de diário/API/UI/captura, transições e sincronismo reais.
   Preservação corrigida em fonte NOT_RUN: schema de pares compartilhado
   entre edição/QC/projeto e recuperação HA. A recuperação anteriormente
   descartava campos extras do perfil; agora lê renderedBusPairs,
   requireProbe e liveSignalPolicy explicitamente. Projeto já usa schema QC
   compartilhado, com leitura strict sem remover os novos critérios.
   Fixtures JSON/projeto e restauração HA ampliados, não executados.
   Backup/restauração reais e demais fluxos de retorno ainda precisam de
   validação integrada; essa edição não comprova restauração operacional.
5. Compilação e execução consolidada dos fixtures, regressão e homologação.

Fixtures preparados, **NOT_RUN**: 2/8/16 canais, cauda com sinal nos últimos
240 frames, contagem exata, finalização única, PCM parcial e corte incompleto.
O relógio/cobertura também tem fixtures de taxa alterada, gap e origem curta.
Nenhum teste, typecheck, compilação ou build foi executado neste lote.

Fixtures servidor adicionais, NOT_RUN: identidade/configuração 2/8/16,
pares faltantes/reordenados, contagem divergente, cauda ausente, padding,
ganho/trilha/mix divergentes, campos privados e falsas qualificações.
Fixtures de evidência, NOT_RUN: plano exato sem paths, runtime divergente,
plano antigo, chave forjada, duplicidade, falha com recibo e job ausente.
Fixtures diário, NOT_RUN: IDs apenas, unicidade/consulta sem replay, proteção
do histórico, retenção de quota, owner distinto, data antiga, evidência
cifrada, resumo histórico e proibição de reexecutar registro terminal.
Fixtures UI de intenção/proveniência/contagem/campos privados/qualificação
preparados NOT_RUN. Navegador, HTTP, recuperação integrada e nativo não testados.
Fixtures de política explícita por par, NOT_RUN: pares faltantes/repetidos,
bus/revisão inválidos, faixas invertidas/não finitas, teto inválido e nenhuma
herança silenciosa de loudness master para auxiliares.
Fixtures de avaliação ampliados NOT_RUN: limites excedidos por par, faixa
auxiliar explícita, medição falha, plano bloqueado/vazio, canal divergente,
ausência versus política inválida e revisão ausente. UI também recusa resumo
que declare falha de medição dentro do perfil, revisão divergente ou avaliação
sem política. Não foram executados; não são evidência de áudio físico.
