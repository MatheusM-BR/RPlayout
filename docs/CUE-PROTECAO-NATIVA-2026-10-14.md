# CUE e edição operacional — proteção nativa integrada

Novo cenário dirigido `verify-priority-playout.mts --cue-protection-native`:
PASS, exit0, fixture `scratch/priority-playout-Pk9xnn`.
Requisitos 4.1/4.4/4.5 seguem em andamento; isso não encerra o grupo 4.

Servidor compilado E5E95ECDB75DFBD2B597C0C11709C73B2340233F20F0C5DE869311A5FBA03CDD;
engine 3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.
VT/arquivo sintético real, SHA publicado e decoder nativo. Broker próprio em
loopback, somente após conferir portas TCP/UDP livres. Não reutiliza ou para
outra instalação. Saída PGM null; sem homologação de placa, NDI/OMT externo,
browser, rede remota ou pixels físicos de programa.

## Resultado

- CUE no filler de 500 quadros recebeu vídeo RTSP realmente decodificado
  320x180, não apenas ACK/metadados: desvio de luminância 29,834.
- Uma compensação conferida **antes** do CUE foi recusada no commit (409)
  depois que o alvo entrou no CUE; nova conferência também foi recusada.
  Nenhuma revisão nem decisão de compensação foi criada nessa recusa.
- Publicação editorial que alterava corte/duração do item preparado foi
  recusada (409/CUE), mantendo a revisão original.
- Publicação urgente compatível, só de título, criou revisão 2 sem trocar
  PGM ou CUE. Mesmos item VT e `startedAt=1157280`; cursor não retrocedeu.
- Limpar CUE permitiu nova conferência/compensação: revisão 3, filler nominal
  500→525 quadros, uma decisão de compensação.
- Reabrir o CUE ajustado recebeu imagem 320x180/desvio 29,843. Rollback para
  revisão 1 foi recusado enquanto alteraria esse CUE (409), sem revisão nova.
- Limpar CUE permitiu o rollback conferido, criando revisão 4 com origem na
  revisão 1, sem mudar o VT/ocorrência no PGM. Revisão original byte-a-byte
  preservada; rascunho manteve o título editorial “Urgent title only”.
- STOP apenas do canal de fixture, servidor/família própria encerrados,
  `ownedCleanupConfirmed:true`, `historicalPidKills:false`.

## Falhas preservadas e ajuste do leitor

`VLjFfK`: primeira leitura RTSP404. A fixture não havia assinado `watching/pvw`;
preview econômico sob demanda estava desligado. Corrigida a assinatura na
fixture, com espera pela prontidão do caminho próprio antes da captura.

`f8FELT`: captura de CUE de 2s ficou uniforme, sem provar imagem. A fixture
dirigida passou a usar CUE de 20s, para não confundir o fim do trecho com o
ensaio de proteção. Isso não é qualificação de clips curtos/EOS de PVW.

`L5H95R`: CUE de 20s também falhou na captura inicial: desvio 2,644, quadro
cinza com contorno residual. Diagnóstico registrou decoder3 entregando quadros
recentes (33ms), cursor190/duração500, PGM nativo preservado. Comando aceito e
quadro entregue não foram usados como substitutos de imagem recebida válida.

O leitor anterior encerrava após 26 quadros, menos que o GOP de 2s do emissor.
Novo leitor solicita/aguarda keyframe em access units e observa 75 quadros;
critérios de dimensão e desvio>10 mantidos. Somente com esse leitor a fixture
Pk9xnn passou. Compatível com entrada do leitor no meio do GOP; não é prova
de latência inicial do navegador nem diagnóstico definitivo de todos os
quadros cinza vistos em instalações reais. Nada no engine foi alterado para
forçar um resultado positivo. Os três registros de falha foram preservados.

## Ainda falta

Fluxo visual nativo completo de publicação/rollback com CUE, concorrência entre
estações, recuperação/falha durante escrita e integração do próximo instalador.
Live prioritária/retomada com fontes externas continua separada. Não repetidos
os ensaios já aprovados de corrida entre duas contas só para mudar status.

Totais: 10 grupos/53 verificações — 6 concluídas, 35 em andamento,
5 pendentes e 7 v3. Nenhuma verificação global encerrada por este cenário.
