# Interface e recuperação da medição pós-ganho

11/10 — implementado em fonte, NOT_RUN. Sem testes/compilação/build; fora R55.

Tela de cópia de mídia STAGED incorpora painel de medição isolada pós-ganho.
Início exige cópia própria, confirmação explícita e ausência de intenção salva.
Guarda apenas UUID/cópia/canal na sessão ANTES do POST. Em falha/resposta perdida,
consulta somente o mesmo UUID; não apaga intenção nem cria repetição automática.
Troca de canal/contexto invalida respostas antigas; trava evita duplo comando.
Não há polling nem execução automática ao abrir tela.

Resumo mostra perfil usado, adoção AUTO, montagens medidas/falhas/bloqueios e
estado registrado. Leitor exige proveniência da cópia/revisão/MAC/SHA/AUTO,
perfil explícito e contagens corretas; recusa evidência privada inesperada ou
flags de autorização. REVIEWED é recibo registrado, não aprovação. Mesmo com
zero falhas, barramento/transições/A-V/QC/PGM continuam pendentes.

POSTGAIN_REVIEW integrado ao contrato, mapa de fases, listagem paginada e
encerramento no Store. Lista no painel central inclui outra execução. Fases
ACCEPTED/MEASURING podem solicitar encerramento; estado/data frescos, justificativa,
confirmação, ausência de trabalhos e prova de processo parado são obrigatórios.
Encerramento FAILED e diário de recuperação ocorrem na mesma transação; owner,
reserva/histórico/cópia preservados. REVIEWED/FAILED não são encerrados/repetidos.
Consulta fresca usa postGainReviewId, nunca confunde com mediaApplicationId.

Fixtures NOT_RUN: contratos de interface/proveniência/flags/contagens, listagem
com ID/fase próprios, encerramento nas fases permitidas. Nenhum navegador,
HTTP, medidor nativo ou arquivo de mídia foi executado para validar o lote.

Restam política técnica, contingência/live, bus 2/8/16, cauda/transições/A-V,
qualificação/QC, engine/saídas/autoridade/retorno/rejoin/homologação física.
Pedido local sem registro no servidor não é apagado/repetido automaticamente;
recuperação guiada desse caso ainda requer decisão específica.

Totais: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes), 8.5/8.6 em andamento.
