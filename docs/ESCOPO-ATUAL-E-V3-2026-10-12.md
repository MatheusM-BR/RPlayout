# Escopo atual e v3 — decisão de 12/10

## Decisão mais recente: continuar o projeto, deixar a cópia de lado

O usuário pediu explicitamente para esquecer a cópia e continuar o projeto.
A pasta de trabalho desta sessão continua C:/IA/RPlayout. Não executar mais
remoção de C:/IA nem finalizadores da migração. As cópias no D: ficam preservadas;
não são a referência das novas alterações feitas nesta sessão. A elegibilidade
do finalizador foi desativada no recibo da migração. C:/RPlayout já é um vínculo
para D:/RPlayout; não alterar essa instalação durante a retomada do código.
Retomar grupo 2 e depois grupo 3, sem exigir a migração como pré-condição.

O usuário autorizou transferir C:/IA para D:/IA e C:/RPlayout para D:/RPlayout.
D:/IA já contém outros projetos/arquivos, que não serão substituídos ou
removidos. D:/IA/Frota, D:/IA/RPlayout e D:/RPlayout não existiam no preflight.

A pasta de trabalho está dentro de C:/IA. A transferência deve copiar,
conferir integridade e só depois remover conteúdo original. Links de
compatibilidade em C: podem preservar o acesso do chat/atalhos/caminhos
absolutos atuais, sem manter outra cópia física no disco C:. Não editar
arquivos internos de configuração do Codex ou encerrar o app à força.
Abrir diretamente o projeto D:/IA/RPlayout depois da transferência para
receber as permissões/caminho de trabalho corretos na próxima sessão.

## Grupo 8 adiado, não cancelado nem aprovado

Não implementar/testar agora; reservar para v3. Código e evidências de trabalho
parcial existentes ficam preservados, inclusive correções anteriores de tipos.

8.1 Replicação para outro host — adiada.
8.2 Reserva apto — adiada.
8.3 Promoção executável — adiada.
8.4 Fencing externo — adiada.
8.5 Handoff e replicação reversa — adiada.
8.6 Rejoin/failback — adiada.
8.7 Falhas físicas e RPO/RTO — adiada.

Não desligar proteções locais de propriedade/processos (grupo1) ou recuperação
da máquina única (grupo9); são requisitos diferentes de redundância entre hosts.

## Contagem atual

Registro completo:10 grupos,53 verificações.
Versão atual:9 grupos (1 concluído,8 abertos),46 verificações (6 concluídas,
32 em andamento,8 pendentes).
V3:1 grupo,7 verificações adiadas (2 antes pendentes,5 antes em andamento).
Assim, no registro completo:6 concluídas+32 em andamento+8 pendentes+7 adiadas=53.

Retomar2→3 nesta pasta; DeckLink2.2 permanece adiada separadamente conforme
pedido anterior, ainda na matriz atual. Não gerar installer dito100% validado
nem chamar ensaios locais de homologação física/externa.
