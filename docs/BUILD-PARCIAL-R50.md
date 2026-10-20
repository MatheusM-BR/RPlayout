# RPlayout r50 — instalador parcial, não homologado

Inclui r49 e corrige a reconexão SRT silenciosa. O plugin local tinha
auto-reconnect=true; com receiver encerrado, o primeiro ensaio recebeu vídeo
mas NÃO registrou falha em45s. Não foi considerado aprovado.
Agora o publisher do engine controla reconexão/backoff, desabilitando a
reconexão interna do srtsink quando a propriedade existe. A queda pode chegar
à saúde operacional, e o novo contador pertence à geração recriada.

Teste dirigido do pipeline SRT/plugin real PASS; compilação engine PASS.
Ensaio de receiver próprio em andamento ao empacotar; não antecipar PASS.
Server preservado da r49, SHA256
4C56E221A424C76968C959A377FF8B9869BBB485DCD7B21D1002D379D0884854.
EngineSHA256 AEBDED621B60041206BA45C4122B7BAE48DBCEBC0465A4B023559FB78E31201B.
Interface preservada. Contador no sink não comprova recepção externa.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Faça backup do banco
e cofre. Mantém migração48; retorno a pacote antigo não é rollback homologado.
Inclui runtimes portáteis da base anterior; DeckLink requer driver oficial.
Instalação NÃO testada. Não é Setup.exe assinado e não inicia servidor sozinho.

9.2 segue aberto: sinais NDI/OMT/DeckLink, destinos reais, carga, storage/crash,
estação remota e operação prolongada. Total10grupos:1 concluído/9 abertos;
53 verificações:5 concluídas/24 em andamento/24 pendentes. Não é entrega final
para ir ao ar. Evidência posterior será registrada externamente.

Registro externo após empacotamento:450449852bytes SHA256
A2CF183FC49CB721159140EA71EBC3E70C158E49A5084FEC460C6245F060BB80.
NBUFrt/AEBDED62 PASS perda/retorno de receiver próprio, decode320x180
antes/depois, retryinggen6→onAirgen7 com entregasnovas, resolução persistida,
contexto/ACK preservados, PGM nunca TAKE/asrun0 e owncleanup confirmado.
Carrier preto de PGM parado; não valida editorial/áudio/destino externo.
LEIA-ME interno precede esse PASS; evidência externa é autoritativa.
