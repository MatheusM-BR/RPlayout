# Ponte de campos protegidos — NOT_RUN

Atualização 11/10: atestado de assinaturas estrangeiras integrado ao selo e à
reproteção, sem reassinar autoridade. Ver HA-EVIDENCIA-ASSINATURAS-ESTRANGEIRAS.md.
Correção do diagnóstico: checkpoints são JSON; journals HA em operator_decisions
usam contexto padrão já coberto. Afirmações anteriores sobre cofres especiais
desses registros não são o diagnóstico atual. Revisão semântica ainda pendente.

Atualização: orquestração de reproteção no principal integrada em fonte em
HA-REPROTECAO-PRINCIPAL.md, também NOT_RUN. Não instala/aprova a derivada para
operação; ausência de integração descrita abaixo é histórico da etapa anterior.

Implementação em lote, sem testes/build; fora R55. Exportação pelo pareamento
agora integra ponte cifrada de campos conhecidos em NOVA cópia privada.
Importador/reproteção foi implementado no auxiliar, mas ainda não integrado
ao fluxo de revisão/restauração no principal. Não anunciar restauração pronta.

Reserva lê o cofre da própria instalação (sem criar/trocar chave), decifra cada
campo conhecido apenas em memória e o recifra com chave derivada de pareamento
e exportId. Contexto AES-GCM inclui exportação/tabela/coluna/PK. Não serializa
nem transfere a chave privada de instalação. Chave de pareamento chega ao worker
somente em memória privada, não por argumentos de terminal/API do navegador.

Ponte armazena PK estável, hash do ciphertext original e envelope export-scoped
na tabela ha_protected_field_bridge da DERIVADA, nunca na execução original.
Inventário completo autenticado, limite 100 mil entradas/64 MiB; excesso/legado
não protegido/chave incompatível recusa, sem fallback/truncamento. SQLite usa
DELETE/FULL na cópia privada e consolida antes de selar. Selo inclui sourceDatabaseHash
da origem bruta, databaseHash dos bytes transportáveis e prova da ponte.
SHA da cópia bruta conferido antes de transformar; origem/identidade reconferidas
e SHA final do destino efetivo registrado. Falha preserva parcial sem selo.

Importador em worker exige outra NOVA derivada do principal, proof correspondente
ao pareamento/exportação, cobertura completa dos campos conhecidos, PK e hash do
ciphertext original. Decifra ponte e reprotege no cofre do principal na transação;
inventário adulterado aborta o lote. Não copia chaves, não instala banco ativo,
não seleciona cursor/edição/PGM. Ainda precisa orquestração própria/SHA/diário/API
antes de ser habilitado no fluxo. Recebimento original permanece imutável.

Cobertura atual é protectedColumns, não cofres/contextos customizados de todos
os journals HA/checkpoints. Esses contextos continuam bloqueados para restauração
operacional. Apenas recifrar não valida mídia, edição, cursor, comandos ou autoridade.
Provas/recibos e metadados não autorizam publicação.

Faltam integração da reproteção isolada no principal com origem/hash/diário,
tratamento completo de contexts customizados, validação de conteúdo/edição/mídia/
cursor/comandos, retenção/geração perdida, retorno/rejoin; testes de transação/
chaves/bytes/PK/limites/cancelamento/crash, homologação, build e publicação.
