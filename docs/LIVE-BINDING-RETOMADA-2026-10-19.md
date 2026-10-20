# 6.2 / 7.3 — fonte confirmada no checkpoint e na recuperação normal

Estado: **SOURCE_INTEGRATED / LOCAL_TESTED / NATIVE_MEDIA_NOT_RUN**.
Não é ativação do corte nativo nem instalador novo. Uso interno/testes,
sem distribuição, sem alteração do banco operacional ou dos binários instalados.

## Implementado

- live-program-binding.ts cria um vínculo da fonte alternativa somente com
  recibo COMMITTED correspondente a transação, geração, decoder e fonte.
  A conexão é criptografada pelo cofre existente, com nonce aleatório e AAD
  ligando canal, grade, revisão, execução/ocorrência, item, transação, ambos
  decoders, fontes, quadro confirmado e tipo. Não grava URL/credencial aberta.
- O checkpoint versão2 exige esse vínculo e uma live nativa ativa, da mesma
  revisão/execução/item, sem trim/pausa de arquivo e em quadro >= ao corte
  confirmado. Versão1 continua válida para os casos anteriores, mas não pode
  carregar o vínculo como campo descartável. Não houve migração de schema SQL.
- Checkpoints.write impede trocar versão2 por versão1 reproduzindo a mesma
  ocorrência: o poll normal não pode sobrescrever a fonte selecionada com a
  original. STOP explícito produz formato parado sem vínculo/trim/hold.
  A proteção existente de posse/predecessor continua valendo.
- Runtime valida envelope/contexto e recibo durável correspondente antes de
  registrar intenção de recuperação. Ausência, corrupção ou inconsistência não
  escolhem a fonte original por fallback. Mantida a política escolhida pelo
  usuário: retomar automaticamente do ÚLTIMO ponto salvo, sem extrapolar perda.
- EngineTransport.recover agora leva o vínculo pela fila real de recuperação,
  confere contexto e capacidade da nova instância e monta LOAD com a conexão
  confirmada e startOffsetFrames exato. URI vem do snapshot protegido, não do
  cadastro possivelmente editado. Mantém marcas/política do item publicado.
- Pending live retém o vínculo até o primeiro PGM confirmado; antes do callback
  de checkpoint ele passa ao snapshot ativo. Watchdog preserva esse vínculo
  no cursor de recuperação. TAKE normal posterior ou STOP confirmado o limpa.
- A fonte real do PGM é congelada na especificação montada; CUE usa sua própria
  seleção. O mesmo item pode estar em backup no PGM e principal no PVW, sem
  cruzar medidas, IDs de catálogo e indicação dos barramentos.
- Contrato de rollback declara formatos de checkpoint aceitos. Contrato antigo
  sem declaração recebe somente[1]; histórico r83 permanece explicitamente[1].
  Preparação E revisão final de rollback conferem o formato dos dados além do
  schema. Não apagam checkpoints nem reduzem versão para encaixar edição antiga.
- Retomada HA de vínculo alternativo é recusada explicitamente nesta fase:
  não remapear edição/fonte estrangeira como principal. Grupo8 continua v3.

## Evidência e limites

scratch/live-binding-recovery-245aeb4b/tests.json: **305/305 PASS**,9arquivos:
transporte186, recuperação25, checkpoints6, arquivo de canal10, HA cursor5,
vínculo22, journal22, cliente23 e rollback6.

Revisão final reforçou a consistência entre metadados do journal e seu recibo,
não somente a existência da linha. tests-final-focused.json: **70/70 PASS**,
vínculo23/recuperação25/journal22. Não são375testes únicos; o transporte não
afetado por essa última regra não foi repetido apenas por atualização de status.
Tipos do servidor completo PASS/exit0 após a revisão final.

SQLite dos testes é real local; dados de mídia e eventos do filho foram
simulados no transporte. Os testes demonstram o comando LOAD correto, quadro
salvo200/recibo anterior143, fonte reserva preservada e CUE principal independente;
NÃO demonstram pixels, PCM, seek/frame real, ABI, placa ou sinal externo.
Testes de envelope alteram metadados/ciphertext e conferem recusa sem segredo
na mensagem; testes de rollback conferem recusa sem modificar os registros.

Compilação isolada dos14executáveis JS PASS/exit0, em server deste lote.
rollback-contract.cjs --describe executado: contrato1,50migrações e formatos
[1,2]. Essa declaração cobre leitura/formato, não homologação audiovisual,
capacidade de um engine antigo, licença ou retorno instalado em Windows.

Hashes SHA256:

| Artefato | SHA256 |
| --- | --- |
| server/server.cjs | E5568ECDE9D9E43590DF45C4B514E78313030EDE61CE136F322CB89D899FED88 |
| server/rollback-contract.cjs | 2B61B9D32938FFC05CBE918B69B1C68DB6230B649F4C7F18CF08253C1CEAE0CE |
| server/storage-service.cjs | 9EB4D10D289F440A78ABE014108BF401CDE7AB282168AB613939949F74D70771 |
| src/domain/live-program-binding.ts | 8F6AA7B80FF1EE71EF7021D4C2727EC0F10F719F0863AB2187DFECAE560D0FC7 |

Servidores7A2/4E3 e evidências anteriores preservados. Nenhuma seleção de
empacotamento foi trocada automaticamente pelo candidato novo. Diff sem erro
de whitespace; avisos LF/CRLF não são validação funcional.

## Falta antes de ativar e entregar

1. Conectar NativeLiveReplacementWire PREPARE/COMMIT/CANCEL/STATUS ao filho
   e IDs/fila de EngineTransport, com ator/canal/posse e configuração reais.
   A fila de RECUPERAÇÃO já foi integrada; a fila de CORTE ainda não.
2. No fato de corte real, compor journal+vínculo+checkpoint em commit SQL único,
   depois aplicar o binding ao estado. Preservar relógio/CUE e não chamar
   confirmTake/onTakeConfirmed como se fosse outra ocorrência. Hoje o vínculo
   ativo é instalado pela recuperação normal; o corte em operação não o produz.
3. Resolver duravelmente STOP/incerteza e intenção abortada antes de qualquer
   envio. Limpar só o guard em memória não libera o journal UNCERTAIN.
4. Integrar controles/retornos da interface e atualizar rastreio/as-run da
   mudança de fonte dentro da mesma ocorrência. Endpoints antigos continuam
   METADATA_DECISION_ONLY; não foram convertidos em corte implicitamente.
5. Compilar/testar o Rust novo (12casos anteriores continuam NOT_RUN), validar
   perda de ACK/SQL/restart e captura audiovisual publicada; depois integrar
   interface, nativos e instalador interno no D:. Sem r88 nesta etapa.
6. Separadamente continuam remoto, Windows limpo, soak, revisão de termos dos
   runtimes e sinais externos indisponíveis; DeckLink física adiada, grupo8 v3.

Totais mantidos:10grupos/53verificações —8concluídas,34em andamento,
4pendentes,7v3. Não encerrar 6.2/7.3/10.4 por testes de contrato simulados.
