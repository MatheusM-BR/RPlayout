# RPlayout 1.1 — escopo consolidado, funcionalidades e roteiro de operação

## Objetivo

Política de aviso live configurável por canal no Perfil técnico QC: chegada ao
decoder em intervalos de quadro e aquecimento, sem alterar TAKE ou critérios
de arquivo. Campo persistido/auditado com revisão existente.158 testes afetados,
tipos/build servidor/interface PASS; homologação interativa/física pendente.

Frente atual EXEC-03 integrada na fonte do backend/MediaMTX/engine/relays;
identidade nativa de encarnação e sockets antes/depois da prontidão HTTP.
Kernel b6c5b7/cliente 95b936 reais PASS, 8 Rust/24 IPC, rodada atual44 PASS.
Repetição final compilada sTtEOU recusou ACL antes de abrir MediaMTX; correção
com auxiliar Windows de arquivos embutido tem4 Rust reais PASS. Compilado final
gW0s1R PASS com engine/relay reais em loopback e recuperação do relay.
Fechamento local por cobertura com replay: integral2.168 PASS/10 FAIL em5
fixtures; após reparo apenas de testes,36/36 PASS,2.142 PASS inalterados fora
do replay. Total distinto2.178/221 arquivos; NÃO integral única verde.
Grupo1 fechado; sem homologação física/HA/navegador ou pacote final.
Inventário fixo em docs/PENDENCIAS-NUMERADAS.md: 10 grupos/53 verificações.
Grupo2 em andamento: canal18/18 PASS, OMT oficial local1/1 PASS,
arquivamento/posse47/47 PASS e replay nativo dirigido PASS. Engine atualizado
compilado; decoder por software padrão evita seleção automática do driver Intel
DXVA onde houve crash. Opt-in de aceleração requer homologação. Não é validação
física nem suíte integral única verde; falhas/replay/hashes registrados na matriz.
Totais:1 grupo concluído/9 abertos;4 verificações concluídas/12 em andamento/37
pendentes. Demais requisitos do relatório permanecem no escopo.
Grupo4 primeira integração compilada/nativa PASS: publicação/timing imutáveis,
corte automático prioritário, ajuste+120s, rollback com PGM preservado e retorno
VT desde cursor nativo357. Sem UI/hardware homologados;4.1..4.5 em andamento.
QC3.5 em andamento: inspeção live pela API compilada com imagem1280x720 e
áudio reais, preview428x240, sem conexão extra da fonte; navegador/arquivos
ainda não homologados. Cenário QC antes do PGM passou na rodada25502 com
servidor DE7F54E e resultado persistido pós-cleanup. A captura anterior sem
terminal mantém atribuição histórica incompleta; não é usada como aprovação.
QC3.7 em andamento: validade temporal de pixels live e cadência de scopes
corrigidas;21 testes/tipos/build web PASS. Medição de consumo/responsividade
remota e freeze por conteúdo ainda não homologados.
Os2135 PASS e compilado EXEC-02 abaixo não validam a fonte nova.

Checkpoint anterior EXEC-02 validada localmente: proteção global de MediaMTX/config/relays
no SQLite compartilhado, migração33. Não transfere posse por prazo e aguarda
exit real antes de reiniciar/substituir recursos. Instância alheia não altera
distribuição nem transporte; configuração privada revalida antes de publicar.
33 novos; direcionadas70/45 PASS sobrepostas e final7 arquivos/82 PASS;
tipos/build44153 e compilado12975/9BJZRR com MediaMTX real local PASS.
Integral3978 terminal215 arquivos/2135 testes PASS,803,16s, um worker;
reporter persistente conferido e hashes iguais ao compilado. Não comprova isolamento entre
bancos, propriedade de portas/API, sinal físico ou HA. Nenhum deploy/push.
Os2102 PASS/ensaios seguintes são históricos EXEC-01, não prova da fonte atual.

Checkpoint anterior EXEC-01: proteção de execução nativa por vida de processo,
token de spawn e identidade opaca do SO, migração32. Peer não abre segundo
engine nem envia CUE/TAKE/STOP, não sobrescreve cursor nem encerra as-run alheio.
56 novos/213 direcionados PASS, tipos/build e ensaios nativos locais yop8U7 e
sN053O PASS; integral final212 arquivos/2102 testes PASS,08h29m52 BRT,750,21s,
um worker, reporter persistente conferido. NULL/fakesink com vídeo
sintético real, não prova de placa/rede/HA. O predecessor engine não sobreviveu
ao pai no compilado; caso órfão vivo é teste de fixture, não ensaio físico.
A build SEC-22I abaixo é histórica. Permanecem legado/reparo explícito,
diagnóstico na interface, posse global MediaMTX/relays, outros contratos,
homologação física/visual e pacote portátil atualizado. Nenhum deploy ou push.

A versão 1.1 organiza o produto como um aplicativo de operação: o Master mantém o PGM protegido, janelas secundárias cuidam de playlist/gestão, e cada estado crítico tem confirmação visual e registro.

Checkpoint local anterior: SEC-22I, 06/10/2026 — remoção/limpeza conferidas,
fallbacks preservados, fila nativa reservada antes do microtask e override MAM
limitado à revisão/hash originais. QC por canal invalida conferência antiga;
fase durável desconhecida não presume canal livre. 89 testes novos, última
direcionada117 PASS, tipos/build e compilado kYCBbt PASS. Integral final I PASS:
209 arquivos/2046 testes,07h07m14 BRT,867,80s. Relatório persistente conferido;
2038 PASS intermediários pertencem à fonte anterior ao complemento. Não é pacote
final ou homologação de hardware/navegador/HA. Ver checkpoint ao final.

Estado de referência histórico: 03/10/2026. A matriz
`IMPLEMENTACOES-BROADCAST-2026-09-30.md` distingue implementação, teste de
software e homologação física. As notas de bundles ao final são históricas;
não identificam a versão portátil em operação. O pacote r18 é intermediário,
não encerramento de todos os requisitos.

## Evidência visual do estado atual

### Monitor WebRTC e áudio

![Tela do monitor PGM](screenshots/webrtc-pgm.png)

A tela mostra vídeo no endpoint MediaMTX, mas o fluxo exibido não deve ser considerado prova de áudio no painel até a trilha ser confirmada no SDP WHEP.

### Conflitos e rodapé

![Área de conflitos](screenshots/conflitos-rodape.png)

O conflito precisa ocupar uma área própria, com altura mínima e rolagem interna; o rodapé não deve repetir o arquivo selecionado.

### Marcação IN/OUT

![Janela de marcação](screenshots/trim.png)

A janela 1.1 deve usar largura menor, vídeo e régua no mesmo quadro e ações fixas no rodapé.

## Funcionalidades da 1.1

### Inspeção em qualidade no QC

- Preview leve é padrão; **Ver em qualidade** carrega o original do clipe
  escolhido, sem aprovar nem enviar ao PGM. **Voltar ao preview leve** reduz
  novamente o consumo. Tela cheia e safe area (desligado por padrão) são
  controles de inspeção, não de saída.
- Se o navegador não decodificar o original, a inspeção informa quadros JPEG
  de até 4K, sem playback contínuo ou conferência de áudio. Essa opção não é
  qualidade original de fonte ao vivo. A homologação visual/playback permanece
  separada dos testes de entrega de arquivo/quadro.
- Os indicadores identificam proxy, player do original, quadros JPEG ou
  preview ao vivo. Quadros mostram **SEM ESCUTA**; alternar qualidade limpa
  medições anteriores. Scopes são amostras visuais aproximadas, não uma
  certificação de cor; loudness de arquivo continua vindo da análise técnica.

### Configuração de canal por revisão conferida

- A edição conserva os campos e a revisão de quando foi aberta. Alteração
  posterior no canal ou nas saídas impede gravar uma tela antiga, sem perder
  o rascunho. **REABRIR CONFIGURAÇÃO DO SERVIDOR** pede confirmação antes de
  descartar somente os campos locais; não altera a grade nem dá TAKE.
- Simulação de FPS inclui o formato escolhido. Mudar os campos depois da
  simulação exige nova revisão; mesmo voltar ao valor anterior não valida uma
  confirmação antiga. FPS/total de áudio exigem STOP, CUE limpo e republicação.
- Gravação e auditoria são juntas. O reinício posterior é uma etapa separada:
  se falhar, a tela informa que a configuração foi gravada e pede conferência,
  sem anunciar sucesso do sinal ou fingir que o banco foi revertido.
- Esta proteção cobre a configuração de canal/FPS; revisão dos outros
  controles e homologação visual/física continuam na matriz de pendências.

### Presets de transmissão por configuração conferida

- Salvar, aplicar ou remover um preset SRT/RTMP exige a configuração que foi
  consultada. Mudança posterior de canal, saída ou preset recusa a confirmação
  antiga; atualizar a lista não reconfirma os campos já digitados.
- **REABRIR CONFIGURAÇÃO E LIMPAR RASCUNHO** pede confirmação antes de descartar
  os campos e consultar a configuração atual. Erro de consulta preserva a lista
  anterior e informa a falha, sem anunciar que não existem saídas.
- Dados, revisão e auditoria são gravados juntos. Aplicar cria uma saída e
  solicita reinício controlado; falha posterior do engine é aviso de cadastro
  realizado, não rollback. Confira imagem e entrega no destino. **HABILITADA**
  significa configuração ligada, não confirmação de sinal no ar.
- Remover um preset não remove saídas criadas a partir dele. As credenciais
  continuam protegidas; protocolo e URL precisam corresponder. Esta etapa
  não substitui a homologação de hardware/rede nem fecha as demais pendências.

### Pares de áudio do PGM / SDI

- Em **Formato do canal**, selecione 2, 8 ou 16 canais. Alterar o total exige
  PGM parado e CUE limpo; as grades precisam de revisão e nova publicação.
  Não há TAKE automático nem descarte silencioso de atribuições incompatíveis.
- Em **Áudio e canais** do item, o master permanece na saída 1–2. Para cada
  auxiliar, selecione um par da trilha de entrada e ganho independente. Sem
  atribuição = silêncio. Confirme o conteúdo real antes de chamar um par de
  SAP, clean feed ou audiodescrição; o produto não infere essas funções.
- Ganho AUTO e medidores verificam o master. Preview e publicadores de rede
  usam 1–2, sem misturar os auxiliares. Atribuições seguem o escopo conferido,
  são congeladas na publicação e alteração após CUE exige nova preparação.
- SDI físico/DeckLink e uso visual desta configuração ainda precisam de
  homologação. Testes nativos e servidor compilado não substituem uma placa
  recebendo o sinal. O pacote r21 não contém esta integração posterior.

### Acesso e administração

- Login por usuário e senha pode ser ativado com `RPLAYOUT_ADMIN_USER` e `RPLAYOUT_ADMIN_PASSWORD`. Após autenticar, a sessão abre a tela do operador e mostra o papel ativo; **SAIR** encerra a sessão.
- **USUÁRIOS** abre o gerenciador para criar contas com papel e ativar/desativar acesso.
- **SAÍDAS E PROCESSOS** reúne distribuição e monitoramento por canal, uso, PID, CPU, memória e estado.

### Organização de playlists

- **PLAYLISTS** abre uma tela separada da operação Master para importar M3U/M3U8/CSV/TXT, filtrar por data, ordenar e remover entradas, escolher data/horário, revisar arquivos ausentes, publicar e baixar a programação em CSV.

### Operação Master

### Aplicativos independentes e servidor 24/7

O servidor do RPlayout pode permanecer ligado sem interface com `RPlayout-Server.exe`. Os clientes são aplicações independentes conectadas à mesma API: `RPlayout-Master.exe`, `RPlayout-Schedule.exe`, `RPlayout-Users.exe`, `RPlayout-Monitor.exe`, `RPlayout-Aired.exe` e `RPlayout-QC.exe`. Fechar uma janela cliente não encerra o servidor nem o canal no ar.

- PGM, PVW e estado de saída no topo do painel direito.
- Grade central com estados inequívocos: NO AR, PRÓXIMO, PREPARADO, INDISPONÍVEL e ERRO.
- CUE prepara o item escolhido no PVW; TAKE envia esse CUE confirmado ao PGM.
- Próximo é a sequência automática da playlist, não substitui silenciosamente o CUE.
- Sem quadro válido, o engine conserva o PGM anterior e informa a falha.
- LIMPAR CUE / PVW não para o PGM. Para carregar outra grade, pare a execução e limpe o CUE de item da grade anterior. A ativação não pode ultrapassar um TAKE pendente.
- Acompanhamento PGM fixado, com bloqueio total de rolagem enquanto ativo.
- Aired distingue transporte nativo, simulado e legado desconhecido; duração por cursor do engine, estimativa de relógio ou N/D. TAKE/parada não são fim normal do arquivo. Não emite certificado regulatório nem comprova transmissão física por si só.
- Conflitos em painel dedicado com altura mínima de 220 px.

### Áudio e vídeo

- PGM WebRTC deve negociar vídeo e áudio no mesmo SDP.
- Speaker inicia mutado; clique explícito libera áudio por política do navegador.
- Estado do áudio: recebido, mutado, ausente ou erro de codec.
- VU permanece evidente; detalhes ficam recolhidos.
- IN/OUT aparecem na régua, nunca como linha sobre o quadro.

### Acervo

- Adição de pasta pelo explorador remoto dentro da página: ele lista pastas na máquina onde o servidor está rodando, inclusive caminhos Unicode. Não abre o seletor do Windows no servidor nem seleciona uma pasta local do computador de controle.
- Nome exibido é o nome da pasta selecionada.
- Remoção de pasta sem apagar os arquivos da grade.
- Ignorados mostra somente vídeos e respeita a busca. Documentos, imagens e áudio não são classificados como vídeo só porque a sonda falhou.
- A sonda identifica o conteúdo; a lista de extensões serve para reconhecer possíveis vídeos avariados, não garante suporte universal a codecs. Importação universal de vídeo continua prevista para v2.5.
- Pasta ausente continua registrada como indisponível até nova reconciliação.

### Playlist 24 horas

- Tela `PLAYLIST 24H` separada do Master.
- Leitura/importação de `.m3u`/`.csv` via seletor de arquivo.
- Pré-visualização de itens, duração total, entradas sem acervo e conflitos.
- Modos: inserir no fim, publicar a partir do próximo item e substituir o futuro.
- Histórico de versões e desfazer.
- Operador de playlist não altera PGM sem publicar explicitamente.

### Usuários e acesso

- Configuração acessível em `Configurações > Usuários e acesso`.
- Papéis: Operador, Programador, Supervisor e Administrador; configuração de canais/saídas exige Supervisor ou Administrador.
- Ações de risco exigem permissão e entram na auditoria.
- Retirar um canal agora significa arquivá-lo: pare o PGM e limpe o CUE antes. Grade, publicações e ocorrências permanecem disponíveis no histórico. Reativar exige Supervisor/Administrador e não inicia engine nem faz TAKE; reaplica a distribuição previamente configurada.
- Aired permite consultar canais arquivados autorizados sem selecioná-los para operação. Contas sem canal ativo autorizado também podem abrir Histórico e Auditoria.
- Auditoria mostra solicitações e decisões permitidas à conta, com erro de consulta explícito e exportação CSV protegida. Uma solicitação registrada não comprova execução física; não é cadeia assinada nem certificação regulatória.
- Troca ou revogação de sessão limpa a operação da tela e descarta inicialização atrasada da sessão anterior. Isso não para o PGM no servidor; uma conta sem canal ativo autorizado não herda a grade da conta anterior.
- Troca de canal/conta também descarta respostas antigas e comandos ainda na fila. Um comando já enviado pode ter sido executado: consulte o estado atual antes de repetir; não há reenvio automático.
- Auditoria limita a consulta aos canais permitidos e oferece exportação CSV.

### Conversão de FPS do canal

- Alterar FPS em Formato ou Configurações abre uma simulação: grades, itens, eventos, cortes herdados e erro máximo de arredondamento.
- Pare o PGM e limpe o CUE; resolva antes qualquer VT interrompido aguardando retorno. Confirme somente após revisar o impacto. Se a grade ou a mídia mudar, recalcule.
- A conversão preserva segundos aproximados com aritmética racional; cortes herdados ficam explícitos no canal, sem alterar o acervo ou outros canais. Publicações e as-run antigos permanecem na cadência histórica.
- O canal fica parado e as grades exigem nova publicação em PLAYLIST. Revisões antigas de outra cadência — ou sem FPS conhecido após conversão — não podem ser usadas em rollback operacional. Nenhum TAKE é feito automaticamente.
- Confira saídas com FPS explícito e o perfil de QC separadamente. Um erro de reconstrução do engine após a conversão é informado sem dizer que o banco voltou ao estado anterior.

### Monitor de entradas

- Cadastro ou descoberta não confirmam sinal e não significam CUE ativo. Engenharia distingue entrada não monitorada de fonte aberta sem vídeo recente.
- CUE de item ou fonte direta identifica o PVW; o item confirmado no PGM identifica o programa. NDI, OMT e SDI usam as medições nativas, não dependem de telemetria SRT para exibir formato/FPS/sinal.
- A imagem compartilhada usa o monitor de baixo consumo do barramento observado, sem abrir um segundo decoder de entrada ou fazer TAKE. Medição ausente/simulação não é sinal físico confirmado.
- Preenchimento na timeline abre a revisão de proposta. Só a aplicação explícita altera a grade; a rota antiga de gap não insere item vazio nem anuncia tempo resolvido antes da revisão.

### Desempenho

- PGM/PVW e saídas de monitor sob demanda.
- Fechar uma janela de monitor encerra somente sua sessão WHEP.
- Saídas RTMP/SRT/NDI/SDI desligadas por perfil não criam pipeline.
- Processos exibidos por canal e por uso.

## Roteiro de operação

1. Abra `rplayout-test.exe`.
2. Selecione o canal no topo.
3. Em `Configurações > Usuários e acesso`, confirme seu papel.
4. Em `Acervo`, escolha a pasta no explorador remoto da página, que navega no servidor.
5. Abra `PLAYLIST 24H`, selecione a lista e confira os itens sem arquivo.
6. Publique no próximo item ou insira no fim.
7. Selecione o item publicado no Master e clique `CUE`; confira sinal no PVW antes do TAKE.
8. Confira o PVW e clique no speaker somente se precisar ouvir.
9. Clique `TAKE`; confirme PGM, VU, entrada, término e Aired.
10. Ative `PGM FIXADO` para acompanhar o item no ar.
11. Corrija conflitos pelo painel direito.
12. Use `Auditoria` para conferir ações e exportar o relatório.
13. Feche o launcher para encerrar a árvore de processos.

## Critérios de aceite 1.1

- O endpoint `/test-1/pgm/` apresenta áudio audível e a mesma trilha é indicada no painel WebRTC.
- PGM/PVW exibem agulha/régua de posição sem linha sobre o vídeo.
- A marcação IN/OUT cabe em uma janela menor que a área útil do operador.
- O painel de conflitos ocupa área visível e não fica reduzido a uma linha.
- A tela Master não é alterada ao editar/importar uma playlist em janela própria.
- Um arquivo de playlist de 24 horas pode ser importado, validado, publicado e desfeito.
- Usuários, papéis e auditoria estão acessíveis sem procurar a engrenagem.
- `pnpm test`, `pnpm typecheck`, `cargo test` e build de produção passam.
- O launcher serve o hash do bundle que acabou de ser compilado.

## Estado desta entrega

A base existente já contém autenticação, usuários, auditoria, histórico de playlists, seletor de pastas, reconciliação do acervo, Aired e testes automatizados. Os itens de áudio WHEP no fluxo `test-1`, régua/agulha dos monitores, importação nativa de playlist 24h e painel Master/Playlist separado permanecem como os próximos blocos de implementação da 1.1; eles não devem ser considerados concluídos apenas porque existem componentes parciais.

## Atualização desta revisão

- A rota do PGM agora aponta para `path.program`, a mesma origem que deve ser usada para validar áudio no MediaMTX.
- A grade ganhou uma régua de posição do PGM baseada em duração/tempo restante.
- A janela de IN/OUT usa classe própria com largura máxima de 820 px.
- Conflitos usam `conflicts-body` com altura mínima de 220 px.
- Bundle validado nesta revisão: `index-DjQI8g3c.js` e `index-CBYKegOc.css`.
- Testes repetidos: 21 arquivos / 164 testes TypeScript aprovados; typecheck aprovado.


## Implementação adicional concluída

- `PLAYLIST 24H` agora possui botão `IMPORTAR ARQUIVO 24H` com seletor nativo do navegador/Windows.
- O arquivo é lido localmente, enviado para `/api/playlists/read`, validado contra o acervo e exibido com entradas sem mídia antes da publicação.
- A publicação usa o conteúdo importado e mantém os modos existentes de inserir no fim ou publicar no próximo item.
- Bundle desta etapa: `index-CcINIJHs.js` e `index-CBYKegOc.css`.

## Programação por janela de horário

A montagem automática agora aceita `preencher até (horário)`. Ao informar, por exemplo, `18:00`, o sistema calcula os minutos entre o relógio atual e 18:00 e gera uma proposta explicável usando as regras de pauta, categorias e intervalo para não repetir. O operador visualiza a proposta antes de aplicar; o botão `montar o dia` continua preenchendo todas as faixas cadastradas.

Bundle desta etapa: `index-BOGifIoI.js` e `index-CBYKegOc.css`.

## Tela separada do operador

A janela de Playlist 24h agora oferece `abrir tela do operador`. Ela abre uma nova aba com `?workspace=playlist` e inicia diretamente o workspace de playlists, permitindo que outro usuário organize/importa a programação sem ocupar a tela Master. A publicação continua exigindo a ação explícita e é registrada no histórico/auditoria.

Bundle desta etapa: `index-DfogDzRJ.js`.

## Revisão manual da playlist importada

Cada entrada importada pode ser movida para cima/baixo ou removida apenas da publicação atual. O arquivo original não é alterado; a ordem revisada é enviada ao servidor no momento de publicar.

## Visão de programação diária

A playlist importada agora exibe o horário calculado de cada entrada. O operador define o início do dia (por exemplo, `00:00` ou `06:00`) e a tela calcula a hora de entrada de cada item a partir das durações, mantendo a revisão de ordem, remoção e publicação.

Bundle final desta etapa: `index-CEsQ-L1U.js` e `index-B67tZCT4.css`.

## Estado da etapa atual

- Filtro de playlists por data adicionado.
- Programação diária exportável em CSV.
- Workspace separado do operador disponível por `?workspace=playlist`.
- Botão `PROCESSOS` acessível no Master.
- Importação, ordenação e remoção de entradas revisadas antes da publicação.
- Build fonte validada em 01/10 às 21h52: `index-MsMdIFmt.js` e `index-BWCnttOE.css`. Pacote r21 é um snapshot anterior às proteções assíncronas e à atualização do monitor; não foi sobrescrito.

## Persistência da data de programação

A data escolhida no workspace agora é enviada ao servidor ao publicar a playlist e gravada em `playlist_versions.scheduled_date`, preservando a agenda por dia no histórico e permitindo futuras consultas/calendário.

## QC: inspeção em qualidade

Acima do player de arquivos, **Ver em qualidade** abre a versão original selecionada para conferência. **Voltar ao preview leve** retorna ao proxy econômico. Tela cheia permanece disponível e a área segura nasce desligada. A inspeção não aprova o material nem envia TAKE ao PGM. O original consome mais rede/processamento e depende dos codecs do navegador; quando não há decodificação, a inspeção por quadros JPEG até 4K é identificada como não contínua, sem prova de áudio. Esta opção não eleva entradas ao vivo para alta qualidade.

## Saídas: configuração confirmada e operação inconclusiva

Alterações de saída usam a configuração conferida na abertura. Uma edição externa exige reabrir explicitamente o rascunho; atualizar a lista não substitui sua revisão. Uma troca de publisher pode interromper brevemente essa saída e só é gravada depois do ACK, sem anunciar homologação do sinal no destino. Habilitar, remover e trocar formato podem exigir reinício controlado.

Se o resultado da troca/retorno for desconhecido, a tela mostra a operação inconclusiva e bloqueia novas mudanças. Pare PGM e limpe CUE antes de **Reconciliar configuração parada**: a ação reabre os perfis gravados, sem TAKE automático. Se processos anteriores ainda estiverem vivos/desconhecidos ou pertencerem a outra máquina, não há liberação automática. Essa cerca de configuração não é redundância ou fencing entre servidores broadcast. Preview e monitor permanecem reduzidos, até 15 fps/450 kbps; qualidade de aprovação pertence ao QC, não ao PGM/PVW padrão.

## Retorno de VT interrompido: decisão conferida e TAKE inconclusivo

**Retomar no PGM** usa a última posição informada pelo engine, não promete o quadro físico exato da interrupção. O pedido é registrado antes do TAKE; uma repetição com o mesmo identificador consulta o resultado sem executar novamente. Mudança de execução, edição, configuração, mídia ou QC exige nova conferência. Sessão e acesso ao canal são reconferidos também depois da preparação, antes do envio.

Falha antes do TAKE mantém o retorno disponível. Resultado desconhecido depois do envio permanece **inconclusivo**, inclusive após reiniciar; não é automaticamente liberado nem repetido. Novos TAKEs e recuperação automática ficam bloqueados. Depois de parar PGM e limpar CUE, um Supervisor/Administrador pode **Encerrar pendência com PGM parado**: isso não confirma sucesso nem reabre o cursor. Processos anteriores vivos/desconhecidos ou de outra máquina impedem o encerramento. Pendência antiga sem registro de posse não é liberada automaticamente.

A consulta das pendências também aparece na página quando o bloqueio impede carregar o engine/grade. Depois da conferência e do encerramento explícito, **Tentar novamente** reabre a página; não inicia automaticamente o PGM. Uma simulação é identificada como simulação, sem confirmação de programa nativo ou sinal físico. Descartar retorno preserva o histórico e não corta PGM.

## Inserção urgente: Próximo / Agora

No Master, abra **INSERÇÃO OPERACIONAL · PRÓXIMO / AGORA**. Escolha vídeo ou entrada cadastrada; a entrada usa o nome selecionado e pede duração estimada. Confira a ação e os conflitos antes de confirmar. O vídeo passa pelas regras de QC do canal. A operação cria uma nova edição de execução sem publicar outros rascunhos da grade nem copiar eventos de equipamento.

**Próximo** insere após o item atual sem mudar PGM ou CUE. O avanço continua respeitando Auto Next/loop do atual: se ele está em hold/manual, a inserção não ativa avanço automático. **Agora** só fica disponível com engine nativo e corta depois da confirmação do novo item no PGM. Fonte descoberta ou comando aceito não comprovam quadro. Se um VT foi interrompido, o retorno fica registrado com a última posição reportada.

Pedido repetido com o mesmo identificador não envia outro TAKE. Depois de erro de comunicação, a página consulta o registro original, sem repetir a operação. Resultado inconclusivo permanece bloqueado após reiniciar. Pare PGM e limpe CUE, depois use a reconciliação de configuração em Distribuição com Supervisor/Administrador. Isso encerra a cerca sem confirmar retroativamente o TAKE e sem reproduzir o pedido; processos anteriores vivos/desconhecidos impedem a liberação. O timing é atualizado ao executar, e conflitos precisam ser corrigidos conforme a operação real.

## Espelho entre nós e cópia de mídia

Em Distribuição → Redundância, o painel **Espelho de operação entre nós**
mostra sequência, confirmação, contagens de estado/as-run e cópias SHA. Esse
painel não autoriza assumir o canal. O reserva fica sem engine/PGM; escolher
um par de fontes SRT também não promove uma máquina reserva.

A configuração é opcional e requer duas instalações com banco e cofre próprios.
Não copie `vault.json` de uma conta Windows para outra como chave de pareamento.
Mantenha a chave de recuperação de cada instalação separadamente.

| Variável | Configuração |
| --- | --- |
| `RPLAYOUT_HA_ROLE` | `PRIMARY` no primário; `STANDBY` no reserva |
| `RPLAYOUT_HA_CLUSTER` | Mesmo identificador em ambos os nós |
| `RPLAYOUT_HA_NODE` / `RPLAYOUT_HA_PEER_NODE` | Identificadores distintos e invertidos no outro nó |
| `RPLAYOUT_HA_KEY` | Mesma chave aleatória de 32 bytes, 64 caracteres hexadecimais; diferente do token admin e da chave de cofre |
| `RPLAYOUT_HA_PEER` | URL HTTP/HTTPS do reserva, somente no primário; sem credenciais, query ou fragmento. Preferir HTTPS em rede externa |
| `RPLAYOUT_HA_DB` | Banco HA separado do operacional; padrão `.ha/<nó>.db` ao lado do banco principal |
| `RPLAYOUT_HA_MEDIA_ROOT` | Pasta própria para as cópias; padrão `media` ao lado do banco HA. Deve suportar hardlinks no mesmo volume, como NTFS |
| `RPLAYOUT_HA_MEDIA_QUOTA_BYTES` | Quota reservada, incluindo parciais; padrão 200 GiB |
| `RPLAYOUT_HA_MEDIA_MBIT` | Limite de transferência de mídia de 1 a 1000 Mbit/s; padrão 8, contando envelope criptografado na rede |

Cada opção incompleta/incompatível é recusada: não use o banco operacional como
espelho nem altere pareamento/pasta para reutilizar contadores e parciais de
outro nó. Vídeo, áudio e imagem usados nas edições publicadas atuais/futuras
ou na execução/contingência são copiados por hash; rascunhos e mídia apenas
histórica não são transferidos implicitamente. Original alterado sem nova
edição é recusado. A transferência independe do heartbeat/checkpoint.

Depois de interrupção, a cópia retoma o offset confirmado. **Arquivo parcial
ou SHA incorreto não é mídia pronta**. A pasta não recebe caminhos arbitrários
do outro computador e arquivos existentes não são sobrescritos. Quota esgotada,
origem ausente ou cópia reprovada aparecem como falha; arquivos antigos e
parciais são preservados, sem limpeza automática para esconder o problema.

Contagem de cópias não comprova QC, sinal físico, codecs no reserva ou saída
ativa. Promoção, fencing externo, handoff de as-run e failover
físico continuam pendentes; não há botão de takeover nem promoção automática.
O ensaio atual foi entre dois processos compilados locais, não duas máquinas.

### Testemunha e concessão curta do engine

Na primeira partida, a descoberta de plugins de um registro GStreamer novo
pode levar mais tempo que a abertura normal do canal. Antes do `Ready` nativo,
o servidor admite até 90 segundos e os comandos aguardam a confirmação real;
não anuncia sinal nem envia TAKE por aceitar a ordem. Depois do `Ready`, o
primeiro quadro tem prazo de 20 segundos; em regime, o watchdog mantém três
segundos observados sem progresso. Esses prazos do servidor não prolongam a
concessão HA nativa. Fechamento/queda recusa comandos que estavam aguardando;
eles não são enviados automaticamente ao processo substituto.

O pacote inclui `apps/server/dist/ha-witness.cjs` e
`start-rplayout-witness.ps1`: a testemunha usa Node e SQLite incluídos, sem
tsx, tsc ou instalação de módulos. É um serviço independente; não inicia
Master, engine ou saída PGM. Para isolamento de falhas, deve operar em um
terceiro host. Não é iniciada automaticamente junto ao servidor.

Configure no ambiente da conta do serviço:

| Variável | Configuração |
| --- | --- |
| `RPLAYOUT_WITNESS_DB` | Caminho exclusivo de dados fora do pacote, diferente do banco operacional/HA; arquivos existentes de outro serviço são recusados sem conversão |
| `RPLAYOUT_WITNESS_CLUSTER` | Mesmo identificador de cluster dos dois nós |
| `RPLAYOUT_WITNESS_NODES` | Dois identificadores distintos, separados por vírgula, correspondentes aos nós |
| `RPLAYOUT_WITNESS_KEY` | Chave aleatória de 32 bytes em 64 caracteres hexadecimais, distinta do pareamento HA e do cofre |
| `RPLAYOUT_WITNESS_HOST` / `RPLAYOUT_WITNESS_PORT` | Padrão `127.0.0.1` / `4051`; escute em interface autorizada quando os nós forem remotos |

Execute `start-rplayout-witness.ps1` na raiz do pacote. Proteja as permissões
da conta/pasta/configuração; a chave não é passada em argumentos nem exibida
no console. Não distribua chaves reais dentro do ZIP/manifesto. As requisições
são autenticadas; HTTP não cifra a rede. Use HTTPS/rede restrita na exposição
remota e não encaminhe o endpoint indiscriminadamente à internet.

Em cada nó, configure conjuntamente `RPLAYOUT_HA_WITNESS` (URL da testemunha)
e `RPLAYOUT_HA_WITNESS_KEY` (a mesma chave exclusiva da testemunha).
Configuração parcial ou chave igual ao pareamento é recusada. Sem ambas as
variáveis, o engine não passa a exigir concessão por mera existência do serviço.

O engine protegido só inicia os pipelines após confirmação de posse. O prazo
é contado pelo relógio monotônico nativo a partir da emissão do pedido, não
da chegada da resposta. Se a concessão deixar de ser renovada, o processo
encerra com código 75; uma resposta atrasada não o reativa. Reinício da
testemunha preserva termos e impõe quarentena de seis segundos.

O painel mostra termos e falhas, não um certificado de saída física. Esse
controle pode interromper a emissão quando a testemunha/rede fica indisponível.
Não preserva disponibilidade sozinho nem comprova retirada de pacotes em voo,
comutação de roteador, promoção do reserva ou failback. Esses fluxos e sua
homologação física continuam pendentes. O verificador portátil exercita posse
exclusiva, expiração nativa e reinício da testemunha com saída null local.

### Ensaio de restauração no reserva

O administrador pode usar GET `/api/ha/rehearsal` para consultar os últimos
relatórios e POST no mesmo endpoint para ensaiar uma sequência espelhada.
O corpo contém apenas `requestId` (UUID único), `channelId` e `sequence`
(sequência atual do reserva). Exige banco HA persistente e separado; sessão
e acesso ao canal continuam obrigatórios. Pareamento não autentica essa ação.
Não há botão de takeover ou ensaio na interface nesta etapa.

O ensaio revalida as cópias locais por SHA e reconstrói publicações/cursor/QC
num banco novo exclusivo sob a pasta `rehearsals` do banco HA. Banco local
e primário não são alterados. Arquivos parciais, alterados ou edição superada
recusam o trabalho; não são apagados/substituídos. O relatório RESTORED não
significa canal no ar: o cursor fica parado, canal arquivado, sem saídas,
contas, inputs ou comandos de equipamento executáveis. O marcador do banco
de ensaio impede runtime mesmo se o canal for desarquivado depois.

A aprovação de QC precisa ser uma decisão explícita para aquele hash/canal
(ou global @all); APPROVED legado não libera automaticamente a cópia. Com
`RPLAYOUT_PROBE` configurado, o ensaio executa a sonda nativa nas cópias
locais antes de concluir. Registra SHA do executável, buffers decodificados,
codec, duração, geometria/cadência, áudio e loudness da primeira trilha,
e aplica o perfil técnico do canal. Apenas caps/metadados ou uma sonda antiga
sem contadores não comprovam decodificação. Outras trilhas são descobertas,
não individualmente decodificadas/certificadas por essa medição.

`localValidation` diferencia análise técnica PASSED/FAILED e conta arquivos
decodificados/bloqueados. `localProbeRequired=false` só informa que a análise
de decodificação terminou para todos os hashes exigidos; não significa QC
aprovado, perfil sem erro ou autorização de PGM. `qcBlocked` conta edições
sem aprovação explícita ou com falha técnica. O resultado técnico nunca cria
uma decisão APPROVED. Sem sonda configurada, a análise segue pendente.

Os resultados completos ficam cifrados por SHA na tabela `ha_recovery_media`
do banco isolado, sem substituir os metadados da publicação congelada. A
sonda roda uma por vez, em prioridade baixa, sem credenciais administrativas
herdadas, sem gerar thumbnails e com limites de tempo/resposta. A cópia é
conferida novamente por SHA e identidade/tamanho/mtime/ctime; alteração e
restauração dos mesmos bytes durante a análise também recusam o ensaio.
Mudança da sequência espelhada/runtime ou encerramento cancela o trabalho;
os resultados anteriores e eventuais bancos parciais são preservados.

Trims/mixes operacionais, vínculos de equipamentos/saídas, posse nativa e
fluxo de promoção permanecem necessários. Vídeo H.264 progressivo e áudio
estéreo/R128 foram verificados com processos reais locais; isto não homologa
todos os codecs, arquivos de áudio/imagem nem saída física. O SHA registrado
é do executável da sonda, não de cada plugin/DLL do GStreamer.
Contexto original fica cifrado
com o cofre do reserva; preserve esse cofre junto do banco de ensaio.

Reenviar o mesmo UUID/canal/seq só consulta seu resultado, inclusive após
reinício; não cria outro banco nem aplica TAKE. CHECKING deixado por crash
bloqueia novos ensaios e não é retomado implicitamente. O administrador pode
usar POST `/api/ha/rehearsal/reconcile` com o mesmo UUID/canal/seq: somente
depois de confirmar o término do processo criador local, o registro passa a
REFUSED/reconciliado. O banco parcial não é tocado nem removido; o pedido
não é reexecutado. Um ensaio novo exige outro UUID. Repetir a reconciliação
apenas consulta o resultado original, que inclui horário e ator.

Criador vivo, PID reutilizado/vivo, outro host, permissão de processo negada
ou dono desconhecido não permitem liberação. Ledgers anteriores ao registro
de dono são preservados, mas CHECKING legado não recebe um dono inventado.
A recuperação verifica vínculos de mídia e loop/cursor antes de criar um
banco, conserva a política de QC e as zonas congeladas e mantém publicações
históricas não exigidas sem usar seus arquivos legados como entrada do
decoder. A promoção do banco restaurado continua pendente.

Em `/api/health`, `engines` conta engines nativas prontas; `nativeEngines`
conta transportes nativos criados, inclusive ainda não prontos, e
`simulatedChannels` conta os simuladores separadamente. Nenhum desses
contadores comprova sinal, placa ou emissão física.

### Inspeção de entradas ao vivo em qualidade no QC

Ver em qualidade também permite inspeção live: o engine usa um ramo do
mesmo decoder, antes da redução para preview. O raster/cadência efetivos da
fonte determinam o perfil, até 4K/60 fps e 6–50 Mbps, em H.264/Opus progressivo.
Não é cópia original sem perdas; a tela informa o custo e os limites. Uma
fonte menor não é ampliada para a resolução do canal. Preview leve continua
padrão; qualidade não aplica TAKE, muda PGM ou aprova material.

Cada janela possui lease vinculada à sessão, canal e fonte atual. Troca de
CUE fecha inspeção da fonte anterior; pedido antigo não abre outra entrada.
Fechar uma janela não interrompe outra; sem heartbeat, o engine encerra HQ
em 15s. Captura de quadro válido antecede a partida do encoder. O QC só
monta vídeo quando a fonte selecionada é o SOURCE pronto no PVW, não apenas
porque há sinal dela no PGM. Scopes/áudio acompanham a rendição montada e
são limpos em troca/falha; qualidade indisponível não vira preview leve sem
aviso. O simulador não anuncia inspeção nativa disponível.

Ensaio local com servidor compilado/engine/MediaMTX comprovou inspeção 720p
mesmo em canal 360p, detalhe real, áudio Opus decodificado, PGM preservado,
reuso da conexão PVW e isolamento/expiração dos viewers. Isso não valida
playback no navegador, fontes físicas DeckLink/NDI/OMT ou emissão 4K live.
Pacote final atualizado e homologações correspondentes permanecem pendentes.

### Conferência QC protegida contra decisões concorrentes

Aprovar/rejeitar/bloquear usa a revisão do arquivo e do perfil conferidos,
não apenas seu nome ou hash. Se outra estação decidir, a ingestão/loudness
alterar dados ou o supervisor mudar o perfil, uma decisão baseada na
conferência anterior é recusada. Alterar e restaurar os valores antigos não
recupera a validade da revisão. A decisão detalhada e sua auditoria são
gravadas juntas, incluindo quarentena global. Falha de auditoria reverte a
alteração; erro posterior de atualização da tela é informado como gravado
com aviso, sem fingir rollback.

O perfil técnico também exige a revisão aberta pelo supervisor. Em conflito,
ressalva/perfil digitados permanecem na tela; Reabrir conferência confirma
o descarte e consulta a versão atual. Aprovação padrão não descarta uma
ressalva ou perfil em edição. A ação por linha exige selecionar e conferir
aquele arquivo/canal primeiro. Uma rejeição recusada não mostra aviso de
quarentena concluída. Decisões por canal e globais são identificadas no
histórico; conta restrita a canais não altera a quarentena compartilhada.

Migração 23 persiste revisões QC; startup e restauração validam suas
proteções. Ensaio com dois servidores compilados/SQLite compartilhado
comprovou concorrência, rollback, restart e backup. Não é replicação/HA,
decodificação de mídia, sinal físico nem homologação visual do navegador.

### Integridade da restauração de projetos — SEC-21A

Capturar projeto grava um snapshot consistente e a auditoria na mesma
transação. Restauração confere IDs, donos e referências antes de remover dados;
recusa colisões com outro canal, seção truncada, mídia ausente, vínculos externos
e remoção de grade com histórico publicado/importado/as-run. Eventos locais
são substituídos sem apagar os de outro canal. Falha de auditoria reverte tudo.

Restauração continua exigindo Supervisor/Administrador, PGM parado e CUE limpo.
Se os dados foram gravados mas o reinício falhou, a tela informa aplicação não
confirmada; a configuração fica inconclusiva, sem repetição/TAKE automáticos.
Não tratar isso como rollback nem como engine pronto.

A conferência SEC-21B mostra formato e quantidades atuais/a restaurar, remoções
de grade, publicações preservadas e saídas/destinos/chaves habilitados. Confirmar
envia a revisão original vista pelo operador; alteração por qualquer escritor,
inclusive mudança seguida de reversão, exige reabrir a conferência. Não há
renovação automática para autorizar uma confirmação antiga. Ausência de revisão,
prova malformada ou conflito são recusados sem restaurar dados.

Contadores persistentes são validados na abertura do banco e no backup. Mudanças
de mídia, QC, equipamentos ou modelos compartilhados invalidam conservadoramente
as conferências de todos os canais, podendo exigir nova conferência durante ingestão.
A tela mantém o rascunho em falha e isola respostas atrasadas ao trocar de canal;
não exibe conteúdo privado, endpoints ou chaves no relatório de impacto.

A SEC-21C também recusa conteúdo fora do contrato salvo: tipos/limites,
cortes e âncoras incoerentes, datas/zonas inválidas, áudio/matriz malformados,
preview full, eventos com comandos ocultos ou estado executado e automação
com equipamento ausente/desabilitado. Confere ao capturar, abrir a prévia e
aplicar, antes da escrita; não corrige silenciosamente o snapshot. Validação
de equipamento não envia comandos nem aprova execução, e estrutura de medição
não autentica loudness nem autoriza AUTO. Compatibilidade explícita de snapshots
v1 anteriores é preservada; conteúdo inválido exige correção pelo operador.

Software: 169 arquivos/1507 testes, tipos/build e ensaio compilado ZlsA6p PASS.
A frente não é homologação integral: SVG e payloads não foram renderizados,
destinos genéricos não foram conectados, e outros mutadores ainda precisam de
guardas equivalentes. Não confundir markup com operação visual remota nem
snapshot válido com mídia aprovada/sinal físico. Ensaio compilado é SIMULATED;
navegador, pacote final e homologação DeckLink/NDI/OMT continuam pendentes.

### Cadastro de entradas ao vivo com conferência original — SEC-22A

Criar, editar ou remover uma entrada NDI/OMT/SDI/SRT/RTMP usa a revisão da
lista que o operador abriu. Se outra estação alterar as fontes ou o canal,
inclusive alterar e reverter, a confirmação antiga é recusada. Rascunho fica
preservado e exige reabrir explicitamente; a tela não renova a revisão para
autorizar a ação antiga. Acesso é reconferido na gravação, junto da auditoria.

O campo Nome continua abaixo da seleção, sugerido pela fonte encontrada;
alias manual pode ser mantido ou substituído explicitamente pelo nome da
fonte. Renomear preserva conexão/credenciais protegidas. Cadastro não sintoniza,
não dá TAKE e não altera o PGM/PVW. Entrada cadastrada ou descoberta não
significa sinal validado. Pares primário/reserva precisam pertencer ao mesmo
canal; remover fonte referenciada exige desfazer o vínculo primeiro.

Migração 25 protege revisões persistentes no startup/backup. Suíte completa
174 arquivos/1553 testes, tipos/build e três verificadores compilados PASS.
Dois servidores isolados comprovaram vencedor único, recusa de ABA/dono errado,
rollback de auditoria, credencial/revisão após restart e PGM/PVW preservados.
Transporte SIMULATED, sem decodificação ou homologação visual/física/HA.
Force-failover, outros mutadores, pacote portátil final e Windows limpo ainda
precisam das verificações específicas; não é publicação 100% homologada.

### Papel inválido não concede operação — SEC-22B

Conta com papel inválido não é tratada como Operador: não autentica, não recebe
sessão nova e perde acesso HTTP/WebSocket. Permissões só aceitam os quatro
papéis válidos exatos; configuração local ou header inválidos não concedem
ações de operação. O diagnóstico é Acesso não autorizado, sem criar um quinto
papel cadastrável. Se a instalação estiver em modo local sem contas, leituras
anônimas previamente permitidas continuam assim; isso não as torna privadas.

Depois de verificar a senha, o login reconfere conta habilitada, nome/hash,
papel e estação na gravação. Sessão de 12h (somente hash do token no banco) e
auditoria são atômicas; falha de auditoria não deixa sessão nem cookie de sucesso.
Tipos/build, 84 testes direcionados, integral 176 arquivos/1600 testes e
servidor compilado jSBHVN PASS; resultados e reparos registrados na matriz.
Ensaio compilado é SIMULATED, sem homologação visual, mídia, hardware ou HA.
Administração/bootstrap inicial e demais mutadores ainda precisam das guardas
específicas; não declarar toda a segurança concluída por esta etapa.

### Layout multiview compartilhado por canal — SEC-22C

A aba Multiview da Engenharia permite conferir e salvar o layout do canal.
Trocar a visualização é local; **Salvar layout no canal** compartilha somente
o layout. Outra estação que altere canal/fontes/configuração invalida a
conferência antiga, inclusive se alterar e reverter. Recusa preserva o layout
local; **Reabrir conferência** exige confirmação antes de descartar rascunho.
Gravação, revisão e auditoria são atômicas; não reiniciam engine nem dão TAKE.

Global e canal de ID `default` não sobrescrevem um ao outro. Ausência de
configuração tem consulta estável, sem timestamp inventado. Conexões/células
privadas são preservadas ao salvar só layout; telemetria/tally salvos são
históricos e não demonstram sinal. Cards continuam usando dados do engine.
Dashboard permanece visualização local; editor completo de células é pendência.

Migração 26 verificada na abertura e backup. 44 testes novos, 184 direcionados,
tipos/build, ensaio compilado 6pc34o e integral 181 arquivos/1644 testes PASS.
Ensaio SIMULATED, não homologação de navegador, hardware, decodificação ou HA.
Pacote portátil final e demais frentes continuam pendentes.

### Faixas da pauta e montagem diária por conferência — SEC-22D

Criar, alterar ou remover faixas exige a lista conferida do canal. Alteração
posterior, inclusive alterar e reverter, recusa a ação antiga. Checagem de
sobreposição, gravação e auditoria são juntas; falha reverte todos os dados.
Horários encostados e dias distintos são válidos. Captura/restauração de
projeto também recusam faixas sobrepostas, sem descartar ou corrigir legado
silenciosamente. Cadastro é editorial: não publica e não altera PGM/PVW.

O editor de AutoFill permite dias/categorias/horários e mantém os campos em
conflito. **Reabrir conferência das faixas** pede confirmação antes de descartar
rascunho. Trocar de aba não reabre automaticamente a conferência; falha de
consulta não significa lista vazia. Remover outra faixa não renova a prova de
edição já iniciada. Campos antigos bloqueiam nova gravação até reabrir ou
iniciar explicitamente um rascunho novo.

Proposta do dia inteiro inclui revisão durável da pauta. Alterar e reverter
não autoriza montagem antiga; confirmação não refaz a seleção. Outro canal
não invalida proposta local. Propostas DAY anteriores a este vínculo precisam
de nova conferência; preencher janela permanece independente das faixas.

65 novos testes, tipos/build, integral 186 arquivos/1709 testes e três ensaios
compilados PASS (pauta 8WyocI, projetos bvhDba e multiview qG8G1M), na mesma
build. Evidências e reparos na matriz. Ensaios SIMULATED/metadata placeholder, sem vídeo
decodificado, homologação visual/física ou HA. Pacote final ainda pendente.

### Cadastro de artes e apresentação técnica conferidos — SEC-22E

No gerador de caracteres, marcar a apresentação técnica faz a escolha local.
**Salvar apresentação técnica** confirma a configuração conferida; não é TAKE
nem disparo de emergência. Se outra estação mudar o canal ou artes compartilhadas,
mesmo alterando e revertendo, a escolha antiga é recusada e preservada na tela.
**Reabrir conferência das artes** é explícito e confirma descarte do rascunho.

**Gerenciar artes** abre cadastro separado do disparo: nome, SVG como texto,
campos/rótulos/defaults, transição e tempo de retirada. Artes locais pertencem
ao canal; compartilhadas exigem acesso não restrito para editar. SVG fica
escapado no textarea, sem execução no navegador. Ocultar cadastro preserva
rascunho; lista nova não renova a prova dos campos antigos. Falha de consulta
não é tratada como lista vazia. Excluir recusa arte ainda vinculada à grade ou
apresentação técnica, sem apagar referências ou histórico publicado.

Gravação, revisão e auditoria são atômicas. Falha de auditoria não chega ao
runtime; falha pós-commit informa configuração gravada com aviso, sem alegar
rollback ou entrega física. Cadastro não dá TAKE/recria engine. Os comandos
de disparo/retirada/layers e slate de emergência continuam uma frente separada.

Migração 28 protegida no startup/backup. 67 novos testes, 112 direcionados,
tipos/build, compilados JihJIy/xWEU0z e integral 191 arquivos/1776 testes PASS.
Primeira tentativa e seus reparos permanecem registrados na matriz. Ensaio
SIMULATED, sem homologação visual, SVG renderizado, mídia, hardware ou HA.
Demais requisitos e pacote portátil final permanecem no objetivo ativo.

### Artes de fábrica preservam suas decisões — SEC-22F

Renomear ou excluir uma arte de fábrica não faz com que ela reapareça ao reiniciar.
Instalações existentes, mesmo sem artes, mantêm seus IDs, conteúdo e referências;
somente banco novo pode receber o catálogo inicial. Uma arte local com o mesmo
nome não impede a criação da compartilhada. Inicialização, revisões e registro
de conclusão são atômicos, com proteção contra reset e validação no backup.

20 novos testes/51 direcionados, tipos/build, dois ensaios compilados e integral
192 arquivos/1796 testes PASS. Ensaios SIMULATED, sem nova
homologação visual, física ou HA. Reconciliação de histórico entre processos,
administração (implementada na SEC-22G abaixo), demais requisitos e pacote final
permanecem no objetivo ativo.

### Usuários e acesso com confirmação explícita — SEC-22G

Editar papel, habilitação, senha, canais ou estações mantém um rascunho local.
**Salvar conta/acesso conferido** aplica somente a lista que foi conferida;
mudança em outra estação, mesmo alterada e revertida, recusa a edição antiga.
Lista e campos são preservados em erro. **Reabrir conferência das contas** pede
confirmação antes de descartar. Consultas nunca mostram senha, hash ou tokens.

**Conferir sessões** mostra datas e quantidade de registros, inclusive expirados.
**Encerrar sessões conferidas** preserva a conta e recusa se houve novo login
desde a conferência. Salvar conta/acesso também encerra suas sessões; alterar a
própria conta exige novo login. O último administrador acessível e a própria
estação são protegidos. Primeiro administrador só é criado na instalação vazia
e na página local; contas desabilitadas não reabrem modo anônimo.

Escrita, revisões e auditoria são atômicas. Falha de auditoria não aplica parte
da conta nem encerra sessões parcialmente. Operações administrativas não dão
TAKE nem mudam PGM/PVW. Migração 30 validada no startup/backup.
87 novos testes/121 direcionados, tipos/build e ensaios b3GGxR/N0huIK/ywtS43 PASS.
Revogação também fecha WebSocket autenticado (4401) sem alterar PGM/PVW.
Integral desta build: 198 arquivos/1883 testes PASS, 23h42m33 BRT, 240,95s.
SSR/HTTP/WebSocket/SIMULATED não são homologação visual, mídia ou hardware.
Demais requisitos, segurança de escritores SQL externos, HA e pacote final
continuam pendentes. Evidências e limitações completas na matriz.

### Conferência de título e categoria do acervo — SEC-22H

Na biblioteca da playlist ou no detalhe do item, **Conferir título / categoria**
abre o editor do arquivo. Digitar/selecionar não grava. **Salvar metadados
conferidos** usa a versão original recebida; mudança em outra estação, ingest
ou QC, inclusive alterada e revertida, recusa a edição antiga. Campos ficam
preservados até **Reabrir conferência do arquivo**, com aviso de descarte.

Título/categoria são compartilhados entre canais. Conta restrita pode consultar,
mas não alterar esses dados globais. Categoria vazia remove a classificação;
categoria nova não dispara cadastro de cor automaticamente. Salvar não altera
título editorial da linha, arquivo no disco, aprovação QC nem PGM/PVW. Revisões
e auditoria são juntas; falha não deixa atualização parcial. Editor não renova
prova QC usando dados de metadata, e falha de consulta não significa acervo vazio.

Entradas NDI/OMT/SDI da biblioteca abrem **Configurar entrada ao vivo** e não
recebem ações de metadata/ignorar de arquivos. Vídeo da categoria Ao Vivo
continua sendo arquivo. A varredura não copia mais decisões anteriores à sonda:
relê título, ignorado, QC e medição sob writer antes de gravar. Mesmo conteúdo
preserva decisões atuais; conteúdo novo volta a PENDING. Análise atrasada não
recria ID removido/substituído. Probe falho permanece FAILED, sem fingir aprovação.

74 novos testes/125 direcionados distintos em duas rodadas, tipos/build PASS.
Primeira integral: 1945 PASS/2 FAIL na proteção Windows de configuração;
cinco testes repetidos isoladamente PASS. Guarda não relaxada, causa exata não
comprovada. Três compilados atuais (metadata tRbSQP, contas A8yKEo e artes
ZsVUNC) PASS, com preservação de PGM/PVW simulados, rollback/restart/backup.
Tentativa anterior de metadata recusada pelo cofre Windows antes de iniciar
servidores; não substituiu chave nem relaxou proteção. Integral final terminal
PASS: 203 arquivos/1957 testes, 00h29m35 BRT, 815,22s, um worker, sem build/
verificador concorrente ou edição de fonte durante a rodada. ACL/DPAPI passam
com limites originais; causas das falhas anteriores continuam não comprovadas.
Ensaios SIMULATED/SSR, não homologação de navegador/mídia/hardware/HA. Remoção,
limpeza, cadastro/cores de categoria, pastas/scan e integrações continuam frentes
separadas, assim como pacote Windows final e demais requisitos do objetivo.

### Remoção e limpeza conferidas do acervo — SEC-22I

O menu MAM agora oferece **Conferir remoção e vínculos**; o rodapé oferece
**Conferir limpeza**. A página apresenta os vídeos, os itens diretos a remover,
os fallbacks a desvincular sem apagar a entrada ao vivo e os bloqueios de uso.
É preciso selecionar arquivos e confirmar seus vínculos antes de aplicar.
Se a grade, fonte de prova, sessão/permissão ou operação mudar, a tela preserva
a seleção e exige reabrir o impacto explicitamente. Não existe force=1 ou retry
automático. Entrada ao vivo não recebe ação de arquivo MAM.

Remover oculta o registro. Limpar apaga somente os registros de vídeos falhos
selecionados desta conferência, nunca imagens ou novos candidatos descobertos
depois. Nenhum arquivo físico é apagado; publicações, projetos e as-run permanecem.
Publicações/projetos e operações protegidas podem impedir a remoção. Modificações
editoriais exigem conferir timing e publicar novamente; remover não faz TAKE,
CUE, STOP ou publicação. A decisão e seus vínculos são gravados juntos e auditados.

89 novos testes, última direcionada117 PASS, tipos/build e ensaio compilado
kYCBbt PASS. Duas instâncias temporárias verificaram vencedor único, rollback,
restart/backup e PGM/PVW simulados preservados; bytes do arquivo placeholder
permaneceram iguais. O override local de ignorado já não sobrepõe QC/catálogo
mais novo. Mudança de QC por canal invalida a original mesmo sem editar o ativo;
fases de operação desconhecidas recusam a conferência. Integral final I PASS:
209 arquivos/2046 testes,07h07m14 BRT,867,80s,um worker; relatório persistente
conferido. Nenhuma fonte foi alterada durante a rodada; limites de ACL/DPAPI
preservados.2038 PASS intermediários são anteriores a esse complemento.
Esse ensaio não valida vídeo real, navegador,
DeckLink/NDI/OMT, dois engines ativos, redundância ou pacote Windows final.
Ver matriz para falhas anteriores, limites e roteiro das demais implementações.
Primeira integral I:2036 PASS/2 FAIL em fixtures legadas; correções de testes
passaram14/14 e tipos, sem mudar produto/guardas. Repetição intermediária2038 PASS;
fonte final possui o resultado2046 PASS acima. Sessão24515 perdeu seu identificador
antes de resultado observado: causa/exit code desconhecidos, não é PASS/FAIL.
Não chamar essa etapa de
publicação100% validada.
