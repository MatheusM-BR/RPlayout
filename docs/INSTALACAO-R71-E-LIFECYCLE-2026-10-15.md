# R71 — instalação real e diagnóstico do encerramento NDI/OMT

15/10/2026, horário local. Avanço em2.3/2.4/3.3/10.1/10.2/10.4, sem
encerrar os respectivos marcos gerais. Nenhuma funcionalidade do produto mudou
nesta rodada: controlador e verificador QA foram aprimorados. ZIP r71 intacto;
não é necessário outro pacote por alteração de evidência/documentação.

## Instalação e abertura do pacote atual

Arquivo: `release/RPlayout-1.1-parcial-20261015-r71-instalador.zip`,540199538bytes,
SHA256 `50F6DAFC8745E9F64A71D6707D807EDC8BC792556ECC429E95DC1DEC365E9973`.

`verify-installed-partial.ps1` executou o INSTALAR.ps1 efetivamente incorporado,
destino novo `scratch/r71-installed-qa-20261015`, atalhos próprios em
`scratch/r71-shortcuts-qa-20261015`. PASS/exit0. Recibo VERIFIED, catálogo e
materialização conferidos, perfil de dados/mídia isolado e sete alvos de atalhos
conferidos. Menu Iniciar/instalações/dados operacionais não alterados.

Preflight antes de criar:8994877440bytes disponíveis,2828450599 necessários
para bundle+instalação+margem QA. Conteúdo expandido1420614464bytes, estimativa
de instalação2154027840. Nenhum servidor iniciou automaticamente.
Evidência: `scratch/r71-install-evidence-20261015/result.json`.

`verify-portable-server.mjs`, executado pelo Node v24.16.0 instalado: PASS,
2513,0647ms, servidor/DB/cofre/acervo próprios, engine e saídas desativados.
PATH mínimo, sem PowerShell, NODE_PATH ou NODE_OPTIONS no filho. SQLite resolveu
dentro do pacote, HTTPhealth/interface/JS200, hash da interface igual ao arquivo
instalado. Servidor próprio encerrado antes de gravar a prova.
Evidência: `scratch/RPlayout-portable-server-WRguxl/result.json`.

Não é Windows limpo: o host tem componentes do sistema e runtimes previamente
instalados. Não é ensaio de upgrade, rollback, energia ou restauração de produção.

## O que o diagnóstico anterior não permitia concluir

No ensaio ABuYjy, o sender OMT registrou ao final:
`TAKE recusado: decoder da entrada recusou o sinal: Could not open resource for reading and writing.`
O controlador desligava broker/carrier antes dos emissores, sem horário/fase
por diagnóstico. Essa ordem podia produzir a falha, mas não provava quando o
registro histórico ocorrera. Resultado anterior continua PARTIAL_PASS e intacto;
não foi convertido retroativamente em PASS nem teve seu JSON editado.

## Novo ensaio causal, sem repetir a rodada visual

`verify-qc-native-input-browser.mts --lifecycle` agora oferece modo API/nativo
separado do modo de revisão no navegador. Usa web, servidor, engine, devices,
GStreamer e MediaMTX **da instalação r71**, sem overlays. Controlador/asserções
ainda usam ferramentas TypeScript do checkout para montar o QA; isso não cria
dependência de tsx/tsc para executar o produto instalado.

Pasta: `scratch/qc-native-browser-BS8rwI`. Hash do controlador executado:
`4D9382CDB038581286C57523A2588ED7477839E7FD1A34D9C1FB7620EE9718D2`.
Eventos datados por fase, estado antes de desligar e espera de encerramento
incluindo drenagem de stdout. Não usa PIDs históricos para encerrar processos.

1. Carrier sintético640×360/25fps/áudio2ch publicado no broker próprio.
   Emissores nativos NDI/OMT abriram esse carrier e confirmaram vídeo/áudio.
   Descoberta nativa real, sem inventar respostas de `/api/sources`.
2. API sintonizou cada fonte somente no PVW do canal QC. Receptor RTSP separado
   decodificou75quadros por fonte:428×240, desvios71,2806 NDI e71,2928 OMT.
   Todos os7snapshots persistidos exigiram onAirnull/playingfalse. Grade0/as-run0.
   Não foi aberto Master nem feito TAKE no canal QC.
3. Após limpar CUE, os dois emissores encerraram primeiro, mantendo o carrier/
   broker disponíveis. Ambos exit0/streams drenados; zero erros e zero eventos
   sourceLost observados na fase RUNNING; estado anterior tinha vídeo/áudio.
   Isso qualifica o cenário finito observado, não estabilidade prolongada.
4. Um **terceiro emissor OMT**, dedicado à injeção, iniciou saudável e sem erros.
   Desligou-se deliberadamente apenas o servidor/broker próprio, mantendo esse
   emissor aberto. Fronteira registrada em1792109898977ms Unix.
5. Primeiro sourceLost em1792109898993ms; depois erro idêntico ao diagnóstico
   investigado em1792109903081ms: **4104ms após a interrupção intencional**,
   fase EXPECTED_UPSTREAM_LOSS. A seleção do emissor permaneceu carrier;
   nenhuma seleção de item diferente foi inventada. Não se testou retorno do
   carrier/reconexão após essa falha nesta rodada.

O novo teste comprova que interromper a origem antes de encerrar um consumidor
reproduz essa mensagem, e que o encerramento ordenado observado não a produz.
Não prova o horário do evento antigo e não autoriza inferir que qualquer erro
similar em produção é causado por teardown. É preciso correlacionar horários,
identidade do decoder e disponibilidade real da origem em cada ocorrência.

Três emissores exit0, nenhum encerramento forçado; servidor/carrier/família
nativa próprios encerrados. Teste terminalexit0. Não foram reiniciados serviços
operacionais, alteradas contas/rede/firewall ou usadas mídias do operador.

## Evidência e resultado

`scripts/verify-r71-native-lifecycle-evidence.mjs` retornou **PASS** para:
instalador real, startup atual, descoberta+imagem PVW nativa instalada, ausência
de PGM/itens/as-run, encerramento ordenado sem erros, falha injetada reproduzida
na fase correta e cleanup completo. É verificador de provas já produzidas,
não outro replay de processos ou do navegador.

Arquivos em BS8rwI: `result.json`, `launch.json`, `assertions-r71-lifecycle.json`,
`ndi-lifecycle-last.jpg`, `omt-lifecycle-last.jpg` e logs próprios. Hashes das
provas de instalação/startup/nativo constam na asserção.

Binários: servidor5F33C58E, engine3F0C9616, devicesD7396F7C;
webDG6oIPgn/CD7665DE. HTTP do servidor também devolveu o JS instalado com esse
hash. Os códigos completos constam no resultado; sourceWebOverride e
devicesOverride são false. Controle gráfico/navegador **não reexecutado**.

## Pendências preservadas

2.x/3.3: equipamentos externos, outros protocolos, recuperação/estabilidade,
estação remota; DeckLink continua adiada. O ensaio não homologa PGM físico,
qualidade de áudio/cor, recepção entre máquinas ou todas as transições CUE/TAKE.
3.5/3.7: provas visuais anteriores continuam com seus limites; sem novo teste
de escuta/PCM, carga/tally/multiview ou interface instalada nesta rodada.
10.x: faltam Windows limpo, upgrade/rollback/recuperação guiada, liberação de
redistribuição/licenças e publicação final. Não transformar os controles locais
passados em conclusão de grupos inteiros. Grupo8 fica para v3.

C:7005999104bytes livres após os ensaios. Nenhuma exclusão ou migração feita.
Total mantido:10 grupos/53 verificações —7 concluídas,35 em andamento,
4 pendentes e7 adiadas à v3.
