# RPlayout r26 — build parcial não validada

Gerada em 09/10/2026 a pedido do operador, sem executar testes antes desta
build nem instalar para homologação. Compilar e empacotar não comprovam o
funcionamento operacional. Não é a entrega final.

Inclui as mudanças posteriores à r25: medição de áudio do trecho selecionado,
aplicação AUTO vinculada ao corte e à versão da mídia, proteção contra análise
desatualizada e identificação do responsável por cada trabalho de arquivo/proxy.
A retomada de jobs não deve tomar o trabalho de outro servidor ainda ativo;
o encerramento aguarda a liberação do trabalho antes de fechar o banco.
Este último fluxo permanece em implementação/verificação. A rodada anterior
teve dois testes falhos; as correções e esta build ainda não foram retestadas.

Extraia TODO o ZIP e execute INSTALAR.cmd. Use uma pasta nova e um ambiente
de teste separado. Faça backup antes de qualquer migração de dados existentes.
A instalação é por usuário e cria atalhos no menu Iniciar; não inicia o servidor.
Abra RPlayout Server e depois Master ou QC. Controle remoto pelo navegador
no endereço do servidor, sujeito à configuração da rede e firewall.

Inclui Node, módulos de produção/SQLite, servidor/interface compilados, engine,
auxiliares, GStreamer e runtimes NDI/OMT/MSVC. Não requer tsx, tsc ou pnpm na
máquina de operação. DeckLink exige o driver Blackmagic Desktop Video.
Não é um Setup.exe assinado; não houve homologação física DeckLink/NDI/OMT.
Os releases anteriores não são sobrescritos.

Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações de fechamento:
5 concluídas, 19 em andamento e 29 pendentes. A build não muda esses totais.
Inventário: docs/PENDENCIAS-NUMERADAS.md.

Registro externo acrescentado após gerar o ZIP (não consta do LEIA-ME interno):
artefato `release/RPlayout-1.1-parcial-20261009-r26-instalador.zip`,
535740595 bytes, SHA-256
`07621D3EF0C82DE829AE6F6D36F89E1776A7D0DB4EDBAC63F484C6331C37CC7F`.
Servidor incluído SHA-256
`EEDD3CCBED72D65AD225574AAF633484CA87F02EDFD97A2DBC5C4E65F9837447`.
Os testes de continuação iniciados depois da entrega não constituem teste de
instalação nem homologação deste pacote. Manifesto: NOT_RUN_PARTIAL_BUILD.
