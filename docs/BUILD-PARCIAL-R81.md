# RPlayout r81 — parcial instalável para teste interno

Destino: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r81-instalador.zip`.
Projeto, r80 e evidências anteriores preservados. Hash/tamanho finais registrados
após a geração, sem alterar o README incorporado ao ZIP.

Inclui a r80 e impede que variáveis MTX_* ou RTSP_* herdadas alterem a configuração
privada do MediaMTX: portas, autenticação, caminhos/hooks e chaves de configuração.
Filtro exclusivo do broker, a cada abertura; não altera o ambiente do servidor
nem a política dos demais helpers/engine. Valores descartados não são registrados.
Referência: código oficial MediaMTX v1.20.1, internal/conf/conf.go, carrega os dois
prefixos depois do YAML e usa CONFKEY para descriptografia.

Lote afetado: 36 casos distintos PASS, tipos e build do servidor PASS.
Launcher101A28C9/engine191CD1E1/web8B0D3FCB inalterados. A prova nativa da r80
usava fixture; não equivale à execução desta instalação. Instalador/startup
r81 NOT_RUN no momento deste README pré-geração; evidências posteriores devem
declarar explicitamente instalação, runtime, ambiente e limitações.

Node/dependências/GStreamer incluídos; sem tsx/tsc/pnpm globais na operação.
Não instala driver DeckLink. Redistribuição REVIEW_REQUIRED: acordo original NDI
indisponível. Sem homologação de hardware, fontes NDI/OMT externas, estação remota,
Windows limpo, upgrade/rollback ou estabilidade prolongada. Grupo8 adiado à v3.
Sem limpeza, migração, alteração de firewall ou publicação pública.

## Registro pós-geração (o README incorporado permanece pré-ensaio)

540.388.627 bytes, SHA256
`28740CC65EED2275CAA6EB87A088EF9B3A9280859E893FDC3BCDA6F4F13AC79F`.
Servidor: `6B3E024C59D7537BE04C00BF7E1AAFAD30BC2747BD52345B445C5D213744092F`.
Instalador real no D: PASS, recibo VERIFIED/7 destinos de atalhos.
Ensaio instalado O70gPG PASS: Node e runtime do próprio pacote, sem overlays;
overrides atuais/legados recusados, CUE/TAKE com arquivo sintético, imagem/PCM
997Hz reais, SQLite/GStreamer carregados de dentro da instalação. Nove listeners
em loopback; nove processos próprios encerrados; perfil anterior restaurado.
Asserção independente dos arquivos brutos e SQLite somente leitura PASS.
Não é Windows limpo, homologação de todos os fluxos, hardware ou estação remota.

Relatório: `INSTALACAO-R81-E-AMBIENTE-2026-10-16.md`, incluindo duas tentativas
QA anteriores FAIL preservadas. Sem mudança no ZIP após os ensaios.

Totais atuais: 10 grupos/53 verificações; 8 concluídas, 34 em andamento,
4 pendentes, 7 adiadas à v3. Somente 10.1 (artefato atualizado) foi encerrada;
10.2–10.5 continuam abertas. Parcial interna, não entrega final homologada.
