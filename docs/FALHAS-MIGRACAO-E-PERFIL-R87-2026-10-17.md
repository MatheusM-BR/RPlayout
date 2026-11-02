# Falhas de migração e publicação de perfil — r87 — 17/10/2026

## Resultado e escopo

Três novos casos qualificados, cada um com conferência independente dos arquivos
e diários, sem repetir a operação para atualizar status:

- DHY9cz: interrupção real depois de publicar o candidato, antes de confirmar
  adoção; reconciliação pelo arquivo observado, sem outro TAKE/publicação.
- zJnVze: interrupção depois do STARTED durável de migração; repetição bloqueada
  nessa cópia e recuperação por outra restauração do backup original.
- IZwzZ2: interrupção durante escritas reais da transação de migração, com WAL
  capturado, salts/checksums válidos, rollback atômico e nova cópia migrada.

Produto e instalador r87 não foram alterados. Apenas verificadores/fixtures e
documentação mudaram, sem recompilação/instalação por status. Artefato disponível:
`D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r87-instalador.zip`, SHA256
`769BD3BC3FC9284CE9F08D47431B56CAFCB8B41A676C6671E31B396EB3F5FE80`.
Pacote real r87/manifesto9A248FFA/servidor3F52DE22 e ferramentas conferidos;
engine610E03E8 e launcher101A28C9 inalterados. Typescript PASS, leitor WAL
testado com transação real/corrupção/checksum/truncamento/salts, sem reparar WAL.

## Perfil candidato publicado, resultado inconclusivo

`D:\RPlayout-builds\qa\upgrade-workflow-DHY9cz\result.json` PASS e
`assertions-interrupted-adoption.json` PASS. Instalação r87, backup nativo r86
XSsny6 preservado; sem regenerar a origem nem repetir STAGE/instalação.

Fault injection: uma transação QA `BEGIN IMMEDIATE` SEM UPDATE/INSERT bloqueou
somente a escrita final do diário, depois de observar o temporário de publicação
do TARGET. Os processos eram próprios, contidos no job Windows. Ao observar o
perfil candidato em disco, o job foi encerrado ANTES do rollback do lock QA.
Nenhuma fase, dono ou recibo foi fabricado/alterado por SQL para simular a queda.

O perfil observado tinha SHA256
`6cb0539ef24e9a6f1d29a97a46c3051308e9e39ed246eb49f67e4513723093c8`,
igual ao candidato, diferente do anterior. Intenção
`614034e6-2c90-4e4a-9a0b-92474baf1225`; ativação nativa
`33773f40-1f78-431f-b2f4-91da29dde840` CONFIRMED; restauração
`403b4eb7-faa2-4e98-9080-516c32dc857e`. STARTED pendente bloqueou partida;
reconciliação comum sem recuperar reserva foi recusada.

Assistente oficial RECONCILE+RecoverMaintenance liberou explicitamente apenas
a reserva da cópia e registrou UPGRADE_PROFILE_CONFIRMED/OBSERVED_FILE_ONLY.
`historicalPublicationAckKnown=false`: conhecer o arquivo atual não fabrica um
ACK histórico. Perfil NÃO reescrito pela reconciliação, cursor/as-run preservados,
ID concluído recusado se reutilizado, sem diário duplicado. Anterior arquivado
preservado; família própria parada/perfil QA original restaurado ao terminar.

fr1iXxFAIL preservado: a primeira injeção de contenção começou cedo demais e
travou observações antes de alcançar o TARGET. Não foi qualificada como queda
após publicação. O verificador passou a observar o temporário correto antes de
aplicar a falha; nenhum gate de produto foi afrouxado.

## Migração interrompida e recuperação sem replay

As origens vieram do backup schema45 realmente criado pelo binário histórico
r30 (sXZyHf, servidor9D8D37BA). Em novas cópias QA foram adicionadas linhas INFO
`QA_MIGRATION_FIXTURE`, message/context nulos, claramente sintéticas:20.000 em
zJnVze e200.000 em IZwzZ2. Não são incidentes reais nem prova de PGM/mídia/jobs
legados. Nenhum marcador de migração, estado de posse ou recibo foi inventado.

zJnVzePASS + `assertions-interrupted-migration.json` PASS: STARTED durável retido,
cópia continua MAINTENANCE, retry real da ferramenta recusado sem modificar
schema/diário. Nova restauração com requestID diferente migrou45→50 e deixou
admissão OPEN; ambas as cópias continuam em quarentena, zero ativações.

IZwzZ2PASS + conferência independentePASS acrescenta a janela dentro da transação:
captura `pre-interruption.wal`,927032bytes,225frames válidos de4096bytes e páginas
novas não commitadas. SHA256
`151bc53b1733cae04418a2c46073466e62c80c094224b60872d8c87872ec5ecd`.
Leitor verifica prefixo com salts e checksum cumulativo conforme o
[formato oficial SQLite](https://www.sqlite.org/fileformat2.html#the_write_ahead_log);
não repara/reproduz frames e não confunde cauda parcial/stale com evidência válida.

`openDatabase` executa as migrações dentro de um único `initialize.immediate()`:
versões46–50 não devem aparecer parcialmente commitadas. Após matar o job próprio
durante as escritas observadas, schema45 ficou íntegro; diário STARTED continuou
pendente e o retry foi recusado. O caso zJnVze não capturou escritas inflight;
counter45 sozinho não prova em qual instrução ocorreu a queda. IZwzZ2 é a prova
adicional de escritas e rollback, não uma reclassificação retrospectiva.

Intenção interrompida `b035096f-a8b6-4e1d-85c3-9045d20982be`, restauração
`03eae884-7d3c-42c6-9d30-cb07e7e06a5b`. Recuperação por NOVA restauração
`b1b92759-1387-4539-b92b-8527d34f174d`, migração
`cd28c2da-61d3-450a-b27a-47406727fab0` MIGRATED_NOT_ACTIVATED/schema50.
Backup de fixtures preservado, SHA256
`f3d7ed30d0a081077765b45b0c1ea27354ba46dea3663cecc8fa867f0ddcf50c`.
Dados editoriais e todos os campos diagnósticos antigos conferidos idênticos,
INFOs não viraram resoluções de sinal; integridade/FKs PASS, zero ativações,
originais/cofres preservados e inventário independente de processos QA vazio.

## O que não foi qualificado e continuação

Não prova corte físico de energia, Windows limpo, fidelidade de SDI/NDI/OMT,
PGM/mídia/jobs legados migrados ou operação prolongada. Contenção de SQLite e
encerramento de job são falhas controladas, não power-loss físico. DeckLink
adiada; grupo8 exclusivamentev3; licenças/redistribuição sem liberação pública.

9.3/10.4 continuam em andamento para quadro PGM mantido, unknown-spawn/STARTING,
legado nativo, energia e homologações restantes. Migração interrompida com
rollback e reconciliação de perfil após publicação agora têm evidência própria;
não repetir os casos aprovados sem alteração relevante que os invalide.

Totais mantidos:10grupos/53verificações,8concluídas/34andamento/4pendentes/7v3.
Escopo desta versão9grupos/46verificações; objetivo completo ainda ativo.
