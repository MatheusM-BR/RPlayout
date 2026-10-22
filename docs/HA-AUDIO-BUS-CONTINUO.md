# Áudio contínuo entre cortes — fonte NOT_RUN

12/10 — Plano editorial em fonte NOT_RUN: `ha-return-sequence-plan` reutiliza
origem congelada e plano bus com ganho/provas privados. Ordem é a publicada,
com IDs/order/horários/durações/contiguidade e corte operacional reconferidos
contra evidência. Edição inteira é recusada por lacuna, live/GFX/contrato
ausente, item descartado, falta de job ou corte alterado sem prova; não omite
obstáculo para renderizar subconjunto como completo. Até 128 itens por edição,
sem divisão automática com RESET. Chave contém revisão, fingerprint do timing,
perfil e jobs ordenados. Fixtures preparados, NOT_RUN. Ainda faltam recibos,
workflow persistido e tratamento de contratos pendentes (não basta recusá-los
para considerar o escopo concluído).

12/10 — Runner/leitor servidor implementados em fonte NOT_RUN:
`ha-return-sequence-probe` recebe jobs privados ordenados, reconfirma SHA/stamp
de todos os arquivos e runtime antes/depois; pipe, cancelamento/ownership,
baixa prioridade, prazo máximo 16 minutos e resposta limitada a 1 MiB.
Transporte JSON atual limitado conservadoramente a 12 mil caracteres para
Windows; exceder recusa sem truncar/dividir/reiniciar DSP. Não recebe paths
de corpo HTTP. Executor genérico privado adicionado para o modo sequência;
medição isolada ainda usa executor anterior.

`ha-return-sequence-reading` exige configuração/ordem/cortes/ordinais/pares e
total de frames exatos, startup/cauda únicos, cobertura e estado preservado;
recusa RESET isolado ou alegação de qualificação operacional/AV/transmissão.
Fixtures preparados NOT_RUN. Ainda falta plano confiável da ordem editorial,
identidades/recibos persistidos, diário/Store/API/UI, fronteiras/AV reais.

`apps/engine/src/continuous_bus.rs` fornece DSP streaming para uma sequência
de cortes já renderizados no bus real. Usa o mesmo `BusLimiter` do engine:
estado único, pares independentes em 8/16 canais, sem RESET por item.

Entradas declaram contagem de frames de cada corte. Buffers completos e
finitos devem chegar na ordem, sem exceder seu corte, até 48 mil frames por
buffer. Não há gap, padding ou crossfade inventado pelo processador.
Saída informa ordinal global para a futura atribuição aos itens medidos.

Remove o startup de 240 frames apenas uma vez e descarrega o atraso apenas
no final da sequência; exige saída total igual à entrada declarada. Aceita
sequências menores que o atraso sem fabricar contagem. Finalização única;
sequência incompleta não produz resultado.

Module incluído na sonda bus para integração/compilação futura. **Não é
chamado pelo renderer ainda**. A medição isolada existente continua RESET.
Não modifica PGM e não comprova TAKE, transição nativa ou sincronismo.

12/10 — `continuous_bus_meter.rs` acrescenta atribuição streaming por ordinal
global ao corte original depois da compensação: um estado DSP para sequência,
medidores por par para o item e para a sequência inteira, sem guardar todo o
PCM. Medidores do item são descartados após registrar seu resumo. Exige cortes
de pelo menos 400 ms, ordem/cobertura completas e finalização única.
Resumo distinto CONTINUOUS_DSP_SEQUENCE/RESET_ONCE, sem comprovar origem,
transição nativa, A/V, QC ou transmissão. Incluído na sonda como módulo,
**ainda sem renderer chamando**.

Fixtures adicionais NOT_RUN: sinal somente nos últimos 240 frames do primeiro
corte, atribuído ao item original apesar de emitido durante o seguinte;
ordinais/contagens/pares em 2/8/16, corte curto/incompleto e finalização única.

Fixtures NOT_RUN: 2/8/16 canais, dois cortes quente/baixo em buffers variados,
comparação PCM exata contra processamento contínuo de referência, ordinal,
cauda/contagem/redução; ordem incorreta, frame parcial, corte excedido e
sequência incompleta/menor que o atraso. Nenhum teste ou build executado.

Próximos passos: renderizar sequência pelos ramos reais e cortes exatos,
comprovar cobertura de cada origem, alimentar esse estado único, atribuir
PCM compensado aos itens e medir fronteiras. Implementar recibos/plano/diário
e UI próprios de sequência, sem confundir ISOLATED_RENDERED_BUS. Depois
correlacionar vídeo/áudio e validar transições/saídas/hardware.

12/10 — Renderer ligado em fonte NOT_RUN: `audio_bus_probe --sequence JSON`
aceita até 128 cortes, configuração até 60 KB, bus/teto estáveis. Usa
`render_cut` compartilhado com modo isolado (ramos reais, caps/roteamento,
timeline PCM e cobertura da origem), entrega cortes em ordem ao medidor
contínuo. Nenhum reset do limiter entre itens, flush só ao final.
Um pipe do servidor para toda a sequência e prazo global de quinze minutos.
Resultado distinto CONTINUOUS_RENDERED_CUT_SEQUENCE, configurações sem paths,
com cobertura confirmada apenas após todas as origens passarem. Contagem
de frames é exata: corte que não corresponder ao número declarado falha,
não é preenchido/truncado como completo.

Não mede o seletor operacional: as fontes são decodificadas sequencialmente
offline. Mantém operacionalSelectorQualified/nativeTransitionQualified/A-V/
editorial/publicação falsos. Não é prova de preroll/gap/TAKE/crossfade/saída.
Fixture de contrato da sequência preparado NOT_RUN; helper não compilado nem
executado. Falta runner servidor, plano/identidades/recibos/diário/UI e medição
de fronteiras/AV reais. O modo isolado foi refatorado e exige regressão no lote.
