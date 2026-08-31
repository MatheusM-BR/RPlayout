# RPlayout

Sistema de playout para TV e streaming: rundown por horário real, grafismo em
camada, entradas NDI/SRT/RTMP e saídas RTMP/SRT com servidor interno para
convidados.

O plano completo de arquitetura, modelo de dados e roadmap está em
[`docs/PLANO.md`](docs/PLANO.md).

## Decisões travadas

- **Plataforma:** Windows (NDI nativo, NVENC, Decklink)
- **Motor de vídeo:** GStreamer, um pipeline por canal
- **Interface:** Web (backend serve a UI, vários operadores)
- **Canais:** multicanal desde o início
- **Grafismo:** camada CEF com templates HTML + editor
- **Servidor interno:** MediaMTX embutido
- **Automação:** motor de regras determinístico, Claude como camada opcional

## Status

Fase de planejamento concluída. Próxima etapa: **F0 (fundação)** e
**F1 (rundown + scheduler)**.
