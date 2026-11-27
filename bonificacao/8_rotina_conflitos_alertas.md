# Rotina diária de conflitos e alertas (procedimento obrigatório)

Versão 1.1 de 26/11/2026, aprovada pela gerência. Regra de negócio: regra 12 das Regras de cálculo. Código: `claude/8_rotina_conflitos_alertas.py` (usar sem alterações).

## Regra (resumo)
- O funcionário não deve usar o app Tarefas e o WMS ao mesmo tempo. Quando usa, gera um conflito.
- Conflito (v1.1, desde 26/11/2026): tarefa do app finalizada ou timeout em que a SOMA do tempo em comum com todas as tarefas do WMS do mesmo funcionário passa de 5 minutos. Exemplo: Movimentação das 13:00 às 13:45 com três tarefas do WMS de 2 minutos cada dentro desse horário = 6 minutos = conflito.
- Esta definição vale só para a rotina diária. O relatório de performance (regra 3, gerador do arquivo 7) continua comparando uma tarefa do WMS por vez.
- Uma tarefa do app gera no máximo 1 conflito. Fica registrada a tarefa do WMS de MAIOR sobreposição com ela (empate: a de aceite mais cedo). `sobreposicao_seg` guarda a soma de todos os trechos em comum.
- A data e hora do conflito é o início do PRIMEIRO trecho em comum (o maior entre o início da tarefa do app e o aceite da primeira tarefa do WMS que se sobrepõe). Ela define o mês do conflito.
- A cada 3 conflitos do mesmo funcionário, no mesmo mês, é gravado 1 alerta. Cada conflito entra em um único alerta. A contagem zera ao final do mês: as sobras (1 ou 2 conflitos) se perdem.
- O alerta é gravado na tabela `alertas` com:
  - `data_alerta`: início da sobreposição do 3º conflito do grupo;
  - `emissor`: PL1;
  - `id_alerta`: "A" + data e hora de Brasília do `data_alerta` (AAAAMMDDHHMMSS) + crachá;
  - `descricao`: `Alerta gerado por 3 conflitos: 23/11 08:10-08:45 Carregamento x WMS 123456 (Separação Manual, 25 min em comum); ...` (horários de Brasília da tarefa do app). Quando o conflito soma mais de uma tarefa do WMS, o número vem seguido de "e mais N" (ex.: `x WMS 610136 e mais 5 (Armazenagem, 9 min 46 s em comum)`), e o tempo é a soma.
- Esses alertas contam para o N3 como qualquer outro alerta (regra 5).
- Se a gerência remover um alerta contestado, nada muda nos conflitos: eles continuam ligados ao alerta removido e não voltam para a contagem.
- Só grava na tabela. O funcionário não é avisado de outra forma.

## Agendamento
- Todos os dias às 06:00 (Brasília), tarefa agendada "Rotina diária de conflitos e alertas".
- Janela verificada: os últimos 5 dias completos (de hoje menos 5 dias, 00:00, até hoje, 00:00, Brasília). Os 5 dias cobrem atrasos na importação do WMS. O que já está gravado é ignorado (a tabela `conflitos` não aceita a mesma tarefa do app duas vezes, e os comandos usam INSERT OR IGNORE).
- Funcionários: todos os ativos (`funcionarios.ativo = 1`).

## Uso do banco
- Permissão de escrita (autorizada pela gerência em 25/11/2026) SOMENTE para esta rotina: INSERT em `conflitos` e `alertas`, e UPDATE de `conflitos.id_alerta`. Nada de DELETE, DROP ou ALTER. Fora desta rotina, o banco continua só leitura.
- Economia de leituras (regra 10): nenhuma junção de `wms_tarefas` ou `registros` com elas mesmas; o conflito é calculado só pelo script, em Python; toda consulta filtra por funcionário e período nas colunas com índice.
- Consumo esperado por execução: as tarefas do app da janela (cerca de 500) e as do WMS dos funcionários com tarefa no app, com 1 dia de margem antes e depois (cerca de 5.000 a 6.000).

## Passo a passo de cada execução
1. Ler `claude/8_rotina_conflitos_alertas.py` do projeto e salvar na área de trabalho, sem alterações.
2. `python3 8_rotina_conflitos_alertas.py consultas` mostra a janela e a consulta C1. Rodar C1 no conector Turso, banco "tarefas" (`read_database`).
   - As consultas trazem a coluna `pad` (só na 1ª linha), que faz o conector salvar o resultado em arquivo. Usar o arquivo que o conector indicar, sem copiar valores à mão.
   - Se C1 voltar sem nenhuma linha: não há o que verificar. Encerrar e informar.
3. `python3 8_rotina_conflitos_alertas.py consultas --app <arquivo C1>` mostra C2 (WMS), C3 (conflitos já gravados no mês) e C4 (alertas do período). Rodar as três, uma vez cada.
4. `python3 8_rotina_conflitos_alertas.py calcular --app <C1> --wms <C2> --conflitos <C3> --alertas <C4> --saida saida`. Para consulta que voltou sem nenhuma linha, passar a palavra `vazio` no lugar do arquivo.
   - Se o script parar com "PARADO: há tarefa do WMS com 24h ou mais", não gravar nada e informar os números das tarefas para a gerência decidir.
5. Rodar no conector (`write_database`), na ordem do campo `arquivos_sql_na_ordem` do resumo, o conteúdo exato de cada arquivo: `1_conflitos_*.sql`, depois `2_alertas_*.sql`, depois `3_vinculo_*.sql`. Conferir se `rows_affected` bate com o esperado. Se der erro no meio, parar e informar: a próxima execução completa o que faltou sem duplicar.
6. Informar o resumo: janela, tarefas verificadas, conflitos novos (lista), alertas gravados (lista), pendentes por funcionário no mês e avisos.

Para reprocessar um período (por exemplo, o mês inteiro), usar `--ini AAAA-MM-DD --fim AAAA-MM-DD` (dias de Brasília, fim exclusivo) nos dois modos.

## Consultas (geradas pelo script; referência)
```sql
-- C1: app Tarefas da janela
SELECT r.id_registro, r.codigo_func, r.nome_tarefa, r.status, r.data_inicio, r.data_fim, <pad>
FROM registros r
WHERE r.codigo_func IN (SELECT codigo FROM funcionarios WHERE ativo = 1)
  AND r.status IN ('finalizada','timeout') AND r.data_inicio >= :ini AND r.data_inicio < :fim
ORDER BY r.data_inicio;

-- C2: WMS dos funcionários de C1, com margem de 1 dia
SELECT numero, codigo_func, tarefa, dt_aceite, dt_conclusao, <pad>
FROM wms_tarefas WHERE codigo_func IN (<crachás de C1>) AND dt_aceite >= :ini_m AND dt_aceite < :fim_m
ORDER BY dt_aceite;

-- C3: conflitos já gravados desde o início do mês da janela
SELECT id_registro, codigo_func, nome_tarefa, inicio_app, fim_app, numero_wms, tarefa_wms,
       inicio_sobreposicao, sobreposicao_seg, id_alerta, <pad>
FROM conflitos WHERE inicio_sobreposicao >= :inicio_do_mes ORDER BY inicio_sobreposicao;

-- C4: alertas do período, para não repetir id_alerta
SELECT id_alerta, codigo_func, data_alerta, substr(descricao,1,40) AS inicio_descricao, <pad>
FROM alertas WHERE codigo_func IN (<crachás de C1>) AND data_alerta >= :inicio_do_mes AND data_alerta < :fim_m
ORDER BY data_alerta;
```
`<pad>` = `CASE WHEN ROW_NUMBER() OVER () = 1 THEN printf('%100000s','') END AS pad`

## Primeira carga (25/11/2026)
Novembro processado de 01/11 a 24/11 (inclusive): 1.823 tarefas do app verificadas, 15 conflitos e 3 alertas gravados. A rotina das 06:00 segue a partir de 26/11 e cobre o dia 25/11 na primeira execução.

## Histórico
| Versão | Data | Mudança |
|---|---|---|
| 1.0 | 25/11/2026 | Rotina criada: tabela `conflitos`, alerta a cada 3 conflitos no mês, execução diária às 06:00 com janela de 5 dias. |
| 1.1 | 26/11/2026 | Pedido da gerência: conflito pela SOMA do tempo em comum com todas as tarefas do WMS (mais de 5 min no total). Registra a tarefa do WMS de maior sobreposição; data do conflito = início do primeiro trecho em comum. Vale daqui para frente, a partir da execução de 27/11 (janela 22/11 a 26/11); não houve reprocessamento de novembro. O relatório de performance (regra 3) não mudou. |
