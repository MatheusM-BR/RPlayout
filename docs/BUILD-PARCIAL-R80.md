# RPlayout r80 — parcial instalável para teste interno

Destino autorizado: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r80-instalador.zip`.
Gerada: 540.389.252 bytes. SHA256
`3311B59E1139950E5DB5E4D778D4060002C7F40A07BD328D183530F114928B3D`.
Integridade PASS: 7.094 arquivos do manifesto / 7.095 entradas conferidas em
memória; evidência `scratch/r80-zip-integrity-20261016/result.json`.
Este registro pós-geração não altera o README pré-geração incorporado ao ZIP.
Projeto e releases anteriores no C: não foram movidos ou apagados.

Inclui r79 e corrige a configuração do MediaMTX1.20.1 incluído:

- MoQ não utilizado explicitamente desativado, sem listeners/chaves TLS implícitos.
- RTP8000, RTCP8001 e ICE8189 respeitam o mesmo endereço configurado dos
  protocolos de mídia. RTSP UDP/TCP preservados; multicast implícito desativado.
- API continua em loopback. Métricas, pprof e playback avulsos desativados.
- Endereços validados e IPv6 representado com colchetes/aspas no YAML.

Servidor SHA256
`E226C793E654679BFB33C4A737948B2C1AC53C8D5AFC1285C4CF8F123A291C65`.
Launcher101A28C9/engine191CD1E1/web8B0D3FCB preservados.
41 casos distintos afetados PASS/tipos/buildservidorPASS; corrigido mock antigo
sem assertOwned, não afrouxada a proteção real. Tentativas QA anteriores com
contratos errados de health/Próximo/encoder não são aprovações.

RaCeNG: integração nativa em fixture isolada PASS. Scanner/probe/arquivo/proxy
reais, decisãoQC e publicação pelaAPI; CUE com quadro entregue e PGMnull,
TAKE real e imagem320×180/PCM997Hz estéreo decodificados. Segunda abertura
do launcher preservou item/origem e cursor avançou. Nove listeners do broker
próprio medidos em loopback; MoQfalse viaAPI real. Família própria observada
de11processos terminou; perfil QA anterior restaurado byte a byte. Não houve
alteração de dados, contas ou serviços operacionais.

Usou binários QA reusados e GStreamer explicitamente compartilhado da r78;
não é instalação completa r80, Windows limpo, teste de hardware, NDI/OMT
externos, estação remota, estabilidade prolongada ou certificação de áudio.
Fonte sintética era arquivo, não entrada de rede/dispositivo. Não abrir
instância contra banco operacional para reproduzir este teste.

Instalador/startup r80 NOT_RUN. R78 permanece instalada em QA; suas provas
não são transferidas para r80. Driver DeckLink externo/validação física adiada.
Redistribuição REVIEW_REQUIRED: acordo original NDI indisponível. Grupo8v3.
Sem cleanup/migração/mudança de firewall. Dependências e Node incluídos,
sem tsx/tsc/pnpm globais no uso do produto; ferramentas TS foram usadas só no QA.

Totais10grupos/53verificações:7concluídas/35andamento/4pendentes/7v3.
Parcial interna, não entrega final homologada.

Relatório detalhado: `LAUNCHER-NATIVO-E-PORTAS-2026-10-16.md`.
Limitação adicional registrada em 10.2: overrides ambientais MTX_* não foram
explicitamente filtrados nem exercitados neste lote.
