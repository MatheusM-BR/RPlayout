# Modelo de continuidade A/B

O RPlayout separa a operação em três planos:

1. **Planejar** — o scheduler resolve horários, âncoras, cortes e conflitos sem
   tocar no sinal que está no ar.
2. **Preparar** — durante a reprodução, o próximo item válido é conferido,
   aberto, decodificado e posicionado no primeiro quadro em um slot alternativo.
3. **Executar** — no EOS ou no take do operador, o engine apenas troca o slot
   preparado para o programa; o pipeline e os encoders do canal não param.

Esse desenho reúne práticas recorrentes em playout profissional: edição de
playlist durante o ar, validação antes da transmissão, cadeia de reprodução
contínua e falha isolada por componente. AirBox Neo documenta resolução de
gaps/overlaps e continuidade mesmo com mídia ausente; OnTheAir Video oferece
relatório de validação e comportamentos de fim por clip; Morpheus descreve
arquitetura modular e cadeias principal/reserva.

## Estado operacional

| Estado | Significado |
|---|---|
| `PVW` | item escolhido pelo operador no barramento de preview |
| `PRÓX` | próximo item calculado pela grade, ainda não confirmado pelo engine |
| `PREP` | arquivo em abertura, descoberta de trilhas e seek |
| `PRONTO` | item confirmado no slot alternativo, pronto para take |
| `NO AR` | item atual no programa |

Falha de preroll não derruba o item no ar. O item defeituoso fica registrado e
o próximo candidato é tentado no tick seguinte. Cada versão da grade faz no
máximo uma tentativa por item, evitando uma tempestade de abertura; ao mudar a
grade ou iniciar outra passagem, o conjunto de falhas é renovado.

## Limite deste estágio

O A/B protege a troca entre itens dentro de uma instância. Alta disponibilidade
1+1 ou N+M é outra camada: exige engines em máquinas distintas, grade espelhada,
comparação de saúde e um comutador de saída. Ela deve reutilizar o mesmo estado
determinístico e o as-run, mas não deve ser simulada dentro de um único processo.

## Referências de produto

- [PlayBox Neo — Playout](https://playboxneo.com/playout)
- [Softron — OnTheAir Video](https://www.softron.tv/products/play/ontheair-video)
- [Grass Valley — Morpheus Engineers Manual](https://wwwapps.grassvalley.com/docs/Manuals/playout/morpheus/Morpheus_Engineers_Manual_v4.6_Rev2.pdf)
- [Imagine Communications — Versio Redundancy](https://imaginecommunications.com/content/uploads/2024/10/Versio-Redundancy.pdf)
