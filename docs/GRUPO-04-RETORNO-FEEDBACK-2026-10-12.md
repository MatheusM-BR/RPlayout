# Grupo4.5 — mensagens de retorno seguem a fase durável

Bug encontrado no banner: qualquer RESUME sem nativeProgramConfirmed era
descrito como simulado, inclusive UNCERTAIN. Agora só CONFIRMED pode anunciar
retorno nativo ou simulado; FAILED informa falha anterior ao TAKE,
PREPARING/SWITCHING aguardam conferência, UNCERTAIN/fase desconhecida informam
resultado inconclusivo sem repetição automática; CLOSED_UNCERTAIN não confirma
sucesso nem reabre cursor. Detalhe diagnóstico permanece após a classificação.
Resposta perdida pós-envio orienta consultar registro antes de TAKE/decisão.
Sem mudança no comando nativo, cursor, requestId ou política de reconciliação.

21 testes web/domínio durável PASS, tipos web exit0, build C2VUC4ZD PASS.
Consulta inicial demorou no ambiente, handle74743 retomado até exit0 antes
de prosseguir; não houve duplicação de processo de busca ou validação.
Não injeta falha do retorno no navegador nem certifica destino físico.
4.5 continua em andamento; mudança posterior àr53. Total10grupos/53:
6concluídas,32andamento,8pendentes,7adiadasv3.
