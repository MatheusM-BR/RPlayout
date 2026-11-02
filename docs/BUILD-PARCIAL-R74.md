# RPlayout r74 — parcial instalável para teste interno

Destino previsto: `release/RPlayout-1.1-parcial-20261016-r74-instalador.zip`.
Hash e integridade serão registrados externamente somente depois da geração.

Registro externo pós-geração (não modifica o README já incorporado no ZIP):
540.202.821 bytes; SHA256
`169CA2662E72A8283EF3C632BA2E796C9F7A7B924985E84D43589A8540411A16`.
Integridade PASS: 7.094 hashes / 7.095 entradas, somente leitura em memória.
Evidência `scratch/r74-zip-integrity-20261016/result.json`.
Instalador/startup permanecem NOT_RUN.

Aviso posterior: ensaio OMT sem emissor `qc-native-browser-bl66Yt` falhou;
reprodução direta `omt-missing-ejQefT` confirmou que quadros antigos de receptor
armado em PAUSED autorizam TAKE indevido. Esta r74 NÃO contém a correção
posterior para esse problema. Não usar como entrega final/ao vivo homologada.

Integra a r73 e corrige a live prioritária: um corte projetado para LIVE
HARD_TIME/FIXED não vira término antecipado do VT. O arquivo mantém seu corte
efetivo até a live confirmar quadro e realizar TAKE. O conflito permanece na
grade, sem alterar silenciosamente a revisão publicada. Cortes manuais e
ajustes independentes continuam válidos; não se fabricam quadros além do arquivo.

Servidor novo SHA256
`A709115F976CC6372F1FFE13D1B9195261FFC217C0EBE2707990477056E0473A`.
Engine mantido
`EAEA694FA34C23CEF81BF6326FD31367E603A5768D67EDF91468AB0AAB66305C`.
Web CD7665DE e devices D7396F7C preservados, sem repetir suítes não afetadas.

Ensaios nativos/API NDI ZL8L4z e OMT KuZCgt PASS: VT completo de 2.250 quadros
interrompido automaticamente no cursor 1.114; retorno revisado ao cursor,
as-run/revisão/hash preservados e imagem/áudio reais antes/durante/depois.
Conferências independentes PASS. Fontes sintéticas locais com runtimes oficiais,
servidor/engine sobrepostos explicitamente à instalação r71: não qualificam
esta instalação, navegador remoto ou placa física. Detalhes e falhas preservados
em `LIVE-PRIORITARIA-VT-2026-10-16.md`.

Cobertura dirigida: 210 casos distintos dos quatro arquivos afetados, mais
9 testes do medidor de áudio; tipos completos e build servidor PASS. Teste de
ausência de sinal no horário em execução, sem presumir resultado no README.

Local: `http://localhost:4000`, ou porta configurada. Remoto:
`http://192.168.42.172:4000`, somente quando esse for o IP real do servidor;
use a porta efetivamente configurada. Não se fixa esse IP no produto nem se
altera rede/firewall. Nome/IP real admitido; alias personalizado configurável.

Pacote parcial para teste interno: inclui Node, módulos de produção, SQLite,
engine e runtimes; não depende de tsx/tsc/pnpm globais. Driver DeckLink externo,
validação física adiada pelo operador. Instalador/startup r74 NOT_RUN; faltam
Windows limpo, upgrade/rollback, sinais externos, ensaio remoto e duração longa.

Redistribuição REVIEW_REQUIRED: acordo original NDI indisponível; avisos de
terceiros não são liberação jurídica. Não é publicação final homologada.
R73 e anteriores preservadas; sem cleanup, migração ou dados operacionais.

10 grupos / 53 verificações: 7 concluídas, 35 em andamento, 4 pendentes e
7 adiadas à v3 (grupo 8). Nenhum fechamento artificial por um teste sintético.
