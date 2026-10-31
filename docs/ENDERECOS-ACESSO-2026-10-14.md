# 6.4 — Admissão de endereços do servidor

Implementado na fonte e validado localmente, sem alterar a configuração do
servidor operacional. Complementa a proteção de Origin: um Origin que combina
com Host forjado não passa a autorizar aquele Host.

## Fluxo de acesso

Confirmado novamente pelo operador: localhost quando local, com IP/nome e
porta quando necessário acessar o servidor remotamente. Não fixar o endereço
192.168.42.172 como requisito para todos os ambientes. Nenhuma configuração
operacional foi alterada a partir dessa confirmação.

Na máquina do servidor, usar localhost e sua porta de escuta (padrão4000).
Na máquina remota, usar IP/nome do servidor e porta; localhost não aponta para
outra máquina. A API/WS segue o endereço da página, sem IP remoto fixado no
cliente. Resposta do operador:192.168.42.172; ele não está lá agora.

Quando192.168.42.172 é IP local do servidor, a política aceita esse IP na porta
real. Não houve conexão a esse endereço nem homologação remota. O caso desse
IP está coberto por identidade simulada nos testes unitários, não pela rede.

Nomes reais/curtos da máquina, localhost, loopbackIPv4/IPv6 e IPs locais são
admitidos na porta efetivamente aberta. O destino real do socket também admite
uma interface alterada depois da partida. Não há resolução de DNS de nomes
recebidos, confiança em Forwarded ou liberação de toda a faixa privada.

Aliases personalizados exigem RPLAYOUT_ALLOWED_HOSTS, lista de nome/IP com
porta opcional, sem protocolo/credenciais/caminho/query/fragmento/curingas.
Nome sem porta admite o nome simples ou a porta de escuta; porta explícita
admite somente aquela porta externa. Proxy/HTTPS precisam de configuração
própria e continuam não homologados. Reinício de configuração deve ser planejado;
nenhum reinício do servidor operacional foi feito neste ensaio.

## Contrato e prova

HOST/PORT/aliases são conferidos antes de app/banco/runtime. Configuração
inválida interrompe startup sem repetir valores privados. Hook global recusa
Host desconhecido/ambíguo403 antes de autenticação/CORS/static/WebSocket,
com resposta privada/no-store, sem repetir o cabeçalho recebido.

57 testes dirigidos PASS (25Host,25Origin,7privacidade), tipos servidor PASS.
Prova no compilado: scratch/http-hosts-bnigjr/result.json, PASS/exit0,
servidor SHA256 CC32625E31E77C78A59D943BE8BF9D7AACC041C586BED798CE821B43CEAF35E3.

- Seis partidas inválidas:exit1, sem criar banco/cofre e sem credenciais no log.
-18 respostas HTTP verificadas: login recusado sem sessão/cookie, login válido,
  localhost/nome real/aliases autenticados; API/static/WS e portas erradas
  recusados; Host duplicado recusado; pré-flight não autoriza acesso sem sessão.
- WebSocket próprio e alias aceitos, Host desconhecido recusado.
- Cabeçalhos Forwarded não concedem autoridade; valores privados de fixture
  ausentes dos logs. Zero as-run, engine e saídas desativados.
- Processo próprio encerrado; contas/banco/mídia pertencem ao ensaio.

Falhas de fixture preservadas:CaL5ly enviava Origin com hostname Windows em
maiúsculas, formato não serializado por navegador; outro ensaio usou array de
Host não aceito pelo cliente Node. Corrigidas a serialização do Origin e a forma
de enviar cabeçalhos duplicados, sem alterar a política ou relaxar recusas.

Não comprova DNS rebinding real, DNS/proxy/TLS, navegador remoto, instalação
Windows limpa, sinal físico nem auditoria integrada completa.6.4 permanece
em andamento. As provas HTTP anteriores têm seus próprios hashes e limites:
PRIVACIDADE-HTTP-LOGS-2026-10-14.md e ORIGENS-ACESSO-2026-10-14.md.
