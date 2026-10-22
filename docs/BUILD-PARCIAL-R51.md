# RPlayout r51 — build de teste, não homologada para ir ao ar

Inclui o servidor atual, engine e auxiliares recompilados, e correções do QC:
fallback quando o original abre só áudio, preservação da posição de inspeção,
safe area com geometria fracionária, botão de saída da tela cheia e redução
de atualizações redundantes das estatísticas. Native graphic-probe adaptado
ao quick-xml0.42, sem liberar recursos externos/dinâmicos:2 testes PASS.

Extraia TODO o ZIP e execute INSTALAR.cmd. Instale em pasta NOVA; não
substitua uma instalação em operação. Preserve banco, mídia e cofre.
Node, dependências nativas e runtimes vêm no pacote; não usa tsx/tsc/pnpm
para executar. DeckLink continua exigindo driver oficial compatível.

Compilação não é homologação. Este instalador não foi instalado/operado em
Windows limpo, nem aprovado com placa/sinais externos ou operação prolongada.
Não é Setup.exe assinado. Runtimes/licenças reutilizam base materializada r30,
conferida por hashes pelo empacotador; redistribuição ainda deve ser revisada.
Grupo8 reservado àv3; nenhum recurso parcial de redundância é homologado.

Total10grupos/53verificações:6concluídas,32em andamento,8pendentes,7adiadasv3.
Grupos2/3/10 permanecem abertos. Evidências do QC em
docs/GRUPO-03-QC-ARQUIVOS-2026-10-12.md. Dados de implantação/rollback ainda
precisam de conferência guiada; não presumir compatibilidade com pacote antigo.

Registro externo após empacotamento:537780008bytes, SHA256
B07F4C7B8AEBC281039FADC91F65780000925D89755F98ABF8D28D7AB50E8ABB.
ServidorAA08FB5F3CE41D10134DF73F0C897786311E295FE50018C23DFB69EF6852FB58;
engineD55F2110C0923BD64BF0F52EC0DF2A4FA3239D1AC454384E5EED6C99A9EED548.
ZIP fechado e processo empacotador exit0. Hash identifica o artefato, não
comprova instalação/funcionamento. Leia-me interno precede este registro.

## Verificação posterior do payload

Extração isolada em scratch/r51-package-qa-20261012/payload, sem executar
INSTALAR.ps1, criar atalhos, apontar ao banco operacional ou ligar sinal físico.
verify-rplayout-package.ps1 -SkipDeferredHa terminou exit0:

- Todos os arquivos do manifesto: tamanho e SHA256 conferidos.
- Assinaturas Microsoft dos runtimes MSVC app-local: válidas.
- Node embutido executou SQLite nativo em memória, criou/leu tabela e encerrou.
- PATH/GST_PLUGIN_PATH/scanner exclusivamente do payload; plugins DeckLink,
  NDI, H264, SVG, Opus e fakesink carregaram.
- Engine do payload com saída null confirmou ready/shutdown; vcruntime140.dll
  carregada da própria pasta do engine, não de instalação global.
- HA/testemunha explicitamente NÃO VALIDADA, respeitando grupo8 adiado àv3.

Não fecha10.2/10.3: presença/carregamento não homologa hardware, licença de
redistribuição, instalação por atalho, servidor/UI completos ou Windows limpo.
Os binários auxiliares recompilados desta build têm hashes próprios; provas
com binários anteriores não são automaticamente herdadas.

Smoke posterior de servidor/UI do próprio payload PASS, Node24.16.0 embutido:
`scripts/verify-portable-server.mjs`, temp RPlayout-portable-server-QveWZE.
Banco/cofre novos, health HTTP e página200, JS servido comparado por SHA256
com payload (index-DkAw6NpA.js,4e9d6ecddd3aacec3db643dd576e7a7cf7437a6d261c3fb50f572a1175111657).
PGM/media-server/ingest nativo desabilitados; servidor exclusivo encerrado.
Primeiros ensaios falharam porque PATH isolado omitira WindowsPowerShell/v1.0;
DPAPI do cofre requer esse componente do Windows. PATH corrigido só com
pastas do pacote e System32/WindowsPowerShell, sem Node/GStreamer globais.
Falhas preservadas em temps d6ZYqy/VI2Jo5; não desativada proteção do cofre.
Não é Windows limpo, teste de atalhos ou homologação operacional completa.

Correção posterior NÃO incluída no ZIP r51: o fonte agora resolve PowerShell
pelo caminho absoluto SystemRoot/System32/WindowsPowerShell/v1.0, em vez de
buscar pelo PATH.11 testes PASS, incluindo criar/reabrir cofre temporário
DPAPI com PATH vazio e proteger contra raízes relativas/remotas. Build do
servidor atualizado em scratch/group10-absolute-dpapi-server-20261012 PASS.
Não modifica o ZIP já publicado neste chat nem herda o smoke da r51: incorporar
ao próximo pacote e conferir novamente a partida do payload atualizado.
