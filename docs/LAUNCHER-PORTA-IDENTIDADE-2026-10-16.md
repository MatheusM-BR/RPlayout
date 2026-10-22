# Launcher — porta, identidade e encerramento, 16/10/2026

**Lote implementado e validado localmente.** Avanço em10.1/10.4, sem
homologação da edição completa ou encerramento dos marcos amplos.

## Problema e contrato

O launcher usava4000 fixo, enquanto o backend aceitava PORT. Uma conexão TCP
em qualquer serviço nessa porta bastava para anunciar/reutilizar RPlayout.
Após esperar o filho encerrar, ainda tentava taskkill usando seu PID antigo.

Agora uma porta estritamente válida1–65535 governa env do Node, sonda e URL;
`--port=NUMERO` prevalece sobre PORT e4000 permanece padrão. HOST de escuta
específico/IPv6 é considerado. Isso não configura firewall, IP remoto ou DNS.

Antes de reutilizar, compara descriptor privado desta raiz/perfil de banco
com resposta HTTP da mesma instância: aplicação, versão, porta, PID e UUID
de abertura. A comparação de raiz/banco usa caminhos físicos canonicalizados,
não uma certificação do conteúdo de mídia ou identidade SQLite por inode.
O UUID é identidade operacional local, não sessão de usuário ou autorização
de TAKE; não é enviado como argumento, credencial ou query à porta ocupada.
PID/arquivo antigo sozinhos não autorizam reutilização ou encerramento.

Backend iniciado pelo launcher publica
`.rplayout-launcher-PORTA.json` na própria raiz, com writePrivateConfig e helper
ACL, somente depois de listen. Endpoint `/_rplayout/launcher` só responde a
conexão local direta (loopback ou endereço de origem igual ao destino local),
sem Origin, Sec-Fetch-Site ou cabeçalhos de encaminhamento. HTTP não retorna
caminhos de instalação/banco. Sem publicação privada, essa partida encerra
com erro, sem modificar servidor preexistente. Descriptor fica retido após
parada; não prova processo vivo e é substituído atomicamente numa nova partida.

Launcher sem descriptor confirmado recusa uma porta ocupada, inclusive versão
antiga/manual: pede intervenção explícita, sem parar ou migrar a instância.
NODE_PATH/NODE_OPTIONS globais não entram no Node de uma instalação empacotada.

Servidor próprio fica vinculado a um job anônimo do Windows com encerramento
por fechamento do identificador. Segunda abertura que só reutiliza não cria
esse job. Removido taskkill após wait: não se atua sobre um PID reciclado.
Falha de associação encerra somente o filho por seu handle, sem continuar
sem supervisão. Fora de Windows não se alega a garantia do job.

## Testes do lote, sem rodadas por status

- 65 casos TS em3arquivos PASS:15discovery +25host +25origin.
- 12 casos Rust distintos aprovados:9 observados na rodada inicial e3 de
  HTTP no replay dirigido. Primeiro teste tinha accept sem prazo; loopback
  restrito interrompeu a execução. Foi encerrado o próprio teste, limitado
  accept a3s, e só os3 casos foram repetidos com acesso local permitido.
  Ausência do executável de teste interrompido confirmada por consulta de
  processo; não se usou PID antigo para encerrá-lo.
- Caminho inicial incorreto de tsc produziu MODULE_NOT_FOUND; corrigida a
  invocação para a ferramenta existente na raiz. Tipos servidor PASS. Builds
  servidor e launcher release locked PASS. Nenhuma dependência/Cargo.lock
  alterada. Engine e web não mudaram neste lote, nem seus testes de mídia
  foram repetidos apenas porque o status mudou.

## Integração compilada real

`scripts/verify-launcher-startup.mjs`, Node da r78 instalada, exit0.
Resultado `scratch/launcher-startup-MPdJnf/result.json` PASS,8cenários:

1. Serviço TCP/HTTP falso **próprio** ocupa porta aleatória. Launcher recusa
   sem criar banco/servidor; serviço continua atendendo até seu teardown.
2. PORT0 é recusada antes da partida, sem fallback silencioso.
3. CLI escolhe56235 apesar de PORT17. Node real inicia com SQLite incluído;
   NODE_OPTIONS global deliberadamente inválida e NODE_PATH estrangeiro não
   impedem a partida porque não são herdados. Identificação e log de prontidão
   confirmam a porta correta em3666,55ms.
4. Segunda abertura confirma a mesma raiz/banco/processo/instância, termina0
   e mantém o primeiro launcher e servidor disponíveis.
5. Perfil aponta para outro banco próprio: reutilização recusada, original
   preservado; perfil de teste restaurado após a tentativa.
6. UUID antigo no descriptor próprio: recusado sem encerrar servidor;
   descriptor original restaurado para o restante do teste.
7. Leituras com Origin, Sec-Fetch-Site ou forwarded-for recebem403.
8. Encerrado somente o launcher próprio pelo handle; job do Windows encerra
   seu Node. Processo Node não está mais vivo; todos os launchers próprios
   fechados. Não houve comando de kill por PID.

Fixture portátil **pequena, explícita, não instalação completa**: Node/módulos
materializados da r78, compilados atuais de servidor/web/launcher e helper
de proteção copiados para pasta nova. Manifesto rotulado como fixture, não
recibo inventado. Engine/MediaMTX/saídas desativados. Nenhuma mídia, conta,
instalação, serviço ou atalho operacional foi alterado. Logs launcher0–5
e resultado preservados, sem publicar identificação privada no relatório.

Hashes usados:

- Launcher `101A28C9E55C5A826B9805804F10853227D539B9A98CC4B018DDEC81F9DC82B8`.
- Servidor `6E061188E72EEB5FAE57666C5B2717E51D736C085F267638C94B2783CCE7023D`.
- Web8B0D3FCB e engine191CD1E1 preservados; engine não executado nesse recorte.

## Limites e entrega

Não é proteção contra administrador/processo que já pode escrever na própria
instalação/conta. Não concede autenticação pela posse do UUID. Identificação
confirma servidor HTTP da instalação, não prontidão de vídeo/PGM ou saúde
integral do banco. Não testou launcher com HOST de LAN/IPv6 real, abertura
gráfica do navegador, STAGE/ACTIVATE completo ou interação dos jobs Windows
com engine/MediaMTX; isso exige ensaio nativo integrado antes de homologar.

R79 parcial gerada540.388.970bytes/SHA256
`DC4BA09DEB545FB8A081242C47B696031259AFE6A529DAD4DF9E0D1034BA49FE`.
Integridade PASS:7.094hashes/7.095entradas emmemória; evidência
`scratch/r79-zip-integrity-20261016/result.json`. R78 permanece intacta e
instalada em QA. Instalação/startup
da edição completa r79 NOT_RUN. Aproximadamente1,34GiB livres após gerar;
não cabe outra instalação QA conservadora, sem limpeza autorizada. Nenhum
arquivo foi apagado para gerar espaço. Isso não impede os demais trabalhos
de implementação/testes pequenos, nem autoriza chamar o objetivo de bloqueado.

Faltam Windows limpo, upgrade/rollback e grupos dependentes, validação remota,
físicos/externos, soak e liberação NDI/licenças. Grupo8v3 e DeckLink física
adiada mantidos. Totais10/53:7concluídas/35andamento/4pendentes/7v3.
