# Compensação operacional — conferência visual local

Fixture l9gMn5 própria, saídas físicas desativadas, VT sintético em loop.
Controle de interface conferiu as quatro ações pelo painel do Master:

- FILLER +2,5s: revisão2, nominal50→113 quadros; executável300 mantido
  pela compensação automática. A tela distingue nominal e executável.
- TRIM -2s: revisão3,125→75 quadros, dentro do mínimo permitido.
- DROP_OPTIONAL: revisão4, linha saiu da playlist operacional, não do rascunho.
- ACCEPT_DELAY +5s: revisão5, horário flexível deslocado; obrigatório mantido.
- Filler em zona protegida recusado na conferência; confirmação indisponível.

Consulta SQLite readonly posterior: quatro decisões OPERATIONAL_COMPENSATION
para filler/trim-vt/optional/soft; revisões1..5, sem decisão de protected.
Rascunho mantém filler50, trim-vt125 e optional75. Não houve TAKE manual.
VT em loop muda naturalmente origem no EOS; não confundir isso com efeito
de compensação. A mensagem UI de PGM preservado não é prova de pixels físicos.

Captura scratch/priority-playout-l9gMn5/compensation-protected.png.
Harness result VISUAL_FIXTURE_COMPLETED/ownedCleanupConfirmed:true;
browserValidated:false nesse JSON é conservado pois a prova UI está aqui.
Servidor/engine próprios encerrados; nenhum PID histórico morto.

Limites: teste local, sem medição formal de latência de operação/rede,
sem live externa/gateway, sem qualificação prolongada. Alarme de preto
da fixture permaneceu visível, contingência automática desativada;
não certifica sinal PGM. O grupo4 ainda não está integralmente concluído.
