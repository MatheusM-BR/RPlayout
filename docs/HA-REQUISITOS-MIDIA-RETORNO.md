# Pré-requisitos de mídia para retorno — NOT_RUN

Integração em lote, sem testes/typecheck/build/hardware/browser. Fora R55.
É preparação do plano de retorno, não plano aplicado nem aprovação do canal.

Revisão de conteúdo da derivada reprotegida reutiliza inspectHaLocalMount,
o mesmo contrato de montagem usado na preparação HA, sem duplicar a regra de
trim/track/routing/pares auxiliares/medição de áudio. A rotina compartilhada foi
exportada sem alterar a lógica usada no reserva.

Para cada VT/fallback, identifica assetId + SHA publicado e procura essa versão
nos payloads/fatos de mídia da fotografia AUTÊNTICA do principal. Mesmo assetId
com outro SHA não é equivalente. Ausência no snapshot gera requisito; não declara
que a versão é impossível de encontrar no arquivo/versionamento do principal.
Os fatos atuais do mesmo asset/SHA complementam o inventário congelado.

Decisões QC do mesmo asset/SHA e canal/@all seguem a ordem capturada: revogação
global posterior não é ignorada em favor de uma aprovação antiga. Não presume
aprovação pela tag antiga do payload nem aplica decisões de outro canal.

Verificação de montagem revisa metadados/cortes/trilhas/mixes/pares/medições.
Mesmo sem erro adiciona LOCAL_BYTES_AND_DECODE_REVALIDATION_REQUIRED: não abriu
arquivo, fez probe ou confirmou runtime/sinal. Todos os caminhos/URLs estrangeiros
permanecem descritivos, não são seguidos. Live exige seleção explícita local e
quadro/áudio; descoberta/igualdade de texto não prova sinal. Fallback é analisado
separadamente. Grafismos/eventos continuam exigindo suas verificações próprias.

Relatório em protectedFields.contentComparison.mediaRequirements traz contagens,
motivos conhecidos por item/edição e até 1.000 detalhes. Limite de 100 mil
montagens por edição e total; excesso recusa sem tratar truncamento como aprovação.
Página mostra bloqueados/lives e avisa bytes/decodificação/vínculos não validados.
localBytesValidated/localDecodeValidated/bindingsSelected=false.

Falta escolher/persistir plano de edição/cursor e vínculos locais, resolver
versionamento local fora do snapshot, verificar arquivos reais/SHA/probe/QC no
host, montagem nativa/trims/mixes/grafismos/comandos, autoridade e retorno/rejoin.
Fixtures de live, versão divergente e revogação QC preparadas: NOT_RUN.

10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 em andamento/
12 pendentes). Nenhum fechamento novo sem validação.
