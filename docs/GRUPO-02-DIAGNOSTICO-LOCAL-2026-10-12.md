# Grupo 2 — diagnóstico local em 12/10/2026

Prioridade solicitada: finalizar grupo 2, depois grupo 3. Trabalho de HA fica
preservado, mas não deve continuar como prioridade antes desses grupos.

## Consulta executada (não é homologação)

Helper existente `rplayout-devices.exe`, SHA256
`69F64C03210A2EEA5649E376094D99189576ECE08295A42F4D5DB054763D8A56`.
Executado nesta máquina, com GStreamer local, sem iniciar transmissão.

- Plugins essenciais/opcionais ausentes: nenhum reportado.
- DeckLink: plugin carregado, zero portas Source/Sink enumeradas.
- NDI: runtime disponível, zero fontes descobertas.
- OMT: runtime disponível, zero fontes descobertas.
- OMT também reportou UnauthorizedAccessException ao criar log em
  `C:/ProgramData/OMT/logs`; descoberta retornou JSON, mas essa falha precisa
  de tratamento antes de declarar instalação limpa.
- Consulta CIM inicial indisponível no sandbox. Consulta autorizada de
  Win32_PnPSignedDriver terminou sem registros cujo DeviceName corresponda a
  DeckLink/Blackmagic/Intensity. PnPUtil Media conectado sem correspondência.

Não concluir ausência física da placa a partir desses filtros. Nenhuma porta
ou fonte real foi comprovada neste diagnóstico. Sem sinal não foi testado,
pois nem a entrada foi enumerada. Não repetir descoberta apenas por status.

## Implementação atual — NOT_RUN

2.1: estatísticas por decoder live agora amostram até 512 bytes distribuídos
no buffer raw, no máximo 4 vezes/s, com reset por caps/perda de buffers.
Telemetria separa duração sem mudança, idade da amostra e contagem.
Diagnóstico compartilhado só alerta com vídeo recente, amostra <=500 ms,
>=9 amostras iguais e >=2 s sem mudança. NO_VIDEO/NO_AUDIO mantêm precedência.
Interface informa conteúdo POSSIVELMENTE parado: cena estática pode produzir
igualdade. Não é prova de freeze completo, não altera tally nem bloqueia TAKE.

Código novo não compilado/testado; o helper consultado acima é binário
anterior. Fixture de contrato protocol preparada NOT_RUN.

## Próximos passos

Fechar produtor/telemetria/avisos e testes de grupo 2 em lote; tratar runtime
OMT/logging; recuperar enumeração DeckLink real, obter fontes NDI/OMT e
validar CUE/TAKE/perda/recuperação/áudio/automação. Depois grupo 3: pasta remota,
nome da input, QC direto/qualidade/layout e desempenho de preview/scopes.
Sem hardware/fontes comprovados, 2.2/2.3/2.4 não podem ser homologados.

Totais inalterados: 10 grupos (1 concluído/9 abertos); 53 verificações
(5 concluídas/36 em andamento/12 pendentes). R55 não inclui código novo.
