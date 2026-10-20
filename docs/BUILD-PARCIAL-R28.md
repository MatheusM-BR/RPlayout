# RPlayout r28 — build parcial não homologada

Gerada em 09/10/2026 a pedido do operador, sem novos testes funcionais antes
do empacotamento. Compilação e geração do ZIP não são homologação operacional.
Instalação limpa, navegador e sinais reais DeckLink/NDI/OMT permanecem pendentes.

Inclui as integrações posteriores à r27: diagnóstico das filas e reservas,
proteção de execução/distribuição, revisão de QC no TAKE, restauração de backup
com manifesto vinculado ao banco, reserva de manutenção e histórico assinado.
Inclui a preparação do backend restaurado e a ativação explícita pelo comando
`--activate-restored MANIFESTO` do servidor compilado. A ativação mantém as
reservas durante a revisão e exige confirmação do engine nativo antes de
arquivar a origem da quarentena. Falha não equivale a promoção aprovada.

A retomada de PGM pausado/congelado ainda é recusada com preservação do cursor.
A retomada nativa completa e as entradas ao vivo restauradas precisam de
validação posterior. Não remover manualmente a quarentena ou reservas do banco.
O comando de ativação não configura automaticamente uma instalação restaurada:
usar o banco/cofre/manifesto correspondentes, em ambiente isolado de teste.

Extraia TODO o ZIP e execute INSTALAR.cmd. Instale em uma pasta nova e faça
backup antes de migrar dados existentes. A instalação é por usuário, cria
atalhos no menu Iniciar e não inicia automaticamente o servidor. Não é um
Setup.exe assinado. Abra RPlayout Server e depois Master ou QC.

Inclui Node, módulos de produção/SQLite, interface e servidor compilados,
engine, auxiliares, GStreamer e runtimes NDI/OMT/MSVC. A máquina de operação
não precisa instalar pnpm, tsx ou tsc. DeckLink exige o driver oficial
Blackmagic Desktop Video; a build não substitui esse driver.

Manifesto: NOT_RUN_PARTIAL_BUILD. Releases anteriores preservados.
Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações de fechamento:
5 concluídas, 22 em andamento e 26 pendentes. A parcial não encerra marcos.

Registro externo após gerar o ZIP (não consta do LEIA-ME interno):
536067236 bytes; SHA-256
`A60E45300366141E394B504EBC5FDE12CF40565DB48739187B097D64E8DCDAD8`.
Servidor incluído: E5D264BFEF53B545FF9BCDEE0BA829FAE8FFE4CB1F0586955DDE23F6C40E1F39.
Depois da geração, o ensaio compilado EhhStp passou com engine real/saída nula,
ativação assinada e origem arquivada. Caso sem cursor em reprodução e sem TAKE:
não homologa PGM, instalação limpa nem sinais físicos deste ZIP imutável.
