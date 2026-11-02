# RPlayout r31 — instalador parcial para teste

Inclui o fluxo integrado de seleção de entradas por canal: selecionar a fonte
antes do nome, sugerir seu nome e preservar a identidade cadastrada na playlist
e nos estados nativos de PGM/PVW. Inclui também a correção posterior à r30:
editar manualmente a conexão atualiza o endereço efetivamente executado e
remove o vínculo cadastral anterior, sem alterar a publicação antiga.

Extraia TODO o ZIP e execute INSTALAR.cmd. Escolha uma pasta NOVA. Preserve
os dados e o cofre anteriores; faça backup antes de migrar. O instalador
não inicia o servidor automaticamente e não é um Setup.exe assinado.

Pacote completo, não delta: Node, dependências de produção materializadas,
SQLite nativo, GStreamer e runtimes NDI/OMT/MSVC da base r29, com integridade
conferida. Não exige instalar pnpm, tsx ou tsc no computador de operação.
DeckLink continua exigindo o driver oficial Blackmagic Desktop Video.

Reutiliza as compilações já concluídas, sem repetir compilação ou testes para
empacotar. O manifesto NOT_RUN_PARTIAL_BUILD indica que este instalador não
foi homologado por instalação em Windows limpo. Ensaios isolados de software
e SRT local não substituem homologação física NDI/OMT/DeckLink, imagem no
navegador, carga ou operação prolongada. Não aprovado para operação no ar.

Total: 10 grupos, 1 concluído e 9 abertos; 53 verificações de fechamento,
5 concluídas, 23 em andamento e 25 pendentes. Esta parcial não encerra grupos.
Releases anteriores preservadas.

Registro externo após geração (não incluído no LEIA-ME interno):
ZIP de 536316287 bytes; SHA-256
3E7700AD8195A541FB075E0A5F1C0C7E3870FA6B9F5D67DDA5B4777A2E3DEFC6.
