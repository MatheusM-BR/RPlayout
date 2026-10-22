# RPlayout r52 — instalador de teste, não homologado

## Ajuste posterior do instalador — NÃO incluído no ZIP r52

Fonte do instalador agora cria cofre por instalação em data/security/vault.json,
não aponta novas edições ao cofre global. Migração/restauração de banco antigo
continua exigindo sua chave original explicitamente. Parâmetros Payload e
ShortcutDirectory permitem QA sem escrever no menu Iniciar.

Ensaio do fonte atualizado com payload r52 concluiu exit0 em
scratch/r52-installer-isolation-qa-20261012; catálogo/hashes conferidos,
perfil isolado e sete atalhos em scratch/r52-installer-shortcuts-qa-20261012
verificados por COM (TargetPath existente e WorkingDirectory da instalação).
Nenhum servidor iniciado, dados/cofre operacional não usados.
Não homologa instalação do ZIP r52 original: o fonte atualizado é posterior.
Ensaio revelou rótulo legado r24 no recibo ao fornecer payload externo;
corrigido bundleRoot para ler installation-edition.json ao lado do payload,
correção ainda não reexecutada. Recibo antigo preservado sem editar sua evidência.
Atalhos conferidos como arquivos, não abertos; Windows limpo continua pendente.

Replay de preflight posterior PASS: payload externo identificou r52 e recusou
destino existente, exit1 esperado, antes de extrair/substituir arquivos.
Removida presunção automática r24 quando falta installation-edition.json;
teste com payload inválido e identificação ausente recusou antes de criar
destino. Nenhuma extração completa repetida só por troca de rótulo. Essas
mudanças do instalador ainda devem entrar no próximo ZIP; r52 permanece intacta.

Inclui as correções QC e engine/auxiliares da r51. Corrige o acesso DPAPI do
cofre para usar o PowerShell absoluto do Windows, sem pesquisar no PATH.
Onze testes PASS, incluindo criação/reabertura de cofre temporário com PATH
vazio; servidor recompilado. Proteção CurrentUser mantida, sem troca de chave.

Extraia TODO o ZIP e execute INSTALAR.cmd, em pasta NOVA. Não substitua uma
instalação em operação. Preserve banco, mídia e cofre. Não é Setup.exe assinado.
Node/SQLite e runtimes incluídos; não requer tsx/tsc/pnpm para executar.
O componente WindowsPowerShell do SO continua necessário ao DPAPI.
DeckLink depende de driver oficial. Redistribuição/licenças ainda em revisão.

Instalação em Windows limpo, atalhos, fluxo completo, sinais físicos e uso
prolongado NÃO homologados. Grupo8 reservado àv3, sem aprovação de HA.
Base materializada r30 validada por hashes; arquivos atuais não sobrescrevem
releases anteriores. Dados não são migrados automaticamente de outra edição.

Total10grupos/53verificações:6concluídas,32em andamento,8pendentes,7adiadasv3.
Grupos2/3/10 permanecem abertos. Evidências em BUILD-PARCIAL-R51.md e
GRUPO-03-QC-ARQUIVOS-2026-10-12.md. Verificação posterior deste ZIP será
registrada externamente, não antecipada no leia-me interno.

## Registro externo após geração

ZIP537781239bytes; SHA256
744FFF73F4E4E8A0AD5FD3602130019BDB54E6AC7E4D6C5D64BAB73F10858C77.
Empacotador exit0, hashes da base e fontes conferidos antes/durante compressão.
Payload extraído separadamente em scratch/r52-package-qa-20261012/payload.
Smoke com Node do payload e --minimal-path PASS (temp RPlayout-portable-server-nbeKZL):
cofre/banco temporários criados, health/página200, JS servido idêntico ao
payload por hash, servidor encerrado. PATH não contém WindowsPowerShell;
DPAPI resolvido pelo caminho absoluto, sem proteção removida.
PGM e processos de mídia desabilitados. Não herdar testes de engine/plugins
da r51 como se executados novamente na r52; Windows limpo/atalhos continuam
NÃO VALIDADOS. Instalação operacional e dados existentes não modificados.
