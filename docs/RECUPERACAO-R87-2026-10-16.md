# Recuperação e restauração repetida — r87 — 16/10/2026

Atualização17/10: um ensaio SEPARADO qualificou o ciclo real r86→r87→r86,
incluindo dados criados após upgrade e novo backup depois do retorno. Ver
UPGRADE-E-RETORNO-R86-R87-2026-10-17.md. Os limites abaixo continuam descrevendo
o caso cKg2O8 de16/10; não converter retroativamente sua cobertura.

## Entrega

Instalável parcial interno:
`D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r87-instalador.zip`.
540527606bytes; SHA256
`769BD3BC3FC9284CE9F08D47431B56CAFCB8B41A676C6671E31B396EB3F5FE80`.
Servidor `3F52DE22CD416A920A273DE2489A3D3FF6A490B8BFBF2790E647B0101C7F030D`;
manifesto `9A248FFA3F8E4792D85C782AA590A6CFF60FC2A6D51BD8D617DFEF02E5F155DE`.
Engine610E03E8, launcher101A28C9 e interface8B0D3FCB inalterados.

Instalador incorporado executado em `D:\RPlayout-builds\qa\r87-installed-20261016`:
7.100 arquivos conferidos, recibo VERIFIED, perfil isolado, sete destinos de
atalhos PASS. `qa\r87-install-evidence-20261016\result.json` registra resultado.
Não sobrescreve instalações anteriores; projeto/dados não foram movidos/apagados.

## Correção e testes afetados

A posse nativa conserva, em memória e apenas durante a mesma admissão, a prova
de parada dos predecessores locais. Os bytes autenticados do registro devem
permanecer exatos; alteração exige prova fresca. A ausência comprovada de uma
geração não é invalidada por outro processo que posteriormente reutilize seu
número de PID. Nenhuma prova é persistida, transferida a outra posse/host ou
usada para aceitar processo cuja parada não foi comprovada. Assinaturas e
verificação da posse atual continuam obrigatórias em cada consulta.

66 casos PASS em lote: ownership38 (inclui dois novos), recuperação18,
checkpoints6 e evidência as-run4. Tipos/build PASS. O domínio de exportação e
integridade da r86 já tinha31casos distintos PASS, quatro de bootstrap e dois
de Unicode; não foram repetidos apenas para mudar status.

A r86→r83 falhou antes de liberar saídas, com checkpoint/histórico preservados:
6NN6PMFAIL e verificação independente de recusa segura PASS. A consulta posterior
encontrou PIDs históricos ausentes; reutilização transitória no instante da falha
é uma inferência, não telemetria capturada. O problema de perder prova já obtida
foi reproduzido deterministicamente nos testes. A r83 não foi modificada.

## Ensaio instalado e conferência independente

`D:\RPlayout-builds\qa\compatible-rollback-cKg2O8\result.json` PASS.
`assertions-compatible-rollback.json` PASS sem repetir a ativação:

- Novo controlador e destino reais são a r87 instalada, sem overlays. Snapshot
  nativo r83 de M6lwbz; baseline original IQkjFO. Exportações explícitas novas,
  journal DELETE, sem WAL/SHM; hashes dos bancos originais preservados. Nenhum
  auxiliar original foi apagado para forçar aceitação. Leituras SQLite podem
  criar/atualizar auxiliares; seus hashes não foram qualificados como imutáveis.
- Histórico mais recente completo restaurado: um registro novo e um alterado
  em relação ao baseline, zero IDs perdidos. Não mescla dados nem usa a cópia
  antiga no lugar da recente.
- Recibo de restauração autenticado, ativação
  `6c32eec9-6cf2-49c5-b14d-05937f7781ca` CONFIRMED e adoção
  `21a097e9-8379-4b41-b94e-f10b1092a952` UPGRADE_PROFILE_CONFIRMED.
  RequestID `45b7b8b7-620b-4e8b-a7db-f56df25f229b` confere entre os diários.
- Mesmos execução/revisão/item/corte; cursor salvo252 e posteriormente739frames,
  25fps. Ocorrência interrompida recebe RESTART/duração UNKNOWN, novo segmento
  nativo começa no cursor salvo. Três segmentos totais, apenas um aberto.
- Imagem real recebida pelo monitor local320×180, desvio72,2368 (não quadro
  uniforme); PCM estéreo48kHz,28.800frames, tom997Hz nos dois canais e presença
  concentrada nas cinco janelas temporais de cada canal. Fonte sintética local,
  não certificação de fidelidade de áudio ou qualidade física.
- Família própria encerrada e perfil original de QA restaurado byte a byte.
  Essa limpeza de perfil QA não é um rollback operacional de produto.

## Limites e continuação

Este PASS qualifica restauração repetida e retomada do snapshot na edição
corrigida, com contrato declarado de schema exato. NÃO qualifica operação PGM
na edição nova seguida de retorno a uma edição anterior: controlador/destino
são a MESMA r87 e os dados nativos vieram da r83. A tentativa no destino r83
continua FAIL; não herda esta correção. Não prova transformação inversa de
schema, Windows limpo, perda de energia, fontes externas ou longa duração.

Continuar9.3/10.4 com estado durável da migração interrompida, adoção interrompida
depois de publicar candidato, PGM/mídia/jobs legados migrados, retorno real entre
edições compatíveis e histórico após operar na edição nova. Conferir capacidades
da edição de destino e recusar schemas incompatíveis; nunca apagar marcadores,
reescrever donos/checkpoints ou substituir snapshot recente por baseline antigo.
Usar cópias e processos QA próprios; preservar todos os FAILs e originais. Fazer
o lote de implementação, depois só os testes afetados, sem replay por status.

10.2licenças/externos,10.3Windowslimpo e10.5publicação permanecem separados.
Acordo NDI original indisponível; redistribuição REVIEW_REQUIRED e publicação
pública não liberada. DeckLink física adiada; grupo8 exclusivamentev3.

Totais mantidos:10grupos(1concluído/8abertos/1v3),53verificações
(8concluídas/34andamento/4pendentes/7v3). Escopo desta versão:9grupos/46checks.
