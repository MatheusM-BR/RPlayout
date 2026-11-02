# PGM pausado: TAKE explícito e qualificação instalada pendente

## 9.3 — correção do engine

O fluxo anterior recusava TAKE quando o PGM tinha quadro mantido confirmado
(`HELD`). A interface já permite TAKE com CUE selecionado, sem exigir PGM em
reprodução; não foi necessário alterar o botão nem acrescentar uma pausa pública.

A mudança em `apps/engine/src/channel.rs` permite substituir esse PGM somente
depois de confirmar a nova fonte e ambos os seletores. O quadro anterior, cursor
e mute permanecem durante preparação, falta de vídeo e falha de comutação.
`UNCONFIRMED` continua recusado. Fontes live conservam exigência de vídeo/áudio
recente e o mecanismo de TAKE pendente. Não há liberação implícita do VT anterior.

Evidência nativa anterior ao último acréscimo de fixture: sessão75993 terminou
com código0, dois testes `program_hold_native` PASS, em2 e16 canais, incluindo
restauração de quadro/cursor, silêncio, bloqueios e TAKE para novo arquivo. Build
release locked/offline PASS. Binário observado no cache privado
`D:\RPlayout-builds\native-r83-20261016\release\rplayout-engine.exe`,1.393.664bytes,
SHA256 `0250CF3164ED72EA7ED2BD3C7E641D0E7AC79B225BDB6D4F7BAB9478A8EC0C7E`.
Isso NÃO identifica um novo pacote instalado.

Após essa rodada foi acrescentada uma fixture de política pendente/cancelamento:
um preroll real de arquivo recebe apenas metadado live sintético e readiness
negada. Não é emissor NDI, não prova protocolo/fonte física e **ainda precisa
da rodada nativa afetada**. Não atribuir os dois PASS anteriores a esse acréscimo.

## 9.3.1 — roteiro integrado preparado, NOT_RUN

`scripts/qa-owned-held-source.ps1` e `verify-held-runtime.mts` criam mídia
sintética real e backup HELD de runtime de domínio com engine/runtime da r87.
Os metadados editoriais/QC são fixtures declaradas: NÃO é backend instalado de
origem, nem certificação de ingestão/aprovação. A família própria fecha antes
da restauração; nenhum diário, checkpoint ou recibo de ativação é forjado.

`scripts/verify-installed-held-recovery.mts` usa um NOVO destino instalado com
o engine corrigido, cofre/copias isoladas e ferramentas reais de preparar,
ativar e adotar. Escopo pretendido numa única rodada:

1. Restaurar execução/revisão/item/corte/cursor HELD, sem reprodução implícita.
2. Receber imagem RTSP em dois leitores, pixels estáveis e áudio PCM silencioso.
3. Fazer CUE do segundo item, sem alterar PGM/cursor.
4. Fazer TAKE explícito e receber imagem em movimento, além de tom997Hz estéreo.
5. Conferir RESTART, segmento HELD encerrado por TAKE no cursor salvo e apenas
   um novo segmento aberto, sem alterar o backup original.
6. Encerrar somente o job próprio e devolver o perfil da instalação QA.

`verify-installed-held-evidence.mts` confere capturas persistidas e recibos
autenticados de restauração/ativação/liberação/adoção, histórico e hashes,
sem repetir TAKE/ativação, reparar histórico ou escrever dados de negócio.
Somente o relatório de asserções é novo. A imagem congelada é confrontada entre
leitores; identidade pixel a pixel com o quadro original NÃO é alegada.
O roteiro integrado e essa conferência independente seguem **NOT_RUN**.

## 9.3.2 — verificações locais do roteiro

Sete testes puros do leitor de GRAY8 PASS: movimento, congelamento não uniforme,
preto/branco piscante, amostra curta, mudança isolada, truncamento/dimensões e
stride não alinhado. Não são sete requisitos novos: a matriz permanece53.
O leitor exige pelo menos25 quadros completos e cinco transições com movimento,
sem aceitar contador avançando como substituto de vídeo real.

A análise de tipos dirigida encontrou quatro problemas do roteiro, corrigidos
sem mudar produção: resolução do tipo SQLite, união do alvo de preview, leitura
tipada de COUNT e sintaxe genérica de arquivo.mts. Rodada final da versão atual,
sessão16534, código0/zero diagnósticos para os quatro arquivos do roteiro e suas
dependências, sem emitir arquivos. Sintaxe PowerShell do wrapper PASS.
A matriz estrutural também confirmou10/53 e8/34/4/7, sem certificar função.
Essas verificações não equivalem ao ensaio instalado nem à compilação Rust.

## 10.1 /10.4 — próxima parcial

A próxima edição reservada é r88. **Não existe ZIP/instalação r88 qualificada
neste registro.** A r87 permanece o último pacote instalado e conferido, com
engine antigo610E03E8; não recebe overlay nem alteração retroativa.

A tentativa de repetir os testes nativos no cache D: foi impedida ANTES de
executar: o serviço de autorizações retornou limite de uso, com liberação
indicada para22/10/2026 10:33. Não é erro de compilação nem recusa por ação
insegura. Não trocar destino para contornar a autorização nem reenviar a mesma
solicitação enquanto a condição persistir. Nenhuma limpeza/movimentação feita.

Após disponibilidade: rodar somente o filtro nativo afetado, compilar release,
conferir hash, gerar r88 com `-EngineBinary` explícito do cache D: (não usar o
610E local), instalar em destino QA novo e executar o roteiro integrado uma vez.
Em seguida conferir as evidências persistidas, sem repetir o cenário por status.
Os resultados posteriores devem preservar FAILs e atualizar este relatório;
não preencher NOT_RUN com PASS por inferência.

9.3/10.4 continuam abertas: este caso não substitui STARTING/spawn inconclusivo,
legado nativo/mídia/jobs, energia, Windows limpo, longa duração ou homologação
externa. DeckLink física adiada, nenhuma fonte externa NDI/OMT disponível,
acordo original NDI ausente e grupo8 reservado à v3. Sem liberação pública.

Totais:10grupos/53verificações;8concluídas,34em andamento,4pendentes e7v3.
