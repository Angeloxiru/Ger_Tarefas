# Ger_Tarefas - Sistema de Registro de Atividades

Sistema web para registro de atividades operacionais em tempo real, utilizado por 31 a 50 funcionarios atraves de coletores Zebra MC22. Inclui o controle de retirada e devolucao dos coletores.

**Stack (desde a 1.0.0):** Frontend (GitHub Pages) + Banco de dados **Turso** (libSQL/SQLite) + rotinas no **GitHub Actions**.
O Google Apps Script e as planilhas Google nao sao mais usados (a pasta `apps-script/` fica so como historico).

---

## Arquitetura

```
Coletor / computador (app no GitHub Pages)
        |  HTTPS, direto
        v
Banco Turso  <----  GitHub Actions a cada 30 min (timeout, alerta 6h, limpeza)
```

- O app fala **direto com o banco**: cada acao e uma requisicao HTTPS ao Turso (40 a 200 ms),
  sem a "partida a frio" de varios segundos do Apps Script.
- As regras ficam em `js/backend.js` (o mesmo codigo roda no navegador e nas rotinas).
- O token do banco fica em `js/config.js`. **Atencao:** o repositorio e publico e o token da
  leitura e escrita. Esse risco foi assumido. Para trocar o token, veja "Trocar o token do banco".
- Cadastros (funcionarios, tarefas, docas, coletores) sao feitos direto pelo **console do Turso**.

---

## Estrutura do repositorio

```
Ger_Tarefas/
├── index.html              # Login (cracha + senha opcional) + vinculo do coletor
├── painel.html             # Painel do funcionario (tarefas + alertas + coletor)
├── carregamento.html       # Fluxo: Doca -> Carga -> Andamento -> Resultado
├── gestor.html             # Painel do gestor (5 abas) + 3 abas do ADM
│
├── css/style.css           # Estilos responsivos (tela 4.3" MC22)
│
├── js/
│   ├── config.js           # Endereco/token do banco e constantes do sistema
│   ├── db.js               # Cliente HTTP do Turso (consultas, transacoes, novas tentativas)
│   ├── backend.js          # Regras do sistema (antes no Apps Script), direto no banco
│   ├── api.js              # Ponte: telas chamam API.get({acao}) -> backend.js
│   ├── auth.js             # Login/logout, sessao e perfis (funcionario, gestor, adm)
│   ├── coletor.js          # Vinculo do aparelho, retirada/devolucao do coletor
│   ├── adm.js              # Telas do ADM: coletores, irregularidades, exportacao
│   ├── desktop.js          # Modo computador: layout largo, painel de coletores, filtros do historico
│   ├── tarefas.js, carregamento.js, gestor.js, scanner.js, ui.js
│   └── vendor/             # html5-qrcode (leitor de QR) e SheetJS (gera .xlsx)
│
├── db/
│   ├── schema.sql          # Tabelas, indices e views do banco
│   ├── importar_planilhas.py  # Converte as planilhas (.xlsx) em comandos para o banco
│   └── aplicar.js          # Cria o esquema e carrega os dados no Turso
│
├── scripts/rotinas.js      # Rotinas agendadas (timeout, alerta 6h, limpeza)
├── .github/workflows/rotinas.yml  # Agenda das rotinas no GitHub Actions (a cada 30 min)
├── testes/                 # Banco Turso simulado + teste de ponta a ponta
├── bonificacao/            # Projeto de bonificacao da logistica (regras, procedimentos e geradores usados pelo Claude)
│   └── CLAUDE.md           # Guia do projeto: comece por aqui
├── manifest.json, service-worker.js, icon-192.png, icon-512.png
└── apps-script/            # LEGADO (Google Apps Script), nao e mais usado
```

---

## Banco de dados (Turso)

Endereco: `libsql://tarefas-angeloxiru.aws-us-east-1.turso.io`. Esquema completo em `db/schema.sql`.

Convencoes: booleanos como 0/1; codigos sem diferenciar maiusculas.

### Padrao de horario (vale para tudo)
| Onde | Fuso |
|---|---|
| **Gravado no banco** (nosso app, rotinas e importacao do WMS) | **UTC**, texto ISO com `Z`: `2026-11-23T12:01:46.600Z` |
| **Exibido no app** (todas as telas, coletor e computador) | **Brasilia**, forcado no codigo (`timeZone: 'America/Sao_Paulo'`), mesmo que o aparelho esteja em outro fuso |
| **Exportacoes** (.xlsx do ADM e do Historico) | **Brasilia** |
| **Filtros por dia** (Historico, Raio X, Irregularidades, Exportacao) | Dia de **Brasilia** (00:00 a 23:59) |
| **Importacao do WMS** | O arquivo vem em Brasilia e e **convertido para UTC** ao gravar (07:47 no arquivo = `10:47Z` no banco) |
| **Codigo do registro** (`R20261123090146PL41`) | Brasilia |

No console do Turso, para ver em Brasilia: `datetime(data_inicio, '-3 hours')`. Filtrar o dia 23/11
de Brasilia: `data_inicio >= '2026-11-23T03:00:00Z' AND data_inicio < '2026-11-24T03:00:00Z'`.

### Cadastros (mantidos pelo console do Turso)
| Tabela | Colunas | Observacao |
|---|---|---|
| `funcionarios` | codigo (PK), nome, nome_completo, cargo, ativo, perfil, senha, criado_em, codigo_wms | `perfil`: `funcionario`, `gestor` ou `adm`. Senha vazia = entra sem senha. Cadastro unico (tarefas e coletores). `codigo_wms` = codigo do funcionario no outro app (regra: PL33 -> 33) |
| `tarefas` | id_tarefa (PK), nome, usa_qrcode_carga, tempo_maximo_min, ativa | Passou de `tempo_maximo_min`: timeout automatico |
| `docas` | codigo (PK), nome | `codigo` e o conteudo do QR da doca |
| `coletores` | coletor (PK), ativo, responsavel, desde, alerta_6h_em, em_conserto | `responsavel` vazio = na base; `em_conserto` = 1 nao pode ser retirado. Mantido pelo app |
| `config` | chave (PK), valor | |

### Movimento (gravado pelo app)
| Tabela | Conteudo |
|---|---|
| `registros` | Todas as tarefas (abertas e encerradas). O banco **impede duas tarefas abertas para a mesma pessoa** (indice unico parcial), o que elimina as duplicatas por toque duplo |
| `cargas` | Leituras do QR de carga (doca, volumes, ajudante) |
| `alertas` | Alertas registrados pelo gestor |
| `coletores_log` | Retiradas e devolucoes. **Apagado apos 7 dias** |
| `ocorrencias` | Irregularidades dos coletores (antigo `registro_diario`). **Apagadas apos 45 dias** |
| `conflitos` | Tarefas do app em conflito com o WMS. Gravada so pela rotina diaria da bonificacao (ver `bonificacao/`). Criada direto no banco em 25/11/2026; definicao incluida em `db/schema.sql` em 27/11/2026 (identica a do banco) |

### Tarefas do outro app (WMS), importadas pelo ADM
| Tabela | Conteudo |
|---|---|
| `wms_tarefas` | Uma linha por tarefa do relatorio "Tarefas Realizadas". **Chave = `numero`**: importar de novo a mesma tarefa sobrescreve. Colunas: endereco_inicial (e partes deposito, predio, rua, posicao, andar), dt_aceite, dt_conclusao, execucao_seg, cod_aplicacao, tarefa, cod_func_wms, nome_func_wms, codigo_func (nosso), qtde_itens, qt_enderecos |
| `lkp_aplicacoes` | Codigos e nomes das aplicacoes do WMS (atualizada a cada importacao) |
| `wms_importacoes` | Historico de importacoes: quando, arquivo, linhas, novas, atualizadas, sem vinculo, periodo, quem |

Regras da importacao:
- Endereco `12B00101A` = deposito `1`, predio `2`, rua `B`, posicao `001`, andar `01A`.
- **Separacao por paletes** (`CSE020WIS`) e gravada como **Separacao Manual** quando e no deposito 1,
  predio 2, ruas A, B, C, D ou F (rua E nao) e andar 01A; todas as outras viram **Separacao Empilhadeira**.
  As demais aplicacoes mantem o nome do WMS (Armazenagem, Recebimento, ...).
- Datas do arquivo (horario de Brasilia) viram UTC; `execucao_seg` vem da coluna Execucao.
- O funcionario e ligado pelo `funcionarios.codigo_wms`. Codigo sem vinculo: a tarefa entra mesmo
  assim (com codigo e nome do WMS) e a previa avisa. Para vincular depois, preencha `codigo_wms`
  e importe o arquivo de novo (as tarefas sao atualizadas).
- Colunas do relatorio que nao sao gravadas: Empresa, Endereco Final, Dt. Convocacao, Espera,
  Tarefa Origem, Tarefa Quebrada, Cliente, Pedido Origem, Rota, Classe, Qt Skus.
- Funcionario novo: ao cadastrar pelo console, preencha tambem o `codigo_wms`.

### Trocas de bateria das empilhadeiras (enviadas pelo Ger_Baterias)
O registro continua no sistema **Ger_Baterias** (QR code na parede, Apps Script + planilha). A cada
troca, o Apps Script envia uma copia para este banco; se o envio falhar, uma rotina de 15 min reenvia.
| Tabela | Conteudo |
|---|---|
| `bat_trocas` | Uma linha por troca: data_hora, codigo_func, empilhadeira, bateria_instalada, bateria_removida, nivel_agua, duracao_uso_anterior_h (horas de horimetro), horimetro, **minutos_creditados (15)**. Chave = data/hora + empilhadeira (reenviar nao duplica) |
| `bat_empilhadeiras` | Situacao atual de cada empilhadeira (copia da aba Equipamentos) |
| `bat_baterias` | Situacao atual de cada bateria (copia da aba Baterias) |

- Cada troca soma **15 minutos** ao tempo trabalhado do funcionario (so N1 da bonificacao), sem
  checagem de sobreposicao.
- No app, as trocas aparecem no **Historico** (tarefa "Troca de bateria (N03)", 15 min) e no
  **Raio X** (tarefa "Troca de bateria"). No computador, o filtro de tarefa tem a opcao "Troca de bateria".

### Views
| View | Uso |
|---|---|
| `lkp_funcionarios`, `lkp_tarefas`, `lkp_docas`, `lkp_coletores` | Listas ativas para conferencia |
| `vw_registros` | Registros com nome, carga e doca |
| `vw_tarefas_abertas` | Tarefas em andamento, minutos decorridos e se ja venceu |
| `vw_coletores_situacao` | Quem esta com cada coletor e ha quanto tempo |
| `vw_exportacao` | Base da exportacao do ADM |
| `vw_wms_tarefas` | Tarefas do WMS com nome do funcionario, aplicacao e dia (Brasilia) |
| `vw_wms_resumo_dia` | Por dia, funcionario e tarefa: quantidade, itens, enderecos e tempo de execucao |
| `lkp_tarefas_wms` | Nomes de tarefa do WMS e quantidade (para filtros) |
| `vw_bat_trocas`, `vw_bat_minutos_dia` | Trocas com nome e dia; minutos creditados por funcionario e dia |
| `vw_bat_consumo_empilhadeira`, `vw_bat_desempenho_bateria` | Trocas e media de horas por empilhadeira / por bateria |
| `lkp_empilhadeiras`, `lkp_baterias` | Listas de empilhadeiras e baterias |

### Cadastrar pelo console do Turso (exemplos)
```sql
INSERT INTO funcionarios (codigo, nome, nome_completo, cargo, perfil) VALUES ('PL55', 'Fulano', 'Fulano de Tal', 'auxiliar', 'funcionario');
UPDATE funcionarios SET ativo = 0 WHERE codigo = 'PL55';           -- desativar
UPDATE funcionarios SET perfil = 'adm', senha = '1234' WHERE codigo = 'PL26';
INSERT INTO coletores (coletor) VALUES ('GC23');
INSERT INTO docas (codigo, nome) VALUES ('11W01401A', 'Doca 14');
INSERT INTO tarefas (id_tarefa, nome, usa_qrcode_carga, tempo_maximo_min) VALUES ('T008', 'Inventario', 0, 240);
```

---

## Perfis

| Perfil | Acesso |
|---|---|
| `funcionario` | Painel de tarefas, carregamento, alertas proprios, retirada/devolucao do coletor |
| `gestor` | Painel do gestor: Tempo Real, Tarefas, Historico, Alertas, Raio X |
| `adm` | Tudo do gestor **+** abas **Coletores** (situacao de cada coletor), **Irregularidades** (filtro por data, 45 dias) e **Exp/Imp** (exporta .xlsx por periodo e importa tarefas do WMS) |

### Modo computador (desde a 1.1.0)
O app trata como **computador** o navegador **sem coletor vinculado** (nunca leu um QR
`COLETOR:xx`). Nesse caso (so gestor e ADM conseguem entrar) o painel do gestor ganha:
- **Largura total da tela**, abas numa linha so, Tempo Real em colunas e tabelas largas.
- **Historico:** filtros por **tipo de tarefa**, **funcionario** (lista, sem escanear cracha),
  **situacao** e **maximo de linhas** (200 a 2000); resumo com registros, funcionarios, tempo das
  finalizadas e volumes; coluna de duracao.
- **Historico em Excel:** botao "Baixar Excel" gera um `.xlsx` exatamente com o que esta na tela.
- **Tempo Real:** quem esta em tarefa aparece primeiro (timeout e alerta no topo, depois as mais
  antigas), ociosos em ordem alfabetica; busca por nome; atualiza a cada **1 minuto** e mostra o
  horario da ultima atualizacao (no coletor continua a cada 30 s, sem mudanca).
- **Coletores (ADM):** painel em cartoes no estilo do antigo Ger_Gestao_Coletores: verde = base,
  azul = em uso, laranja = mais de 6h fora, cinza tracejado = conserto, borda vermelha piscando =
  mesma pessoa com 2 coletores. Clique no cartao mostra as ultimas movimentacoes (log de 7 dias) e
  os botoes **Enviar para conserto** / **Liberar do conserto**. Atualiza sozinho a cada 30 s.

### Conserto de coletor
- So o ADM, pelo painel de coletores no computador, envia um coletor para conserto, e so se ele
  estiver **na base**. Fica registrado em Irregularidades (tipo "Conserto") quem enviou e quem liberou.
- Coletor em conserto **nao pode ser retirado nem assumido**. Quem tentar entrar num aparelho
  vinculado a ele ve "O GCxx esta em conserto. Use outro coletor e avise o responsavel."
- Tambem da para marcar pelo console: `UPDATE coletores SET em_conserto = 1 WHERE coletor = 'GC10';`

**No coletor Zebra (com vinculo) nada disso e ativado:** todas as regras de estilo ficam sob
`body.modo-computador` e o `js/desktop.js` nao faz nada quando ha vinculo.

### Exportacao (ADM)
Planilha `.xlsx` de tarefas finalizadas no periodo escolhido, com as mesmas colunas da antiga
exportacao do Apps Script: Tarefas Diarias, Qtd de Tarefas, Qtd Itens, Soma de Tempo, Volume por
hora, Nome do funcionario, Data. Correcoes em relacao a antiga: **Qtd Itens** e a parte de cada
pessoa na carga (`volumes_proporcionais`), nao o total da carga; **Volume por hora** e calculado
(itens / horas) em vez de sair sempre 0.

---

## Acoes do sistema (`js/backend.js`)

As telas chamam `API.get({ acao, ... })` e recebem `{ sucesso, dados, mensagem }`, o mesmo formato
do antigo Apps Script.

| Acao | Descricao |
|---|---|
| `verificar_cracha`, `login` | Cracha, senha (se cadastrada) e perfil |
| `listar_tarefas`, `status_funcionario` | Tarefas ativas; tarefa aberta (ja encerra por timeout se venceu) |
| `iniciar_tarefa`, `finalizar_tarefa` | Inicia/finaliza; no carregamento calcula e grava a distribuicao de volumes |
| `verificar_doca`, `registrar_carga`, `workers_carga`, `distribuicao_carga` | Fluxo de carregamento |
| `painel_gestor`, `historico`, `raiox` | Painel do gestor (`historico` aceita `tarefas` e `limite`) |
| `registrar_alerta`, `listar_alertas` | Alertas |
| `cadastrar_funcionario`, `cadastrar_tarefa` | Cadastros pelo app (opcional; o padrao e o console) |
| `coletor_status`, `coletor_registrar`, `coletor_assumir`, `coletor_evento`, `coletor_lista` | Controle de coletor |
| `adm_coletores`, `adm_ocorrencias`, `adm_exportacao`, `adm_coletor_historico`, `adm_coletor_conserto` | Telas do ADM |
| `adm_wms_importar` (`simular` para a previa), `adm_wms_importacoes` | Importacao das tarefas do WMS |
| `versao` | Versao do backend (`turso-1`) |

Operacoes que mexem em mais de uma tabela (retirar, devolver, assumir coletor, gravar volumes)
rodam numa **transacao**: ou grava tudo ou nada. Se duas pessoas tentarem retirar o mesmo coletor
ao mesmo tempo, so a primeira consegue.

---

## Rotinas agendadas (GitHub Actions)

`.github/workflows/rotinas.yml` roda `scripts/rotinas.js` a cada 30 minutos:
1. Encerra por timeout as tarefas que passaram de `tempo_maximo_min` (e recalcula a carga).
2. Anota em `ocorrencias` o coletor fora da base ha mais de 6h (uma vez por retirada).
3. Apaga `coletores_log` com mais de 7 dias e `ocorrencias` com mais de 45 dias.

Alem disso, o proprio app encerra uma tarefa vencida assim que alguem consulta o status dela ou
abre o painel do gestor, entao o timeout nao depende do horario exato da rotina.

- Para rodar na hora: GitHub > Actions > Rotinas > **Run workflow**.
- O GitHub pode atrasar execucoes agendadas em alguns minutos e **desativa agendamentos de
  repositorios sem atividade por 60 dias** (reative em Actions se acontecer).
- O token vem de `js/config.js`. Se preferir, crie os secrets `TURSO_URL` e `TURSO_TOKEN` no
  repositorio (Settings > Secrets and variables > Actions); eles tem prioridade.

---

## Fluxos do sistema

### Login (2 etapas condicionais)
1. Escaneia QRcode do cracha (ou digita codigo manual)
2. Sistema chama `verificar_cracha` — se `requer_senha: true`, pede senha
3. Se nao tem senha cadastrada, loga direto
4. Sessao salva no `sessionStorage`

### Painel de tarefas (funcionario e gestor)
O painel destaca as tarefas de carregamento (com botao grande e destaque) separadas das demais tarefas, que ficam agrupadas sob o botao "Outras Tarefas". Se o funcionario tem alertas, um botao "Meus Alertas" aparece para expandir a lista.

### Tarefa comum (Limpeza, Conferencia, Avarias)
1. Seleciona tarefa em "Outras Tarefas" -> clica para iniciar
2. Cronometro inicia, tela mostra tarefa ativa
3. Clica "Finalizar" -> registra data_fim, volta ao painel

### Tarefa de carregamento (4 etapas)
1. **Doca**: Escaneia QRcode da doca (ou digita). Sistema valida na aba Docas e mostra o nome
2. **Carga**: Escaneia QRcode da carga (formato: `NUMERO|VOLUMES`, ex: `C350|410`). Toggle "Ajudante?" disponivel (desativado por padrao)
3. **Andamento**: Cronometro + info da doca/carga + distribuicao de volumes em tempo real
4. **Resultado**: Resumo final com distribuicao proporcional

### Distribuicao de volumes (multiplos workers)
Quando mais de um funcionario trabalha na mesma carga:
- Volumes sao distribuidos **proporcionalmente ao tempo de execucao** de cada um
- Workers com status `timeout` sao **excluidos** da distribuicao (aparecem riscados em vermelho)
- Se o mesmo funcionario tem multiplos registros na mesma carga, seus tempos sao **somados** (agrupamento por worker unico)
- Monitoramento em tempo real a cada 15 segundos
- Ultimo worker recebe o restante (evita erro de arredondamento)

### Ajudante
Em algumas cargas, um ajudante auxiliar pode participar do carregamento:
- Na etapa de scan da carga, o funcionario pode ativar o toggle **"Ajudante?"**
- Maximo **1 ajudante por carga**, independente de quantos funcionarios marquem a opcao
- O ajudante e um participante virtual na distribuicao de volumes, com **tempo integral da carga** (do inicio mais cedo ao fim mais tarde entre todos os workers)
- O ajudante aparece na distribuicao como "Ajudante" e recebe sua parcela proporcional de volumes
- A flag e gravada na coluna `ajudante` da aba Cargas

---

## Controle de coletor

O controle de quem esta com cada coletor acontece dentro do app (desde a v10). Desde a v11 os
registros ficam no banco (tabelas `coletores`, `coletores_log` e `ocorrencias`). O antigo sistema
`Ger_Gestao_Coletores` e o e-mail diario foram desativados: as irregularidades ficam na aba
**Irregularidades** do perfil ADM e o painel de coletores na aba **Coletores**.

### Vinculo do aparelho (uma vez por coletor)
- Um navegador nao consegue ler numero de serie/IMEI do aparelho. Por isso cada coletor e
  identificado lendo, uma unica vez, um **QR de configuracao** com o texto `COLETOR:<nome>`, onde
  `<nome>` e exatamente o nome do coletor na tabela `coletores` (ex.: `COLETOR:GC07`).
- O QR pode ser lido no quadro "Coletor nao vinculado" ou no proprio campo do cracha da tela de login.
  O app confere se o coletor existe antes de gravar.
- O vinculo fica no `localStorage` do aparelho: **nao expira**, sobrevive a desligar o coletor e
  a atualizacoes do app. So se perde se os dados do Chrome forem apagados, o app/Chrome for
  desinstalado ou o aparelho for resetado. Para trocar o vinculo, basta ler outro QR de configuracao.

### Regras
| Situacao ao entrar com o cracha | O que acontece |
|---|---|
| Coletor na Base | Painel bloqueado: so o botao **Retirar** funciona |
| Coletor com a propria pessoa | Entra direto, com o botao **Devolver** no rodape |
| Coletor com outra pessoa **sem** tarefa aberta | "Fulano e responsavel por este coletor. Deseja assumir?" **Sim**: devolucao para Fulano + retirada para quem entrou + ocorrencia em `ocorrencias`. **Nao**: volta ao login |
| Coletor com outra pessoa **com** tarefa aberta | Tela vermelha "Fulano e responsavel por este coletor e esta executando tarefas!" por 10s e volta ao login |
| Aparelho sem vinculo, funcionario | Nao entra: pede o QR de configuracao |
| Aparelho sem vinculo, gestor ou ADM (computador) | Entra normalmente, sem controle de coletor |

- **Retirar** e **Devolver** abrem uma caixa de leitura. O QR da estacao e reconhecido como
  `retirada` ou `devolucao`, com ou sem acento e em qualquer combinacao de maiusculas (mesma regra
  do sistema de coletores).
- **Devolucao** so e aceita sem tarefa em andamento. Depois dela aparece a confirmacao verde por 3s
  e o app faz logout.
- **Gestor no coletor vinculado** segue a mesma regra do funcionario: todo o painel fica bloqueado
  ate a retirada.
- **Leitura errada** (QR de devolucao ao retirar, de retirada ao devolver, ou qualquer outro codigo):
  nada muda na posse, a mensagem aparece na caixa com "Tentativa N de 3", e a leitura e anotada em
  `ocorrencias` com o conteudo lido (para treinamento). Na 3a leitura errada seguida a caixa
  fecha e aparece a tela amarela "Chame o responsavel"; a contagem recomeca na proxima vez.
- QR da estacao lido no campo do cracha: "Este e o QR da base de coletores. Primeiro leia o seu cracha".
- **Tempo Real do gestor** mostra o coletor que cada funcionario esta usando.

### Configuracoes (`js/config.js`)
| Campo | Padrao | Descricao |
|---|---|---|
| `COLETOR_TENTATIVAS_MAX` | 3 | Leituras erradas seguidas antes da tela "Chame o responsavel" |
| `COLETOR_AVISO_BLOQUEIO_S` | 10 | Segundos do aviso "esta executando tarefas" |
| `COLETOR_CONFIRMA_DEVOLUCAO_S` | 3 | Segundos da confirmacao de devolucao |

> **Cadastro unico:** desde a v11 tarefas e coletores usam a mesma tabela `funcionarios`.

---

## Compatibilidade com Zebra MC22

O coletor Zebra MC22 envia automaticamente a tecla **Enter** apos cada leitura de QRcode. Todos os campos de input do sistema respondem ao Enter disparando a acao do botao correspondente, eliminando a necessidade de tocar na tela apos o scan:

- **Login**: scan do cracha -> avanca automaticamente
- **Doca**: scan da doca -> confirma e avanca para carga
- **Carga**: scan da carga -> registra automaticamente
- **Modais de scan**: codigo digitado + Enter -> confirma

---

## Sistema de Alertas

Gestores podem registrar alertas para funcionarios (advertencias, observacoes, etc):

- **Gestor** (aba "Alertas"): escaneia o cracha do funcionario, sistema exibe o **nome** do funcionario, escreve a descricao e registra. Visualiza lista de todos os alertas recentes
- **Funcionario** (painel): botao "Meus Alertas" aparece quando ha alertas. Ao clicar, expande a lista com todos os alertas recebidos, ordenados do mais recente

---

## Estrategia anti-esquecimento

| Tempo | Acao |
|-------|------|
| 0 - 3h | Cronometro verde, tarefa normal |
| 3h | Cronometro amarelo + alerta pulsante |
| 3h+ | Cronometro vermelho |
| 4h | Auto-timeout pelo backend (trigger a cada 30 min) |
| Proximo login | Mostra tarefa ativa automaticamente |

Workers com timeout sao excluidos da distribuicao de volumes — apenas quem finalizou corretamente recebe volumes.

---

## Painel do gestor (5 abas; ADM tem mais 3)

1. **Tempo Real**: Lista de funcionarios com status (ocioso/em andamento/alerta/timeout), filtros por tarefa e status, mostra doca e carga quando aplicavel
2. **Tarefas**: Mesmo painel do funcionario (Carregamento em destaque + Outras Tarefas) — gestores tambem executam tarefas
3. **Historico**: Filtro por data + Todos/Individual (scan QRcode do funcionario). Tabela com nome do funcionario, tarefa, doca, carga, volumes proporcionais e status
4. **Alertas**: Registrar alertas para funcionarios (scan do cracha + exibe nome do funcionario + descricao) e visualizar alertas recentes
5. **Raio X**: Analise de desempenho por periodo (Diario/Semanal/Mensal) — ver secao abaixo

---

## Raio X

Ferramenta de analise disponivel no painel do gestor (aba "Raio X").

### Fluxo de uso
1. Selecionar o periodo: **Diario** (dia corrente), **Semanal** (domingo a sabado da semana corrente) ou **Mensal** (mes corrente)
2. Escolher o modo:

**Resumo Equipe**
- Um quadro por tarefa existente no sistema
- Cada quadro lista os funcionarios que executaram aquela tarefa no periodo, com o tempo total trabalhado
- Funcionarios sem registro no periodo nao aparecem
- Ordenacao por tempo crescente (menos tempo primeiro)
- Para tarefas de carregamento: exibe tambem os volumes proporcionais atribuidos

**Detalhado**
- Lista todos os funcionarios ativos (coluna `ativo = TRUE` na aba Funcionarios)
- Ao selecionar um funcionario: exibe o Raio X individual com contexto (periodo + modo + nome)
- Raio X individual mostra: total de tempo por tarefa, volumes (para carregamento), e total de alertas recebidos no periodo
- Botao "←" para voltar a lista de funcionarios sem precisar reselecionar o periodo

---

## Nomes vs codigos

O sistema armazena codigos internamente mas exibe **nomes** no frontend:
- **Funcionarios**: codigo `PL4` -> exibe `Angelo Lopes` (da tabela `funcionarios`)
- **Funcionarios (nome_completo)**: codigo `PL4` -> exibe `Angelo Lopes` (da coluna `nome_completo` da tabela `funcionarios`)
- **Docas**: codigo `D01` -> exibe `Doca Norte` (da tabela `docas`)

---

## QRcode - Formatos

| QRcode | Conteudo | Exemplo |
|--------|----------|---------|
| Cracha | Codigo do funcionario | `PL4` |
| Doca | Codigo da doca | `D01` |
| Carga | NUMERO_CARGA\|QTD_VOLUMES | `C350\|410` |
| Configuracao do coletor | COLETOR:NOME_DO_COLETOR | `COLETOR:COLETOR 07` |
| Estacao de coletores | retirada / devolucao | `retirada`, `Devolução` |

---

## Configuracao e deploy

### Versionamento (MAIOR.MENOR.CORRECAO)
Desde a 1.0.0 a versao tem tres numeros. A tela de login mostra a versao (`Versao 1.1.0`).

| Tipo de mudanca | O que sobe | Exemplo | Quando usar |
|---|---|---|---|
| **Geral** | MAIOR, zera os outros | `1.4.2` -> `2.0.0` | Muda a arquitetura ou o jeito de trabalhar (ex.: troca de banco, mudanca no fluxo do coletor que exige treinar a equipe) |
| **Funcionalidade nova** | MENOR, zera a correcao | `1.4.2` -> `1.5.0` | Tela, filtro, relatorio ou regra nova, sem mudar o que ja existe |
| **Pequena** | CORRECAO | `1.4.2` -> `1.4.3` | Correcao de erro, texto, ajuste visual, desempenho |

Equivalencia com as versoes antigas: `v11` (banco Turso) = **1.0.0**; modo computador + melhorias = **1.1.0**.
O historico abaixo da 1.0.0 mantem os nomes antigos (v4 a v10).

### Publicar uma versao nova (frontend)
A cada mudanca em HTML/CSS/JS, troque a versao em **3 lugares** (mesmo numero nos tres):

| Arquivo | Campo | Exemplo |
|---------|-------|---------|
| `js/config.js` | `APP_VERSION` | `'1.1.1'` -> `'1.1.2'` |
| `service-worker.js` | `CACHE_NAME` | `'ger-tarefas-1.1.1'` -> `'ger-tarefas-1.1.2'` |
| Todos os 4 HTMLs | `?v=` nos `<script>` **e no `<link>` do `css/style.css`** | `?v=1.1.1` -> `?v=1.1.2` |

> O `?v=` no CSS e obrigatorio: sem ele o navegador pode usar o CSS antigo com o JavaScript novo
> (foi o que aconteceu na 1.1.0, corrigido na 1.1.1).

Depois: merge na `main` e aguarde 1-2 min para o GitHub Pages processar. O service worker detecta a
versao nova, apaga o cache antigo e recarrega. **Como conferir num coletor:** a tela de login mostra
`Versao vX`.

### Mudar o banco (esquema)
Edite `db/schema.sql` e aplique. Tabelas e indices usam `IF NOT EXISTS` (nada e apagado), as
views sao recriadas, e colunas novas em tabelas que ja existem entram na lista `MIGRACOES` do
`db/aplicar.js` (`ALTER TABLE ... ADD COLUMN`, ignorado se a coluna ja existir):
```bash
NODE_USE_ENV_PROXY=1 node db/aplicar.js libsql://tarefas-angeloxiru.aws-us-east-1.turso.io <token>
```
Outras alteracoes (renomear/remover coluna) devem ser feitas com cuidado pelo console do Turso,
deixando o `schema.sql` igual ao banco.

### Reimportar as planilhas (virada)
Baixe cada planilha em **Arquivo > Fazer download > Microsoft Excel (.xlsx)** e rode:
```bash
python3 db/importar_planilhas.py Ger_Tarefas.xlsx Controle_de_Coletores.xlsx dados.json
node db/aplicar.js libsql://tarefas-angeloxiru.aws-us-east-1.turso.io <token> dados.json --substituir
```
`--substituir` apaga os dados do banco antes de carregar. Datas da planilha (horario de Brasilia)
viram UTC; IDs de registro repetidos (toque duplo no app antigo) ganham sufixo `-2`, `-3`; a mesma
carga lida duas vezes no mesmo registro fica so uma vez.

### Trocar o token do banco
1. No painel do Turso, crie um token novo (leitura e escrita) para o banco `tarefas`.
2. Cole em `js/config.js` (`TURSO_TOKEN`), bumpe a versao do app e publique.
3. Depois que os coletores mostrarem a versao nova, invalide o token antigo no Turso.

### Testes
```bash
node --no-warnings testes/e2e.test.js
```
Sobe um banco Turso simulado (`testes/turso-local.js`, SQLite do Node 22+) e percorre o fluxo
completo no Chromium (Playwright): vinculo, retirada, tarefa, carregamento, assumir coletor,
devolucao, ADM e exportacao.

### GitHub Pages
- Fazer merge para `main` -> deploy automatico
- HTTPS automatico (necessario para camera do MC22)

### Zebra MC22
- Navegador Chrome Android, tela 4.3"
- Camera traseira para QRcode (biblioteca html5-qrcode hospedada no proprio app, `js/vendor/`)
- Scanner embutido envia Enter apos leitura: o sistema responde automaticamente
- Conexao WiFi

---

## Requisitos de rede (liberacao no WiFi/firewall)

Tudo e **HTTPS (TCP 443)**. Libere os dois dominios:

| Dominio | Para que | Se bloquear |
|---|---|---|
| `angeloxiru.github.io` | Hospedagem do app (HTML/JS/CSS/icones/manifest/SW) | app nao abre |
| `tarefas-angeloxiru.aws-us-east-1.turso.io` | Banco de dados (todas as acoes) | login e todas as acoes |

`script.google.com` e `script.googleusercontent.com` **nao sao mais necessarios** desde a v11.

- **IPs:** GitHub Pages usa `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
  O Turso usa IPs dinamicos da AWS: libere por dominio.
- **Inspecao de SSL/MITM:** se o WiFi reassina certificados, faca SSL bypass desses dominios ou
  instale a CA do proxy no coletor.
- **Sem downgrade para HTTP:** o app so funciona em HTTPS (service worker + camera).

---

## Limites e consideracoes

- Turso (plano gratuito): limites mensais de linhas lidas/gravadas e armazenamento folgados para
  o volume atual (~12 mil registros/mes). Acompanhe o uso no painel do Turso.
- Latencia: 40 a 200 ms por acao (servidor nos EUA, `aws-us-east-1`).
- Historico do gestor mostra no maximo 200 registros encerrados por busca (como antes).
- O historico de tarefas nao e apagado; o log de coletores e (7 dias) e as ocorrencias tambem (45 dias).

---

## Bonificacao da logistica (pasta `bonificacao/`)

O Programa de Bonificacao por Niveis (N1 Assiduidade, N2 Produtividade, N3 Excelencia) e apurado pelo Claude, num projeto do claude.ai, lendo este mesmo banco Turso. A pasta `bonificacao/` guarda as regras de calculo, os procedimentos e os geradores de PDF desse projeto.

- **Comece por `bonificacao/CLAUDE.md`**: explica o que e importante, o que nao pode ser quebrado e como registrar mudancas.
- O Claude le esse guia no inicio de cada relatorio, fechamento ou rotina. Mudancas pedidas pela gerencia entram na secao "Mudancas para o Claude aplicar" do guia.
- **Mudancas no app tambem podem afetar a bonificacao** (estrutura das tabelas em `db/schema.sql`, nomes das tarefas, tempo maximo das tarefas (`tempo_maximo_min`, que define o timeout), calculo de `volumes_proporcionais`, gravacao de alertas, importacao do WMS, indices). A lista completa esta na secao 4 do guia. Ao mexer nesses pontos, registre no guia.

Arquivos da pasta:

| Arquivo | O que e |
|---|---|
| `CLAUDE.md` | Guia: o que nao pode quebrar, dependencias com o app e mudancas pendentes |
| `1_descricao_e_instrucoes.md` | Descricao e instrucoes do projeto no claude.ai |
| `2_regras_de_calculo.md` | Regras oficiais de calculo (versao 1.5) e historico de decisoes |
| `3_dicionario_de_dados.md` | Tabelas e colunas do banco |
| `4_modelo_relatorio_pdf.md` | Modelo do PDF individual |
| `5_como_criar_o_projeto.md` | Passo a passo para montar o projeto no claude.ai |
| `6_padrao_relatorio_performance.md` / `7_gerador_relatorio_performance.py` | Procedimento e gerador do relatorio individual |
| `8_rotina_conflitos_alertas.md` / `.py` | Rotina diaria (06:00) que grava conflitos e alertas |
| `9_fechamento_equipe.md` / `9_gerador_resumo_equipe.py` | Fechamento mensal da equipe (resumo do RH, impressao e conferencia) |

Pendente no guia: as trocas de bateria (`bat_trocas`, 15 min por troca so no N1) ja estao no banco, mas ainda nao fazem parte das regras de calculo 1.5. O item esta registrado como `PENDENTE` em `bonificacao/CLAUDE.md`.

---

## Historico de versoes

### 1.3.0 - Trocas de bateria das empilhadeiras

- Banco: tabelas `bat_trocas`, `bat_empilhadeiras`, `bat_baterias`; views `vw_bat_trocas`,
  `vw_bat_minutos_dia`, `vw_bat_consumo_empilhadeira`, `vw_bat_desempenho_bateria`,
  `lkp_empilhadeiras`, `lkp_baterias`. Ja aplicado no Turso.
- O sistema Ger_Baterias (repositorio proprio) envia cada troca ao banco; registro pelo QR nao muda.
- Historico e Raio X mostram "Troca de bateria" (15 min por troca); filtro de tarefa com a opcao.
- Bonificacao: cada troca soma 15 min ao N1 (regra ainda pendente no projeto de bonificacao, ver `bonificacao/CLAUDE.md`).

**Arquivos:** `db/schema.sql`, `js/backend.js`, `js/desktop.js`, `js/config.js`, `service-worker.js`,
4 HTMLs (`?v=1.3.0`), `README.md`.

### 1.2.2 - Correcao: horario no Excel do Historico

- O "Baixar Excel" do Historico (modo computador) saia com 3 horas a menos (tela 08:11, Excel
  05:11): o horario ja convertido para Brasilia era convertido de novo pela biblioteca do Excel
  usando o fuso do computador. Agora a data vai como numero de serie do Excel ja em Brasilia, sem
  depender do fuso do computador.
- Conferido com dados reais (Keterson, 23/11): Excel igual a tela com o computador em Brasilia e em
  Toquio. O teste de ponta a ponta passou a rodar o computador em Brasilia e comparar Excel x tela.

**Arquivos:** `js/desktop.js`, `testes/e2e.test.js`, `js/config.js`, `service-worker.js`,
4 HTMLs (`?v=1.2.2`), `README.md`.

### 1.2.1 - Horario de Brasilia forcado em todas as telas

- Historico e Alertas (coletor), "Com voce desde" do coletor e "Atualizado as" usavam o fuso do
  aparelho; agora forcam `America/Sao_Paulo`, como o resto do app. Testado com o navegador em
  Toquio, UTC e Brasilia: sempre mostra o horario de Brasilia.
- README: secao "Padrao de horario" (grava em UTC, mostra/exporta/filtra em Brasilia).

**Arquivos:** `js/gestor.js`, `js/coletor.js`, `js/desktop.js`, `painel.html`, `js/config.js`,
`service-worker.js`, 4 HTMLs (`?v=1.2.1`), `README.md`.

### 1.2.0 - Importacao das tarefas do WMS

- Aba do ADM **Exportacao** passa a se chamar **Exp/Imp**: mantem a exportacao e ganha a importacao
  do relatorio "Tarefas Realizadas" (.xlsx) do outro app, com previa (novas, atualizadas, sem
  vinculo, quantidade por tarefa) antes de confirmar e historico das importacoes.
- Banco: tabelas `wms_tarefas` (chave = numero, reimportar sobrescreve), `lkp_aplicacoes`,
  `wms_importacoes`; views `vw_wms_tarefas`, `vw_wms_resumo_dia`, `lkp_tarefas_wms`; coluna
  `funcionarios.codigo_wms` (preenchida PL<n> = <n>; PL49 sem codigo ate corrigir o cadastro).
  Ja aplicado no Turso.
- Separacao por paletes classificada em Separacao Manual / Separacao Empilhadeira pelo endereco.
- Teste com o relatorio real (3.353 tarefas): importacao em menos de 1 s, reimportacao atualiza sem duplicar.

**Arquivos:** `db/schema.sql`, `db/aplicar.js`, `js/backend.js`, `js/adm.js`, `gestor.html`,
`css/style.css`, `js/config.js`, `service-worker.js`, 4 HTMLs (`?v=1.2.0`), `README.md`.

### 1.1.1 - Correcao: CSS desatualizado no navegador

- O `css/style.css` era carregado sem `?v=` e o navegador continuava usando o estilo antigo com o
  JavaScript novo (painel de coletores e modo computador apareciam sem formatacao).
- Agora o CSS tem `?v=` como os scripts. Versao `1.1.0` -> `1.1.1`.

**Arquivos:** 4 HTMLs, `js/config.js`, `service-worker.js`, `README.md`.

### 1.1.0 - Modo computador e melhorias do gestor/ADM

**Modo computador** (navegador sem coletor vinculado; no coletor nada muda):
- `js/desktop.js`: largura total da tela, abas numa linha, Tempo Real em colunas.
- Historico: filtros por tipo de tarefa, funcionario (lista), situacao e limite de linhas; resumo;
  coluna de duracao; **Baixar Excel** do que esta na tela.
- Tempo Real: em tarefa primeiro (alertas no topo), busca por nome, atualizacao a cada 1 minuto
  com horario da ultima atualizacao.
- Coletores (ADM): painel em cartoes no estilo do antigo Ger_Gestao_Coletores, historico por
  coletor e atualizacao a cada 30 s.

**Conserto de coletor:** coluna `coletores.em_conserto`; ADM envia/libera pelo painel; coletor em
conserto nao pode ser retirado nem assumido; login no aparelho dele avisa para usar outro.

**Versionamento** passa a ser MAIOR.MENOR.CORRECAO (ver "Versionamento"). `v11` = 1.0.0.

**Banco:** coluna `em_conserto` (migracao no `db/aplicar.js`), views recriadas a cada aplicacao,
`vw_coletores_situacao` com `em_conserto`. Ja aplicado no Turso.

**Arquivos:** `js/desktop.js` (novo), `js/backend.js`, `js/coletor.js`, `js/gestor.js`, `js/adm.js`,
`gestor.html`, `css/style.css`, `js/config.js`, `service-worker.js`, 4 HTMLs (`?v=1.1.0`),
`db/schema.sql`, `db/aplicar.js`, `testes/e2e.test.js`, `README.md`.

### 1.0.0 (antiga v11) - Banco de dados Turso (sai o Google)

**Motivo:** o app ficava lento e dava "sem resposta" com o Google Apps Script + planilhas
(partida a frio de varios segundos, leitura de abas inteiras a cada acao, limite de execucoes).

**1. Banco de dados**
- `db/schema.sql`: 10 tabelas, indices e 8 views. Cadastro unico de funcionarios para tarefas e
  coletores; perfil novo `adm`.
- Indice unico parcial impede duas tarefas abertas para a mesma pessoa (fim das duplicatas por
  toque duplo, que existiam na planilha).
- Importacao das planilhas (`db/importar_planilhas.py` + `db/aplicar.js`): 53 funcionarios,
  6.300 registros, 1.324 cargas, 111 alertas, 23 coletores, 653 movimentos de coletor e 17 ocorrencias.

**2. Regras portadas para `js/backend.js`**
- Login, tarefas, carregamento (distribuicao de volumes identica a anterior), painel do gestor,
  historico, alertas, Raio X e controle de coletor. Mesmo formato de resposta: as telas nao mudaram.
- `js/db.js`: cliente HTTP do Turso com transacoes e novas tentativas automaticas.
- `js/api.js`: as telas continuam chamando `API.get({acao})`, que agora vai direto ao banco.

**3. Perfil ADM** (abas extras no painel do gestor)
- **Coletores:** situacao de cada coletor (substitui o painel do Ger_Gestao_Coletores).
- **Irregularidades:** ocorrencias por periodo, guardadas 45 dias (substitui o e-mail diario).
- **Exportacao:** `.xlsx` por periodo, com Qtd Itens por pessoa e Volume por hora calculado.

**4. Rotinas no GitHub Actions** (substituem os gatilhos do Google): timeout a cada 30 min,
alerta de coletor com mais de 6h (uma vez por retirada), limpeza do log de coletores (7 dias) e
das ocorrencias (45 dias).

**5. Versao de frontend** `v10` -> `v11` (`APP_VERSION`, `CACHE_NAME`, `?v=11`).

**Arquivos novos:** `db/`, `scripts/rotinas.js`, `.github/workflows/rotinas.yml`, `testes/`,
`js/db.js`, `js/backend.js`, `js/adm.js`, `js/vendor/xlsx.full.min.js`.
**Arquivos alterados:** `js/config.js`, `js/api.js`, `js/auth.js`, `js/coletor.js`, `css/style.css`,
`index.html`, `painel.html`, `gestor.html`, `carregamento.html`, `service-worker.js`, `README.md`.

> As secoes de versoes anteriores abaixo descrevem o sistema com Apps Script e planilhas.

### v10 — Controle de coletor dentro do app

**1. Retirada e devolução do coletor (frontend)**
- Novo `js/coletor.js`: vínculo do aparelho por QR `COLETOR:<nome>`, quadro com a situação do
  coletor no login e no painel, botões **Retirar** e **Devolver**, pergunta "Deseja assumir?",
  aviso de 10s quando o responsável está executando tarefas, bloqueio da devolução com tarefa
  aberta, confirmação verde e logout após devolver, limite de 3 leituras erradas.
- `auth.js`: depois do crachá aceito, checa o coletor antes de abrir o painel.
- `index.html`: bloco do coletor, QR de configuração e QR da estação reconhecidos no campo do
  crachá (campo passou de 10 para 40 caracteres).
- `painel.html` e `gestor.html`: painel bloqueado até a retirada (no computador do gestor nada muda).
- Tempo Real do gestor mostra o coletor de cada funcionário.
- Registros na planilha de coletores, pela API nova do `Ger_Gestao_Coletores` (sem mudança no
  Apps Script do Tarefas, `BACKEND_VERSION` continua o mesmo).

**2. Leitor de QR hospedado no app**
- `html5-qrcode` 2.3.8 em `js/vendor/`, no cache do service worker. `unpkg.com` saiu da lista de rede.

**3. Versão de frontend**
- `APP_VERSION` `v9` → `v10`, `CACHE_NAME` `ger-tarefas-v10`, `?v=10` nos 4 HTMLs.

**Arquivos alterados:** `js/coletor.js` (novo), `js/vendor/` (novo), `js/config.js`, `js/api.js`,
`js/auth.js`, `js/gestor.js`, `css/style.css`, `index.html`, `painel.html`, `gestor.html`,
`carregamento.html`, `service-worker.js`, `README.md`

**Passos de deploy desta versão:**
1. **Primeiro** o `Ger_Gestao_Coletores`: copiar o `code.gs` novo e publicar **Nova versão na
   mesma implantação** (a URL `/exec` não muda). Conferir no navegador
   `<URL>?api=status&coletor=<nome de um coletor>`: deve responder `{"sucesso":true,...}`.
2. Depois o Tarefas: merge na `main`; conferir `Versão v10` na tela de login dos coletores.
3. Em cada coletor, ler o QR de configuração `COLETOR:<nome>` uma vez.
4. A página antiga de coletores pode continuar em paralelo por 1 a 2 semanas (as duas gravam
   na mesma planilha, com as mesmas regras). Depois, remover o atalho antigo dos coletores.

### v8 — Índice de tarefas abertas + diagnóstico de deploy

**1. Escala — separar tarefas em andamento do histórico (backend)**
- Nova aba `RegistrosAbertos` guarda apenas tarefas `em_andamento`; ao finalizar/dar timeout,
  a linha é movida para `Registros` (histórico) via `moverParaHistorico()` (com `LockService`
  para evitar duplicidade; grava no histórico antes de remover da aba quente).
- Caminhos de alta frequência passam a ler só a aba quente: `status_funcionario`,
  `iniciar_tarefa`, `painel_gestor` (Tempo Real, 30s) e o trigger `verificarTimeouts` (30min).
  O custo passa a ser proporcional ao nº de pessoas ativas agora, não ao tamanho do histórico.
- Cálculos de carga (`calcularDistribuicaoVolumes`, `workers_carga`) e o Histórico do gestor
  unem as duas abas via `_indexarRegistrosPorId()` (workers finalizados + ativos na mesma carga).
- Migração única: `inicializarPlanilha()` cria a aba; `migrarRegistrosAbertos()` move as
  abertas existentes (idempotente). A API pública não muda: mesmos endpoints e respostas.

**2. Diagnóstico e disciplina de versão (backend)**
- `BACKEND_VERSION` no topo de `Code.gs` + endpoint `?acao=versao`: mostra qual código o
  `/exec` executa. Além da versão, inspeciona via `Function.toString()` qual **definição** de
  `Tarefas_iniciar`/`finalizar`/`statusFuncionario` está ativa — pega função duplicada em `.gs`
  antigo que sobrescreve a nova.
- `verificarConsistencia()` (rodar no editor): conta quantas `em_andamento` ainda estão presas
  em `Registros` e quantas há em `RegistrosAbertos`.

**3. Cache dos coletores (frontend)**
- Bump `v7` → `v8` (`APP_VERSION`, `CACHE_NAME`, `?v=` dos scripts) para forçar os coletores a
  descartar o `config.js` em cache — necessário porque o histórico da `API_URL` mostrava uma
  URL nova por deploy, e cache velho apontava para implantações antigas com código velho.

**4. Documentação**
- README: separação de deploy backend × frontend, **regra de ouro** (nunca criar implantação
  nova — sempre atualizar a mesma, URL fixa) e guia de troubleshooting da "aba errada".

**Arquivos alterados:** `apps-script/Code.gs`, `apps-script/Utils.gs`, `apps-script/Tarefas.gs`, `apps-script/Gestor.gs`, `apps-script/Carregamento.gs`, `apps-script/Timeout.gs`, `js/config.js`, `service-worker.js`, `index.html`, `painel.html`, `gestor.html`, `carregamento.html`, `README.md`

**Passos de deploy desta versão (numa janela sem ninguém logado):**
1. Backend: copiar os `.gs`, republicar na mesma implantação (Nova versão), conferir `?acao=versao`.
2. Planilha: `inicializarPlanilha()` → `migrarRegistrosAbertos()` → `verificarConsistencia()`.
3. Frontend: merge na `main`; conferir `Versão v8` na tela de login dos coletores.

---

### v5 — 2025-05-15
**Validacao automatica de versao e logout por inatividade**

- Adicionado `APP_VERSION` em `config.js` como referencia unica de versao do app
- Service Worker passa a notificar todas as abas abertas (`SW_UPDATED`) ao ativar uma versao nova — abas recarregam automaticamente sem intervencao do usuario
- Guard de versao via `localStorage` inserido em todas as paginas: detecta mudanca de versao ao carregar e forca reload imediato (cobre browsers sem suporte a PWA)
- Script tags atualizados para `?v=5` em todos os HTMLs (cache-bust adicional para CDN do GitHub Pages)
- Bumped `CACHE_NAME` de `ger-tarefas-v4` para `ger-tarefas-v5`

**Arquivos alterados:** `js/config.js`, `service-worker.js`, `index.html`, `painel.html`, `gestor.html`, `carregamento.html`

---

### v4 — (anterior)
**Versao de producao com Service Worker cache-first**

- Cache-first para assets estaticos, network-only para chamadas ao GAS
- `CACHE_NAME = 'ger-tarefas-v4'`
- Logout automatico por inatividade de 30 minutos sem tarefa ativa (`IDLE_LOGOUT_MS`)
- Verificacao de idle a cada 60 segundos e ao voltar ao foco da aba (`visibilitychange`)
- Redirect para `index.html?motivo=inatividade` ao deslogar por idle
