# RPlayout 1.1 — escopo consolidado, funcionalidades e roteiro de operação

## Objetivo

A versão 1.1 organiza o produto como um aplicativo de operação: o Master mantém o PGM protegido, janelas secundárias cuidam de playlist/gestão, e cada estado crítico tem confirmação visual e registro.

Estado de referência: 03/10/2026. A matriz
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
