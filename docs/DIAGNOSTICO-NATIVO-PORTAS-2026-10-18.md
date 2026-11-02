# 9.4 /9.3 /10.4 — diagnóstico de consulta nativa de portas

## Implementado neste lote

O backend descartava o motivo validado enviado pelo helper, substituindo-o por
uma mensagem genérica. A reserva do host continuava aparecendo confirmada,
embora a consulta de propriedade das portas tivesse falhado. Reserva e prontidão
são fatos diferentes; não foi relaxada nenhuma condição de admissão/publicação.

- O cliente privado agora conserva o motivo e a operação correlacionados,
  carimbo da observação e, quando fornecido, diagnóstico limitado da tabela.
  Timeout é explicitamente inconclusivo. Não fabrica código Windows ausente.
- A prova de família/posse ou uma operação diferente não apagam uma falha de
  sockets. Somente resposta válida correlacionada da mesma operação limpa essa
  última falha; respostas expiradas não confirmam consultas novas.
- A consulta autorizada de distribuição entrega esses campos sem adquirir posse,
  alterar banco, abrir engine, matar processo ou liberar saídas. Permissão
  OUTPUT_CONTROL e `private, no-store` preservadas. Conta OPERADOR recebe403.
- A tela de reservas mostra a falha, inclusive com posse local confirmada, e
  explica que isso não autoriza publicação nem presume porta livre. Não cria
  controles de liberação/elevação e não sugere encerrar processo alheio.
- O fonte Rust passa a fornecer tabela TCP4/TCP6/UDP4/UDP6, etapa e motivo;
  código numérico Windows somente quando a API realmente retorna erro. Sem
  endereço, PID, token, caminho ou texto arbitrário. Erros de tabela/layout/
  proprietário desconhecido continuam recusando a consulta, nunca tabela vazia.
  Falha de sockets em `process_ports` não é mais rotulada como falha de identidade.

O backend novo aceita helper anterior sem metadados e informa que ele não os
forneceu. Metadados inconsistentes, desconhecidos ou arbitrários são recusados.
O diagnóstico de falha não se torna concessão nativa nem altera o TTL/nonce.

## Evidência e limites

66 testes PASS em cinco arquivos: cliente IPC com processo simulado, posse/
rotas com banco local, renderização estática React e contrato compartilhado.
São testes afetados, não66 verificações novas. Incluem compatibilidade com helper
anterior, rejeição de campos privados/códigos inválidos, timeout/resposta atrasada,
preservação após prova de posse, limpeza correlacionada, isolamento de cópias,
ACL e exibição sem falsa prontidão. Código Windows5 nesses testes é **fixture**,
não código observado na consulta real anterior.

Tipos completos de servidor/interface PASS; tipos dirigidos do roteiro PASS
com Node explicitamente incluído. Uma invocação isolada anterior sem contexto
de tipos Node falhou; corrigida a invocação, não adicionado pacote ou supressão.

Servidor isolado: build14 entrypoints PASS, sem alterar dist convencional.
Interface: primeira compilação FAIL/EPERM ao criar `third-party`; consulta
posterior encontrou diretório materializado, sem reparse e com Modify permitido.
Nenhuma ACL/política alterada. Segunda compilação no MESMO destino/código PASS,
com inventário/avisos reais. A causa específica do EPERM inicial não foi
determinada; não foi contornada a exigência de avisos nem declarado PASS inicial.

Rustfmt dos dois arquivos PASS (parse/formatação), **NÃO é compilação/teste
nativo**. Novo helper ainda NOT_BUILT/NOT_RUN: permanece necessária a rodada
nativa autorizada e inclusão explícita do helper atualizado no pacote. O helper
instalado/C: não foi substituído. Não repetido o ensaio de PGM nem a consulta de
sockets bloqueada; resultados uSd4el/F55TR6 permanecem FAIL e sem código Windows.
Tela instalada/HTTP/browser não qualificados por renderização estática/build.

## Builds isolados atuais para futura r88

- Servidor: `scratch/host-history-r88-native-diagnostic-20261018/server.cjs`.
  SHA256 `5b92432fedfaf58cb6d9a7dffc2300ccc3acc521265f4aa603d1f3b110da4484`.
- Interface: `scratch/host-history-r88-web-native-diagnostic-20261018`, entrada
  `assets/index-DED2jcbR.js`; SHA256
  `efdc03ff397c91dfdd60d6e3836dd91e3df1f690510874bfb374a05e752bdfa1`.
- Helpers storage idênticos aos anteriores: bridge A7BE733D…, service9EB4D10D…;
  nenhuma repetição de seus ensaios inalterados.

Builds FADFFB13/E15DBFFB anteriores preservados, agora supersedidos para o próximo
pacote. Caso positivo do seletor atualizado para os hashes novos, NÃO EXECUTADO
sob recusa de scripts. Não confundir build isolado com instalador/instalação.

## O que falta

9.4 continua em andamento: compilar/testar helper, obter a falha real detalhada e
validar interface instalada. 9.3/10.4 abertas: prontidão nativa, ensaio completo
HELD→CUE→TAKE com pixels/PCM e demais casos registrados; seleção/compilação,
instalador em D: e instalação QA sob autorizações válidas. Não usar consulta
indisponível como prova de placa/driver ausente, nem desabilitar a proteção.

Não gerado ZIP, não escrito em D:, nenhuma instalação/cópia anterior modificada.
Grupo8 reservado à v3 e DeckLink física adiada, conforme decisão do usuário.
Total:10 grupos /53 verificações —8 concluídas,34 em andamento,4 pendentes,7v3.
