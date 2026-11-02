# RPlayout r51 — instalador parcial para testes

Esta edição reúne as alterações posteriores à r50. Não é homologada para ir ao ar.
A instalação não foi testada, conforme pedido de entrega parcial sem esse ensaio.

Inclui os módulos e runtimes portáteis da base existente: não exige instalação
global de Node, pnpm, tsx, tsc ou GStreamer para iniciar. DeckLink continua exigindo
o driver oficial compatível; presença da placa e sinal físico não foram homologados.

## Instalar

1. Extraia todo o ZIP, mantendo INSTALAR.cmd e RPlayout-payload.zip juntos.
2. Execute INSTALAR.cmd e escolha uma pasta NOVA, em disco com espaço suficiente.
3. Abra RPlayout Server e depois Master ou QC pelos atalhos criados.

Não substitua uma instalação em operação. Preserve backup do banco e do cofre.
Não copie banco antigo para a nova pasta sem o procedimento de migração/restauração.
O pacote não é um Setup.exe assinado e não inicia o servidor automaticamente.

## Alterações incluídas

- Expiração de sessões, auditoria e proteção contra alterações durante espera.
- Registro durável de comandos gráficos, confirmação nativa e histórico.
- Grafismos automáticos, apresentação técnica idle e emergência com confirmação.
- Janelas de grafismo vinculadas à ocorrência; retirada preserva substituição manual.
- Recuperação consulta o canal, execução, item e revisão exatos.
- Template publicado ausente falha sem exibir gráfico genérico.
- Alertas persistentes para eventos secundários sem confirmação após abertura.
- Eventos secundários sem confirmação bloqueiam novos comandos gráficos no canal,
  inclusive quando surgem durante espera. Não são reenviados automaticamente.
- Migração 49: projeção indexada de pendências gráficas e integridade de histórico.
- Registro de encerramento da observação e detecção de lacuna após queda.

## Evidências e limites

Lote final: 47 testes e tipos aprovados; compilação atual aprovada.
Server SHA256: A1CFB1E16CA0B7C2D6036D515754F3F82586D162CC3E6F8AA4CE4142E5501F28.
Engine SHA256: AEBDED621B60041206BA45C4122B7BAE48DBCEBC0465A4B023559FB78E31201B.

Ensaios nativos anteriores pertencem aos hashes registrados nas evidências, não
homologam automaticamente esta compilação. Pendentes: recuperação completa após
queda/perda de confirmação, liberação auditada de eventos incertos antigos,
emergência com mídia em PGM, sinais físicos DeckLink/NDI/OMT, navegador remoto,
failover de máquina, operação prolongada, instalação limpa, upgrade e rollback.
Reconhecer um alerta não comprova recuperação física nem libera um evento incerto.

Total: 10 grupos — 1 concluído, 9 abertos. 53 verificações — 5 concluídas,
26 em andamento, 22 pendentes. O instalador parcial não encerra esses marcos.
