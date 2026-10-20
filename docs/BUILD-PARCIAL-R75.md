# RPlayout r75 — parcial instalável para teste interno

Destino previsto: `release/RPlayout-1.1-parcial-20261016-r75-instalador.zip`.
Hash/integridade serão registrados externamente somente após gerar o arquivo.

Registro externo pós-geração (o README interno do ZIP permanece o da geração):
540.202.872 bytes; SHA256
`A9B901F6641CEA21775AE7A024FA9B8F8510A26CF6611CBA63004286DEF1B27B`.
Integridade PASS: 7.094 hashes / 7.095 entradas, leitura em memória sem execução.
Evidência `scratch/r75-zip-integrity-20261016/result.json`. Engine7FD481E0
efetivamente presente. Instalador/startup r75 continuam NOT_RUN.

Inclui a correção r74 que separa o corte projetado da live HARD_TIME/FIXED do
EOS real do VT. Acrescenta a correção nativa para live preparada: o receptor
continua consumindo sinal em PLAYING no slot ainda não selecionado; assim
quadros antigos acumulados durante PAUSED não ganham chegada nova no TAKE.
Preparar continua sem comutar PGM. Arquivos continuam pausados no ponto de
entrada e mantêm a preparação A/B existente.

Engine novo SHA256
`7FD481E0B58A147C553477EC2B9EAB397EBAD4ED9136F0D2D589B6981B141EB9`.
Servidor mantido da correção r74
`A709115F976CC6372F1FFE13D1B9195261FFC217C0EBE2707990477056E0473A`.
Web CD7665DE e devices D7396F7C preservados.

Build release locked PASS. Seis testes nativos dirigidos PASS: cinco de
TAKE/prazo/relógio/hold e um de entrega real expirada com LOAD live em PLAYING,
sem trocar PGM. Diagnóstico direto OMT DdM4Jh PASS: receptor preparado com sinal,
emissor encerrado, ausência de sinal não permite TAKE; recusa após prazo real,
VT preservado. Reproduções anteriores ejQefT/bl66Yt continuam FAIL e motivaram
a correção; não são reclassificadas. Detalhes e provas anteriores de corte/
retorno NDI/OMT em `LIVE-PRIORITARIA-VT-2026-10-16.md`.

Resultados posteriores à geração: NDI InhMRG PASS (corte1109/2250/retorno) e
OMT U4naNK PASS (1112/2250/retorno), com o engine7FD481E0 desta build;
conferências independentes PASS, pixels/PCM/as-run/cursor/revisão/hash relidos.
OMT sem sinal rJnTrF também PASS e conferência independente PASS: VT3000,
continua após âncora nos cursores1363/1988, retorna emissor sem TAKE tardio,
uma as-run encerrada somente no STOP2211. Essa prova substitui o ensaio C2zabR
como fechamento local desse cenário; sua limitação EOS permanece registrada.
A build é
parcial, conforme pedido, antes da homologação completa. Instalador/startup
r75 NOT_RUN; overlay de binários sobre r71 não valida esta instalação.
Node/módulos de produção/SQLite/engine/runtimes incluídos: tsx/tsc/pnpm globais
não são necessários para operar. Driver DeckLink externo, teste físico adiado.

Local: `http://localhost:4000`, ou porta configurada. Remoto:
`http://192.168.42.172:4000`, se esse for o IP atual do servidor, ajustando
a porta. IP/nome e porta são configuráveis; não fixamos esse IP nem alteramos
rede/firewall. Localhost sempre corresponde à máquina que abre o navegador.

Redistribuição REVIEW_REQUIRED: acordo original NDI indisponível; notices não
são liberação jurídica. Fontes sintéticas locais não homologam placa física,
rede remota, saída broadcast, fidelidade sem perdas ou estabilidade longa.
Faltam Windows limpo, upgrade/rollback e matriz visual completa.

R74/anteriores preservadas, sem limpeza/migração ou alteração de dados reais.
10 grupos / 53 verificações: 7 concluídas, 35 em andamento, 4 pendentes,
7 adiadas à v3 (grupo 8). Não é entrega final homologada.
