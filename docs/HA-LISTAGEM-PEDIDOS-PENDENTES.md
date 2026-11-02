# Listagem de revisão/cópia sem conclusão

11/10 — implementada em fonte, NOT_RUN. Sem testes/build, fora R55.

Na área de recebimentos de retorno, selecionar canal permite consultar
revisões de mídia ou criações de cópia, inclusive de uma execução anterior,
sem depender de intenção salva no navegador. Não inicia consulta automática.

GET /api/ha/returns/pending-jobs aceita somente canal, kind e afterId UUID
opcional. Requer acesso admin/canal, sessão estável e no-store. Nomes SQL são
fixos, nunca fornecidos pelo cliente. Store confere ownership atual antes e
depois. Resposta contém apenas IDs, tipo, canal, fase/data e ownedHere; não
inclui caminhos, recibos privados, probes, evidências ou resultados completos.

Cada consulta percorre até 25 registros ordenados pelo UUID binário, usando
um registro extra para decidir o próximo cursor. Filtra ACCEPTED/CHECKING ou
ACCEPTED/APPLYING. A página pode estar vazia e ainda possuir nextCursor:
significa que os registros percorridos eram finais, não que todos os pedidos
do canal foram conferidos. Não informa número total de pendências pelo tamanho
da página. Não promete snapshot estável entre páginas; novas consultas desde
o início são necessárias para observar inserções anteriores ao cursor.

Frontend valida identidade/canal/tipo/cursor, limite, ordem, unicidade e flags.
Troca de contexto descarta resposta antiga. Cada resultado oferece o painel
de encerramento explícito já integrado. Depois do encerramento confirmado,
atualiza apenas a página consultada; nenhuma alteração é presumida localmente.

Não prova processo parado, não adota owner anterior, não retoma operação nem
libera PGM. Gates de processo/trabalho/estado/data continuam no encerramento.
Decodificação dos diários criptografados é limitada aos registros da página;
índice de fase compacta pode ser otimização futura, sem perder compatibilidade
com históricos. Outras etapas do retorno/intenções não registradas ainda
exigem fluxo próprio e a recuperação operacional completa continua pendente.

Fixtures NOT_RUN: página vazia com cursor, registro pendente após a primeira
página, isolamento de canal/tipo, fim explícito e recusa de tabela/page size/
path arbitrários. Não há validação de navegador ou hardware neste lote.

Totais: 10 grupos (1 concluído/9 abertos); 53 verificações (5 concluídas,
36 em andamento, 12 pendentes). 8.5/8.6 permanecem em andamento.
