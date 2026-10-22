# Sonda local de grafismos — implementação NOT_RUN

11/10/2026. Fonte nova, sem teste, typecheck, compilação, render ou build gerada.

`rplayout-graphic-probe` é um binário separado do canal. Recebe uma composição
privada por stdin, usa `rsvgoverlay`/GStreamer como o engine e devolve um cabeçalho
mais um quadro RGBA de tamanho exato. Não abre entrada, saída, banco ou arquivo
de imagem. O quadro é produzido sobre fundo preto; isso não prova alfa, contraste,
fontes corretas, transições, legibilidade ou uma composição multicamada completa.

A conferência nativa usa quick-xml 0.42.0, já disponível no cache local; a resolução
offline acrescentou somente esse pacote ao lockfile, sem executar compilação.
Limites: SVG 4MiB, 100000 nós, profundidade 256, raster até 3840x2160. DTD,
instruções XML, scripts, conteúdo estrangeiro, animação/alteração de atributos,
bases externas e referências não locais são recusados antes de GStreamer.
Referências internas e imagens raster incorporadas são permitidas. CSS com
importação, escapes/comentários ou entidades exige decisão explícita; não existe
ainda um workflow de vínculos de recursos/estilos externos. Não chamar esse
subconjunto de compatibilidade integral de SVG.

O leitor privado no servidor envia a composição pelo mesmo viewport canônico
da operação. Processo sem shell/janela visível, baixa prioridade, ambiente sem
credenciais RPlayout, limite de bytes, cancelamento/poll de autoridade e timeout.
Confirma apenas depois do encerramento limpo do próprio processo. Confere
identidade/SHA do executável antes/depois; calcula SHA dos pixels e conta pixels
não pretos, sem presumir que preto significa falha ou aprovação.

O resultado mantém editorialApproved/publicationAuthorized/nativePrepared/
authorityTransferred falsos. SHA do helper não homologa DLLs, fontes, plugins,
drivers, formato de saída ou hardware. Ainda NÃO ligado ao diário de revisão
HA, à aplicação da derivada ou à interface. Não remove avisos históricos de
LOCAL_GRAPHIC_RENDER_PENDING e não aprova mídia automaticamente.

Receitas de pacote completo/parcial e inventário obrigatório incluem o novo
binário para a próxima compilação; R55 permanece intacta e não o contém.
Fixtures de protocolo/viewport e XML adicionadas, todas NOT_RUN.

Próximo: inventário de composições com IDs/revisões/digest, execução por fila,
evidência cifrada persistida com reconferência de runtime/recursos, consulta
sanitizada, montagem por camada/transições e aprovação visual separada.
Continuam pendentes mixes/cortes/trilhas, automação/saídas locais, engine,
autoridade, retorno/rejoin, recuperação e homologação física.

Totais: 10 grupos (1 concluído, 9 abertos); 53 verificações (5 concluídas,
36 em andamento, 12 pendentes). Nenhum marco encerrado por esta fonte nova.
