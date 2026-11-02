# RPlayout r42 — instalador parcial, não homologado

Inclui r41 e o encerramento das observações PGM antigas na admissão de uma
nova execução nativa com posse assinada comprovada. Reiniciar não significa
recuperação do sinal: o incidente original continua sem resolvedAt, seu
contexto e reconhecimento são preservados, e o fim da observação tem evento,
auditoria e fila externa na mesma transação. Retry não duplica o encerramento.
Simulação, posse de outro canal, standby e quarentena não autorizam essa ação.
Uma sonda já existente na mesma instância não é substituída por esse fluxo.

Validação local: cinco novos testes de admissão/isolamento/quarentena/rollback
e preservação de contexto aprovados; sete testes afetados de incidentes PGM
aprovados. Tipos do servidor e compilação aprovados. Não equivale a ensaio
prolongado nem homologação de reinício com sinal físico.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Faça backup do banco
e cofre antes de migrar. Mantém migração48: voltar banco48 para pacote antigo
não é rollback homologado. Inclui Node/módulos nativos/SQLite/GStreamer e
runtimes NDI/OMT/MSVC da base anterior; DeckLink exige driver oficial.

Instalação NÃO testada. Não é Setup.exe assinado e não inicia o servidor.
Engine e interface preservados da r41; servidor recompilado.
Ainda falta reconciliar falhas de fontes/saídas e validar operação física,
remota e prolongada. Grupo9.2 permanece em andamento.

Total:10 grupos —1 concluído/9 abertos;53 verificações —5 concluídas,
24 em andamento/24 pendentes. Não é entrega final para operação no ar.
