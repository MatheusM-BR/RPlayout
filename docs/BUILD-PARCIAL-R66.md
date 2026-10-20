# RPlayout r66 — parcial instalável para teste, não homologada

ZIP `release/RPlayout-1.1-parcial-20261014-r66-instalador.zip`,540177898bytes,
SHA256 855DC616B6AD4B0208FE1AE5C9614EC9876C45D598DF3179A7B7DD5546468DFA.
Integridade pós-geração PASS:7094 arquivos do manifesto/7095 entradas,
verificação em memória, sem extração integral ou início do runtime.
Evidência `scratch/r66-zip-integrity-20261014/result.json`.
Esse registro externo é posterior ao README incorporado no próprio ZIP.

Integra a r65 e os lotes de publicação/rollback e confirmações operacionais:

- Conferências de grade com prazo de 10s; falha não aparece como histórico vazio.
- Resposta antiga não atualiza outra seleção. Commit preservado não é anunciado
  como desfeito; sincronização só é confirmada depois da leitura/carga.
- Confirmações de Próximo/Agora, próxima grade, reconhecimento de incerteza e
  continuidade recorrente ficam na página, sem caixa nativa; desmarcadas por
  padrão e vinculadas à conferência. Regras do servidor permanecem obrigatórias.
- Engine e módulos nativos incluídos; não depende de tsx/tsc/pnpm globais para
  iniciar. Nova funcionalidade nativa não foi fabricada nesta edição.

Fonte: 27 testes dirigidos do lote anterior e 6 novos do controle de confirmação,
tipos web e builds web/servidor/engine release locked PASS.
Visual local: publicação/rollback com falhas de GET preservaram commit/histórico;
Próximo/Agora com engine real e recibos/as-run PASS. CUE nativo com vídeo RTSP
320x180 comprovou recusas de compensação/publicação/rollback incompatíveis,
preservando PGM e permitindo nova decisão após limpar CUE. Saídas físicas não
homologadas. Não foi repetida regressão global nem feito soak.

Web index-CEI6tlbJ.js SHA256
AD8C73F90DE3E6121DB819A9649874FBA757804AB8DD805501DE0A052D0C63B3.
Servidor E5E95ECDB75DFBD2B597C0C11709C73B2340233F20F0C5DE869311A5FBA03CDD;
engine 3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.

Esta build parcial será entregue **sem outra extração/instalação QA**.
Instalação, startup instalado e validação funcional instalada r66 NOT_RUN.
Não transfere os testes instalados da r65 como homologação desta edição.
ZIP novo, preservando builds/QA/bancos anteriores; nenhuma limpeza realizada.

Documentos de evidência: PUBLICACAO-ROLLBACK-VISUAL-2026-10-14.md,
CUE-PROTECAO-NATIVA-2026-10-14.md e CONFIRMACOES-OPERACIONAIS-2026-10-14.md.

Windows limpo, hardware externo, estação remota/carga, cenários completos de
falha/recuperação e publicação final no GitHub continuam abertos. DeckLink
física adiada; grupo8 v3. Redistribuição REVIEW_REQUIRED (NDI/MSVC/codecs/
abstract-logging); notices incluídos não equivalem à liberação jurídica.

Total 10 grupos/53 verificações:6 concluídas,35 em andamento,5 pendentes,7 v3.
