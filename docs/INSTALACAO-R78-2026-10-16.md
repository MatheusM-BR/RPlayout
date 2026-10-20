# R78 — instalação real e partida do servidor, 16/10/2026

**PASS no escopo local abaixo.** Não é Windows limpo, homologação de mídia
instalada, abertura pelos executáveis de atalho ou qualificação final de10.x.

## Instalação incorporada no ZIP

Arquivo `release/RPlayout-1.1-parcial-20261016-r78-instalador.zip`,
540.206.044bytes, SHA256
`D6A254CEBD4BB0448564AF3369D2862A92C0CA89B1018546A121D9B0B8E750D4`.

`verify-installed-partial.ps1` executou o INSTALAR.ps1 efetivamente incorporado,
sem substituí-lo pelo script de desenvolvimento. Destinos novos e distintos:

- Instalação: `scratch/r78-installed-qa-20261016`.
- Bundle/evidência: `scratch/r78-install-evidence-20261016`.
- Atalhos: `scratch/r78-shortcuts-qa-20261016`.

Preflight:4.132.171.776bytes disponíveis;2.828.470.341 necessários para bundle,
instalação e margem. Conteúdo expandido1.420.627.829bytes; estimativa conservadora
da instalação2.154.041.205bytes. Nenhuma pasta anterior foi apagada para caber.

Resultado PASS/exit0 em `r78-install-evidence-20261016/result.json`: recibo
VERIFIED, hashes materializados conferidos, perfil de dados/mídia/cofre próprio,
sete atalhos com alvo e diretório corretos. Menu Iniciar e atalhos operacionais
não alterados. O instalador não inicia servidor automaticamente.

Conferência dos binários efetivamente extraídos:

- Engine `191CD1E112C7AFBA81896BBF3AA109A100775A7A358B7894FAAAFBE8D1ABDFBC`.
- Servidor `A709115F976CC6372F1FFE13D1B9195261FFC217C0EBE2707990477056E0473A`.
- Web `8B0D3FCBD44724DE835FCBE491531F6A5A0629EA9A688ECA520EFD76A2499F1D`.

## Partida instalada, sem sobreposição do checkout

`verify-portable-server.mjs --workspace-artifacts --minimal-path`, pelo Node
da instalação r78: **PASS em2274,6302ms**, Nodev24.16.0. Sem `--server-binary`,
sem servidor ou interface sobrepostos; `compiledServerOverride:false`.

SQLite resolveu dentro do pacote; banco novo criado. HTTPhealth e página200,
JS `/assets/index-BsVZYGz4.js` retornou200 e hash igual ao arquivo instalado.
PATH do filho limitado a Node/GStreamer incluídos e System32, sem PowerShell;
NODE_PATH e NODE_OPTIONS removidos. Não requer pnpm/tsx/tsc globais no produto.

Evidência: `scratch/RPlayout-portable-server-i7fkSW/result.json`, `launch.json`
e `server.log`. Engine, MediaMTX e auxiliares de mídia explicitamente desligados
neste recorte; não usar HTTPhealth para afirmar que vídeo/áudio funcionaram.
Servidor próprio encerrado antes da gravação do resultado; sessão exit0.

Tentativa anterior `scratch/RPlayout-portable-server-RbXBqR` continua FAIL:
sondas HTTP locais receberam EACCES no ambiente restrito, não ECONNREFUSED.
Não era evidência de prontidão ou de ausência de dependência. Após término
confirmado e saída do processo próprio, o replay com permissão para a consulta
local passou. Não houve alteração de firewall ou desativação de proteção.

## Limites e próxima ação

Não se fez novo replay de mídia inalterada apenas por status. Provas nativas
e visuais anteriores mantêm sua atribuição aos respectivos overlays na r71;
hashes idênticos na r78 não viram teste de sinal realizado nesta instalação.
Este host possui runtimes/componentes prévios: não é Windows limpo.

Sete alvos de atalhos conferidos não significa sete executáveis abertos. A
inspeção do launcher atual encontrou próximo ponto concreto de10.1/10.4:
usa porta4000 fixa para verificar prontidão/abrir navegador e aceita TCP ocupado
como instância existente, enquanto o servidor aceita PORT configurada. Não
foi executada uma colisão ou porta alternativa nesta rodada. É necessário
revisar esse contrato e verificar a abertura real pelos executáveis sem
reutilizar uma instalação/serviço indevido; não declarar startup do launcher
aprovado a partir da partida direta do Node.

Também faltam upgrade/rollback guiados, Windows limpo, sinais físicos/externos,
estação remota, desempenho prolongado e liberação de redistribuição. Acordo NDI
indisponível; não publicar pacote como juridicamente liberado. Grupo8v3,
DeckLink física adiada. Sem limpeza, migração ou dados operacionais alterados.

Sem alteração do produto neste lote, portanto sem novo ZIP: a r78 permanece
intacta. Totais10grupos/53verificações:7concluídas/35andamento/4pendentes/7v3.
