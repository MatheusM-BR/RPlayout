# Upgrade e retorno entre edições — r86/r87 — 17/10/2026

## Escopo e artefatos

Ensaio entre instalações reais já materializadas no D:, mesma conta e schema50.
Sem overlays, alteração de bancos operacionais, mudança de firewall, limpeza ou
publicação pública. Produto e ZIPs existentes não foram modificados: nesta etapa
mudaram somente verificadores/evidência/documentação, sem build por status.

- r86: `D:\RPlayout-builds\qa\r86-installed-20261016`, servidor
  `7D2568300761AE477A60A4C3C9B8EA26821D4680B3C840052117F5A98ED0348B`.
- r87: `D:\RPlayout-builds\qa\r87-installed-20261016`, servidor
  `3F52DE22CD416A920A273DE2489A3D3FF6A490B8BFBF2790E647B0101C7F030D`.
- Engine610E03E8 e launcher101A28C9 comuns, sem recompilar código inalterado.
  Servidores conferidos contra manifestos/recibos VERIFIED; r87 é edição posterior
  à r86 e tem implementação distinta de posse nativa, não só nome diferente.

## Origem r86 e atualização r87

`qa\launcher-native-XSsny6\result.json` PASS e conferência independente PASS:
source r86 instalada, ingestão/probe/arquivo/proxy/QC/publicação/CUE/TAKE reais,
pixels320×180 e PCM997Hz nos dois canais, SQLite/GStreamer do próprio pacote,
backup online sem trocar PGM e UUID consultado sem replay. Backup original
SHA256 `83907ef5d377913f54d92a9d8aac451dc7f4d19b08b575c8178a4451a41f59c2`.
Família própria parada e perfil QA restaurado.

`qa\upgrade-workflow-9u6OQd\result.json` PASS e conferência independente PASS:
ativação/adoção r87 autenticadas, mesmo item/revisão/execução/corte, PGM real com
imagem/áudio, RESTART do predecessor e segundo segmento nativo no cursor salvo.
Ativação `cb4799de-8bdf-492a-aad8-f96e4cf07d55` CONFIRMED; adoção
`f58cf348-5b72-401a-8942-f605071be1b9` UPGRADE_PROFILE_CONFIRMED.

Uma grade futura foi criada pela API APÓS a atualização, sem trocar o PGM:
`ea119565-c5e5-496f-8f21-8692697f7244`, nome contendo `ação Çãó`, data2099-12-31.
Ela não existe no backup r86. Nova cópia online autocontida SHA256
`c2514bb9fa2356482b410e2c7f54a71f8e56b454cf6571707c6900c3ea3fdfd1`,
pedido `4826c83c-2ffb-45d7-a49f-95766a7618a2` READY, contém a grade e dois
segmentos as-run, apenas um aberto. Consulta do UUID não repete a cópia.

## Etapas explícitas de segurança e tentativas preservadas

1. O snapshot online contém seu próprio pedido ainda CHECKING: READY só pode
   ser gravado depois de terminar/verificar a cópia. Na restauração ele aparece
   UNCERTAIN e impede novo builder até reconciliação explícita do criador parado.
   bQEZSUFAIL preservado: ativação e nova grade chegaram a funcionar, mas o QA
   omitiu essa etapa e recebeu409. Consulta ao banco confirmou só o pedido antigo
   CHECKING, sem novo pedido gravado. O roteiro corrigido9u6OQd chamou a API de
   reconciliação para o UUID exato, confirmou REFUSED e só então usou UUID novo.
   Sem edição SQL de estado, replay, remoção de arquivos ou afrouxamento do gate.
   STAGE/instalação já aprovados não foram repetidos na rodada afetada.
2. O snapshot r87 também conserva a reserva MAINTENANCE vigente na origem.
   pulcYZFAIL preservado: preparação de retorno r86 íntegra/histórico recente e
   sete tabelas de negócio iguais à cópia atual, mas revisão operacional recusou
   admissão ocupada, antes de ativar ou alterar perfil. A recuperação explícita
   da reserva deve ocorrer SOMENTE na cópia, com helper oficial e prova nativa
   de parada; não apagar registro nem liberar o banco original.

## Continuação da mesma preparação

`qa\compatible-rollback-FhtX7Y` continua a preparação de pulcYZ, sem recopiá-la.
A primeira solicitação não executou por falha temporária da revisão automática
de autorização; reenvio após o serviço voltar não contornou permissões.

Recuperação oficial PASS: RESERVATION_RELEASED_NOT_ACTIVATED, requestID
`1dbc0931-ead5-4946-bb99-ca638079c6d7`, revisão4, sem ativação ou promoção.
FhtX7Y terminou FAIL pelo orçamento de180segundos do QA durante a conferência,
com somente QA_JOB_ENTERED no log, antes de confirmar launcher. Família própria
encerrada/perfil QA restaurado. Não confundir esse prazo do roteiro com falha
de decoder, encerramento de um processo por observação expirada ou homologação.

O orçamento de conferência offline foi ampliado para600segundos, sem reduzir
hashes/revisões nem mudar deadlines nativos. Uma checagem nova exige AUSÊNCIA de
qualquer tentativa de ativação para o requestID restaurado, antes de continuar.
vLM1s1FAIL preservado: o verificador fechava cedo a conexão usada por validação
assíncrona de recibo; corrigido somente o ciclo de leitura, sem iniciar ativação.
zpPOhn continua a MESMA cópia de pulcYZ, reconhecendo a recuperação já existente
pelo diário autenticado. Não repete recuperação, exportação, STAGE ou instalação.

## Retorno concluído e conferência independente

`qa\compatible-rollback-zpPOhn\result.json` PASS e
`assertions-compatible-rollback.json` PASS, sem repetir a ativação para conferir.
Foi usada a r86 ORIGINAL (manifesto
`44C4B9B830DEA8193FCB7FBD67587A3FCA17D52921D0A5ECC7264EF3F99A679D`),
não outra cópia r87 renomeada. O controlador r87 restaurou o snapshot online
mais recente da r87; o baseline r86 serviu apenas para comparar IDs históricos.

- Ativação `823aaef7-155f-4958-9290-126b33a6a701` CONFIRMED e adoção
  `a6c68836-9771-4fb0-9c75-273699422e81` UPGRADE_PROFILE_CONFIRMED, recibos
  autenticados para requestID `1dbc0931-ead5-4946-bb99-ca638079c6d7`.
- Recuperação anterior reconhecida pelo evento autenticado
  `16dd3ac9-2a83-427f-ab41-b273b0506797`, revisão4, sem reexecutar recuperação.
  A origem permaneceu intacta; só a reserva da cópia foi recuperada.
- Sete tabelas de negócio iguais ao snapshot recente antes da ativação:
  media_assets,media_versions,qc_decisions,rundowns,rundown_items,
  operational_playlist_revisions,media_jobs. A grade criada APÓS o upgrade
  permanece idêntica e pode ser consultada pela API do destino r86; estava
  ausente no baseline antigo. Nome Unicode preservado.
- Mesmos execução/revisão/item/corte e retomada a partir do cursor do snapshot
  recente, não do baseline. Histórico: um registro novo e um alterado em relação
  ao baseline, zero IDs perdidos; após retorno, três segmentos totais e apenas
  um aberto. Interrupção recebe RESTART/duração UNKNOWN, sem inventar frames.
- Imagem recebida no monitor real320×180, desvio72,2924; PCM estéreo48kHz,
  28.800frames, tom997Hz em ambos os canais, sem usar apenas ACK/decoder como
  prova. Cursor observado posteriormente1206frames,25fps; não é medição de
  continuidade/fidelidade de saída física nem latência de corte.
- Após retorno, o pedido herdado `4826c83c-2ffb-45d7-a49f-95766a7618a2` foi
  reconciliado explicitamente pela API, sem replay. A r86 gerou novo backup
  READY `be04ce48-e913-4de6-a682-987beb5a38f6`,946176bytes, SHA256
  `fc6bd5b4a8335310b42b0ba75e207b79311de688f9c9b192b3997dc777a242a6`.
  Conferência independente confirmou journal DELETE, nova grade e as-run
  completos também nesse backup.
- Famílias próprias encerradas e perfil QA original r86 restaurado byte a
  byte. Esta restauração do perfil QA não é a prova do retorno: a prova é a
  operação nativa no binário r86 com o snapshot recente, recibos, dados e mídia.

O caso r86→r87→r86 está qualificado para esta combinação de schema/conta/arquivo.
Não reexecutar zpPOhn/pulcYZ por status: já há ativação CONFIRMED para esse
requestID. O verificador agora recusa continuar qualquer candidato que já tenha
tentativa de ativação, inclusive incerta/falha. Todos os FAILs foram preservados.

## Limites e matriz

Este caso, mesmo aprovado, não transforma schema inversamente, não qualifica
PGM/mídia/jobs legados migrados, perda física de energia, Windows limpo, estabilidade
prolongada ou protocolos/hardware externos. A recusa r86→r83 do ensaio anterior
continua FAIL; não herda a cobertura deste par. DeckLink física adiada; grupo8v3.
NDI SDK original indisponível; redistribuição REVIEW_REQUIRED e sem publicação.

9.3 e10.4 permanecem em andamento: faltam PGM/mídia/jobs legados migrados,
interrupção de migração, adoção interrompida depois de publicar candidato,
quadro PGM mantido, unknown-spawn/STARTING, energia e homologações restantes.
Não repetir este ciclo aprovado sem alteração relevante que o invalide.
Totais10grupos/53verificações:
8concluídas/34andamento/4pendentes/7v3; escopo atual9grupos/46verificações.
