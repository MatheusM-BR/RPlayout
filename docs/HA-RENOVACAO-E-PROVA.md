# Renovação HA e prova de candidato — NOT_RUN

Implementação posterior à R55; testes/build/medição ainda adiados no lote.

Antes, a concessão da geração cercada passava pelo current completo antes e
depois de cada nonce. Esse caminho revalidava SHA do banco preparado, runtime e
mídias locais e ainda repetia a prova já feita pelo assertAdmission. Custo de
acervo/disco ficava indevidamente no caminho do watchdog de publicação.

Agora a factory exige uma verificação separada de renovação, criada somente
após a transferência explícita: autorização/posse do pedido, reserva local
host/storage/execução e assignment assinado atual com node/revision/transferId
exatos antes e depois da concessão. Nonce/assinatura/termo/TTL continuam a cargo
do cliente e watchdog nativo. Não aceita cache de autoridade ou receipt antigo.
Ausência da função/abort/mudança de posse/admissão recusa renovação.

LOAD/TAKE/composição/accounting/liberação de saídas continuam usando prova
completa do candidato. Warmup continua verificação completa local; geração
cercada não repete a mesma prova já feita pelo assertAdmission no mesmo passo.
Não é relaxamento de TAKE, de mídia/QC ou da cerca nativa. Não foi medido ganho
de desempenho; resta validar orçamento de latência sob acervo grande, lentidão
da testemunha, disco ocupado, perda de rede e mudança de autoridade.
