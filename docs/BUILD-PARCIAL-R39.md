# RPlayout r39 — instalador parcial, não homologado

Inclui a r38 e o acesso direto INCIDENTES DO CANAL no Monitor, abrindo Saúde
sem passar pelas saídas. Falhas ao reconhecer ficam visíveis até o fechamento
do aviso; a atualização automática não apaga o erro nem resolve o incidente.

Conferência local no navegador isolado: ACK 200 auditado, erro 409 sem ACK,
botão liberado, aviso preservado após atualização automática, recuperação
medida separada de reconhecimento e observação encerrada. Dois testes de
interface, tipos e compilação aprovados. Não são provas físicas/remotas/soak.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Backup dos dados e
do cofre antes de migrar. Migração 47 incluída; voltar o banco a pacote antigo
não é rollback homologado. Inclui Node, módulos de produção/SQLite, GStreamer,
NDI/OMT/MSVC. Não exige pnpm/tsx/tsc no destino. DeckLink exige driver oficial.

Não é Setup.exe assinado. Instalação NÃO testada e servidor não iniciado
automaticamente. Releases anteriores preservadas; não é entrega final no ar.

Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações: 5 concluídas,
24 em andamento e 24 pendentes. 9.2 continua em andamento: falta fechar
observabilidade integrada e operação prolongada; físico não homologado.

Registro externo após empacotamento (não integra o LEIA-ME interno):
450391895 bytes; SHA-256
184BFB3F304A792BBF3A5CFE1623B1A22C1320E6BD35C5C139EAD752AE8A64F2.
