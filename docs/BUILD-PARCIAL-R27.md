# RPlayout r27 — build parcial não homologada

Gerada em 09/10/2026 por solicitação do operador, sem executar uma nova
rodada de testes antes do empacotamento. Não é a entrega final: compilação
e geração do instalador não comprovam funcionamento operacional.

Inclui os fluxos integrados desde a r26: conferência original de categorias,
integrações, pastas e varredura; registro da pasta e fila de varredura em uma
operação; proteção e diagnóstico de posse do scanner; retomada explícita
somente quando o encerramento do processo local foi comprovado. Inclui as
melhorias anteriores de ingestão, proxy, recuperação e medição de áudio.
Donos remotos, desconhecidos ou inconclusivos não são liberados por suposição.

Extraia TODO o ZIP e execute INSTALAR.cmd. Instale em uma pasta nova, em
ambiente de teste separado. Faça backup antes de migrar dados existentes.
A instalação é por usuário, cria atalhos no menu Iniciar e não inicia o servidor.
Abra RPlayout Server e depois Master ou QC; controle remoto pelo navegador
no endereço do servidor, conforme as permissões de rede e firewall.

Inclui Node, módulos de produção/SQLite, servidor/interface compilados,
engine, auxiliares, GStreamer e runtimes NDI/OMT/MSVC. Não exige tsx, tsc ou
pnpm na máquina de operação. DeckLink ainda exige Blackmagic Desktop Video.
Não é um Setup.exe assinado. Instalação em máquina limpa, navegador e sinais
físicos DeckLink/NDI/OMT continuam sem homologação deste pacote.

Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações de fechamento:
5 concluídas, 21 em andamento e 27 pendentes. Gerar a build não encerra
verificações. Manifesto: NOT_RUN_PARTIAL_BUILD. Releases antigos preservados.

Registro externo após gerar o ZIP (não consta do LEIA-ME interno):
`release/RPlayout-1.1-parcial-20261009-r27-instalador.zip`, 535788731 bytes.
SHA-256: `4C06A592C0D2C89E2C134125747ADFDE8BC2C12CAA1A45F63B951884F639E06E`.
Servidor incluído: `AD9EAE62B00723E57392690C5D66352511FBD7044A19E78E4241195C3DA891EF`.
Verificações de continuação posteriores não homologam a instalação deste ZIP.

Continuação posterior: auditoria automática do scanner foi implementada e
validada no servidor `9BC72149715AB63704AEBBB82CE5286ED1BC4FCA883773573AF258C55929B3C7`.
Essa mudança não consta deste ZIP imutável, que contém o servidor AD9EAE62
registrado acima. Não apresentar evidência da fonte nova como instalação da r27.

Outra continuação posterior: diagnóstico e recuperação auditada de integrações,
incluindo bloqueio de reenvio de legado inconclusivo por confirmação manual,
foram validados no servidor FE797333/webE4C2DA7F. Também não constam da r27.

Overview posterior da fila e filtros de acesso por canal/configuração foram
validados no servidor B97378AA/web522BD006. Também não constam da r27 imutável.

Painel posterior de reservas de execução/distribuição e diagnóstico estruturado
foram integrados no servidor9BDEFB10/web2E79965F; não constam da r27 imutável.
