# 10.2 / 10.5 — termos oficiais NDI localizados, aplicação ainda não comprovada

Estado: REVIEW_REQUIRED. Não autoriza publicação nem altera a DLL instalada.

## Uso definido pelo usuário em 19/10/2026

Resposta expressa: **uso interno e testes, sem distribuição**. A próxima
entrega prevista é uma build interna para testes em D:\RPlayout-builds,
não uma publicação pública ou redistribuição do produto. Não publicar nem
enviar binários ao GitHub com base nesta resposta. Uma eventual distribuição
futura requer nova definição do usuário e revisão específica.

Essa decisão esclarece o destino da entrega; não equivale a aceite de contrato
nem comprova licença aplicável ao uso interno dos runtimes. A conferência do
vínculo entre a DLL e os termos correspondentes permanece REVIEW_REQUIRED,
separada da futura revisão de redistribuição. Não é necessário autorizar
distribuição pública para continuar as implementações e os testes internos
permitidos. Não remover avisos nem alterar a classificação para aprovada.

Os bloqueios técnicos de compilação e empacotamento continuam independentes;
esta decisão não gera build, não valida sinal e não encerra 10.2 ou 10.5.

## Evidência local

Base r30: Processing.NDI.Lib.x64.dll,29.863.120bytes, FileVersion e
ProductVersion6.3.2.0, SHA256
2b6602075868ba4401f82f417d72424805d69b11ca86078023d0d489ff45dd84.

Leitura da instalação r87 no D: confirmou o MESMO tamanho/hash nas cópias
da raiz e apps/server, ambas de acordo com package-manifest.json. Não houve
nova instalação, mutação de pacote, substituição ou nova qualificação de sinal.

## Fontes oficiais consultadas em19/10

A documentação atual remete especificamente ao SDK6.3.2 para os termos
completos; atribuição visual não substitui o contrato do SDK.
[Licenciamento oficial](https://docs.ndi.video/all/developing-with-ndi/sdk/licensing).

A página de distribuição condiciona a inclusão de binários aos termos do
SDK e da aplicação.
[Distribuição oficial](https://docs.ndi.video/all/developing-with-ndi/sdk/software-distribution).

Dois documentos distintos estão acessíveis no domínio oficial:

- [NDI SDK License Agreement](https://downloads.ndi.tv/SDK/NDI_SDK/NDI%20SDK%20License%20Agreement.pdf):
  leitura web,7páginas. Define condições de distribuição e do contrato do produto,
  atualização/compatibilidade e exclusões conforme o ambiente de implantação.
- [NDI License Agreement](https://downloads.ndi.tv/SDK/NDI_SDK/NDI%20License%20Agreement.pdf):
  leitura web,5páginas, identificado no texto como novembro2024.

São fontes para revisão, não prova de que qualquer uma acompanhe a DLL
6.3.2.0 existente. URLs sem versão podem mudar. Não tratar nomes parecidos,
licença de NDI Tools ou um PDF antigo como contrato equivalente. Falta vínculo
com o pacote SDK correspondente ou confirmação do fornecedor e revisão dos
termos aplicáveis/EULA do produto. Não é parecer jurídico.

O [download oficial do SDK](https://ndi.video/for-developers/ndi-sdk/download/)
encaminha a formulário com dados pessoais/empresa/uso. O formulário foi apenas
lido. Não enviado; nenhum cadastro, consentimento de marketing ou aceite foi
submetido em nome do usuário nesta etapa.

## Coleta local e limite observado

scripts/collect-ndi-review-material.mjs coleta somente os dois PDFs públicos,
com limite de tamanho, tipo/magicPDF, SHA, origem e resultado de revisão. Não
baixa nem instala SDK; não modifica ZIP/base/instalação; os materiais iriam
somente para scratch, sem integração automática como licença aprovada.

Execução preservada em scratch/ndi-review-material-XI6kI5/result.json:
COLLECTION_FAILED. A primeira requisição falhou com ENOTFOUND para
downloads.ndi.tv, antes de obter HTTP/PDF. Não há PDF local coletado nem SHA
do documento confirmado. Não se tentou rota alternativa, alteração de DNS,
proxy, ACL ou autorização para contornar a falha. Sintaxe do coletor PASS;
coleta funcional NÃO aprovada. A leitura via pesquisa web não foi confundida
com download de bytes para o workspace.

## Próximo passo e pendências

Passar de “documento não localizado” para “fontes oficiais identificadas” é
progresso de procedência, não liberação. Falta obter o SDK correspondente em
ambiente autorizado, vincular seus termos aos binários e revisar cumprimento
antes de publicar. O fato de o SDK já estar em uso não foi interpretado aqui
como autorização de redistribuição.

Manter DLL/autonomia do pacote e avisos existentes; não retirar NDI para fazer
a auditoria passar nem aceitar termos automaticamente. Não solicitar novamente
o caminho antigo que o usuário já informou não possuir; usar o portal oficial
ou confirmação do fornecedor como próximos meios de obter a referência.

Continuam separados Windows limpo, fontes físicas/externas, licença dos demais
componentes/codecs e bloqueios de compilação/instalador. Nenhuma nova build ou
publicação.10grupos/53verificações:8concluídas,34em andamento,4pendentes,7v3.
