# R81 instalada no D: e ambiente do broker — 16/10/2026

Artefato atualizado (10.1): concluído para a edição atual. Isso não fecha os
demais requisitos do pacote (10.2–10.5) nem a homologação funcional dos outros
grupos. O pacote continua parcial interno, não uma entrega final homologada.

## Correção e testes afetados

MediaMTX v1.20.1 carrega os prefixos RTSP_* (legado) e MTX_* depois do arquivo,
e também aceita CONFKEY para descriptografá-lo. Fonte primária:
[conf.go oficial da versão incluída](https://github.com/bluenviron/mediamtx/blob/v1.20.1/internal/conf/conf.go#L505-L568).

O processo próprio do broker agora exclui ambos os namespaces, sem distinguir
apenas opções conhecidas. Não altera process.env, não registra os valores,
mantém as variáveis necessárias ao runtime e não muda a política dos demais
helpers/engine. O filtro é aplicado em cada spawn, inclusive reinício.

36 casos distintos afetados PASS: ambiente 5, identidade/configuração 14,
admissão 4, início privado dos helpers 13. Tipos e build do servidor PASS.
Sem novo build/teste do engine ou web inalterados. Sintaxe dos dois roteiros QA
conferida; a verificação estrutural da matriz não é um teste funcional.

## Artefato e instalação real

- ZIP: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r81-instalador.zip`.
- Tamanho: 540.388.627 bytes.
- SHA256: `28740CC65EED2275CAA6EB87A088EF9B3A9280859E893FDC3BCDA6F4F13AC79F`.
- Servidor: `6B3E024C59D7537BE04C00BF7E1AAFAD30BC2747BD52345B445C5D213744092F`.
- Launcher101A28C9 / engine191CD1E1 / web8B0D3FCB preservados.

Instalador incorporado executado, não uma cópia montada por QA. Destino novo:
`D:\RPlayout-builds\qa\r81-installed-20261016`. Pré-checagem exigia
2.829.058.949 bytes para bundle, instalação e margem; havia 651.999.469.568 bytes.
Catálogo, materialização e hashes verificados pelo instalador, recibo VERIFIED,
manifesto com 7.094 arquivos, perfil de dados/mídia isolado e sete destinos reais
de atalhos conferidos. Destinos de atalhos não equivalem a executar as sete UIs.

Evidência: `D:\RPlayout-builds\qa\r81-install-evidence-20261016\result.json`.
Atalhos QA somente em `D:\RPlayout-builds\qa\r81-shortcuts-20261016`, não
substituíram o menu/desktop operacional. Nenhum servidor iniciado pelo instalador.

## Ensaio nativo da própria instalação

`D:\RPlayout-builds\qa\launcher-native-O70gPG\result.json`: PASS.
`assertions-launcher-native.json` no mesmo diretório: PASS, conferência
independente de pixels/PCM, arquivo original e banco somente leitura, sem replay.

O produto executou launcher, Node, servidor compilado, engine, probe, proxy,
guard e GStreamer da própria instalação. Sem overlay, fixture portátil, runtime
GStreamer emprestado ou NODE_PATH global. O QA usa ferramentas TypeScript do
workspace, mas elas não são necessárias à execução do produto. PATH do filho
limitado ao pacote e System32. Dados e mídia do teste foram novos; perfil
instalado salvo e restaurado byte a byte após parada da família própria.

Foram fornecidos ao ambiente somente dos filhos QA sete overrides conflitantes:
MTX_CONFKEY, RTSP_CONFKEY, MTX_MOQ, RTSP_APIADDRESS, MTX_RTPADDRESS,
RTSP_WEBRTCLOCALUDPADDRESS e MTX_PATHS_QA_SOURCE. Nenhum comando de hook real
foi fornecido. O ambiente da máquina não foi alterado.

- Partida nativa: 4.821,97ms; medida local, não benchmark de Windows limpo.
- Scanner/probe reais em arquivo Unicode sintético VP8/Vorbis, 60s, 320×180,
  25fps e áudio estéreo 997Hz. ARCHIVE/PROXY READY, aprovação QC e publicação
  feitas pelas APIs. Não foram semeados metadados, aprovação ou jobs prontos.
- CUE entregou quadro no PVW sem selecionar PGM. TAKE colocou o item em PGM.
- Imagem decodificada do monitor H264: desvio de luminância 72,21.
- PCM Opus: 28.800 frames, 24.000 analisados, RMS ~0,03545 por canal, espectro
  independente 997Hz nos dois canais e cinco janelas concentradas por canal.
  Não substitui escuta humana nem certifica fidelidade completa de áudio.
- Segunda abertura reutilizou a instância confirmada, sem reiniciar o item:
  origem 1673379 preservada e cursor 8→265 frames.
- Interface HTTP serviu o asset instalado index-BsVZYGz4.js com hash correto.
- Biblioteca better_sqlite3.node observada carregada no processo de armazenamento
  indicado pela própria API autenticada, não suposta no backend HTTP. DLL
  gstreamer-1.0-0.dll observada no engine. Ambas dentro da instalação r81 no D:.
- MoQ=false e endereços reais da API permaneceram os previstos apesar do ambiente.
  Nove listeners próprios medidos em loopback; nenhuma chave MoQ implícita gerada.
- Família própria de nove processos observada e encerrada pelo job do launcher;
  o verificador não foi contado como parte da aplicação. Sem matar PIDs históricos.
- SQLite íntegro; exatamente um as-run nativo, revisão e hash do arquivo corretos.
  ended_at=NULL porque o cenário fecha o launcher durante a reprodução. Não foi
  inventado STOP normal nem demonstrada recuperação pós-crash por esse registro.

## Falhas preservadas do roteiro, não aprovações

| Tentativa | Resultado | Causa e limite |
| --- | --- | --- |
| kJQ1a8 | FAIL | Preflight contou os dois processos do próprio QA (CLI tsx/Node do pacote). Nenhum launcher abriu, nenhum perfil mudou. Consulta posterior não encontrou processos restantes. |
| 4CfxBM | FAIL | Imagem/áudio foram capturados, mas o roteiro procurou SQLite no backend HTTP em vez do armazenamento separado; exigência de dois módulos recusou. Processos conhecidos encerrados e perfil restaurado. Não convertida em PASS. |
| O70gPG | PASS | Invocação Node --import sem pai CLI, verificador excluído por seu PID atual conhecido; SQLite conferido no processo efetivo da API. Família completa e perfil conferidos. |

Essas correções são do QA; o produto e o ZIP r81 não foram alterados depois do
build que passou nos 36 casos. Não houve reinstalação para mudar status.
O README incorporado ao ZIP foi escrito antes do ensaio, portanto conserva
NOT_RUN e totais daquele instante. Evidências pós-build estão neste relatório;
não foi reempacotado apenas para alterar documentação/status.

## O que continua aberto

10.2: auditoria de redistribuição/licenças e qualificação externa dos runtimes.
10.3: máquina Windows limpa, que esta estação de desenvolvimento não substitui.
10.4: upgrade/rollback e recuperação operacional, não só nova instalação isolada.
10.5: publicação final e GitHub incluindo todas as alterações/evidências atuais.

Os demais grupos mantêm seus requisitos específicos: sinais externos NDI/OMT,
hardware, estação remota, estabilidade prolongada e combinações não ensaiadas.
DeckLink física adiada; fontes externas indisponíveis, acordo original NDI não
fornecido. Grupo8 permanece adiado à v3. Nenhuma configuração de firewall,
limpeza, migração de pastas ou dados/contas/serviços operacionais alterados.

Totais após fechar somente 10.1: 10 grupos/53 verificações; 8 concluídas,
34 em andamento, 4 pendentes e 7 adiadas à v3. Grupo10: 1 concluída, 2 em
andamento, 2 pendentes. Objetivo amplo permanece ativo.
