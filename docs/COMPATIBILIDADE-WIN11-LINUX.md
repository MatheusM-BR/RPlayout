# RPlayout: compatibilidade Windows 11 (23H2/24H2/25H2), WinUI 3 e Linux

Data: 2026-10-30. Repositório auditado: /home/claude/matheusm-br/rplayout (somente leitura).
Legenda: **[REPO]** = verificado lendo o código. **[FONTE]** = confirmado em página citada no fim. **[INFERIDO]** = conclusão minha, sem fonte direta.

## Resumo executivo

1. **Linux: o servidor Node e o engine Rust já têm caminhos Linux em boa parte** (cofre `OWNER_FILE`, `/etc/machine-id`, `/proc/net/dev`, `chmod 0700`, `xdg-open`, `cfg(not(windows))` no launcher; binários ELF já compilados em `apps/engine/target/release`). **Um único item bloqueia o playout nativo no Linux: o `rplayout-host-guard`**, que só existe para Windows (mutex `Global\`, Job Object, tabelas IP Helper). No Linux ele imprime "host guard requires Windows kernel job/mutex support" e sai com código 1; o servidor trata isso como "posse nativa não confirmada" e **não abre engine, MediaMTX nem relays**. Isso é falha fechada, de propósito.
2. **Segundo bloqueio prático (mais fácil):** `apps/server/src/config.ts` só procura binários com sufixo `.exe`. No Linux, `ENGINE_BINARY` e `MEDIAMTX_BINARY` resultam em vazio e o servidor cai em **transporte SIMULADO** sem avisar alto. Contornável com variáveis de ambiente (`RPLAYOUT_ENGINE`, `RPLAYOUT_MEDIAMTX`, `RPLAYOUT_HOST_GUARD`) ou com uma correção pequena.
3. **WMIC: não há nenhum uso no repositório.** Os scripts usam `Get-CimInstance Win32_Process`, que continua funcionando (só o `wmic.exe` foi removido, WMI não). A remoção do WMIC é real: Microsoft diz que saiu das versões suportadas do Windows 11 (24H2 e 25H2) na prévia de agosto de 2026 [FONTE].
4. **WinUI 3 / Windows App SDK / WPF / Electron: não existem no repositório** [REPO]. A UI é React 18 + Vite servida pelo servidor (`apps/web`). WinUI 3 não é necessário e não resolve nenhum problema atual.
5. **Risco operacional maior no Windows 11 não é incompatibilidade de código, é política do sistema:** reinício por atualização (inclusive o novo "um reinício por mês" nas versões 24H2/25H2), Smart App Control/SmartScreen/Defender diante de executáveis próprios **não assinados**, e fim de suporte de 23H2 e 24H2 Home/Pro.
6. **Recomendação:** Windows 11 **25H2** (ou 24H2 Enterprise/Education) para a estação atual; **Ubuntu 24.04 LTS** para o alvo Linux, depois de implementar o host guard Linux.

---

## A. Auditoria do código para Linux

### A.1 Como a posse do host é feita hoje

[REPO] `apps/engine/src/bin/host_guard.rs` + `host_guard/windows.rs` + `host_guard/sockets.rs`:

- Mutex nomeado global `Global\RPlayout.Broadcast.Distribution.v1` (CreateMutexW) e Job Object nomeado `Global\RPlayout.Broadcast.ProcessFamily.v1` com `KILL_ON_JOB_CLOSE`. O broker fica fora do job e admite o processo pai (o servidor Node) e os descendentes.
- Tabelas TCP/UDP com PID dono via `GetExtendedTcpTable`/`GetExtendedUdpTable` (IP Helper), para provar quem está escutando em cada porta.
- Consulta de processos por Toolhelp32 e `OpenProcess`.
- **Não usa named pipe para o mutex.** O IPC com o servidor é por **stdin/stdout** (linhas JSON com nonce de 64 hex; esquema em `apps/server/src/domain/host-distribution-fence.ts`, eventos `ready`, `blocked`, `asserted`, `membership`, `ports`, `pinned`, `process_ports`, `process_released`, `draining`, `unavailable`, `refused`).
- Em não-Windows, `main()` imprime erro e `exit(1)`.

Consequência no servidor [REPO] (`apps/server/src/app.ts` linha ~1640): se `ENGINE_BINARY`, `MEDIAMTX_BINARY` ou `RELAY_BINARY` existem e o papel HA não é STANDBY, cria `HostDistributionFence(HOST_GUARD_BINARY)` e chama `acquire()`. Sem guard funcional, `distribution-ownership.ts` devolve `HOST_FENCE_UNCONFIRMED` ("Posse nativa do computador não confirmada. Configurações e novos processos permanecem bloqueados").

### A.2 Tabela de itens específicos de Windows

| # | Item | Onde | Classe | Observação |
|---|---|---|---|---|
| 1 | Host guard só Windows (mutex, job, IP Helper) | `apps/engine/src/bin/host_guard.rs`, `host_guard/windows.rs` (634 linhas), `host_guard/sockets.rs` (284) | **BLOQUEIA** | Precisa de implementação Linux (ver A.4). Protocolo JSON do lado Node é portável. |
| 2 | Busca de binários só com `.exe` e `C:/IA/RPlayout/...` | `apps/server/src/config.ts` linhas 11-19, 34, 61-63 | **CONTORNÁVEL** | Sem a correção, vira SIMULADO no Linux. Contorno: `RPLAYOUT_ENGINE`, `RPLAYOUT_MEDIAMTX`, `RPLAYOUT_HOST_GUARD`, `RPLAYOUT_FILE_SECURITY`, `RPLAYOUT_INSTALL_ROOT`. Correção: sufixo condicional por `process.platform`. |
| 3 | `windowsHide` / `detached` em spawns | `host-distribution-fence.ts:64`, `engine.ts:~640`, `schedule-publication.ts:247`, `mediamtx.ts:321`, `relays.ts:150` | OK | `windowsHide` é ignorado fora do Windows. `detached:true` no Linux cria novo grupo de sessão (setsid); o comentário do código fala em "job do Node", então revisar a semântica de morte do guard no Linux (ver A.4). |
| 4 | PATH do GStreamer `C:\Program Files\gstreamer\1.0\msvc_x86_64\bin` | `apps/server/src/domain/engine.ts:~631-640` | OK | Já condicionado a `process.platform==='win32'`; no Linux usa `process.env.PATH`. |
| 5 | Cofre DPAPI via PowerShell | `apps/server/src/domain/secret-vault.ts` (windowsProtect linhas ~62-78, 88-102, 122) | **OK com ressalva** | Já existe ramo Linux `OWNER_FILE` (chave 32 bytes, arquivo 0600 do mesmo uid). Ressalvas: (a) caminho padrão usa `LOCALAPPDATA`, que no Linux não existe e cai em `process.cwd()/RPlayout/security/vault.json`; defina `RPLAYOUT_VAULT_FILE` (ex.: `/var/lib/rplayout/security/vault.json`). (b) Um `vault.json` do Windows (`WINDOWS_CURRENT_USER`) **não abre no Linux** (erro "Chave pertence ao Windows"). Migração de banco com segredos exige `RPLAYOUT_VAULT_KEY` (base64 de 32 bytes) preservada; `docs/RESTAURACAO-DE-BACKUP.md` diz que a conversão automática de DPAPI para chave compartilhada **não** está homologada. |
| 6 | Proteção de ACL de arquivo privado (`rplayout-file-security`) | `private-config-file.ts` (linha 10: `if (process.platform !== 'win32') return`) | OK | No Linux usa `chmod 0700/0600` e valida modo. Helper Windows não é necessário. |
| 7 | Identidade do host | `domain/execution-host.ts` | OK | Windows: `reg.exe query MachineGuid`; Linux: `/etc/machine-id` já implementado. Em contêiner/VM clonada, `machine-id` duplicado quebra a prova de "mesmo host" (INFERIDO). |
| 8 | Imagem do processo por PID via `tasklist` | `domain/server-instances.ts:39-41` (`windowsImageLookup`) | CONTORNÁVEL | Retorna `null` fora do Windows, o que mantém todas as linhas "protegidas" (conservador). Funciona, mas pode reter linhas obsoletas após reboot/reuso de PID. Correção simples: ler `/proc/<pid>/exe` ou `/proc/<pid>/comm`. |
| 9 | Contadores de processo via `powershell Get-Process` | `domain/process-metrics.ts:18-21` | CONTORNÁVEL | Retorna mapa vazio no Linux (métricas de CPU/memória por PID somem na UI; "estado do engine continua disponível"). Correção: `/proc/<pid>/stat` e `/proc/<pid>/statm`. |
| 10 | Rede via `Get-NetAdapterStatistics` | `domain/host-metrics.ts:110-118` | OK | Ramo Linux com `/proc/net/dev` já existe. |
| 11 | GPU via `nvidia-smi` | `host-metrics.ts` | OK | Disponível no Linux com driver NVIDIA. |
| 12 | Comparação de caminhos com `toLowerCase()` no win32 | `roots.ts:174`, `media-workflow.ts:71`, `media-partial-cleanup.ts:7`, `storage-maintenance.ts:38`, `upgrade-profile-adoption.ts:14`, `reconcile-upgrade-profile.ts:20` | OK | Já condicionado a `win32`; Linux é sensível a maiúsculas. Atenção a mídia vinda de pastas Windows com nomes que só diferem por caixa (INFERIDO). |
| 13 | Caminhos de mídia em playlist `.m3u` e assets com `\` | `routes.ts:1951, 1953, 1985` (`replace(/\\/g,'/')`); `packages/protocol/src/playlist.ts` (teste usa `D:\Programas\leilao.mp4`) | **CONTORNÁVEL** | Caminhos absolutos `D:\...` gravados no banco **não resolvem** no Linux. Precisa de remapeamento de raiz (ex.: `D:\RPlayout Arquivo de Midia` para `/srv/rplayout/midia`) na migração. O banco guarda `root.path`; migrar as raízes e os `asset.path` relativos. Não auditei o esquema de dados por completo. |
| 14 | Rejeição de caminhos `\\servidor` (UNC) | `ha-return-*.ts`, `ha-local-outputs.ts`, `ha-execution-export.ts` | OK | No Linux `startsWith('\\\\')` é falso; porém, **a proteção contra "compartilhamento de rede" deixa de existir**: um NFS/SMB montado em `/mnt/nas` passa. Para HA/WAL isso importa (ver A.6). |
| 15 | Placeholder de UI com `C:\Midia` e `\\NAS\Playout`; texto de docs com `D:\...` | `apps/web/src/views/MasterControlView.tsx:2580`, `DocsView.tsx:53-55` | OK (cosmético) | Trocar por texto dependente de plataforma. |
| 16 | Launcher `rplayout` (mutex/Job do servidor, `CREATE_NO_WINDOW`, `start`, `GetLocalTime`) | `apps/engine/src/bin/launcher.rs` linhas ~177-239, 455, 596-640, 688-699 | OK / CONTORNÁVEL | Já há `cfg(not(windows))` para `OwnedServerJob`, `hoje()`, `xdg-open`. **Bug de portabilidade:** `configurar_runtime_gstreamer` (linha ~552) junta PATH com `;` (Windows) e define `GSTREAMER_1_0_ROOT_MSVC_X86_64` e `gst-plugin-scanner.exe`; só afeta quem usar runtime GStreamer portátil em `runtime/gstreamer`. No Linux use GStreamer do sistema e **systemd**, não o launcher. |
| 17 | Espelho de backup em `%LOCALAPPDATA%\RPlayout\backups-banco` | `launcher.rs:~354` | CONTORNÁVEL | No Linux definir `RPLAYOUT_BACKUP_MIRROR` explicitamente. |
| 18 | OMT nativo: `libomt.dll` + `libvmx.dll`, recusa fora do Windows | `apps/engine/src/omt_runtime.rs:25-39` (`if !cfg!(windows) { return Err("OMT nativo está disponível ... apenas para Windows x64") }`) | **BLOQUEIA somente a saída/entrada OMT** | Se OMT for requisito no Linux, é preciso binário `libomt.so`/`libvmx.so` do fabricante e remover a trava. Não verifiquei se existem builds Linux (INFERIDO: o projeto OMT é multiplataforma, confirmar). NDI/SRT/RTMP/DeckLink não dependem disso. |
| 19 | Codificadores: lista `nvh264enc, qsvh264enc, mfh264enc, x264enc` | `apps/engine/src/output.rs:725, 755` | CONTORNÁVEL | `mfh264enc` é Media Foundation (Windows) e some no Linux sem erro (o código pula elementos ausentes). No Linux funcionam `nvh264enc` (NVENC) e `x264enc`. Para Intel/AMD faltam `vah264enc`/`vaapih264enc` na lista (melhoria opcional). |
| 20 | Decode por hardware opt-in `RPLAYOUT_HARDWARE_DECODE=1` | `channel.rs:861` | OK | Escolha de decoder é feita por política própria; verificar no Linux quais elementos (`nvh264dec`, `vah264dec`) o GStreamer expõe. Padrão é software. |
| 21 | DeckLink: `decklinkvideosrc/sink`, `decklinkaudiosrc/sink`, `decklinkdeviceprovider` | `channel.rs:923-942, 1680-1699`; `bin/devices.rs:125-382` | OK | Plugin GStreamer `decklink` (gst-plugins-bad) existe no Linux e depende do driver Desktop Video (ver seção B). Sem código Windows específico. |
| 22 | NDI: `ndisink`, `ndisinkcombiner`, `ndideviceprovider` | `output.rs:630-700`; `channel.rs:118, 886` | OK | Plugin `gst-plugin-ndi` (gst-plugins-rs) + NDI runtime Linux. O plugin é o mesmo código, outro binário. |
| 23 | MediaMTX | `mediamtx/mediamtx.exe`, `mediamtx.yml` | OK | Baixar binário `linux_amd64`. YAML é portável. |
| 24 | Sinais de processo | `index.ts:493-494` (`SIGINT`/`SIGTERM`), `process.kill(pid,0)` em vários domínios, `child.kill('SIGKILL')` | OK | No Windows `process.kill(pid,0)` e SIGTERM são emulados; no Linux são nativos e mais confiáveis. `ESRCH` já é tratado. |
| 25 | Scripts PowerShell (`scripts/*.ps1`, `.cmd`) | `instalar-vigia-rplayout.ps1`, `vigiar-rplayout.ps1`, `ligar/desligar-rplayout.ps1`, `atualizar-rplayout-no-lugar.ps1`, `install-rplayout-partial.*`, `package-rplayout-1.1.ps1`, `prepare-/restore-/review-*` | **BLOQUEIA o fluxo de instalação/atualização/vigia (não o runtime)** | Todo o ciclo de pacote, upgrade, rollback e vigia é PowerShell com `Get-CimInstance Win32_Process`, `Register-ScheduledTask`, `Start-Process`, `Stop-Process`, caminhos `D:\RPlayout Atual`. Sem equivalente Linux. Substituir por unit systemd + script de deploy (ver A.5). |
| 26 | Verificadores `verify-*.mts/.mjs` | `scripts/verify-host-guard.mjs` (assert `win32`), `verify-powershell-builtins.mjs` (usa `D:/RPlayout-builds/qa`), `qa-owned-*.ps1` | CONTORNÁVEL | Suíte de QA nativa é só Windows; a suíte `vitest` unitária é portável (o repositório foi "construído e verificado em Linux", `docs/WINDOWS.md`). |
| 27 | Build do servidor | `scripts/build-server.mjs` (esbuild, `platform:'node'`, `target:'node24'`, `better-sqlite3` externo) | OK | Portável. `better-sqlite3` precisa do binário nativo para a combinação Node/OS; já existe `better_sqlite3.node` em `apps/server/node_modules` (Linux). Caminho `runtime/node/node.exe` aparece em `prepare-compatible-rollback.ts:23-29` (rollback compatível; só empacotado Windows). |
| 28 | `GST_REGISTRY`, `GST_PLUGIN_SCANNER`, runtime portátil de ~centenas de DLLs | `launcher.rs`, `third-party-licenses/gstreamer/*.txt` | OK (não se aplica) | No Linux instalar `gstreamer1.0-plugins-{base,good,bad,ugly}`, `gstreamer1.0-libav`, `gstreamer1.0-rs`/compilar `gst-plugin-ndi`. |
| 29 | SQLite WAL | `apps/server/src/db/client.ts:415-417` (`journal_mode=WAL`, `synchronous=FULL`) | OK **se disco local** | WAL exige memória compartilhada no mesmo host; **não use NFS/SMB/CIFS para `rplayout.db`** (documentação do SQLite). O código já usa `journal_mode=DELETE` em cópias HA/restauração (`ha-protected-bridge.ts:24`, `backup-restore.ts:64`). Bom. Mídia pode ficar em rede; banco não. |
| 30 | Locais de dados padrão relativos a `process.cwd()` | `config.ts:5` (`rplayout.db`) | CONTORNÁVEL | Em systemd defina `WorkingDirectory=` e `RPLAYOUT_DB`, `RPLAYOUT_VAULT_FILE`, `RPLAYOUT_MEDIA_VERSIONS`, `RPLAYOUT_PGM_RECORD_DIR`, `RPLAYOUT_BACKUP_MIRROR`. |
| 31 | `windows-sys` no `Cargo.toml` | `apps/engine/Cargo.toml` (`[target.'cfg(windows)'.dependencies]`) | OK | Condicional; o crate compila no Linux (ELF já gerado em `target/release`). |

### A.3 O que já funciona no Linux (evidência)

- [REPO] `apps/engine/target/release/rplayout-engine` e `rplayout-host-guard` são ELF x86-64 GNU/Linux. Executei o guard: sai com a mensagem de "requires Windows" e nenhum recurso é adquirido (comportamento seguro).
- [REPO] `docs/WINDOWS.md`: "o sistema foi construído e verificado em Linux". `docs/PENDENCIAS-NUMERADAS.md`:126 cita testes Rust em Linux/GStreamer 1.24.
- [REPO] `better_sqlite3.node` presente para Linux em `apps/server/node_modules`.
- [REPO] `host-metrics.ts` e `execution-host.ts` já têm ramos Linux.

### A.4 Menor mudança para um build Linux de servidor + engine

Ordem de menor esforço para maior:

1. **Ambiente, sem mudar código (permite subir em SIMULADO e testar UI, banco, grade):** `RPLAYOUT_DB`, `RPLAYOUT_VAULT_FILE` (0600, dono do serviço), `RPLAYOUT_VAULT_KEY` se vier banco do Windows, `HOST=0.0.0.0`, `PORT=4000`, raízes de mídia remapeadas.
2. **Correção pequena em `config.ts`:** sufixo `.exe` somente em `win32`; remover o caminho fixo `C:/IA/RPlayout`; incluir `/opt/rplayout/...`. Também aceitar `RPLAYOUT_ENGINE` sem fallback silencioso para simulado quando `RPLAYOUT_REQUIRE_NATIVE=1` (sugestão, INFERIDO como melhoria de segurança).
3. **Host guard Linux (único bloqueio real do playout nativo).** Manter o protocolo JSON e as garantias já descritas no cabeçalho do guard ("sem kill de processo alheio, sem takeover por TTL, sem serviço de rede"). Desenho sugerido **[INFERIDO, não validado]**:
   - Exclusão do host: `flock(LOCK_EX|LOCK_NB)` em `/run/rplayout/distribution.v1.lock` (ou `/var/lock`), mantido enquanto o guard viver; a morte do guard libera o lock (equivalente ao mutex que não abandona silenciosamente).
   - Família de processos: cgroup v2 do próprio serviço systemd (`KillMode=control-group`, `Delegate=yes`) lido via `/sys/fs/cgroup/.../cgroup.procs`, ou `prctl(PR_SET_CHILD_SUBREAPER)` mais `pidfd`; "kill on close" = encerrar o cgroup quando o guard morrer (`BindsTo=`/`PartOf=` na unit).
   - Propriedade de portas TCP/UDP por PID: `/proc/net/{tcp,tcp6,udp,udp6}` (inode) cruzado com `/proc/<pid>/fd/*` (socket:[inode]), ou netlink `sock_diag`. Exige o mesmo uid ou `CAP_SYS_PTRACE`/`CAP_DAC_READ_SEARCH` para ver fds de outros processos.
   - Identidade de processo: `starttime` de `/proc/<pid>/stat` em lugar de `GetProcessTimes` (protege contra reuso de PID).
   - Esforço estimado: algumas centenas de linhas de Rust mais o verificador (`verify-host-guard.mjs` hoje exige `win32`). Não estimei prazos.
4. **Métricas por PID e `tasklist`:** trocar por `/proc` (itens 8 e 9). Cosmético para operação.
5. **Operação:** unit systemd para o servidor (item A.5). Substitui `vigiar-rplayout.ps1` e `instalar-vigia-rplayout.ps1`.
6. **OMT:** só se necessário (item 18).

### A.5 Serviço, vigia e atualizador (Linux)

Hoje: tarefa agendada do Windows (`Register-ScheduledTask`, gatilho `AtLogOn`, reinício a cada 1 min até 999 vezes) que chama `vigiar-rplayout.ps1`; o atualizador mata processos por caminho com `Get-CimInstance` e `Stop-Process -Force`. [REPO]

Linux (INFERIDO, padrão do sistema, sem fonte específica):

```
[Service]
Type=simple
User=rplayout
WorkingDirectory=/opt/rplayout
EnvironmentFile=/etc/rplayout/rplayout.env
ExecStart=/opt/rplayout/runtime/node/bin/node apps/server/dist/server.cjs
Restart=always
RestartSec=2
KillMode=control-group
TimeoutStopSec=30
LimitNOFILE=65536
AmbientCapabilities=            # nenhum, portas >1024
```

- Rodar como serviço de sistema (não depende de logon), com `Restart=always`. Ajustar `Nice`/`CPUSchedulingPolicy`/`IOSchedulingClass` e isolar CPUs só depois de medir.
- Atualização: pasta versionada `/opt/rplayout/releases/<id>` e link simbólico `current`; reinício por `systemctl restart`. O contrato de upgrade/rollback atual (`prepare-rplayout-upgrade.ps1`, `reconcile-upgrade-profile`) é PowerShell e precisaria de reimplementação para manter as garantias de recibo, backup e rollback.

### A.6 SQLite e sistemas de arquivos

- `rplayout.db` e o diretório de dados devem ficar em **disco local ext4/xfs** (WAL). Backups e espelho podem ir para outro volume. Mídia e gravação PGM podem ficar em NFS/SMB (verifique latência e `soft/hard` mount no playout; INFERIDO).
- O código recusa UNC `\\` em partes do HA; no Linux essa defesa deixa de existir porque montagens de rede parecem caminhos locais. Considerar checagem de tipo de sistema de arquivos (`statfs` f_type ou `/proc/mounts`) ao aceitar raízes HA (INFERIDO, melhoria).

### A.7 DeckLink, NDI, vMix, ffmpeg

- **DeckLink no Linux:** o código não tem nada específico de Windows; precisa do pacote `gstreamer1.0-plugins-bad` com o plugin `decklink` e do driver **Desktop Video para Linux** (`.deb`/`.rpm`/tar). [FONTE] A página oficial da Blackmagic lista Desktop Video 16.3 com Linux x86-64 em Ubuntu 24.04 e 26.04, Debian 13, Fedora 44, Rocky 8.6/9.8, kernel mínimo 4.18. O plugin GStreamer é compilado contra um SDK DeckLink específico; a versão do driver precisa ser compatível (INFERIDO, validar com `gst-inspect-1.0 decklinkvideosink` e `rplayout-devices`).
- **NDI no Linux:** [FONTE] NDI é suportado e depende de `libavahi-common.so.3` e `libavahi-client.so.3` com o `avahi-daemon` rodando; configuração em `$HOME/.ndi/ndi-config.v1.json` (ou `NDI_CONFIG_DIR`). O `ndisink`/`ndisinkcombiner` pertence ao plugin `ndi` do `gst-plugin-ndi` [FONTE]; precisa de `libndi.so` do runtime NDI instalado (INFERIDO: o plugin carrega a biblioteca em tempo de execução, confirmar caminho com `NDI_RUNTIME_DIR_V6` ou equivalente).
- **vMix** só roda em Windows. O RPlayout em Linux continua recebendo/enviando por **rede** (NDI, SRT, RTMP, OMT se houver runtime Linux). O código só trata vMix como origem de rede (por exemplo fonte `ndi:VMIX` e rótulos de UI); não encontrei integração por API/COM com vMix em `apps/server/src` e `apps/engine/src` [REPO]. Fonte "live vMix/NDI" continua válida.
- **ffmpeg:** o repositório não usa ffmpeg (servidor e engine); decodificação e proxy usam GStreamer (`uridecodebin`, `x264enc`, `avdec_aac`) [REPO]. No Linux basta `gstreamer1.0-libav` para `avdec_*`.

---

## B. Windows 11 23H2 / 24H2 / 25H2: mudanças recentes relevantes

### B.1 Ciclo de vida e versões [FONTE]

| Versão | Home/Pro | Enterprise/Education |
|---|---|---|
| 23H2 | fim em **11/11/2025** (já sem atualizações de segurança) | até **novembro/2026** |
| 24H2 | fim em **13/10/2026** (já passou, hoje é 30/10/2026) | até **outubro/2027** |
| 25H2 | GA em setembro/2025 como **pacote de habilitação**; fim consumidor em **outubro/2027** | não confirmado nas fontes lidas |

- Dispositivos 24H2 Home/Pro não gerenciados são atualizados automaticamente para 25H2 (o usuário pode adiar/escolher horário de reinício).
- **Conclusão:** 23H2 e 24H2 Home/Pro **não recebem mais correções**. Para uma estação 24/7, fixar **25H2** (ou 24H2/25H2 Enterprise/Education/IoT Enterprise LTSC se licenciado; LTSC não foi pesquisado).
- 24H2 exige CPU com **POPCNT** (e há bloqueio de compatibilidade por **SSE4.2** visto em build Canary; se está na versão final não foi confirmado nas fontes) [FONTE: Neowin]. Hardware antigo de estação deve ser conferido.
- Versões novas já listadas pela Microsoft: 26H1 e 26H2 [FONTE: KB5121772]. Não avaliei esses releases.

### B.2 WMIC (pedido específico do dono) [FONTE + REPO]

- **Fato:** o utilitário `wmic.exe` está removido das versões suportadas do Windows 11. Cronologia da Microsoft: desativado por padrão em 23H2 e 24H2 (ainda instalável como Feature on Demand), removido ao atualizar para 25H2, e a remoção entrou na **prévia de agosto de 2026** para 24H2 e 25H2; **não está mais disponível como FoD**. Só o `wmic.exe` sai; o WMI continua. Substitutos: `Get-CimInstance`, `Get-WmiObject`, `Invoke-CimMethod`. Existe um pacote paliativo `wmic_dlc.zip` que a própria Microsoft chama de "não seguro, não de longo prazo".
- **No repo:** `grep -i wmic` em `.ps1 .cmd .ts .mts .mjs .rs .md .txt` retorna **zero ocorrências**. Os scripts usam `Get-CimInstance Win32_Process` (`atualizar-rplayout-no-lugar.ps1:32,49`, `desligar-rplayout.ps1:7`, `ligar-rplayout.ps1:7`, `vigiar-rplayout.ps1:26`, `observe-own-probe.ps1:13,17`) e `Get-CimInstance Win32_OperatingSystem` (`scripts/lib/available-memory.ps1:9`). **Nada quebra com a remoção do WMIC.**
- Risco residual: ferramentas de terceiros do estúdio (monitoramento, instaladores de driver, scripts do operador) que chamem `wmic`. Fora do repo, não verificado.

### B.3 Atualização do Windows e reinício [FONTE]

- **KB5121772 "One restart a month for Windows updates"** (Microsoft, publicado em agosto/2026): para 24H2, 25H2, 26H1 e 26H2, atualizações que exigem reinício são retidas e instaladas junto com a atualização mensal de segurança (segunda terça do mês), com reinício "fora do horário ativo sempre que possível". Aplica-se, por ora, a dispositivos **não gerenciados por TI**, com liberação gradual; usuário pode definir horário ativo ou pausar até 35 dias. Defender, componentes de IA, drivers críticos e atualizações de emergência continuam imediatos. A página não descreve reinício forçado nem prazo.
- **Relato de usuário (Microsoft Q&A, sem resposta aceita):** 25H2 reiniciou durante o horário ativo com a máquina sem usuário, ignorando GPOs de "sem reinício automático com usuários logados" e de horário ativo; a causa possível citada é prazo (deadline/grace period) vencido. Tratar como **risco real para playout 24/7** (relato, não confirmado pela Microsoft).
- **Ações sugeridas para a estação Windows (INFERIDO a partir das fontes):** gerenciar por política (WSUS/Intune/GPO) em vez de depender de "horário ativo"; usar prazos de qualidade/feature com período de carência longo; janela de manutenção planejada com failover para a máquina de standby (o sistema já tem HA); pausar atualizações por até 35 dias durante grandes eventos; nunca atualizar as duas máquinas HA no mesmo dia.

### B.4 Smart App Control, SmartScreen, Defender/ASR e binários não assinados [FONTE + REPO]

- **Smart App Control (SAC)**, modo de execução: bloqueia código não assinado e sem reputação; só deixa rodar o que a inteligência da Microsoft considera seguro ou o que está assinado por uma CA do Trusted Root Program. Em "avaliação" pode se desligar sozinho para perfis de desenvolvedor/corporativo. Nenhuma exceção empresarial é descrita; a página recomenda assinar os binários. (Se SAC ficou desligado, a página não afirma se dá para religar sem reset; a FAQ da Microsoft cobre isso e não li.)
- **ASR (Defender):** a regra "Block executable files from running unless they meet a prevalence, age, or trusted list criterion" (GUID `01443614-cd74-433a-b99e-2ecdc07bfc25`) exige proteção na nuvem e permite exclusões limitadas por arquivo/pasta. A página não informa o modo padrão em Windows 11 não corporativo; verificar na máquina com `Get-MpPreference` (campos `AttackSurfaceReductionRules_Ids/Actions`).
- **No repo [REPO]:** não há `signtool`, `Set-AuthenticodeSignature` nem tratamento de `Zone.Identifier`/`Unblock-File` para os executáveis próprios (`RPlayout-Server.exe`, `rplayout-engine.exe`, `rplayout-host-guard.exe`, launchers). O único uso de `Get-AuthenticodeSignature` valida o runtime MSVC e DLLs do GStreamer. **Conclusão [INFERIDO]:** os executáveis do RPlayout são **não assinados** e novos a cada build (hash novo, sem reputação); em máquina limpa com SAC em enforcement, SmartScreen forte ou ASR de prevalência ativa, **podem ser bloqueados**, e o host guard bloqueado derruba a posse nativa (falha fechada) e portanto o playout.
- **Ações:** (1) assinar todos os `.exe`/`.dll` próprios com certificado de assinatura de código de CA pública (e carimbo de tempo); (2) no Windows de produção, SAC desligado (decisão consciente, ele só pode ser desligado, ver FAQ) ou estação com política WDAC/AppLocker permitindo o editor; (3) exclusões ASR/Defender para a pasta de instalação e a pasta de mídia, sem desligar a proteção; (4) testar o primeiro start numa imagem Windows 11 25H2 limpa com SAC em "Ligado".

### B.5 Windows Firewall

Não encontrei fonte verificada de mudança de comportamento relevante em 24H2/25H2. Uma busca retornou uma notícia (Neowin, KB5060829, "novo recurso do 24H2 acionando o firewall") cuja página não abriu, portanto **não verificada**. O que o projeto exige continua sendo regra de entrada para: porta do servidor (`4000`), MediaMTX (RTSP 8554, RTMP 1935, SRT 8890/UDP, HLS 8888, WebRTC 8889; API 9997 só loopback, `mediamtx.yml`), NDI (mDNS 5353/UDP, descoberta e streams em portas dinâmicas TCP/UDP; ver docs NDI) e o launcher. [REPO] `mediamtx.yml`. Ação [INFERIDO]: regra de firewall por programa para os executáveis assinados, perfil de rede "Privada" na LAN do estúdio.

### B.6 W32Time, energia e USB

- **W32Time:** não consegui abrir a documentação da Microsoft; **sem fonte**. [INFERIDO] O cliente Windows usa SNTP com precisão da ordem de dezenas de ms a segundos e não é adequado como referência de quadro. Se o playout depender de relógio de parede alinhado com outras máquinas (agendamento, as-run, HA), configurar NTP interno e verificar `w32tm /query /status`. No Linux, `chrony` (e PTP/`linuxptp` se houver grandmaster) é a opção padrão (INFERIDO).
- **Energia / USB selective suspend:** **sem fonte consultada**. [INFERIDO] Plano "Alto desempenho"/"Desempenho máximo", sem suspensão de disco/USB/PCIe (ASPM), "USB selective suspend" desligado, sem hibernação nem modern standby; relevante para interfaces USB de áudio/controle, não para DeckLink PCIe.
- **POPCNT/SSE4.2:** ver B.1.

### B.7 Drivers e runtimes de mídia

- **DeckLink / Desktop Video:** [FONTE] a página "About Blackmagic Desktop Video Software" lista **Desktop Video 16.3** como a mais recente, para Windows 10/11 64 bits (Thunderbolt ou PCIe, 8 GB de RAM); **a página não cita 24H2 nem 25H2 por nome**. Portanto **não consigo afirmar compatibilidade específica com 24H2/25H2 a partir da fonte oficial**; validar na máquina: instalar 16.x, `rplayout-devices`, `gst-inspect-1.0 decklinkvideosink`. Um fórum da Blackmagic registra casos de placa não detectada em Windows 11 (tópicos individuais, não lidos em detalhe, não conclusivos).
- **NDI no Windows:** [FONTE] x64 recomendado; **driver Npcap Loopback (instalado com o Wireshark) pode interferir no NDI e degradar a rede**; configurações em `C:\ProgramData\NDI\ndi-config.v1.json`. Versão atual do NDI Tools/Runtime não foi verificada.
- **GStreamer:** [FONTE] a série **1.28** (1.28.0 em 27/01/2026; 1.28.8 em 08/10/2026 com correções de segurança). O repositório usa a crate `gstreamer` 0.23 e docs citam GStreamer 1.28.x/1.24 [REPO]. Não verifiquei se há binários MSVC da 1.28.8 publicados (a notícia diz "em breve"). Recomendar fixar uma versão testada, e atualizar plugins `decklink`/`ndi` em conjunto.
- **Node.js:** [FONTE] **Node 24 "Krypton" é LTS** (suporte até abril/2028 segundo nodejs.org); Node 22 "Jod" também está em LTS. Fim de vida do 22 por volta de abril/2027 (conhecimento prévio, **não confirmado** pela página). O repositório aceita `>=22 <23 || >=24 <25` e compila com `target:'node24'` [REPO]. Node 23+ não tem binários de 32 bits para Windows [FONTE]. Windows 11 64 bits é suportado (a página da migração não lista mínimo). Recomendar **Node 24 LTS**; evitar versões ímpares (23/25), porque `better-sqlite3` não tem binário pré-compilado ([REPO] `docs/WINDOWS.md`).
- **PowerShell:** os scripts rodam em `powershell.exe` 5.1. Não pesquisei a remoção do PowerShell 2.0 do 24H2 (INFERIDO: não afeta scripts que não pedem `-Version 2`).

---

## C. WinUI 3

**Verificação no repositório [REPO]:** não há `.csproj`, `.xaml`, `.sln`, `.vcxproj`, referência a `Microsoft.WindowsAppSDK`, WinUI, WPF, Electron, Tauri, WebView2 ou MSIX. `apps/web` é **React 18 + Vite + TanStack Query + Zustand**, servido pelo servidor Fastify (`@fastify/static`); os "clientes" (`RPlayout-Master.exe`, `-Schedule`, `-Users`, `-Monitor`, `-Aired`, `-QC`) são o mesmo launcher Rust que abre o navegador em um workspace (`launcher.rs`, `abrir_navegador`). **Resposta clara: não há componente WinUI 3, Windows App SDK, WPF nem Electron.**

**O que WinUI 3 mudaria:** [FONTE] WinUI 3 é o framework nativo recomendado pela Microsoft para novos apps de desktop Windows, entregue no **Windows App SDK**; roda no Windows 10 1809+ e Windows 11. A versão estável atual é a **2.6.4** (27/10/2026); a série 2.0 é "Current" (fim de serviço 29/04/2027) e a 1.8 saiu de serviço em 24/09/2026 (WASDK exige ficar no último patch para ter suporte).

| | Prós de uma estação nativa WinUI 3 (INFERIDO) | Contras (INFERIDO) |
|---|---|---|
| Operação | Atalhos globais, multi-janela, janelas fora do navegador, integração com driver/GPIO | Exclusivo Windows; incompatível com o alvo Linux |
| Manutenção | Aparência nativa Fluent | Segunda base de código (C#/C++ + XAML) para manter junto da UI web; reescrita de todas as telas (`apps/web/src/views/*`, milhares de linhas) |
| Distribuição | MSIX ou não empacotado | Dependência do runtime do Windows App SDK (ciclo de vida de ~1 ano por série), assinatura/SmartScreen também valem para o app novo |
| Risco | | Mais um componente sujeito a SAC/ASR e a quebras entre versões do WASDK |

**Veredito:** **não é necessário** e prejudica o plano de Linux. A UI web atende Windows e Linux e é usada de qualquer máquina da LAN. Só se justificaria uma estação nativa para necessidades que o navegador não cobre (exemplos: atalhos globais com a janela sem foco, controle de múltiplos monitores dedicados em quiosque). Alternativa mais barata, caso se queira janela dedicada [INFERIDO]: modo "app" do Edge/Chrome em quiosque, sem código novo.

Se algum dia um componente WinUI 3 for criado: usar Windows App SDK 2.x estável, publicar assinado, e fixar a versão do runtime.

---

## D. Conclusão

### D.1 Tabela Item × Win11 24H2/25H2 × Linux (Ubuntu LTS) × risco × ação

| Item | Win11 24H2/25H2 | Linux (Ubuntu 24.04 LTS) | Risco | Ação sugerida |
|---|---|---|---|---|
| Servidor Node/TS + React | OK (Node 22/24, 64 bits) | OK | Baixo | Padronizar em Node 24 LTS |
| `better-sqlite3` (nativo) | OK em 22/24 | OK (binário já presente) | Baixo | Não usar Node 23/25 |
| SQLite WAL | OK em disco local | OK em disco local; **nunca NFS/SMB** | Médio (se banco em rede) | Banco local; mídia pode ser rede |
| Engine Rust + GStreamer | OK (runtime MSVC portátil) | Compila (ELF existe); usar GStreamer do sistema | Médio (versão de plugins) | Fixar GStreamer 1.28.x; testar encoders |
| Host guard (posse do host) | OK (Job + mutex) | **BLOQUEIA** playout nativo (só Windows) | **Alto no Linux** | Implementar guard Linux (flock + cgroup + /proc) e verificador |
| Busca de binários `.exe` | OK | Cai em SIMULADO sem aviso | Alto (falha silenciosa) | Corrigir `config.ts` ou definir variáveis de ambiente |
| Cofre de segredos | DPAPI via PowerShell | `OWNER_FILE` 0600 já implementado; cofre do Windows não abre | Médio | `RPLAYOUT_VAULT_FILE`; migrar com `RPLAYOUT_VAULT_KEY` preservada |
| DeckLink SDI | Desktop Video 16.x (24H2/25H2 não citados pela Blackmagic) | Desktop Video 16.3 para Ubuntu 24.04/26.04 (Blackmagic) | Médio (versão/compatibilidade) | Validar com `rplayout-devices` em ambos |
| NDI | OK; Npcap Loopback pode atrapalhar | Precisa de avahi-daemon e libndi.so | Médio | Instalar avahi; testar descoberta |
| OMT | `libomt.dll` + `libvmx.dll` | Recusado por código (`omt_runtime.rs`) | Médio (se OMT for requisito) | Verificar se há build Linux; remover trava só então |
| MediaMTX | `mediamtx.exe` | `mediamtx` linux_amd64 | Baixo | Baixar binário e configurar caminho |
| Encoders | `nvh264enc`, `qsvh264enc`, `mfh264enc`, `x264enc` | `nvh264enc`, `x264enc`; faltam `va*` | Baixo | Adicionar `vah264enc` se usar Intel/AMD |
| Vigia/atualizador | PowerShell + Tarefa Agendada | systemd | Alto (reescrever) | Unit systemd, deploy por symlink; reimplementar upgrade/rollback |
| Scripts `.ps1`/`.cmd`, QA nativa | OK (sem WMIC) | Não portam | Médio | Equivalentes `.sh`/Node para o que for mantido |
| WMIC | **Removido**; repo não usa | n/a | Nenhum no repo | Auditar scripts de terceiros do estúdio |
| Executáveis não assinados | SAC/SmartScreen/ASR podem bloquear | n/a | **Alto no Windows limpo** | Assinar; testar em imagem limpa 25H2 com SAC ligado |
| Reinício de atualização | KB5121772 e relatos de reinício forçado | `unattended-upgrades` sem reinício automático | Alto (24/7) | Política de manutenção e HA; no Linux controlar reboot |
| Fim de suporte | 23H2 e 24H2 Home/Pro sem correções | Ubuntu 24.04 LTS (suporte padrão de 5 anos, conhecimento prévio) | Médio | Ir para 25H2 |
| Relógio | W32Time (precisão limitada, sem fonte) | chrony/PTP | Médio | Configurar NTP/PTP |
| Energia/USB | Plano de alto desempenho, sem suspend (sem fonte) | `tuned`/governor `performance` | Baixo | Padronizar na imagem |
| WinUI 3 / WASDK | Não usado | n/a | Nenhum | Não adotar |

### D.2 Ordem de execução recomendada

1. **Agora (Windows de produção, sem código):** fixar 25H2; política de atualização com janela de manutenção e HA; confirmar com `Get-MpPreference` o estado de ASR; planejar assinatura de código; inventariar scripts de terceiros por `wmic`.
2. **Assinatura de código** dos executáveis próprios e teste em **imagem Windows 11 25H2 limpa** com Smart App Control ligado, Defender padrão e SmartScreen (já previsto pelo dono: "Windows limpo testaremos depois").
3. **Linux, etapa 1 (rápida):** corrigir `config.ts` (sufixo, caminhos), rodar servidor + UI em Ubuntu 24.04 com banco/cofre locais e engine em modo sem host guard (apenas laboratório); validar `vitest` e as suítes Rust.
4. **Linux, etapa 2 (bloqueio):** implementar o host guard Linux e seu verificador; só então liberar engine nativo, MediaMTX e relays.
5. **Linux, etapa 3:** Desktop Video 16.x + plugin `decklink`; NDI (avahi + runtime + `gst-plugin-ndi`); medir encoders (`nvh264enc`/`x264enc`/`va*`) e decode por hardware.
6. **Linux, etapa 4:** unit systemd, rotação de logs, backup/espelho, remapeamento de raízes de mídia do banco migrado, procedimento de atualização e rollback.
7. **Linux, etapa 5:** teste de 72 h com failover HA entre máquinas e comparação de desempenho com Windows; só então decidir produção.

### D.3 O que eu só inferi, sem fonte

- Desenho do host guard Linux (flock, cgroup v2, /proc, sock_diag), esforço e capacidades necessárias.
- Qualquer parâmetro de unit systemd, chrony/PTP, governor, `unattended-upgrades`.
- Comportamento de NFS/SMB com SQLite além do que o código já evita (a regra "WAL não em rede" é documentação do SQLite, não consultada nesta rodada).
- Existência de `libomt.so`/`libvmx.so` oficiais; caminho exato de `libndi.so` esperado pelo `gst-plugin-ndi`.
- Que os executáveis do RPlayout são não assinados (baseado em ausência de qualquer comando de assinatura no repo e nos scripts de pacote; os binários já compilados não foram inspecionados no Windows).
- Mudanças de Firewall, W32Time e USB selective suspend (sem fonte oficial aberta).
- Fim de vida do Node 22 (abril/2027) e suporte do Ubuntu 24.04.
- Qualquer efeito das versões 26H1/26H2 do Windows (apenas citadas pela Microsoft).

---

## Fontes

- Microsoft Support, "Windows Management Instrumentation Command-line (WMIC) removal from Windows": https://support.microsoft.com/en-gb/topic/windows-management-instrumentation-command-line-wmic-removal-from-windows-e9e83c7f-4992-477f-ba1d-96f694b8665d
- Microsoft Support, "One restart a month for Windows updates" (KB5121772): https://support.microsoft.com/en-us/servicing/os/windows/docs/2026/07/kb5121772-one-restart-a-month-for-windows-updates
- Microsoft Q&A, "Windows 11 25H2 forces automatic reboot during active hours when user is away - GPOs correctly set but ignored" (relato de usuário): https://learn.microsoft.com/en-in/answers/questions/5916635/windows-11-25h2-forces-automatic-reboot-during-act
- Microsoft Learn, "Smart App Control" (visão geral para desenvolvedores): https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview
- Microsoft Learn, "Attack surface reduction rules reference": https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-reference
- Microsoft Learn, "Windows App SDK release channels" (versões e ciclo de vida): https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/release-channels
- Microsoft Learn, "WinUI 3": https://learn.microsoft.com/en-us/windows/apps/winui/winui3/
- BleepingComputer, "Microsoft: Windows 11 23H2 Home and Pro reach end of support": https://bleepingcomputer.com/news/microsoft/microsoft-windows-11-23h2-home-and-pro-reach-end-of-support
- BleepingComputer, "Windows 11 24H2 Home and Pro reach end of support in October": https://www.bleepingcomputer.com/news/microsoft/windows-11-24h2-home-and-pro-reach-end-of-support-in-october/amp/
- Neowin, "Microsoft adds SSE4.2 to the list of compatibility blocks in Windows 11": https://www.neowin.net/news/microsoft-adds-sse42-to-the-list-of-compatibility-blocks-in-windows-11/
- Blackmagic Design, "About Blackmagic Desktop Video Software" (readme, versão 16.3, Linux/Windows): https://www.blackmagicdesign.com/support/content/readme/1fc57acbb3f44c05bea7b8cbdf79f6aa
- NDI Docs, "Platform Considerations": https://docs.ndi.video/docs/sdk/platform-considerations
- GStreamer documentation, "ndisinkcombiner" (plugin ndi): https://gstreamer.freedesktop.org/documentation/ndi/ndisinkcombiner.html
- GStreamer Discourse, "GStreamer 1.28.0 new major feature release": https://discourse.gstreamer.org/t/gstreamer-1-28-0-new-major-feature-release/5700
- Linuxiac, "GStreamer 1.28.8 Multimedia Framework Gets Security Fixes": https://linuxiac.com/gstreamer-1-28-8-multimedia-framework-gets-security-fixes/
- Node.js, "Node.js v22 to v24" (migração, Node 24 LTS): https://nodejs.org/en/blog/migrations/v22-to-v24
- Node.js, "Previous releases": https://nodejs.org/en/about/previous-releases

Não abertos ou sem conteúdo útil: Neowin KB5060829 (firewall), documentação W32Time da Microsoft.
