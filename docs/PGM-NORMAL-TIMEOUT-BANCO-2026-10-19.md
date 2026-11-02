# 7.3 /9.4 /10.4 — PGM normal durante timeout real do banco

## Escopo distinto da retomada recusada

Ensaio novo usa `createApp`/`runtimeFor` reais, banco/grade QA, mídia sintética
local com metadados declarados e saída exclusivamente para arquivo novo. Host
e dono do canal adquiridos pelo fluxo NORMAL do produto. Não é backend HTTP
instalado nem valida ingestão/QC, cabo, fonte externa ou toda a continuidade.

Inspeção do factory confirmou: admissão restaurada/HA é uma opção distinta.
Neste banco novo, `ha`, `restoredAdmission` e `haExecutionAdmission` são nulos;
a publicação normal local não instala a concessão especial de restauração.
O teste não desativa uma concessão configurada nem simula prova de posse.
Preservada a falha de consulta de portas da retomada uSd4el/F55TR6; este caso
não homologa essas consultas ou a retomada protegida por caminho alternativo.

Engine já compilado0250 no cache D:, sem recompilação/escrita em D:; SDK de
desenvolvimento em C:, registry/temporários/mídia novos na própria pasta QA.
Servidor/domínio99748AED, bridgeC60C2EFD/serviço9EB4D10D. Não é pacote portátil.

## Resultado original — FAIL preservado

`scratch/normal-pgm-storage-timeout-pQ9ViJ/result.json` permanece FAIL:

1. PGM nativo confirmado no itemVT, decoder1 e cursor52; as-run aberto e
   checkpoint persistido. HostREADY/posse confirmada; fencing especial false
   corresponde ao factory normal, não a uma liberação forjada.
2. Proxy QA reteve ACK REAL de UPDATE dentro de transação não commitada. O
   prazo do produto NÃO foi reduzido:30.013,7345ms observados; serviço perdeu
   conexão, resultado declarado desconhecido, COMMIT posterior recusado.
3. Mesmo engine21104 continuou vivo e cursor avançou52→854, mesmo item/início.
   Contador sozinho NÃO foi aceito como prova de imagem e áudio.
4. Encerramento pediu shutdown, mas o engine terminou por SIGTERM, não código0.
   O teste recusou explicitamente essa finalização, antes de aprovar a captura.
5. `app.close()` também recusou STORAGE_CLOSED pelo banco inabilitado. Nenhuma
   assinatura de encerramento ou liberação SQL foi fabricada para passar QA.

Marker da falha: um UPDATE alvo, ACK retido/inTransactiontrue, sem reenvio;
serviço encerrado por seu próprio proxy após desconexão do pai.27COMMITs na
contagem pertencem ao fluxo completo de inicialização/publicação; NÃO aplicar
o esperado0 do ensaio antigo de banco vazio a esta fixture com createApp.

## Captura existente — conferência independente limitada PASS

Sem reiniciar o engine ou repetir os30s, o leitor examinou o arquivo existente
e gravou somente medições derivadas. `assertions-local-capture.json` PASS,
com `sourceRunResult:FAIL` e `nativeGracefulExitQualified:false` explícitos:

- 858quadros decodificados,34,32s a25fps.
- 1.647.616amostras estéreo,34,3253s a48kHz.
- Três janelas distribuídas em25/50/75% da captura:18/19/16transições com
  movimento, imagem não uniforme; áudio997Hz nos dois canais, concentração
  em5/5janelas em cada canal.
- MKV original e arquivo principal SQLite com bytes preservados pela leitura;
  integridade `ok`, zero violações FK e UPDATE pendente ausente (valor0).
- Backend15208, engine21104, proxy20752 e SQLite2036 ausentes, sem matar PID
  reconstruído. Não alegar inventário completo da família por esses quatro PIDs.

Isso comprova dados reais decodificáveis e movimento/tom distribuídos na
publicação LOCAL NORMAL durante o ensaio, não finalização limpa de container,
alinhamento exato de PTS/A-V, cada quadro entregue sem lacunas ou disponibilidade
HTTP. A entrada MKV tinha tamanho0 na observação enquanto aberta, mas879.554bytes
após o encerramento; NÃO concluir ausência de mídia a partir do tamanho aberto.

Banco retém um as-run aberto e checkpoint52, apesar do cursor nativo854 antes
de fechar. Isso é uma lacuna real de persistência durante falha, NÃO recuperação
completa homologada. Não reparar/encerrar histórico por SQL manual nesta cópia.

## Causa de encerramento a corrigir

`EngineTransport.close()` envia shutdown e agenda kill padrão em1s. Já o nativo
`Publisher.shutdown()` pode esperar EOS por5s e `Channel.shutdown()` tem outra
espera de5s. O teste normal observou SIGTERM nesse fluxo. Além disso,
`closeConfirmed()` força SIGKILL imediatamente: é apropriado à limpeza de
promoção/posse inconclusiva, não prova de finalização normal de gravação.

Próxima correção: separar shutdown normal com espera limitada/verificada da
parada forçada de segurança. Manter os prazos de perda de posse e a capacidade
de encerrar imediatamente na promoção/erro; não aumentar CUE/TAKE/timeoutSQL,
nem aceitar arquivo truncado como fechamento limpo. Produto NÃO alterado por
este lote de teste; correção e validação agrupada ainda faltam.

## Instrumentação compatível com o isolamento de ambiente

A filtragem nova remove corretamente variáveis QA também. Os roteiros antigos
de falha/observação dependiam delas e precisavam adaptação, não exceção na
allowlist de produção. Novo staging somente em pasta QA vazia/materializada:
bridge idêntico, proxy legado copiado intacto, loader e contexto sidecar com
hashes. O loader cria somente os caminhos da fixture no próprio processo QA;
não herda credencial do backend, concede posse ou sintetiza ACK.

Três roteiros de falha/observação e seus leitores aceitam esse versionamento;
os fontes originais dos proxies, cópias históricas e FAILs não mudaram. Casos
antigos NÃO reexecutados por status. A configuração nova foi exercitada neste
ensaio completo: inicialização real/ACK retido/prazo real/desconexão. Tipos dos
nove arquivos do lote e sintaxe do loader PASS. Não requalifica concorrência ou
o ensaio SIM compilado por inferência.

## Pendências mantidas

7.3/9.4/10.4 abertas: corrigir/testar shutdown normal, persistência/recuperação
com banco perdido e retomada protegida; NativeGate/seleção/ZIP/instalação r88
pendentes. R87 intacta, r88NOT_BUILT; nenhum build novo do produto neste lote.
Sem escrita D:, limpeza, mudança de políticas ou certificação de fontes físicas.
Total:10grupos/53verificações —8concluídas,34em andamento,4pendentes,7v3.
