# RPlayout r47 — instalador parcial, não homologado

Fonte e servidor compilado incluem o lote de captura nativa da r46 mais duas
correções finais: LOST/FAILED invalidam medições anteriores, e histórico
informativo não duplica a contagem de incidentes CRITICAL correlacionados.
sourceReady sem nova telemetria fica UNKNOWN; não resolve a queda anterior.

17 testes afetados distintos PASS em lotes dirigidos:12 fila/ciclo,2 marcação,
3 transporte. Os casos afetados pelas duas correções finais passaram novamente
sem aumentar a contagem. Tipos finais PASS; servidor recompilado SHA256
51CE5E4CFC45F1F149CF4CC9FCF5FBFDCC72A78A8440406F2177FDC70E0AAFC3.
Web index-DeUoJJaB.js SHA256
1C3CC58CC6E63F2384D75204E57CDC722663669B1D3926D8718F9738953CD11D.
Engine preservado; sem nova migração.

O ensaio compilado --native-cue-failure passou após restabelecer a aprovação
de execução: AgZKD4, mesmo server51CE5E4C. Fonte loopback indisponível gera
CUEING e incidente de recusa sem semear incidente sintético; API de histórico
não expõe endpoint privado. RespostaCUE500 é a recusa esperada no cenário de
PVW ausente, não falha de conexão SRT nem sucesso de sintonia. As-run0, servidor/engine próprios
encerrados. Não homologa NDI/OMT/DeckLink nem receptor físico.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Faça backup de banco
e cofre antes de migrar. Mantém contexto48; voltar a banco/pacote antigo não é
rollback homologado. Runtime portátil preservado; DeckLink requer driver
oficial. Instalação NÃO testada. Não é Setup.exe assinado e não inicia o servidor.
Fila de observações é memória até commit: crash durante falha de armazenamento
exige conferência; limite512 registra lacuna CRITICAL ao storage voltar.

Último corte empacotado R46:450446844bytes SHA256
925DCB83FCA958FA78F3D3BCB5B919B8E67745A1391A17D5CB60616F8B12DE75.
Não inclui as duas correções finais. Prova ApjCqe/AF0CE539 pertence somente ao
server da R46 e cobre admissão/retirada de incidentes históricos sintéticos,
não a nova prova de CUE nem sinal físico. Nenhum instalador foi testado.

Detalhe da inspeção do log (registro externo ao empacotamento): a causa foi
"este canal não tem barramento de preview". Não houve abertura de conexão da
fonte; flags antigas do result.json AgZKD4 devem ser interpretadas somente
como captura da recusa nativa de CUE. Testar fonte conectando/perdendo/retornando
com PVW configurado continua pendente. Script futuro explicita esse limite.

Total10grupos1 concluído/9 abertos;53checks5 concluídas/24 em andamento/
24 pendentes. Grupo9.2 aberto; homologação física/remota/prolongada aberta.

Registro externo após empacotamento: ZIP gerado450446977bytes SHA256
189E45ACF4C975DD4B6B65407EAE466FF67D2FB6FF67FD2CD66CAA767F78C473.
LEIA-ME interno anterior ao refinamento do motivo da recusa: considerar a
inspeção do log acima como limite autoritativo. Não é prova de conexão SRT.
