# RPlayout r32 — instalador parcial para teste

Inclui tudo da r31 e a recuperação do preview WHEP: publicação recém-ativada
aguarda até 5 segundos, com tentativas limitadas na mesma oferta de vídeo.
Trocar de fonte cancela a espera. Erros de acesso/codec continuam explícitos.
Uma conexão recuperada cancela a reconexão agendada, e imagem disponível só
é confirmada por vídeo decodificado na sessão atual.

Extraia TODO o ZIP e execute INSTALAR.cmd em uma pasta NOVA. Preserve dados
e cofre anteriores e faça backup antes de migrar. Não é Setup.exe assinado;
não inicia o servidor automaticamente. Não exige instalar pnpm, tsx ou tsc.
Inclui Node, SQLite/dependências de produção, GStreamer e runtimes NDI/OMT/MSVC.
DeckLink ainda requer o driver oficial Blackmagic Desktop Video.

Pacote completo com runtimes materializados da r30 cuja integridade foi
conferida, servidor/engine já compilados e interface atualizada. Só a interface
foi recompilada neste lote. O manifesto NOT_RUN_PARTIAL_BUILD indica ausência
de homologação deste instalador por instalação em Windows limpo.

37 testes afetados e tipos web passaram. Isso não comprova estabilidade
prolongada, consumo na rede remota, homologação física NDI/OMT/DeckLink ou
fechamento de todos os requisitos. Não aprovado para operação no ar.

Total: 10 grupos, 1 concluído e 9 abertos; 53 verificações de fechamento,
5 concluídas, 23 em andamento e 25 pendentes. Esta parcial não encerra grupos.
Nenhuma release foi excluída por este empacotamento.

Registro externo após empacotamento (não incluído no LEIA-ME interno):
536316772 bytes; SHA-256
E2937E36F353981C2735471FF3A4DFD96727D1A0B927A9A52BC92613FAD91761.
