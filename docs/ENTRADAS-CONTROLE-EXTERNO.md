# Entradas e controle externo

## Onde configurar

- **Master/Operador:** `http://localhost:4000/`
- **Playlist 24h:** `http://localhost:4000/?workspace=playlist`
- **Usuários:** `http://localhost:4000/?workspace=admin` ou botão **USUÁRIOS**
- **Monitoramento e saídas:** `http://localhost:4000/?workspace=monitor`

## Entradas ao vivo

Em **Master → COM HORA MARCADA… → AO VIVO**, o campo Fonte oferece as fontes
descobertas na máquina (DeckLink/SDI, NDI e convidados). Também é possível
informar diretamente uma URL `srt://…` ou `rtmp://…`; ela fica gravada como
`sourceRef` no item e é aberta pelo engine no momento do preparo.

### DeckLink/SDI

O binário `rplayout-devices.exe` enumera placas e subdispositivos. A entrada é
referenciada como `sdi:0`, `sdi:1` etc. A saída SDI é configurada em
**Saídas e Processos → adicionar → SDI/Decklink**. É necessário instalar o
driver Blackmagic e o plugin DeckLink do GStreamer. A presença da placa precisa
ser validada fisicamente; o ambiente de desenvolvimento não possui hardware.

### SRT e RTMP

Informe a URL completa no campo de fonte ao vivo. Para SRT caller, use por
exemplo `srt://host:porta?mode=caller&latency=800`; para listener, use o modo
suportado pelo servidor MediaMTX. RTMP pode ser informado como
`rtmp://host:1935/caminho`. O item ao vivo recebe uma duração de ocupação na
grade, pois a fonte de rede não tem EOS confiável.

## GPI, ATEM e routers

O endpoint de controle externo é:

```http
POST /api/external/control
X-RPlayout-Control-Token: <RPLAYOUT_CONTROL_TOKEN>
Content-Type: application/json
```

Corpo aceito:

```json
{"channelId":"test-1","action":"take","itemId":"..."}
```

As ações são `take`, `cue`, `stop` e `park`. Cada comando é registrado na
auditoria e emitido para as integrações configuradas. O RPlayout fornece a API;
a conversão elétrica GPI, protocolo ATEM ou driver de router depende de um
gateway externo conectado à rede ou à placa de automação.

## O que exige validação física

DeckLink, NDI, GPI, ATEM, SCTE físico e sincronismo N+1 só podem ser marcados
como concluídos após teste com os equipamentos reais. Rode
`rplayout-devices.exe`, confirme os plugins ausentes e execute o roteiro em
[`roteiro-validacao-fisica-v1.1.md`](roteiro-validacao-fisica-v1.1.md).
