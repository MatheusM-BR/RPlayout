# Launcher com engine nativo e configuração de mídia — 16/10/2026

Resultado local: PASS, em ambiente QA isolado. Não é homologação da instalação
r80 completa, Windows limpo, estação remota ou sinais externos.

## Correção incluída na r80

O MediaMTX incluído é v1.20.1. A configuração oficial dessa versão habilita MoQ
por padrão e tem endereços UDP próprios; configurar apenas RTSP/WHEP não vincula
todos os listeners ao endereço escolhido. Referência primária:
[configuração oficial v1.20.1](https://github.com/bluenviron/mediamtx/blob/v1.20.1/mediamtx.yml).

O servidor agora declara MoQ, métricas, pprof e playback avulsos desativados;
RTP, RTCP e ICE seguem o mesmo bind da mídia. RTSP UDP/TCP continuam disponíveis;
multicast implícito fica desativado. Endereços são validados antes da partida e
IPv6 é delimitado e colocado entre aspas no YAML. API permanece em loopback.

Limitação ainda aberta em 10.2: variáveis ambientais MTX_* não são removidas
explicitamente antes da partida do broker. Este ensaio não incluiu overrides
ambientais; não comprova resistência a uma configuração externa conflitante.

## Compilação e casos afetados

- Servidor: `E226C793E654679BFB33C4A737948B2C1AC53C8D5AFC1285C4CF8F123A291C65`.
- Launcher preservado: `101A28C9E55C5A826B9805804F10853227D539B9A98CC4B018DDEC81F9DC82B8`.
- Engine preservado: `191CD1E112C7AFBA81896BBF3AA109A100775A7A358B7894FAAAFBE8D1ABDFBC`.
- MediaMTX: `114E6C0B514813658E10BE55F8AB6EAB950AE879943272A59B0A51D55930900A`.
- Web preservada: `index-BsVZYGz4.js`, SHA256 `8B0D3FCBD44724DE835FCBE491531F6A5A0629EA9A688ECA520EFD76A2499F1D`.

41 casos distintos afetados cobertos: identidade/configuração 13, admissão 4,
cerca do host 24. A primeira rodada teve 34 PASS/7 FAIL porque o mock antigo
não oferecia assertOwned. Corrigido somente o mock; os 13 casos desse arquivo
passaram no replay. Não contar o replay como 13 verificações novas. Tipos e
build do servidor passaram; não repetidos testes Rust/web sem alteração.

## Integração nativa real, limitada a arquivo sintético

Evidência principal: `scratch/launcher-native-RaCeNG/result.json`.
Conferência independente dos arquivos brutos e do SQLite somente leitura:
`scratch/launcher-native-RaCeNG/assertions-launcher-native.json`, PASS.

Foram reutilizados apenas os binários da fixture gLZi9G, após consulta nova de
processos confirmar que estava parada. Dados, mídia e evidências são novos por
tentativa; GStreamer foi compartilhado explicitamente da instalação QA r78.
O marcador de manifesto dessa fixture declara que é fixture, não recibo real
de instalação. Perfil anterior restaurado byte a byte depois da parada.

Scanner, probe, arquivo e proxy executaram de verdade sobre arquivo VP8/Vorbis
de 60s, 320×180/25fps, nome Unicode, áudio estéreo 48kHz/997Hz. Aprovação QC,
criação do item e publicação ocorreram pelas APIs do produto, não por inserção
de metadados prontos. A base recebeu somente usuário/canal/grade QA inicial.

- Partida de launcher, servidor, broker e engine: 4.635,55ms.
- CUE: alvo PVW correto e quadro entregue; PGM permaneceu vazio antes do TAKE.
- TAKE: item publicado entrou em PGM; saída H264/Opus ficou pronta no broker.
- Decodificação da imagem: 320×180, desvio de luminância 72,27, sem quadro preto.
- PCM: 28.800 frames, 24.000 analisados, pico espectral independente 997Hz nos
  dois canais, RMS aproximado 0,03536, cinco janelas concentradas por canal.
  Isso não substitui escuta humana nem certifica fidelidade de toda a cadeia.
- Segunda abertura do launcher reutilizou a mesma instância: item/origem iguais,
  cursor avançou de 0 a 257 frames, sem reiniciar PGM.
- API real confirmou MoQ=false e os endereços configurados. Consulta aos sockets
  do PID do broker próprio encontrou nove listeners, todos em 127.0.0.1:
  TCP 1935/8554/8888/8889/9997 e UDP 8000/8001/8189/8890. Sem chaves MoQ geradas.
- Família observada de 11 processos próprios, incluindo engine, broker, guard e
  armazenamento, encerrada pelo job do launcher. Nenhum serviço operacional foi
  parado. PIDs históricos são apenas evidência, nunca autorização para matar PID.
- SQLite íntegro; QC APPROVED, ARCHIVE/PROXY READY; exatamente um as-run nativo
  vinculado à revisão e ao hash do arquivo. ended_at permanece NULL porque o
  cenário encerrou o launcher durante reprodução: não simular um STOP normal nem
  considerar recuperação pós-crash demonstrada por esse registro.

## Tentativas que continuam sendo falhas

| Evidência | Resultado e causa | Encerramento/limite |
| --- | --- | --- |
| XxIqHy | FAIL: roteiro esperava health.mediamtx.running; API fornece texto | Prazo finito, processos próprios encerrados; observação extra não transforma em PASS |
| gLZi9G | FAIL: roteiro confundia preparedItemId (Próximo) com CUE | Timeout, família própria encerrada; configuração nova efetiva observada |
| 30MEIB | FAIL: leitores RTSP iniciaram antes da publicação H264/Opus, retornando 404 | Leitores drenados, família encerrada, perfil restaurado |
| RaCeNG | PASS: contratos do roteiro corrigidos, sem afrouxar produto | Capturas, persistência, família e perfil conferidos independentemente |

## Pacote parcial interno

`D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r80-instalador.zip`:
540.389.252 bytes, SHA256
`3311B59E1139950E5DB5E4D778D4060002C7F40A07BD328D183530F114928B3D`.

Catálogo e todos os 7.094 hashes do manifesto conferidos em memória, 7.095
entradas: PASS em `scratch/r80-zip-integrity-20261016/result.json`. Não houve
extração completa r80 nem execução do instalador/startup dessa edição. A prova
instalada da r78 não é transferida à r80. O README incorporado foi escrito antes
da geração; hash e integridade finais estão registrados aqui, sem reempacotar.

Sem mover/apagar projeto, releases, dados ou evidências no C:. Sem firewall,
limpeza, migração ou publicação pública. Redistribuição REVIEW_REQUIRED, acordo
original NDI indisponível. DeckLink física adiada; nenhuma fonte externa NDI/OMT
disponível. LAN/IPv6 reais, estação remota, estabilidade prolongada, instalação
completa atual, Windows limpo e upgrade/rollback permanecem abertos.

Totais preservados: 10 grupos, 53 verificações; 7 concluídas, 35 em andamento,
4 pendentes, 7 adiadas à v3. O ensaio fecha um cenário local, não esses grupos.
