# RPlayout r73 — parcial instalável para teste interno

Destino: `release/RPlayout-1.1-parcial-20261016-r73-instalador.zip`.

Registro externo posterior à geração (não altera o README interno do ZIP):
540.202.880 bytes; SHA256
`961FE70700BB619F11710AFCF318D85B9E379F5FC2C9C702E622F34FFBDE3F64`.
Integridade PASS: 7.094 hashes do manifesto / 7.095 entradas, leitura em memória
sem instalar/executar. Evidência `scratch/r73-zip-integrity-20261016/result.json`.

Integra a r72 e corrige a contagem de tempo das entradas ao vivo: o cursor da
ocorrência no PGM usa relógio monotônico a partir do TAKE confirmado, não o
último PTS recebido. Uma perda da fonte não congela esse contador. O offset da
recuperação é respeitado; só a reabertura automática do próprio decoder recebe
o relógio anterior. STOP/TAKE explícito inicia nova ocorrência, mesmo com o
mesmo ID. Arquivos, seek e quadro mantido conservam o relógio de mídia existente.

Sinal e tempo no ar continuam separados: o contador avançar não declara
SIGNAL_OK, não inventa quadros/áudio e não autoriza TAKE de fonte sem sinal.
Permanecem as correções r72 de assinatura NDI e tally inicial CUEING/NO_VIDEO.

Engine novo SHA256
`EAEA694FA34C23CEF81BF6326FD31367E603A5768D67EDF91468AB0AAB66305C`.
Build release locked PASS e 9 testes nativos dirigidos PASS, incluindo bloqueio
real de buffers, reabertura, STOP/TAKE e prazo absoluto de TAKE pendente.
Servidor novo SHA256
`6A86A3CE26164C5B55603336F7CE96D469F92A6E48E3F38C0D8C7D9250516D43`:
erro do candidato não avança nem invalida o PGM da abertura anterior do mesmo ID.
preparação automática de Próximo/próxima playlist não sobrescreve comandos
pendentes; fila antiga reconfirma sequência, origem e revisão antes de LOAD.
166 casos distintos do transporte cobertos (164 na rodada +2 replays de fixtures
nativas corrigidas); tipos completos PASS. Web CD7665DE preservada, sem repetir sua suíte.

Integração NDI do relógio NPfgFC PASS: 3,199 s sem buffers/78 quadros de avanço,
retorno com novos pixels/PCM, PGM/start/as-run preservados, um CUE/TAKE, mesmo
receptor e cleanup confirmado. OMT jHoq4P PASS: 3,331 s/85 quadros, ausência real
de entrada e retorno com novos pixels/PCM, mesma operação/as-run. Essas provas
usam engine intermediário 182006A3/servidor E4A01600. Ensaio final NDI com os
binários acima também verifica expiração real de TAKE do mesmo ID durante perda,
sem comutação tardia: **CuhQue PASS**, com os binários finais. Aviso nativo após
11957 ms; retorno de pixels/PCM novos, mesmo item/start/PID/as-run, sem novo
TAKE após a recusa. Conferência independente PASS, inclusive bloqueio do LOAD
automático enquanto TAKE pendente e avanço de 80 quadros em 3,084 s sem buffers.
Diagnóstico esperado do TAKE recusado permanece visível: não se afirma painel
de saúde inteiro verde nem ausência de erro provocado. Processos próprios
encerrados. Os ensaios
anteriores yZvhsD/M0jt27 comprovaram recuperação de imagem/PCM e preservação do
item/start/as-run, mas revelaram o congelamento do cursor na lacuna: não validam
o relógio novo. Ver `PGM-LIVE-RECUPERACAO-2026-10-16.md` para resultados posteriores,
falhas do leitor e limites, sem transformar overlay em instalação homologada.

Essa edição é para teste interno. Instalador/startup desta edição, Windows
limpo, upgrade/rollback, hardware/sinais externos e estabilidade longa não foram
homologados. Node, módulos de produção, SQLite, engine e runtimes incorporados;
operação não depende de tsx/tsc/pnpm globais. Driver DeckLink é externo, teste
físico adiado pelo operador. Localhost local; IP/nome e porta para acesso remoto.

Redistribuição **REVIEW_REQUIRED**: acordo original do SDK NDI indisponível e
demais runtimes/codecs/avisos em revisão. Notices não são liberação jurídica.
Não é publicação final nem homologação física de saída broadcast.

Sem limpeza, migração de pastas ou alterações em dados/contas/rede operacional.
R72 e pacotes anteriores preservados. Grupo 8 permanece adiado à v3.
Total: 10 grupos/53 verificações — 7 concluídas, 35 em andamento, 4 pendentes,
7 adiadas à v3. Registro externo de hash/integridade somente após a geração;
este README não pode antecipar o hash do arquivo ZIP que o contém.
