# RPlayout r78 — parcial instalável para teste interno

Destino previsto: `release/RPlayout-1.1-parcial-20261016-r78-instalador.zip`.
Tamanho/hash/integridade devem ser registrados externamente após a geração.

Registro externo pós-geração:540.206.044bytes; SHA256
`D6A254CEBD4BB0448564AF3369D2862A92C0CA89B1018546A121D9B0B8E750D4`.
Integridade PASS:7.094hashes/7.095entradas emmemória, sem instalar/executar.
`scratch/r78-zip-integrity-20261016/result.json`. Encerramento A4Uy5d exit0,
senders semforce/errors[], servidor/carrier/família encerrados. Conferência
independente `assertions-source-history.json` PASS. Detalhes e limites em
`QC-SINAL-HISTORICO-2026-10-16.md`; README interno mantém texto da geração.

Registro externo posterior: instalação incorporada PASS em
`scratch/r78-install-evidence-20261016/result.json` (recibo VERIFIED, perfil
isolado,7atalhos). Partida direta pelo Node instalado/PATHmínimo PASS em
2274,6302ms, SQLiteinterno/interface8B0D3FCBsemoverlays; evidência
`scratch/RPlayout-portable-server-i7fkSW/result.json`. Servidor próprio parado.
Não é startup do launcher, mídia instalada ou Windows limpo. Tentativa restrita
RbXBqR/EACCES preservada FAIL. `INSTALACAO-R78-2026-10-16.md` contém limites.

Inclui engine r76 e diagnóstico corrigido das entradas no QC:

- **Última amostra (histórica)** nas fontes não sintonizadas ou com medição
  vencida, sem anunciar presença atual de vídeo/áudio a partir do cache.
- Sinal recente vinculado a PGM/PVW; idade inclui tempo desde a coleta,
  áudio vencido indicado separadamente e política de instabilidade do canal.
- Rede SRT OPTIMAL não vira confirmação verde de vídeo.
- Um tick por segundo na lista visível atualiza validade, mas a avaliação usa
  o instante real de cada render, não o instante anterior do tick. Corrige o
  falso vencimento observado no primeiro replay/r77.
- Não adiciona conexão de fonte, decoder, polling por entrada ou CUE/TAKE.

Web `index-BsVZYGz4.js`, SHA256
`8B0D3FCBD44724DE835FCBE491531F6A5A0629EA9A688ECA520EFD76A2499F1D`.
78 casos distintos afetados PASS; tipo web PASS e build final PASS. Replay
local A4Uy5d: NDI pronta, troca OMT pronta, NDI histórica/amarela e OMT
recente/verde; browser428×240 ready4/reproduzindo, scopes amostrados. Sem
TAKE/PGM/grade/as-run. Sobreposições explícitas de servidor/engine/web na r71,
não instalação r78. Encerramento e conferência independente do registro devem
ser acrescentados externamente após a geração.

R77 preservada mas **superada; não usar para este diagnóstico**: integridade
do seu ZIP passou, porém o replay visual gPFOlH encontrou falso vencimento por
relógio anterior à amostra. iYCEKg falhou antes de abrir mídia pela autorização
de configuração no ambiente restrito. Nenhuma tentativa deve virar aprovação.

Engine preservado SHA256
`191CD1E112C7AFBA81896BBF3AA109A100775A7A358B7894FAAAFBE8D1ABDFBC`;
servidor preservado
`A709115F976CC6372F1FFE13D1B9195261FFC217C0EBE2707990477056E0473A`.
Ensaios nativos inalterados da r76 não repetidos apenas por status/interface.
Runtimes/Node/módulos/SQLite incluídos: uso sem tsx/tsc/pnpm globais.

Instalador/startup r78 NOT_RUN. Não é homologação de Windows limpo,
upgrade/rollback, estação remota, hardware, fidelidade ou estabilidade longa.
Redistribuição REVIEW_REQUIRED: acordo original NDI indisponível; notices
não substituem a conferência jurídica. DeckLink física adiada. Grupo8 para v3.
Sem limpeza, migração, alteração de produção, firewall ou permissões de rede.
Local localhost:porta configurada (4000 padrão); remoto IP/nome:porta real,
sem fixar 192.168.42.172. Pacotes/evidências anteriores preservados.

Totais:10grupos/53verificações,7concluídas/35andamento/4pendentes/7v3.
Não é entrega final homologada.
