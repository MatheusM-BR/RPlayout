# Cobertura da cauda na medição isolada pós-ganho

11/10 — implementação em fonte, NOT_RUN. Sem compilação/testes/build; fora R55.

Nova política explícita COMPENSATE_AND_FLUSH no helper pós-ganho. Planejador
seleciona esse modo nas novas montagens; política faz parte da configuração e
da chave do job, portanto recibo antigo não é adotado como prova da nova análise.
Ausência da política mantém comportamento legado para leitura histórica, sem
reescrever provas ou alterar o áudio de operação.

Limiter expõe o atraso exato da instância (240 quadros a 48kHz/5ms). Medição
compensada descarta os primeiros 240 quadros artificiais de startup e, ao final
do corte válido, processa 240 quadros de entrada zero para descarregar a linha
de atraso. Conta input/output; saída medida deve cobrir exatamente as mesmas
amostras do corte, sem adicionar silêncio à duração ou perder a janela final.
Meter compensado recebe apenas saída após startup e cauda. Ganho/limiter são
os mesmos DSP compartilhados; maior redução inclui descarga. Finish é único;
processar/finalizar depois do fechamento é recusado.

Recibo ISOLATED_POSTGAIN_FLUSHED_STEREO exige tailFlushed=true,
startupFramesRemoved=240 e flushedFrames=240, além da cobertura PCM existente.
Leitor correlaciona espécie do recibo com política solicitada. O legado
ISOLATED_POSTGAIN_LIMITED_STEREO continua exigindo tailFlushed=false e nenhum
campo novo; não pode satisfazer a nova política, nem servir de pre-gain AUTO.

Isso é análise offline isolada/reset de um par estéreo. Não significa que o
pipeline ao vivo descarrega cauda na mesma fronteira ou que o vídeo foi
compensado. Não modifica PGM, timing, transições ou atraso de saída. Bus 2/8/16,
soma/limitação dos pares, continuidade de estado entre itens e A/V precisam
qualificação e contrato operacional próprios. postGainQualified/busQualified/
transitionQualified/editorialApproved/publicationAuthorized continuam false.

Fixtures preparadas NOT_RUN: áudio apenas nos últimos 240 quadros, contagem
input/output, finish único, configuração/recibo legado distintos, contagem de
descarga incorreta recusada. Nenhum resultado PASS/homologação é reivindicado.

Próximo: política técnica e contingência/live, render de bus e transições,
qualificação A/V, grafismos/engine/saídas/autoridade/retorno/rejoin/hardware.
Totais 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes), 8.5/8.6 em andamento.
