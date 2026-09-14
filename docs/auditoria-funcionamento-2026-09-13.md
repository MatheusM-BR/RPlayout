# Auditoria funcional do Playout — 13/09/2026

## Resultado

Foram corrigidas falhas no engine GStreamer, no transporte do servidor, na
reconciliação do acervo e nos monitores WebRTC. A interface foi reconstruída.
O executável corrigido está preparado em
`backups/playout-fix-20260913/rplayout-engine-fixed.exe`.

A substituição do executável em uso foi suspensa antes de encerrar processos:
o canal **Test** entrou em reprodução durante a conferência. É necessário
reiniciar o servidor e os engines para carregar integralmente esta versão.
O monitor local do Remate, que estava desabilitado, foi reativado no perfil.

## Defeitos encontrados e correções

| Problema confirmado | Causa | Correção |
| --- | --- | --- |
| Monitor conectado, sem imagem | A primeira tabela MPEG-TS podia anunciar somente Opus; o MediaMTX descartava os pacotes de vídeo posteriores | Folga de 500 ms no multiplexador SRT e perfil H.264 baseline nos monitores |
| PGM mudo depois do segundo take | O encerramento do sink anterior apagava o formato de áudio compartilhado com o item preparado | Reabrir e reaplicar o corte do próximo item após liberar o anterior |
| Interface confirmava reprodução que falhou | Comandos load/take não aguardavam confirmação do engine | Fila de operações, respostas confirmadas, prazo de comando e estado publicado também após falhas |
| Arquivo ausente ou recusado impedia avançar | Não havia validação do arquivo e tentativa limitada dos próximos itens | Conferência em disco, salto de indisponíveis e de recusas do decoder; término quando não existe candidato válido |
| Watchdog reiniciava durante carregamento | Preroll síncrono interrompia relatórios e era confundido com congelamento | Comandos pendentes têm seu próprio prazo; ausência temporária de relatórios não dispara morte prematura |
| Monitores não voltavam após reinício do engine | O estado desejado ficava apenas no cache do servidor | Reaplicação do estado dos monitores ao recriar o processo |
| Pasta removida mantinha arquivos aparentemente válidos | Raízes ausentes eram excluídas da varredura | Reconciliação de todas as referências e varredura incluindo raízes indisponíveis |
| Arquivo restaurado continuava com erro | Cache aceitava tamanho/data iguais mesmo após falha anterior | Arquivos com erro são reanalisados; mudanças durante a leitura são detectadas |
| Análise podia travar ou interromper todo o acervo | Subprocessos sem prazo e falhas de arquivo sem isolamento | Consumo dos canais de saída, limites de tempo e tratamento individual das falhas |
| Biblioteca e tela ficavam desatualizadas | Atualização dependia da ação da própria aba; WebSocket não reconectava | Busca automática a cada minuto, atualização periódica da interface e reconexão |
| Som dos monitores difícil de ativar | Controle pouco explícito, reprodução sujeita ao bloqueio do navegador | Botões Ouvir/Silenciar, volume independente e mensagens de falha |
| Diagnóstico enganoso | Erros do engine ocultos e medidores simulados usados como fallback | Erros visíveis, silêncio quando não há medição real e disponibilidade indicada na grade |

Arquivos indisponíveis permanecem referenciados para preservar a grade e seus
ajustes, mas ficam sinalizados como **serão pulados** e deixam de reservar tempo
no planejamento. O item já no ar é preservado na programação quando seu arquivo
desaparece. Na conferência da biblioteca havia 216 registros e **53 arquivos
fisicamente ausentes**. Corrigir o software não recria esses arquivos.

## Validação executada

- **153 testes TypeScript** em 16 arquivos passaram.
- **38 testes Rust** passaram.
- `pnpm typecheck`, `pnpm lint` e `pnpm build` passaram após os ajustes finais.
- Novo teste reproduzível: `node scripts/check-engine-playback.mjs [executável]`.
  Gera áudio temporário, executa três takes e um preview, sem ativar saída de
  rede. O executável antigo falhou no segundo take com **−90 dBFS**; o corrigido
  passou nos três takes e no preview com aproximadamente **−12,2 dBFS**.
- Integração TypeScript → engine real: arquivo ausente, arquivo corrompido e
  vídeo válido em sequência. Apenas o válido foi confirmado no ar.
- Engine → SRT → MediaMTX → WHEP → navegador: ambos os monitores decodificaram
  vídeo 320×180 em movimento (`readyState=4`) e receberam áudio Opus estéreo.
  Os controles independentes de escuta foram acionados e verificados.
- Medição do sinal recebido após as transições: PGM e preview com pico de
  aproximadamente **−11,5 dBFS**. Não se usou apenas o medidor interno como prova.
- Sonda nativa abriu vídeo real do acervo e mediu loudness; os arquivos de
  mídia originais não foram alterados.

Esses testes não certificam saídas SDI/NDI em hardware nem precisão de corte
quadro a quadro. A correção de transição renegocia o próximo decoder; seu tempo
de entrada depende do formato e do armazenamento. O programa de testes usou
sinais sintéticos e portas locais separadas das saídas configuradas pelo usuário.

## Backup e aplicação

- Banco: `apps/server/backups/rplayout-2026-09-13T11-15-19-906Z.db`.
- Executável anterior: `backups/playout-fix-20260913/rplayout-engine-before.exe`.
- Perfis anteriores: `backups/playout-fix-20260913/outputs-before.json`.
- Executável pronto: `backups/playout-fix-20260913/rplayout-engine-fixed.exe`.

Após liberar a interrupção, substituir o engine em
`apps/engine/target/release/rplayout-engine.exe`, reiniciar esta instalação e
conferir o acervo e os monitores na interface. A aplicação automática foi
interrompida pela checagem de canal em reprodução, antes de qualquer encerramento.

## Referências técnicas consultadas

- [Publicação com GStreamer no MediaMTX](https://github.com/bluenviron/mediamtx/blob/main/docs/3-publish/18-gstreamer.md): encapsulamento e compatibilidade de codecs.
- [Leitor MPEG-TS do MediaMTX](https://github.com/bluenviron/mediacommon/blob/main/pkg/formats/mpegts/reader.go): descoberta inicial das trilhas pela PMT.
- [Implementação do interaudiosink](https://github.com/GStreamer/gstreamer/blob/main/subprojects/gst-plugins-bad/gst/inter/gstinteraudiosink.c): limpeza do formato compartilhado ao encerrar o sink.
