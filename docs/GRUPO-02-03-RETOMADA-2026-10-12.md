# Retomada dos grupos 2 e 3 — 12/10/2026

Pedido atual: deixar a cópia de lado e continuar em C:/IA/RPlayout. Remoção
pendente desativada no recibo, sem apagar novas pastas. Grupo8 fica para v3;
DeckLink2.2 adiada. Nenhum instalador/push novo neste lote.

## Software compilado e engine nativo

Servidor isolado: `scratch/group02-final-server-20261012/server.cjs`, SHA256
AA08FB5F3CE41D10134DF73F0C897786311E295FE50018C23DFB69EF6852FB58.
Engine release: D55F2110C0923BD64BF0F52EC0DF2A4FA3239D1AC454384E5EED6C99A9EED548.
Esses cenários incluem a guarda recente de buffers de vídeo reais. Não foi
reexecutada a suíte NDI/OMT inteira ou a suíte Rust por mudança documental.

1. CUE/TAKE compilado: PASS, pasta temporária `RPlayout-qc-live-quality-O6gkVQ`.
   CUE repetido não entra no ar; outro CUE preserva item/origem/contador do PGM.
   TAKE implícito seleciona CUE, fonte ambígua é recusada, ausência de CUE não
   toma Próximo. PVW real428×240; qualidade do QC não é pré-condição do TAKE.
2. QC nativo: PASS, pasta `RPlayout-qc-live-quality-EHMd7X`.
   QC abre antes da publicação/TAKE, com PGM parado e1 reader. Inspeção1280×720
   tem detalhe real, preview428×240. Áudio Opus decodificado RMS0,0245178.
   HQ não abre outra conexão da fonte; isolamento e expiração de viewers
   preservam PGM. Cleanup próprio confirmado nos dois `result.json`.

As evidências completas ficam no diretório temporário do usuário, com hashes
dos binários e resultado persistido depois do cleanup. Sinais próprios locais
SRT/RTSP, não hardware, emissão externa ou soak de longa duração.

## Conferência visual — Edge

UI inicial compilada BGjw9G2a, fixture `RPlayout-qc-live-quality-v4bBkD`.
PGM permaneceu PARADO. QC foi aberto e selecionou o SRT local diretamente,
sem CUE no Master; vídeo WHEP ativo428×240. Botão "Ver em qualidade" passou
para "Voltar ao preview leve", com vídeo ativo1280×720. Safe nasceu desligado;
overlay acompanhou a imagem16:9 e, na tela cheia, não incluiu as barras pretas.
Scopes passaram de aguardando para amostra real do player.

MAM/+Pastas abriu modal HTML com diretórios do servidor. Criada apenas uma
pasta vazia da fixture `ação ÇÃÓ 東京`; atualizada a lista e navegado nela.
Caminho selecionado correto nos dois campos. Nenhum diálogo nativo do Windows
ou upload de arquivos pessoais. Isso encerra3.1; não certifica NAS/UNC remoto.

Diálogo de entrada: protocolo/referência acima do nome. Referência NDI manual
`ESTÚDIO ÇÃÓ — câmera 1` preencheu automaticamente o nome. Alterado nome para
alias manual e depois referência NDI: alias preservado. Caso de edição local,
não descoberta NDI/OMT: fixture desativa dispositivos. A edição final ocorreu
depois da expiração do servidor, sem salvar cadastro; não é persistência validada.

## Correção encontrada na interface

Aviso "Sintonizando..." persistia mesmo após PVW pronto e vídeo em reprodução.
Aviso agora ligado à seleção pendente (canal/id/referência), desaparece após
vídeo recente no PVW, não herda outra seleção nem retorna por perda posterior
de uma solicitação consumida. Aprovação/erro de arquivo mantêm seu feedback.
Não usa ACK como prova de vídeo. Painel do perfil corrige canal legado sem
audioChannels explícito, usando o mesmo padrão estéreo já adotado no canal;
não ativa/cria política de pares ao abrir.

25 testes afetados em3 arquivos PASS; tipos web PASS. Primeira checagem de
tipos apontou audioChannels opcional; reparo aplicado, última checagem PASS.
Build web IVzjANFq PASS; aviso de chunk grande permanece. pnpm tentou buscar
metadados e falhou por rede; uso direto de TypeScript/Vite já instalados
compilou sem baixar dependências.

Fixture curta `RPlayout-qc-live-quality-QyQgDa`, mesma API/engine, UI IVzjANFq:
seleção ao vivo no QC, PVW PRONTO, vídeo428×240 readyState4/currentTime3,787733,
PGM PARADO e aviso de sintonia ausente, sem clicar em qualidade. Evidência
visual: `scratch/group03-qc-browser-notice-20261012.jpg`.

## Pendências preservadas

Rede/equipamentos NDI/OMT/SDI externos e estabilidade; dispositivos de automação.
Arquivos QC4:3/vertical/fallback e resize; default de nome a partir da lista
NDI/OMT descoberta; CPU/RAM/rede e scopes/áudio em outra estação; pacote Windows
atualizado e publicação. Não fechar2/3 ou afirmar100% a partir destes cenários.

Registro:10 grupos/53 verificações; versão atual9 grupos/46 verificações:
6 concluídas,32 em andamento,8 pendentes;7 adiadas à v3.
