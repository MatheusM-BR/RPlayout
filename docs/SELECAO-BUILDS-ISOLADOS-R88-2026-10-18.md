# 10.1 /10.4 — Seleção explícita de servidor e interface isolados

## Implementação preparada

O empacotador aceitava `-ServerBuildDirectory`, mas sempre pegava a interface
de `apps/web/dist`. Os novos builds de histórico foram intencionalmente isolados,
pois a consulta de processos estava indisponível. Usar o empacotador assim
poderia combinar servidor novo com interface antiga, ou exigir sobrescrever
uma pasta cujo uso não foi confirmado.

`scripts/build-streamed-partial-installer.ps1` agora também aceita
`-WebBuildDirectory`. Ambas as origens passam pela mesma função somente-leitura
em `scripts/lib/build-source-roots.ps1`. O mapeamento de destino continua
`apps/server/dist/...` e `apps/web/dist/...`; não é overlay em instalação existente.
Origem externa exige caminho absoluto e `-UseCurrentBuilds`, que continua sendo
declaração do operador de compilação observada, NÃO uma prova automática dela.

A seleção verifica pastas materializadas, rejeita junction/symlink nos ancestrais
e na árvore antes de descer por eles, e não recorre a outro dist se faltar arquivo.
Servidor exige os14 entrypoints auxiliares já requeridos. Interface exige
index.html, build.json, inventário de avisos e entradas JS/CSS locais existentes
referenciadas pelo HTML; referências fora da raiz são recusadas. Não aprova
licenças, compatibilidade de runtime nem comportamento funcional por esses checks.

Manifesto/hashes finais, runtime Node/SQLite, engine explícito, margem de espaço,
destino novo e política de não sobrescrever ZIPs permanecem no empacotador. Este
lote não executou compilação nativa, gerou ZIP, instalou ou escreveu emD:.

## Verificação: sintaxe PASS, execução NÃO APROVADA

Parser PowerShell: zero erros no helper e no empacotador. Nenhum corpo de função
foi avaliado pelo parser; não confundir análise de sintaxe com teste funcional.

Rodada de oito casos `build-source-roots.test.mjs`: **0PASS/8FAIL**, diretório
`scratch/build-source-roots-5y37Sp`. Sete tentativas foram recusadas no carregamento
do script pelo AuthorizationManager/UnauthorizedAccess, antes da função nova.
As asserções negativas não atingiram o erro de negócio esperado. O caso de
junction falhou ao preparar a fixture com EPERM, sem criar o link. A rodada e
fixtures foram preservadas; não atribuir esses resultados a recusas validadas
do empacotador. `scope.json` registra o escopo, NÃO é um relatório de aprovação.

Consulta somente-leitura de Get-ExecutionPolicy no Windows PowerShell também
foi recusada com SecurityException de acesso ao Registro. Não foi possível
determinar a política efetiva; não presumir assinatura, malware ou defeito do
produto como causa. Nenhum ExecutionPolicy/Registro/ACL foi alterado, e não se
tentou outro host, carregamento indireto de função, assinatura falsa ou bypass.

Depois dessa rodada, o roteiro recebeu um preflight único: se o carregamento
for negado, registra BLOCKED/zero testes funcionais completados, sem tratar
autorização negada como prova de regra de negócio. Essa versão do roteiro não
foi reexecutada, pois a condição externa permanece. Os oito casos futuros cobrem
origem convencional, override Unicode, switch/caminho absoluto, servidor
incompleto, HTML antigo/asset ausente, metadados/entradas/traversal, junction
real e escolha dos hashes das compilações isoladas reais. Não são oito requisitos
novos da matriz53.

## Próxima execução autorizada

1. Executar os oito casos de seleção com permissões de script e fixture adequadas,
   sem contornar recusas; observar especialmente a execução real no PS5.
2. Completar a rodada nativa pendente do HELD e a compilação observada no cacheD:.
3. Gerar r88 emD: com ServerBuildDirectory e WebBuildDirectory apontando para as
   compilações isoladas novas, e EngineBinary para o binário novo conferido. Não
   usar os dist convencionais antigos nem engine610E.
4. Conferir manifesto/ZIP e instalar em destino QA novo; depois rodar o cenário
   HELD e o histórico HTTP/browser com conexões permitidas. Preservar FAILs.

Essa seleção funcional e seu uso no ZIP ainda estão **NOT_VALIDATED**. Não existe
ZIP r88; r87 e instalações anteriores permanecem intactas. O limite do serviço
de autorizações até22/10 e a recusa local de conexãoEACCES são impedimentos
adicionais já registrados nos relatórios de HELD e histórico.

10.1 mantém a conclusão histórica do artefato r87, não certifica este novo
empacotador/r88. 9.1/9.3/10.4 permanecem em andamento. DeckLink física adiada,
grupo8v3, fontes externas/licenças/homologações restantes não substituídas por
testes de seleção de arquivos. Sem limpeza/movimentação/publicação pública.

Totais10pendências/53verificações:8concluídas/34andamento/4pendentes/7v3.
