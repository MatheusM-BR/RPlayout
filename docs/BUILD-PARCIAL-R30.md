# RPlayout r30 — parcial sem homologação funcional

Inclui seleção por canal e nomes de entradas, identidade explícita do cadastro
na playlist, migração45, metadado retornado pelo decoder de PGM/PVW e histórico
operacional com paginação, nomes, retenção atômica e retomada de consulta.
Confirmação de cadastro não substitui confirmação de vídeo/áudio.

Gerada após compilação, sem executar novos testes funcionais por solicitação.
Não é aprovada para operação no ar. Restam validação integrada, navegador,
carga, restauração e homologação física DeckLink/NDI/OMT.

Extraia TODO o ZIP e execute INSTALAR.cmd. Escolha pasta NOVA, preserve dados
e cofre da instalação anterior e faça backup antes de qualquer migração.
Não é Setup.exe assinado. Não inicia o servidor automaticamente.

O ZIP é completo, não uma atualização delta. Reutiliza runtimes materializados
da r29 com integridade conferida, substituindo servidor/interface e todos os
executáveis nativos por builds atuais. Node, SQLite/dependências de produção,
GStreamer, NDI/OMT/MSVC estão incluídos. Não exige pnpm, tsx ou tsc no operador.
DeckLink requer driver oficial Blackmagic Desktop Video na máquina da placa.

Manifesto NOT_RUN_PARTIAL_BUILD. Releases anteriores preservados. Total:
10 grupos,1 concluído/9 abertos;53 verificações,5 concluídas/23 em andamento/
25 pendentes. Esta parcial não encerra grupos.

Registro externo após empacotamento (não incluído no LEIA-ME interno):
ZIP 536314854 bytes; SHA-256
694967BEDAB1FE0E3F002217A5C72803A3FA248379ACCCA8A19EB3069EEB53AF.
Engine atualizado:
4E71D4784219DAD7D2154A28D0B9F399EA36F68B21392B0393A216A77D537C29.
