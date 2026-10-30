# Relógio do servidor (NTP) no playout

A grade e os horários fixos dependem do relógio de parede do servidor. Se ele
deriva, o bloco entra fora de hora e ninguém percebe até o ar errar. O servidor
passa a **medir** o relógio contra NTP o tempo todo e a avisar. Ele **não
ajusta** o relógio: quem sincroniza é o serviço de hora do sistema (abaixo).

## O que é medido

- Cliente SNTP (RFC 4330) próprio, UDP 123, sem dependência nova, em segundo
  plano (nunca no caminho do PGM).
- Servidores padrão: `a.st1.ntp.br`, `b.st1.ntp.br`, `c.st1.ntp.br`, `pool.ntp.org`.
- Por servidor: no mínimo 3 amostras válidas; vale a mediana. Descartadas:
  stratum 0 (inclui kiss-of-death) e acima de 15, LI=3 (servidor sem
  sincronismo), root dispersion alta, resposta cujo *origin timestamp* difere do
  enviado, modo errado, RTT negativo.
- `offset = ((t1 - t0) + (t2 - t3)) / 2` (positivo: o servidor do playout está
  **atrás** do NTP) e `RTT = (t3 - t0) - (t2 - t1)`. O valor final é a mediana
  entre os servidores que responderam.
- Rodada inicial ~20 s após o início e depois a cada 10 min.
- A cada 5 s, sem rede, compara o relógio de parede com o monotônico: diferença
  maior que 1 s entre duas leituras é **salto do relógio** (alguém acertou a
  hora à mão, VM retomada, serviço de hora corrigindo de uma vez).
- Complemento, sem substituir o SNTP: Windows lê `w32tm /query /status`
  (Source, Last Successful Sync Time) e o estado do serviço W32Time; Linux lê
  `timedatectl show -p NTPSynchronized -p NTP` e, se existir, `chronyc tracking`.
  Falha de leitura vira campo `error`, nunca derruba nada.

## Estados e limiares

| Estado | Condição | Padrão |
|---|---|---|
| OK | desvio absoluto <= 50 ms | `RPLAYOUT_CLOCK_WARN_MS` |
| AVISO (WARN) | desvio > 50 ms, **ou** salto do relógio | |
| CRÍTICO (CRITICAL) | desvio > 500 ms | `RPLAYOUT_CLOCK_CRITICAL_MS` |
| NÃO VERIFICADO (UNVERIFIED) | nenhum servidor respondeu em 3 rodadas seguidas | `RPLAYOUT_CLOCK_UNVERIFIED_ROUNDS` |

Por quê: um quadro a 25 fps dura 40 ms. 50 ms é pouco mais de um quadro, acima
do ruído normal de SNTP pela internet. 500 ms são cerca de 12 quadros: começos
de bloco e cortes por horário ficam visivelmente fora e a conferência com outros
sistemas (grade, comerciais, as-run) deixa de bater.

"Não verificado" é **aviso**, não crítico, de propósito: rede de ar costuma
bloquear a internet. **O firewall precisa liberar saída UDP 123** para os
servidores NTP (ou use `RPLAYOUT_CLOCK_SERVERS` com um servidor NTP interno).
Sem isso o monitor fica cego, não o playout.

## Eventos e integração

- Incidentes em `health_events`, componente `CLOCK`, ids
  `clock:drift:<ocorrência>:active` (abre, WARN ou CRITICAL),
  `clock:drift:<ocorrência>:critical` (se escalar de aviso para crítico) e
  `clock:drift:<ocorrência>:recovered` (INFO; resolve os anteriores). O
  `<ocorrência>` é único por incidente porque `health_events.id` é chave
  primária. Se o servidor reiniciar com incidente aberto, ele é retomado.
- Eventos de integração: `clock.drift` (abertura e escalada) e `clock.recovered`.
  Aparecem no catálogo de eventos do painel de Integrações.
- CLOCK **não** entra no escalonamento do PGM (que vale só para quedas de sinal).
  Como todo alerta WARN/CRITICAL, gera `alert.warning`/`alert.critical`.
- `GET /api/clock` (exige sessão, somente leitura): `checkedAt`, `state`,
  `offsetMs`, `rttMs`, `servers[]`, `platform`, `thresholds`. O cabeçalho da
  interface mostra o selo RELÓGIO com o desvio e a hora da última checagem.

## Variáveis de ambiente

`RPLAYOUT_CLOCK_SERVERS` (lista separada por vírgula; aceita `host:porta`),
`RPLAYOUT_CLOCK_INTERVAL_MS` (600000), `RPLAYOUT_CLOCK_INITIAL_DELAY_MS` (20000),
`RPLAYOUT_CLOCK_JUMP_CHECK_MS` (5000), `RPLAYOUT_CLOCK_TIMEOUT_MS` (1500),
`RPLAYOUT_CLOCK_SAMPLES` (3, mínimo 3), `RPLAYOUT_CLOCK_WARN_MS` (50),
`RPLAYOUT_CLOCK_CRITICAL_MS` (500), `RPLAYOUT_CLOCK_MAX_ROOT_DISPERSION_MS` (500),
`RPLAYOUT_CLOCK_UNVERIFIED_ROUNDS` (3), `RPLAYOUT_CLOCK_JUMP_MS` (1000).
Valores inválidos voltam ao padrão.

## Limite: SNTP não é PTP

SNTP serve para manter a **hora do dia** do servidor correta (dezenas de
milissegundos). Ele **não substitui** PTP (IEEE 1588), nem o perfil de
sincronismo de mídia SMPTE ST 2059, quando houver sincronismo de vídeo/áudio
entre equipamentos (genlock, relógio de áudio em rede). Este monitor não mede
nem garante isso.

## Configurar o serviço de hora

Windows (W32Time), em prompt elevado; confira com `w32tm /query /status`:

```
sc config w32time start= auto
net start w32time
w32tm /config /manualpeersearchlist:"a.st1.ntp.br,0x8 b.st1.ntp.br,0x8 c.st1.ntp.br,0x8" /syncfromflags:manual /reliable:yes /update
w32tm /resync
```

Linux com chrony (`/etc/chrony/chrony.conf` ou equivalente da distribuição):

```
server a.st1.ntp.br iburst
server b.st1.ntp.br iburst
server c.st1.ntp.br iburst
makestep 1.0 3
```

Depois `chronyc tracking` e `chronyc sources -v`.

Linux com systemd-timesyncd (`/etc/systemd/timesyncd.conf`, seção `[Time]`,
`NTP=a.st1.ntp.br b.st1.ntp.br c.st1.ntp.br`), depois
`timedatectl set-ntp true` e `timedatectl timesync-status`.

Se for usar chrony e timesyncd, deixe só um ativo. Em máquina virtual, evite
que o hipervisor e o serviço de hora corrijam o relógio ao mesmo tempo.
