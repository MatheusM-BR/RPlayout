# Soak da r88-11, correção na r88-12 e atualização r88-11 → r88-12 (21/10/2026)

Autorização do operador: "total autonomia para testes nesta máquina".

## 1. Defeito achado no soak da r88-11 migrada

Nos primeiros 10 min do soak (grade do operador em LOOP), a cada virada de item
aparecia o alerta ENGINE "Corte salvo não corresponde a PGM nativo
reproduzível". No último quadro de um item cortado o cursor do PGM fica igual
ao comprimento do corte; o schema do checkpoint recusa esse ponto (correto:
não é ponto de retomada), mas a recusa virava `recoveryError` permanente.

Correção (`apps/server/src/app.ts`, `checkpoint()`, commit e2da3ea): nesse
quadro o checkpoint anterior é mantido, sem alerta. Teste novo em
`runtime-idle-storage.test.ts`; a mutação "sem a guarda" derruba o teste.
Suíte do domínio no Linux: 3002 PASS / 13 FAIL (as mesmas falhas conhecidas).

## 2. Build r88-12

13/13 PASS, Rust 125/0/4. Instalador
`D:\RPlayout-builds\RPlayout-1.1-parcial-20261020-r88-12-instalador.zip`,
SHA256 `C55659E98084077D1B76678A946EFA4E6AF1762F526D5E77ECFB6F4841ED0545`.

## 3. Atualização r88-11 → r88-12 (caminho oficial) e dois achados

Passos: backup de atualização pela API → instalação nova `D:\RPlayout r88-12`
→ preparação em quarentena `D:\RPlayout r88-12 dados` → ativação com adoção.
Backup `D:\RPlayout r88-11 dados\backups\upgrade\rplayout-2026-10-21T12-03-32-303Z-….db`,
12.472.320 bytes, SHA256 `da1082f853509c02c2c796c5c976865df2a78343a238510499f3c6fd42365cf4`.
Ativação 09:05; PGM retomado no ar; 0 alertas.

**Achado A — banco bloqueado depois de encerramento forçado.** A instância
ativada a partir de uma cópia restaurada mantém a reserva de armazenamento
MAINTENANCE durante toda a execução e só a solta em encerramento ordenado. Ao
parar a r88-11 à força, a partida seguinte recusou: "Banco reservado para
manutenção; partida bloqueada". É o comportamento projetado (sem liberação por
idade), e a ferramenta oficial resolveu:
`runtime\node\node.exe apps\server\dist\recover-restored-reservation.cjs
--database … --manifest <dados>\restore-quarantine.json --vault-file …` →
`RESERVATION_RELEASED_NOT_ACTIVATED` (ativação anterior já confirmada); depois
a partida normal funcionou. **Risco operacional:** queda de energia ou
encerramento forçado depois de uma atualização deixa o RPlayout sem partir até
alguém rodar essa ferramenta. Falta conferir se fechar a janela do servidor
conta como encerramento ordenado.

**Achado B — backup de atualização herda o próprio pedido em CHECKING.** O
backup online copia o banco enquanto o pedido ainda está em CHECKING; no banco
migrado essa linha bloqueia o próximo backup de atualização (409 "Backup não
iniciado…"). Resolvido pela rota oficial
`POST /api/backups/upgrade/<id>/reconcile {confirm:true}` (criador morto
conferido → REFUSED), com o UUID lido do banco em modo somente leitura. A r88-12
herdou do mesmo jeito o pedido `fc225b0b-…`; a próxima atualização vai precisar
da mesma reconciliação.

Nenhum dos dois foi corrigido no código nesta rodada: mexem na segurança da
restauração e pedem decisão (liberar a reserva ao confirmar a ativação; marcar
o pedido copiado como encerrado ao preparar a cópia).

## 4. Soak de 8 h na r88-12

Iniciado 09:06 em `D:\RPlayout r88-12`, CSV
`D:\IA\Claude\RPlayout\soak-r88-12-20261021-0906.csv`. Primeiros minutos: três
viradas de item com 0 alertas. Resultado completo será anexado aqui.

## Limites

Sem vMix aberto, sem DeckLink, sem outra máquina; 8 h não substituem 24–48 h.

## 5. Soak r88-12 (parcial) e r88-13 (21/10 tarde)

Soak r88-12 interrompido às 13:02 para instalar a r88-13: 3 h 55 de grade em
LOOP, **0 alertas** em todas as amostras (correção do checkpoint confirmada),
API 70–250 ms, memória do servidor estável em 750–830 MB e engine em 560–680 MB
(sem crescimento), engine ~1,4 núcleo em média.

r88-13 (2a544f9; 13/13, Rust 125/0/4; instalador renomeado de `r88-2` para
`RPlayout-1.1-parcial-20261020-r88-13-instalador.zip`, SHA256
`16299FD4B1A12292BD2732C9B40DDD6991EEF45A8EE8CFDC7627ACDC6947E18B`; o script
reutilizou o nome `r88-2` porque os instaladores r88-2…r88-11 tinham sido
removidos da pasta). Correções: Aprovar/Ignorar do QC direto pela linha;
áudio (medidor e escuta) das entradas ao vivo no QC; QC ao vivo sem
referência ao PVW do Master; Biblioteca MAM só com VTs aprovados e entradas
ao vivo; categoria em lote (Ctrl/Shift+clique); duração de ao vivo editada no
horário de entrada recalcula a grade.

Atualização r88-12 → r88-13: o Achado A apareceu também aqui. O backup tirado
com a r88-12 ativada carrega a reserva MAINTENANCE viva; a revisão da cópia
recusou ("Revisão operacional recusada"). A ferramenta oficial na CÓPIA
(`r88-13 dados`) liberou (`RESERVATION_RELEASED_NOT_ACTIVATED`) e a ativação
passou (1 canal, 1 publicação, 4 mídias). Ou seja: hoje toda atualização a
partir de uma instalação já atualizada exige essa recuperação manual.
Achado B confirmado de novo (pedido `fc225b0b-…` reconciliado).
