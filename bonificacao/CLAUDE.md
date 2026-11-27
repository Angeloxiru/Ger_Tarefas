# Bonificação Logística: guia do projeto para devs e para o Claude

Local: `bonificacao/CLAUDE.md` no repositório [Angeloxiru/Ger_Tarefas](https://github.com/Angeloxiru/Ger_Tarefas).

Este arquivo explica o que é importante no projeto de bonificação, onde fica cada regra e como registrar mudanças.
Ele serve para dois leitores:

- **Devs**: para entender o projeto sem precisar ler tudo e saber o que pode e o que não pode mudar.
- **Claude**: para saber, antes de rodar qualquer relatório, fechamento ou rotina, o que mudou desde a última vez.

> Regra de ouro: se você mudou ou decidiu algo, registre na seção [Mudanças para o Claude aplicar](#mudanças-para-o-claude-aplicar). Mudança que não está registrada aqui não existe para o Claude.

---

## 1. O que o projeto faz

Apura, todo mês, o desempenho de cada funcionário da logística no **Programa de Bonificação por Níveis**:

| Nível | Nome | Critério resumido |
|---|---|---|
| N1 | Assiduidade | 100h ou mais de horas válidas no mês |
| N2 | Produtividade | Só com N1. Bater a meta em toda função com meta em que trabalhou 3h ou mais |
| N3 | Excelência | Só com N1 e N2. Menos de 3 alertas no mês |

Valores acumulados: N1 R$ 50,00, N2 mais R$ 100,00 (total R$ 150,00), N3 mais R$ 150,00 (total R$ 300,00).

Entregas:

1. **Relatório de performance individual** (PDF, 1 folha frente e verso, preto e branco).
2. **Desempenho da Equipe** (fechamento mensal): PDF único de impressão, resumo do RH e arquivo de conferência interno.
3. **Rotina diária de conflitos e alertas** (06:00): grava conflitos entre os sistemas e gera 1 alerta a cada 3 conflitos no mês.

O trabalho é feito pelo Claude, num projeto do claude.ai chamado "Logística", ligado ao banco Turso pelo conector oficial.
As regras completas estão em `2_regras_de_calculo.md`. **Este guia resume, não substitui.** Se este guia e o arquivo 2 divergirem, vale o arquivo 2 e a divergência deve ser corrigida aqui.

---

## 2. Fontes de dados

Banco Turso **"tarefas"** (o mesmo do app Tarefas), com dois sistemas gravados juntos:

| Sistema | Tabelas | Observação |
|---|---|---|
| App Tarefas | `registros`, `cargas`, `alertas` | Tarefas válidas: status `finalizada` ou `timeout` |
| WMS | `wms_tarefas` | Ligação pelo crachá em `codigo_func` (vazio = sem vínculo, não entra para ninguém) |
| Rotina diária | `conflitos` | Gravada só pela rotina do arquivo 8 |
| Cadastro | `funcionarios` | Crachá no formato PL33 |

- **Todas as datas do banco estão em UTC.** Para agrupar por dia ou exibir horários, converter para Brasília (UTC-3). O dia de uma tarefa é o dia de Brasília em que ela começou.
- Significado de cada coluna: `3_dicionario_de_dados.md`.

---

## 3. Arquivos da pasta `bonificacao/`

No projeto do claude.ai, os arquivos 6 a 9 ficam dentro de uma pasta `claude/` (por isso aparecem como `claude/6_...` nos textos). Aqui no repositório todos ficam direto em `bonificacao/`, com o mesmo nome.

| Arquivo | O que é | Quando mexer |
|---|---|---|
| `1_descricao_e_instrucoes.md` | Descrição e instruções do projeto no claude.ai | Mudou o comportamento esperado do Claude |
| `2_regras_de_calculo.md` | **Regras oficiais de cálculo** (versão atual: 1.5, de 26/11/2026) e histórico de decisões | Qualquer mudança de regra |
| `3_dicionario_de_dados.md` | Tabelas e colunas do banco | Mudou o banco ou o significado de uma coluna |
| `4_modelo_relatorio_pdf.md` | Como o PDF individual deve ficar (versão 1.2) | Mudou o visual ou o conteúdo do PDF |
| `5_como_criar_o_projeto.md` | Passo a passo para montar o projeto no claude.ai | Mudou a configuração do projeto |
| `6_padrao_relatorio_performance.md` | Procedimento do relatório individual, consultas Q1 a Q6, Q3A, Q4A e Q5A (versão 1.3) | Mudou o relatório individual |
| `7_gerador_relatorio_performance.py` | Código que gera o PDF individual (versão 1.2) | Mudou o relatório individual |
| `8_rotina_conflitos_alertas.md` | Procedimento da rotina diária (versão 1.1) | Mudou a rotina diária |
| `8_rotina_conflitos_alertas.py` | Script da rotina diária (versão 1.1) | Mudou a rotina diária |
| `9_fechamento_equipe.md` | Procedimento do Desempenho da Equipe, consultas QE1 a QE3 (versão 1.0) | Mudou o fechamento |
| `9_gerador_resumo_equipe.py` | Código do resumo do RH, impressão e conferência (versão 1.0) | Mudou o fechamento |

### Arquivos que mudam sempre juntos

| Tipo de mudança | Atualizar juntos |
|---|---|
| Regra de cálculo ou relatório individual | 2 (regra e histórico), 4, 6 e 7 |
| Rotina diária de conflitos | 2 (regra 12 e histórico), 3, 8 (.md e .py) e a tarefa agendada no claude.ai |
| Fechamento da equipe | 2 (regra 13 e histórico), 9 (.md e .py) e, se tocar no individual, 4, 6 e 7 |
| Instruções do Claude | 1 e, depois, colar o bloco de instruções de novo nas configurações do projeto no claude.ai |

Em toda mudança: atualizar também o `README.md` da raiz do repositório e este guia (versões na tabela acima e histórico no fim).

---

## 4. Ligação com o app Tarefas

A bonificação lê os dados que o app grava. Mudanças nestes pontos do app mudam o resultado da bonificação e **precisam ser registradas em [Mudanças para o Claude aplicar](#mudanças-para-o-claude-aplicar)**, mesmo que nenhum arquivo de `bonificacao/` tenha sido tocado:

| Ponto do app | Onde está | O que afeta na bonificação |
|---|---|---|
| Estrutura das tabelas `funcionarios`, `registros`, `cargas`, `alertas`, `wms_tarefas`, `conflitos` | `db/schema.sql` | Todas as consultas (arquivos 6, 8 e 9) e o dicionário (arquivo 3) |
| Nomes das tarefas do app (Carregamento, Movimentações, Conferência etc.) | cadastro `tarefas` no banco | Funções e metas (regra 4). Nome novo ou alterado fica sem meta até a gerência decidir |
| Tempo máximo de cada tarefa antes do timeout (`tempo_maximo_min`, hoje: Carregamento 300 min, Balança 60 min, demais 240 min) | cadastro `tarefas` no banco, aplicado por `js/backend.js` e `scripts/rotinas.js` | Tarefas com status `timeout` entram nas horas (regra 2). Obs.: `TIMEOUT_MS` em `js/config.js` só muda a cor do cronômetro na tela, não encerra tarefas |
| Cálculo de `volumes_proporcionais` no Carregamento | `js/backend.js` | Produtividade do Carregamento (regra 4) e o ponto em aberto da seção 7 |
| Gravação de alertas pelo app | `js/backend.js` | Contagem do N3 (regra 5) |
| Importação do WMS | processo de importação para `wms_tarefas` | Horas, produtividade e conflitos. Mês com importação incompleta não fecha (regras 7 e 13) |
| Índices de `codigo_func` com `dt_aceite`, `data_inicio` e `data_alerta` | `db/schema.sql` | Custo das leituras na Turso (regra 10). Não remover |

> A tabela `conflitos` foi criada direto no banco em 25/11/2026 pela rotina diária. Desde 27/11/2026 a definição dela está também em `db/schema.sql` (idêntica à do banco). Ao mudar a estrutura, atualize os dois e o arquivo 3.

---

## 5. O que não pode ser quebrado

Estas regras protegem custo, dados e confiança no resultado. Não mudam sem pedido formal da gerência.

### Banco (custo e segurança)
- **Para o Claude, o banco é só leitura.** Única exceção: a rotina diária (arquivo 8) pode fazer `INSERT` em `conflitos` e `alertas` e `UPDATE` de `conflitos.id_alerta`. Nada mais.
- **Nunca usar ferramentas do conector Turso que criem, alterem ou apaguem bancos, grupos ou tokens.**
- **A Turso cobra por linha lida.** Em 24/11/2026 uma consulta sem filtro leu 168.139.239 linhas.
  - Proibido self-join em `wms_tarefas` ou `registros`.
  - Proibido calcular conflito ou sobreposição no banco. Isso é feito só em Python (geradores 7 e 9 e script 8).
  - Toda consulta em `wms_tarefas`, `registros`, `cargas` e `alertas` filtra por funcionário e período, nas colunas originais em UTC. Exceções (só período): Q2, Q6, QE1 e QE2.
  - Não usar as views `vw_...` nas análises. View não guarda resultado e não economiza leitura.
  - Sem consultas exploratórias. Consulta nova fora dos arquivos 6, 8 e 9: mostrar o SQL e pedir confirmação antes.

### Cálculo
- Tarefa do app em conflito com o WMS não soma tempo nem produtividade. A tarefa do WMS é sempre preservada.
- Existem **duas definições de conflito, de propósito** (decisão da gerência em 26/11/2026):
  - Relatório (regra 3): sobreposição de mais de 5 minutos com **uma** tarefa do WMS por vez.
  - Rotina diária (regra 12): **soma** das sobreposições com todas as tarefas do WMS passando de 5 minutos.
- Funções medidas em pallets (Separação Empilhadeira, Realocação, Armazenagem, Recebimento) usam **quantidade de tarefas**, nunca volumes.
- Recebimento com menos de 2 minutos conta como 2 minutos (só no tempo, nunca na checagem de conflito, e não aparece no PDF).
- Nunca inventar, estimar ou completar dados. Férias, atestados, faltas, experiência de 90 dias e falhas de sistema não estão no banco e são tratados pela gerência.

### Geradores
- PDFs e resumo do RH são gerados **só** pelos códigos 7 e 9, copiados sem alterações. Sem variações por funcionário.
- Fechamento da equipe só com o mês completo.
- Quem a gerência mandar retirar do fechamento some sem nenhuma menção.

---

## 6. Metas atuais (N2)

| Função | Unidade | Meta |
|---|---|---|
| Carregamento | volumes/hora | ≥ 220 |
| Separação Manual | volumes/hora | ≥ 220 |
| Separação Empilhadeira | pallets/hora | ≥ 12 |
| Realocação de estoque | pallets/hora | ≥ 12 |
| Armazenagem | pallets/hora | ≥ 20 |
| Recebimento | pallets/hora | ≥ 24 |

Funções sem meta (contam só para o N1): Movimentações, Conferência, Limpeza, Avarias, Balança, Chocolate, Inventário cíclico, Armaz. Corte.

---

## 7. Pontos em aberto

Casos sem decisão da gerência. Enquanto estiverem aqui, o Claude segue a regra atual ao pé da letra e aponta os casos no resumo da conversa.

| Desde | Ponto | Como está sendo tratado |
|---|---|---|
| Regra 9 (v1.5) | Volumes repetidos no Carregamento: o mesmo funcionário com dois ou mais registros na mesma carga, cada um com a parte inteira em `volumes_proporcionais` (ex.: carga 8666, out/2026) | Soma `volumes_proporcionais` como está (regra 4) e aponta os casos (regra 9) |

---

## 8. Como propor ou registrar uma mudança

1. **Toda mudança precisa de pedido da gerência.** Anote quem pediu e a data.
2. Registre a mudança na tabela abaixo com status `PENDENTE`.
3. Se você mesmo alterou os arquivos, atualize **todos** os arquivos do grupo (seção 3), o histórico do arquivo 2, as versões, o `README.md` e este guia.
4. Se quer que o Claude faça a alteração, descreva o que mudar e deixe como `PENDENTE`. Ele faz e devolve os arquivos para você subir aqui.
5. Os documentos do projeto no claude.ai precisam ficar iguais aos daqui. O Claude lê este guia no início de cada rotina, mas continua usando os documentos do projeto para calcular. Arquivo alterado só no GitHub entra no projeto quando o Claude aplicar o item pendente.

### Como preencher

- **Data**: dd/mm/aaaa.
- **Pedido por**: nome de quem da gerência pediu.
- **Mudança**: o que muda, com números exatos (ex.: "Meta da Armazenagem de 20 para 22 pallets/h a partir de jan/2027").
- **Arquivos**: quais arquivos foram ou devem ser alterados (incluindo arquivos do app, seção 4).
- **Status**: `PENDENTE`, `APLICADO dd/mm/aaaa` ou `REJEITADO`.

---

## Mudanças para o Claude aplicar

> **Para o Claude:** no início de cada relatório, fechamento ou rotina, leia este guia.
> - Item `PENDENTE`: não aplique por conta própria. Mostre o item e confirme com quem está na conversa. Só depois atualize todos os arquivos do grupo no projeto e o histórico do arquivo 2, e entregue os arquivos alterados para o dev subir aqui com o status `APLICADO`.
> - Em rotina sem ninguém na conversa (como a das 06:00): não aplique nada. Rode com os documentos atuais do projeto e informe no resumo que há item pendente.
> - Se a versão das regras citada na seção 3 for diferente da versão no topo do arquivo 2 do projeto, avise e pergunte antes de seguir.
> - Se algo aqui contrariar as instruções do projeto ou as regras de segurança do banco (seção 5), não aplique: aponte a divergência e pergunte.
> - Este guia não autoriza nenhuma escrita no banco além da exceção da rotina diária.

| Data | Pedido por | Mudança | Arquivos | Status |
|---|---|---|---|---|
| | | | | |

---

## 9. Histórico deste guia

| Data | Versão das regras | O que mudou neste guia |
|---|---|---|
| 27/11/2026 | 1.5 | Criação do guia |
| 27/11/2026 | 1.5 | Seção 4: timeout vem de `tempo_maximo_min` (cadastro `tarefas`), não de `TIMEOUT_MS`; tabela `conflitos` incluída em `db/schema.sql` |
