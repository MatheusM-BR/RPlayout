# Reinstalação do RPlayout do zero (PC formatado)

Preparado em 03/11/2026, antes da formatação da máquina do ar (DESKTOP com
D:\RPlayout, D:\RPlayout Atual, D:\IA\Claude\RPlayout).

## 1. Onde está cada coisa

| O quê | Onde | Observação |
|---|---|---|
| Código-fonte completo | GitHub `MatheusM-BR/RPlayout`, branch `claude/playout-ndi-srt-rtmp-iqz2c7` | Inclui a r88-36 (árvore `870464d`). **Repositório público**: nada de banco, senha ou chave aqui. |
| Scripts de operação da máquina | `ops/windows/` neste repositório | Launchers `.cmd`, backup + atualização, firewall, soak, teste do vigia, captura de telas, conferência de build. |
| Base de runtime do instalador (`release/runtime-base-r30`, 1,9 GB) | Pacote **NUVEM** → `base-runtime/runtime-base-r30.tar.zst` | **Não está no git** (`.gitignore: release/`). Sem ela não se empacota versão nova. |
| Instalador da versão no ar (r88-35) | Pacote **NUVEM** → `instalador/RPlayout-1.1-parcial-20261020-r88-35-instalador.zip` (460 MB, SHA256 `8BE1EA47…BA97B`) | Instala sozinho; não precisa de build. |
| Banco de dados (grade, acervo, usuários, as-run) | Pacote **NUVEM** → `banco/rplayout-banco-2026-11-03T12-50.db.zst` | Backup consistente pedido à API às 12:50 de 03/11 (r88-35 no ar). |
| Chaves e perfil da instalação | Pacote **NUVEM** → `banco/vault.json`, `installation-profile.json`, `installation-receipt.json`, `mediamtx.yml`, `upgrade-preparation.json` | `vault.json` é **segredo**: abre as credenciais guardadas no banco (saídas, integrações). Guardar só em lugar privado. |
| Vídeos do acervo | `D:\Videos` e pastas do acervo | **Não** foram para a nuvem (tamanho). Copiar para disco externo se o D: for apagado. |

O pacote **NUVEM** foi montado em `D:\IA\Claude\RPlayout\NUVEM` e precisa ser
copiado pelo operador para o Google Drive (pasta privada), porque o acesso
automático ao Drive não foi liberado nesta sessão.

## 2. Pré-requisitos na máquina nova (Windows 11)

1. Drivers: **Blackmagic Desktop Video** (UltraStudio HD Mini) e da placa de vídeo (NVIDIA, para NVENC nos monitores).
2. **NDI Runtime/Tools** (o `Processing.NDI.Lib.x64.dll` já vem no pacote; as Tools ajudam a conferir as fontes).
3. Para **rodar** a versão empacotada: nada além disso — o pacote traz Node e GStreamer portáteis.
4. Para **gerar versões** (build): Git, **Node 24.16.0** (tem de ser igual ao da base), pnpm 10 (`corepack enable`), Rust estável MSVC + `rustup target add wasm32-unknown-unknown`, Visual Studio Build Tools (C++), GStreamer **1.28.7 MSVC runtime + development, instalação Complete** (variável `GSTREAMER_1_0_ROOT_MSVC_X86_64`). Conferir com `scripts\conferir-windows.ps1`. Detalhes em `docs/WINDOWS.md`.

## 3. Voltar ao ar com a versão que estava rodando (r88-35)

1. Copiar o pacote NUVEM para `D:\RPlayout-restauracao\`.
2. Descompactar o instalador r88-35 e instalar em `D:\RPlayout Atual` (seguir o LEIA-ME do zip).
3. Restaurar o banco: `zstd -d rplayout-banco-2026-11-03T12-50.db.zst -o service.db`, criar a pasta de dados (ex.: `D:\RPlayout dados`) com `service.db` e `vault.json`, e apontar o perfil da instalação para ela (ver `installation-profile.json` do pacote — campo `dataRoot`). Para restauração guiada, `docs/INSTALACAO-DADOS-E-INTEGRIDADE.md`.
4. Ajustar caminhos do acervo se a letra/pasta dos vídeos mudar (tela de Pastas do acervo).
5. Firewall: liberar `rplayout-engine.exe`, `node.exe` do runtime e o MediaMTX (portas 4000/TCP, 8889/TCP, 8189/UDP; SRT/NDI conforme as entradas). Os scripts `ops/windows/5-FIREWALL-*.ps1` só registram o estado antes/depois.
6. Vigia: `powershell -ExecutionPolicy Bypass -File scripts\instalar-vigia-rplayout.ps1` (no próprio usuário, sem administrador).
7. Bloqueio de tela: em máquina de ar, desligar o bloqueio automático (as atualizações remotas dependem da sessão desbloqueada).

## 4. Instalar a r88-36 (pronta, nunca entrou no ar)

A r88-36 foi tentada em 02/11 e a ativação falhou (porta 4000 ocupada; retorno
manual para a r88-35). As correções estão na árvore `870464d` ("r88-36b"):
espera da porta 4000, retorno robusto, `rplayout-encoders.exe` no pacote.

1. `git clone https://github.com/MatheusM-BR/RPlayout.git D:\RPlayout` e `git checkout claude/playout-ndi-srt-rtmp-iqz2c7`.
2. Restaurar a base: descompactar `runtime-base-r30.tar.zst` em `D:\RPlayout\release\` (fica `D:\RPlayout\release\runtime-base-r30\package-manifest.json`).
3. `powershell -ExecutionPolicy Bypass -File scripts\build-r88.ps1 -Edition RPlayout-1.1-parcial-20261020-r88-36b` e conferir com `ops\windows\conferir-build.ps1 -Edition RPlayout-1.1-parcial-20261020-r88-36b` (**só instalar com as 13 etapas PASS**).
4. Atualizar com `ops\windows\backup-e-atualizar4.ps1 -Tag r88-36b -OldData "<pasta de dados atual>"` (ajustar caminhos em `ops/windows/0-9-GERAR-E-ATUALIZAR-R88-36B.cmd`, que pressupõe a árvore antiga de D:\IA\Claude\RPlayout).
5. Verificar no ar: versão na tela técnica, PGM com áudio, monitores REF/PAD/LEV, multiview, scopes, sessões NVENC, consumo (soak 24 h com `ops\windows\soak2.ps1`).

## 5. Pendências que continuam valendo

- Watchdog com sinal real do vMix (NDI) caindo e voltando.
- DeckLink com sinal real e saída SDI.
- Memória do servidor subindo ~500 MB/dia na r88-35 (a r88-36 reduz o polling; medir no soak).
- Banco crescendo ~45 MB/dia (300 → 390 MB em 2 dias): conferir retenção na r88-36.
- Item da grade com pico −1,1 dBFS / ~−10,5 LUFS (alvo −23): conferir no QC.
- VT "Finaliza Gado Canal" sem áudio (91 s de silêncio por volta da grade).
- Lista completa: `docs/PENDENCIAS-NUMERADAS.md`.
