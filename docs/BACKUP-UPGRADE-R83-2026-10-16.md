# Backup, quarentena e retomada instalada r80 → r83

Lote de 16/10/2026, mesma máquina/conta Windows e mesmo schema. Houve duas
correções de produto: módulos PowerShell e inicialização de QC retido. A
ativação/adoção com mídia foram confirmadas na r83; a conferência independente
dos dados/capturas passou. O roteiro original da execução final permanece FAIL
por uma expectativa incorreta sobre a segmentação do as-run, detalhada abaixo.
Não é homologação completa de 9.3/10.4, downgrade ou Windows limpo.

## Correções de produto

1. A preparação na r81 falhou antes do restore: Get-FileHash não era encontrado
   porque Windows PowerShell5 selecionava Utility de outro host pelo PSModulePath
   herdado. A reprodução isolada identificou o manifesto incompatível escolhido;
   importar o manifesto do PSHOME executado restabeleceu o comando e o hash.
   Os sete scripts de instalação/restore/upgrade agora importam Utility e
   Management de seu próprio PSHOME, sem mudar variáveis/configuração da máquina.
   [Importação por caminho absoluto — documentação Microsoft](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/import-module?view=powershell-5.1#example-4-import-all-modules-specified-by-a-path).
   `powershell-builtins-kuhKI3/result.json`: 14 casos PASS, caminhos herdados e
   módulo estrangeiro prioritário; são casos de bootstrap, não upgrades completos.
2. R82 chegou à ativação, mas o engine exigia barramento PVW ao configurar QC no
   bootstrap, justamente quando PGM/PVW estavam retidos por segurança. A r83
   conserva apenas o destino QC validado, sem publisher/superfície até a liberação
   nativa explícita do preview depois de PGM. Destino inválido/duplicado continua
   recusado. Não foi removido o gate nem antecipada a publicação para fazer passar.
   Sete testes nativos afetados PASS: seis QC/perfil/retido e um de áudio simultâneo
   PVW/HQ. Build de produção release/locked/offline PASS, com avisos de código
   não utilizado. Engine SHA256:
   `610E03E8A61215E7DDB85570451178456337B8F2F9AA57AB07A057AE954CF7FA`.

Cache de compilação copiado para `D:\RPlayout-builds\native-r83-20261016`,
sem mover/apagar projeto no C:. Após a prova funcional, somente o binário de
build local foi atualizado para610E03E8: hash anterior191CD1E1 e ausência de
processo usando esse arquivo foram conferidos antes da cópia. Releases/QA
anteriores191CD1E1 foram preservadas. Servidor6B3E024C, launcher101A28C9 e
web8B0D3FCB inalterados; não recompilados/retestados sem alteração.

## Backup online real na r80

Instalação independente:
`D:\RPlayout-builds\qa\r80-upgrade-source-20261016`.
Recibo VERIFIED, manifesto materializado e sete destinos de atalhos PASS em
`qa\r80-upgrade-source-install-evidence-20261016\result.json`.

`qa\launcher-native-IQkjFO\result.json`: PASS. Fonte sintética própria por
arquivo, não dispositivo/rede ao vivo; scanner, probe, arquivo, proxy, decisão
QC e publicação reais pelas APIs. PGM permaneceu no mesmo item/origem durante
o backup online. Pedido UUID1fbe52c8-8343-4cc4-ae04-0722e90363a9 retornou READY;
repetir o mesmo UUID retornou o mesmo resultado sem criar outro pedido.
Backup839680bytes, SHA256
`f66272ab004f1fabc7b4372642de538353fbb89cfd2091122f86176fc1fa3feb`.
Asserção independente dos brutos/SQLite/hash PASS no mesmo diretório.
O backup original, cofre e mídia permaneceram preservados em todos os ensaios.

## Pacotes gerados, sem sobrescrever anteriores

| Edição | ZIP em D:\RPlayout-builds | Bytes | SHA256 |
| --- | --- | ---: | --- |
| r82 | RPlayout-1.1-parcial-20261016-r82-instalador.zip | 540389751 | 72C6126684784BEC46BA3B4D1B5EE2F10B75671C889541BF595B64AF42EBFE80 |
| r83 | RPlayout-1.1-parcial-20261016-r83-instalador.zip | 540389724 | D9F042EB93FA78678EE89AAE12A24D94CFA56A3681666550E26417AFB09F9F51 |

Ambos instaladores incorporados foram executados em pastas QA novas no D:;
catálogo, materialização/hashes, recibo VERIFIED, perfil isolado e sete destinos
de atalhos PASS. Evidências `qa\r82-install-evidence-20261016\result.json` e
`qa\r83-install-evidence-20261016\result.json`. Isso não executa as sete UIs.
Preflight r83:2.829.063.765bytes necessários,644.337.283.072bytes disponíveis.
R83 usa explicitamente o engine610E03E8 compilado no D:, não o antigo copiado
da base r78. READMEs incorporados permanecem pré-ensaio, sem reempacotamento
apenas para atualizar status/hash de documentação.

## Sequência efetivamente exercitada

Na r83 instalada, scripts reais prepare/review/start do pacote, launcher real,
Node/GStreamer/auxiliares do próprio pacote, sem overlays. O controlador QA
forneceu a confirmação fixa ATIVAR E ADOTAR somente ao prompt esperado e rodou
o assistente em job Windows próprio. Encerrou apenas seu ChildProcess; não
executou taskkill por PID nem parou serviço operacional.

1. Preparação do backup em pasta nova; validação de cofre/procedência e cópia em
   quarentena. Oito tabelas operacionais comparadas integralmente com o backup:
   mídia, versões, QC, grades, itens, revisões publicadas, as-run e jobs.
   Perfil ativo ainda anterior; backup/hash/cofre originais preservados.
2. STAGE admitiu consultas/autenticação, com zero engines nativos e nenhum broker
   ou engine em execução. TAKE retornou409; checkpoint/as-run não foram alterados.
3. Interrupção deliberada apenas do job STAGE de teste. O comando portátil de
   recuperação conferiu ausência do detentor/predecessor e exclusão nativa antes
   de retornar RESERVATION_RELEASED_NOT_ACTIVATED. Não houve liberação por idade.
4. ACTIVATE fez revisão fresca, manteve posse/reserva e retomou arquivo no engine.
   Liberações PROGRAM/PREVIEW ocorreram sob admissão; diário autenticado terminou
   CONFIRMED. Adoção só depois disso terminou UPGRADE_PROFILE_CONFIRMED, com perfil
   anterior preservado em arquivo privado e nenhum pedido de adoção pendente.
5. PGM recuperado foi decodificado: imagem320×180/desvio72,17; PCM estéreo48kHz,
   pico espectral independente997/997Hz, RMS~0,035506 e cinco janelas concentradas
   por canal. Não é escuta humana nem certificação completa de fidelidade.
6. Identidades de grade/revisão/item/execução e corte0–1500 preservados. Checkpoint
   posterior752frames comprova avanço, não substitui as capturas. As-run anterior
   fechado RESTART com duração nativa ainda UNKNOWN; novo segmento NATIVE parte
   do cursor salvo. Exatamente um segmento aberto. O instante de reconciliação
   não comprova o último quadro físico do predecessor; esse fim não foi inventado.
7. Famílias próprias STAGE e ACTIVATE observadas,10processos em cada inventário,
   encerradas pelos jobs; nenhuma instância restante da cópia instalada. Perfil
   original do ambiente QA restaurado byte a byte pelo controlador após a parada.
   Essa restauração de ambiente de teste NÃO é o rollback operacional do produto.

## Evidências e falhas preservadas

Todas as pastas abaixo ficam em `D:\RPlayout-builds\qa`.

| Tentativa | Resultado original | Evidência/limite |
| --- | --- | --- |
| upgrade-workflow-BUiuWz | FAIL | r81: módulo incompatível/Get-FileHash antes de restaurar; sem ativação |
| upgrade-workflow-pJaBUT | FAIL | r82 preparou com sucesso; QA leu envelope.report como relatório plano; nenhum STAGE nesse primeiro roteiro |
| upgrade-workflow-TvKSa7 | FAIL | Continuou explicitamente a preparação anterior, autenticou manifesto, passou STAGE/recuperação; ACTIVATE recusado por QC/PVW retido. assertions-failure-preservation.json PASS prova FAILED autenticado e origem/cursor/as-run/perfil preservados; não aprova o upgrade |
| upgrade-workflow-MLIh8R | FAIL | Nova restauração r83, STAGE/recuperação/ACTIVATE/adoção e capturas concluídos; última asserção QA exigia uma única linha as-run, contrariando o contrato RESTART + retomada |

No último caso, a expectativa correta já existia em
`scripts/verify-restored-playing-activation.mts` e em `AsRun.reconcileAfterStartup`.
Corrigido somente o verificador; produto/ZIP não alterados. Não foi repetida a
ativação apenas para obter verde e o result.json original continua FAIL.

`upgrade-workflow-MLIh8R/assertions-upgrade-workflow.json`: PASS independente,
com sourceRunResult=FAIL explícito. Confere os bytes de imagem/PCM existentes,
integridade SQLite, manifesto/procedência, assinaturas da ativação e da adoção,
arquivo anterior/hash, ausência de adoção pendente, execução/cursor, dois
segmentos as-run corretos e apenas um aberto. Esse relatório prova o cenário
local pela evidência persistida; não altera a classificação do roteiro original.

## Pendências que não foram encerradas

- 9.3: completar combinações de restauro/retomada e homologação operacional;
  esta prova é arquivo sintético, mesma conta/máquina/schema.
- 10.4: migração real entre schemas/versões antigas, reconciliação de adoção
  incerta/interrupção de energia, retorno compatível/downgrade e conciliação
  completa do histórico após a atualização. Comparar histórico não é restaurar
  uma versão anterior pronta; não abrir banco migrado com binário antigo.
- 10.2/10.3/10.5: licenças/externos, Windows limpo e publicação final continuam
  separados. Acordo original NDI indisponível; nenhuma fonte externa NDI/OMT.
- DeckLink física adiada; grupo8 adiado à v3. Demais grupos conservam seus gates.

Sem limpeza, migração de pastas, modificação de firewall, dados/contas/serviços
operacionais ou publicação pública. Totais10grupos/53verificações preservados:
8concluídas,34em andamento,4pendentes,7v3. Objetivo amplo permanece ativo.
