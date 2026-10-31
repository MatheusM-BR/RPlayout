# 6.2 — journal durável e transporte nativo: integração em andamento

Estado: **COMPONENTS_IMPLEMENTED / LOCAL_TESTED / NOT_ACTIVATED**.
Não é failover físico/PGM entregue. Não houve instalação, publicação, aceite
de licença ou alteração de binário nativo. Destinação continua interna/testes.

## O que entrou neste lote

- native-live-replacement-ledger.ts: intenção/recibos no operator_decisions
  protegido existente, com health_events na MESMA transação IMMEDIATE.
  Nenhuma alteração de schema nem comando nativo dentro da transação SQL.
- Vinculação ao canal, revisão operacional, execução, ocorrência, posse,
  geração UUID do engine, item/decoder atuais, fonte e política. Par precisa
  ser recíproco/habilitado, mesmo canal e papéis distintos. Uma assinatura
  HMAC da conexão realmente aberta impede usar somente o ID do cadastro
  depois de alterar seu endereço. URI/credencial não são armazenadas no journal.
- Validação de configuração novamente antes de enviar preparo/corte. Intenção
  é gravada antes dos bytes no pipe. Campos prepareSent/commitSent/cancelSent
  são marcadores conservadores de intenção de envio, NÃO prova de recebimento
  pelo engine: falha após o commit SQL pode deixar o resultado inconclusivo.
- Idempotência/ator/contexto, bloqueio de nova transação enquanto a anterior
  não foi reconciliada. COMMIT não pode ser repetido depois da intenção durável,
  mesmo se uma consulta posterior retornar READY. Apenas consultar/reconciliar.
- Recibos exigem contexto/gerações iguais; decoder/cursor obrigatórios para
  COMMITTED. Recibo terminal é imutável; leitura repetida de um fato idêntico
  não duplica auditoria. COMMITTED sem intenção de COMMIT é recusado.
- Recibo do engine ainda pode ser persistido se a sessão do operador expirou,
  mas só sob a posse original válida. Histórico lido continua autorizado.
- native-live-replacement.ts: cliente do pipe com callbacks obrigatórios de
  autorização/journal, geração/capacidade negociada, correlação de ACK+recibo,
  prazo limitado e consulta em vez de reenviar corte. Sem fallback para TAKE,
  toggle de metadados, retry automático ou kill do engine por ACK perdido.
- Confirmação exige estado de seleção observado pelo port; recibo histórico
  não vira prova do programa atual. Prontidão pode ser retirada; erros de
  persistência, geração antiga ou seleção UNCERTAIN não geram sucesso fictício.
- EngineTransport real já lê a capacidade e programSelectionUncertain. Esse
  estado bloqueia evidência de posição/checkpoint, novas mutações de PGM e
  avanço automático, remove atribuições PGMs da fonte incerta e não mata o
  engine apenas por incerteza. Não bloqueia os monitores de vídeo/áudio reais.
  Estado falso posterior não limpa a proteção; somente STOP com ACK e PGM vazio.
  Após morte do processo, não retoma silenciosamente a fonte anterior incerta.

## Limite explícito da integração

O cliente novo ainda NÃO está conectado aos comandos privados reais de
EngineTransport nem aos endpoints/ChannelRuntime. Os endpoints existentes
continuam METADATA_DECISION_ONLY. Não foi registrado listener que transforme
esse recibo de metadados em corte de PGM.

Port de escrita/seleção e eventos nativos foram SIMULADOS nos testes do
cliente; journal e falhas de SQL usaram SQLite real local. A integração SQL+
cliente verifica que recusa real da auditoria impede escrever COMMIT no port
de teste; NÃO prova IPC de um engine real, vídeo, áudio ou corte publicado.

EngineTransport somente recebeu a leitura de capacidades e a proteção de
incerteza. Ainda não recebeu orquestração de preparar/confirmar/cancelar,
binding da perna selecionada, mudança de telemetria e recuperação do novo source.
Não confundir supported no health (protocolo anunciado) com entrega habilitada.

## Evidência efetiva, sem repetir suítes por mudança de status

Resultados em scratch/native-live-replacement-server-633f08fa:

1. tests.json: **274/274 PASS**,6arquivos: transporte182, recuperação22,
   incidentes17, failover de metadados13, cliente nativo20 e journal20.
2. Revisão final dos dois módulos novos: validação de entrada/canonicalização,
   alternativa única, recibo imutável e auditoria sem duplicação.
   tests-final-focused.json: **45/45 PASS**, cliente23/journal22.
   Não são319testes únicos nem45requisitos fechados; suítes não afetadas da
   rodada anterior não foram repetidas só para atualizar status.
3. TypeScript do servidor completo: PASS/exit0, também após a revisão final.
4. Compilação isolada dos14executáveis JS do servidor: PASS/exit0, subpasta
   server deste lote. Bridge/serviço inalterados. Não é instalador/Windows limpo.
5. Diff dos arquivos do transporte sem erros de whitespace; avisos LF/CRLF
   são só normalização prevista pelo Git, não validação funcional.

Na primeira rodada,52/53 PASS e1FAIL: o cenário de outro canal tentava mover
uma fonte para canal inexistente e violou FK ANTES da regra testada. Fixture
corrigida criando o outro canal, sem desativar FK nem alterar a regra de par.
Essa rodada inicial não foi reclassificada como totalmente aprovada.

Hashes após a revisão final:

| Artefato | SHA256 |
| --- | --- |
| server/server.cjs | 7A2DACA3EFBE64C10D97AE54719045A47586B3930C737BAA9564A92AE12EE81D |
| server/storage-bridge.cjs | C60C2EFDC5A68983C1C27FEBDEDC8C882B696A90BA450CFCC90D6025B6D64B5D |
| server/storage-service.cjs | 9EB4D10D289F440A78ABE014108BF401CDE7AB282168AB613939949F74D70771 |
| src/domain/engine.ts | A67961F51F573C2B3D7B09E3754826799FA9F5EA21686280A6D2BCFFECFE24A8 |
| src/domain/native-live-replacement.ts | 432AA89E63E3CF3FFE4BD2A98F83A65C6BFD713EBB832D11356BA927A7B8F41C |
| src/domain/native-live-replacement-ledger.ts | 983BB917560061C837B809B247BF548303A10AA1B299E9FB58A6EE9486F80CC4 |

Os componentes de journal/cliente ainda não usados pelo runtime não são
anunciados como fluxo incluído/ativado no bundle. O bundle comprova as
alterações efetivas de health/proteção do EngineTransport, não ligação de PGM.
O servidor4E3 anterior e todos os relatórios anteriores foram preservados;
o candidato isolado não mudou automaticamente seletores de empacotamento.

## Próximo lote obrigatório — não ativar antes

1. Conectar cliente ao filho atualmente pertencente ao servidor, à fila de
   transporte e aos IDs globais de RPC; receber ACK+evento e espontâneos.
   Conectar journal ao Runtime com ocorrência/as-run/lease reais, não contexto
   enviado pelo navegador. Reautorizar ator/canal antes de ações.
2. Binding por barramento da perna confirmada: PGM pode usar backup enquanto
   CUE/QC do mesmo item continua na fonte original. Não limpar CUE nem reiniciar
   onAirStartedAt/as-run ao receber State da mesma ocorrência com outro decoder.
3. Checkpoint/retomada/compatibilidade: schema atual continua versão1 e NÃO
   guarda perna alternativa. Persistir/reconciliar binding confirmado sem
   credenciais abertas e impedir rollback antigo de ignorá-lo silenciosamente.
   Não habilitar o corte antes desse contrato estar integrado.
4. Resolver de forma durável STOP confirmado e intenção abortada antes de
   qualquer envio. O STOP do EngineTransport hoje limpa somente sua proteção
   em memória; NÃO fecha automaticamente o journal SQL UNCERTAIN. Nunca marcar
   COMMITTED ou apagar esse histórico para liberar o canal.
5. Execução nativa dos12testes escritos no lote Rust anterior continua NOT_RUN;
   compilar/testar engine e host guard autorizados, testar perda de ACK/SQL,
   cancelamento, deadlines, próximo preparado e capturar pixels/PCM de ambas as
   fontes. Separar sintético local, sinais externos e hardware.
6. Integrar interface e pacote/instalador interno no D:. Permanecem revisão de
   termos de uso, remoto, Windows limpo e soak. DeckLink física segue adiada,
   fontes externas NDI/OMT indisponíveis e grupo8 reservado à v3.

Nenhuma r88 gerada.10grupos/53verificações:8concluídas,34em andamento,
4pendentes,7v3.6.2 e10.4 permanecem em andamento,10.5 pendente.
