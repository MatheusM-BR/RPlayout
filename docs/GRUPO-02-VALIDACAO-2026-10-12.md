# Grupo 2 — rodada consolidada em 12/10

Rodada posterior final: Rust94 PASS/3 ignored; NDI1 caso com3 ciclos PASS,
30,57s; OMT perda/retorno final1 PASS,9,20s. Histórico de intermitência, produto
alterado, limites de prova e próximas ações em
`GRUPO-02-NDI-RECUPERACAO-2026-10-12.md`. Retorno curto não prova retry após
EOS longo. Caso adicional22998 comprovou esse retry local (1 PASS/16,87s),
decoder2→3 com imagem vermelha/áudio, mesmo item. Engine release PASS/hash no
relatório; nenhuma fonte externa homologada, nenhum instalador novo.

DeckLink 2.2 adiada pelo usuário. Demais verificações não fechadas por estes
resultados locais; fontes externas e estabilidade continuam necessárias.

- Compilação inicial revelou dereference de Result no loader OMT; corrigido
  antes da segunda compilação, erro original preservado no histórico da rodada.
- Cargo test engine omt::tests, excluído loopback: **7 PASS**, inclui ABI,
  formatos, relógio corrente/retorno/reset e timestamps não especificados.
- Vitest local: live-signal 19, live-source-monitor 15, warning-markup 2:
  **36 PASS**. pnpm não iniciou testes por tentativa de buscar metadata na
  rede; execução feita com Vitest já instalado, sem instalar dependências.
- Rodada engine-transport + qc-live-preview: **152 PASS / 1 FAIL** (139 casos
  engine, 14 QC). Falha no encerramento de TAKE atual sem identidade inicial.
  Não tratar logs de cenários negativos esperados como novas falhas.
- Produto corrigido: identidade pendente desconhecida vincula UMA vez ao
  estado armado correspondente, positivo e com capacidade nativa. Identidade
  conhecida não é substituída por outra; erro de decoder antigo continua
  recusado. Guarda exige pendingLiveTake existente.
- Replay dirigido da falha: **1 PASS / 138 skipped**, não suíte integral.
- Regressão final do arquivo engine-transport após guarda final: **139/139 PASS**,
  sessão55021 terminada com exit0. Não somar replay aos casos originais como
  verificações distintas. As 14 verificações QC da rodada anterior passaram.
- Loopback oficial OMT sessão48538: não concluiu. Processo de teste confirmado
  por caminho/comando/pai/criação; threads em espera, sem etapa identificada.
  Encerrado somente esse processo após diagnóstico, exit0xffffffff, **ensaio
  interrompido, não PASS**. Não concluir causa interna pelo estado das threads.
- Fixture instrumentada (sem alterar asserções): etapas explícitas e deadline
  global60s cobrindo criação/discovery/recepção/cleanup do SDK, que ficavam fora
  das janelas8s anteriores. Rodada instrumentada32773 terminou **exit124 / timeout
  stage3 (official discovery)**: GStreamer e publisher/runtime construídos;
  descoberta não completou. Não repetir/reconsultar handles terminados.
  Sem UnauthorizedAccessException reportada nessa rodada, mas descoberta/recepção
  ainda não fechadas. Não concluir causa dentro da DLL sem diagnóstico adicional.
  Nenhuma fonte externa homologada.

Nova build instalável não gerada. Test binary Rust compilado, não release final.
Totais inalterados:10 grupos1/9;53 verificações5/36/12.

## Diagnóstico de ambiente e ensaio OMT final

Loader agora serializa inicialização e consultas/cópia das strings retornadas
por getaddresses (buffer compartilhado válido até a próxima consulta). Faz
uma consulta inicial antes de criar handles send/receive, sem substituir
descoberta por endpoint direto. DLL embutida reporta FileVersion1.0.0.19.

Rodada75378 no sandbox: consulta inicial retornou0, seis consultas retornaram1;
timeout60s exit124 na construção do receptor (stage4). A hipótese de deadlock
na DLL não ficou provada. Não atribuir a mudança de etapa apenas à priming.

Comparação com MESMO executável compilado, runtime e asserções, usando rede
local autorizada fora do sandbox: **1/1 PASS, exit0, 8,49s**.
Descoberta6consultas/source1, vídeo branco e seno reais, delivered3,
appsrc vídeo/áudio, CUE PVW sem PGM, LOAD/TAKE, telemetry original320x180
versus compositor640x360, áudio audível e frames PGM; cleanup terminou.
Nenhuma UnauthorizedAccessException de logging reportada.

Diferença de ambiente é evidência de interferência das restrições de execução,
não homologação de rede externa, fonte comercial ou estabilidade prolongada.
Sessions48538/32773/75378 são terminais; não consultar/reiniciar por status.
Código final do produto foi exercitado neste teste; não repetir os testes
servidor/UI inalterados. Manter falhas/interrupção anteriores no histórico.

Fonte primária de contrato de strings consultada:
https://github.com/openmediatransport/libomt/blob/master/src/DiscoveryInstance.cs
