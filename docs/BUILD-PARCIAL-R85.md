# RPlayout r85 — parcial instalável interna

## Resultado posterior à geração (ZIP original preservado)

Instalador real no D: PASS (7.100 arquivos, recibo VERIFIED, sete destinos de
atalhos). ZIP540524145bytes/SHA256
6243084B658D7DF56F5D9CBB0B6DDCC28143FC82C238128BA2CC9DD269055FFE.
A leitura Unicode passou, mas o retorno recusou snapshots com WAL/SHM antes
de ativar o destino: `D:\RPlayout-builds\qa\compatible-rollback-VNw64T` FAIL,
família própria encerrada. Originais e auxiliares preservados. A r86 adiciona
exportação explícita de novas cópias autocontidas; não afrouxa a exigência de
backup fechado nem apaga auxiliares históricos para forçar aceitação.

## Registro pré-geração

Destino: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r85-instalador.zip`.
Inclui o fluxo de retorno compatível r84 e corrige a leitura UTF-8 do manifesto
nas duas novas entradas PowerShell. O catálogo real contém caminho Unicode de
dependência; r84 foi recusada antes de preparar/ativar e permanece imutável.
Encoding de saída nativa também é UTF-8, restaurado ao terminar o script.

26 casos distintos de contrato/histórico/integridade PASS, tipos/build PASS;
4 casos de bootstrap PS5 das duas entradas e2casos de manifesto Unicode com
ferramenta inerte PASS. A primeira fixture hardlink precisou de permissão para
criar o link; só esse caso foi repetido. Não afrouxada nenhuma conferência.
Servidor6B3E024C/engine610E03E8/launcher101A28C9/web8B0D3FCB preservados.

Retorno usa snapshot COMPLETO MAIS RECENTE, exige todas as identidades antigas
do histórico, contrato de schema exato e ferramentas/manifesto verificados;
recusa edição desconhecida, schema incompatível ou história faltante. A r83 é
qualificada pelo manifesto completo exato; próximas edições têm contrato próprio.
Não mistura bancos, remove colunas/marcadores ou substitui estado novo pelo antigo.
Restauração é feita pela edição de destino em pasta nova/quarentena. Início usa
revisão/assistente/launcher reais de destino, com seus próprios gates nativos e
confirmação explícita. Nenhum TAKE, parada ou troca de perfil na preparação.

Registro pré-geração: instalação/execução do fluxo deste ZIP NOT_RUN neste
README. Hash/evidências posteriores serão registrados externamente, sem
reempacotar apenas para status. R84 não recomendada para esse novo assistente.

Não homologa Windows limpo, schema incompatível, energia, hardware, fontes
externas ou estabilidade prolongada. Redistribuição REVIEW_REQUIRED; acordo
original NDI ausente. DeckLink adiada; grupo8v3. Sem limpeza/movimentação do
projeto, alteração de firewall/serviços operacionais ou publicação pública.

Matriz10grupos/53verificações:8concluídas/34andamento/4pendentes/7v3;
10.4 continua aberta até qualificação dos cenários restantes.
