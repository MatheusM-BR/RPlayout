# RPlayout r43 — instalador parcial, não homologado

Inclui r41/r42 e o encerramento de observações PGM anteriores após admissão
nativa com posse comprovada. Consulta antecipada na tela de saúde pode criar
uma sonda vazia, mas não impede essa reconciliação. Alertas ativos e transições
ainda pendentes da sonda atual são preservados; não há recuperação presumida.

O incidente original mantém contexto, reconhecimento e resolvedAt vazio.
Evento de fim da observação, atualização, auditoria e fila externa são atômicos
e idempotentes. Outro canal, posse encerrada, simulação, standby e quarentena
não autorizam a ação. Não envia TAKE nem altera a grade.

Validação local: seis novos testes aprovados (incluindo sonda vazia/ativa e
recuperação pendente); sete testes afetados da ponte PGM aprovados. Tipos e
compilação do servidor conferidos. Não é homologação de reinício com sinal físico.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Faça backup do banco
e cofre antes de migrar. Mantém migração48: voltar banco48 para pacote antigo
não é rollback homologado. Inclui runtimes portáteis da base anterior;
DeckLink exige driver oficial. Engine e interface preservados da r41.

Instalação NÃO testada. Não é Setup.exe assinado e não inicia o servidor.
Ainda faltam ensaio compilado do reinício deste lote, reconciliação de falhas
de fontes/saídas e homologação física/remota/prolongada. Grupo9.2 em andamento.

Total:10 grupos —1 concluído/9 abertos;53 verificações —5 concluídas,
24 em andamento/24 pendentes. Não é entrega final para operação no ar.

Registro externo após empacotamento (não integra o LEIA-ME interno):
450443105 bytes; SHA256
9F96AC6D2E1F133FDAB39718E9B3C94799732D17F50FA2411D65D946CB8F0A7A.
Ensaio compilado YCy82r PASS: duas instâncias sucessivas de servidor/engine
próprios, encerramentos observados, predecessor assinado vinculado, incidente
histórico sintético com contexto/ACK preservados e sem resolvedAt, um evento
externo loopback e uma auditoria. As-run0, saída nula, instalação não testada.
Server DF413F3A338E29E2165CA1FE9CC66945C8020F794624D3EA5096409EBA3D292E.
