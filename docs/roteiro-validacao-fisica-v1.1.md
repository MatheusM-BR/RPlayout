# Roteiro de validação física — RPlayout 1.1

## Pré-requisitos

- Windows limpo ou estação de teste isolada.
- Placa DeckLink/NDI instalada, quando aplicável.
- Um arquivo de vídeo com áudio conhecido.
- Navegador Chromium atualizado.
- Medidor externo ou retorno de áudio disponível.

## Teste PGM/PVW e WebRTC

1. Iniciar o pacote pelo `rplayout-test.exe`.
2. Abrir o canal no operador e preparar um vídeo com áudio.
3. Executar **TAKE** e confirmar imagem, movimento e áudio no PGM.
4. Abrir `/test-1/pgm/` e confirmar imagem e áudio no navegador.
5. Abrir o PVW, usar o botão de áudio e confirmar que o áudio só aparece após a ação do operador.
6. Arrastar o seek em mídia gravada e testar `−1f`/`+1f`.
7. Confirmar que o fluxo ao vivo não apresenta seek falso quando não há duração.

## Teste NDI/SDI

1. Ativar apenas a saída necessária em **SAÍDAS E PROCESSOS**.
2. Confirmar no receptor NDI ou monitor SDI imagem, sincronismo e áudio.
3. Desligar a saída e verificar que o processo correspondente encerra.
4. Reativar a saída sem reiniciar o servidor.
5. Repetir com PGM e PVW e registrar CPU/GPU/memória.

## Teste de estabilidade

1. Manter o canal no ar por pelo menos 30 minutos.
2. Alternar dois vídeos e um item sem arquivo.
3. Confirmar que o item sem arquivo é pulado e o próximo assume.
4. Fechar o launcher e confirmar que engine, relay e MediaMTX terminam juntos.
5. Iniciar novamente e confirmar que não existem processos órfãos.

O script `scripts/verify-media-endpoints.ps1` valida a disponibilidade HTTP, mas não substitui a confirmação visual, auditiva e física destes passos.
