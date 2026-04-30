# Ger_Tarefas - Sistema de Registro de Atividades

Sistema web para registro de atividades operacionais em tempo real, utilizado por 31 a 50 funcionarios atraves de coletores Zebra MC22.

**Stack:** Frontend (GitHub Pages) + Backend (Google Apps Script) + Banco (Google Sheets)

---

## Estrutura do repositorio

```
Ger_Tarefas/
├── index.html              # Login (scan QRcode cracha + senha opcional)
├── painel.html             # Painel do funcionario (tarefas + alertas)
├── carregamento.html       # Fluxo: Doca -> Carga -> Andamento -> Resultado
├── gestor.html             # Painel do gestor (5 abas)
│
├── css/
│   └── style.css           # Estilos responsivos (tela 4.3" MC22)
│
├── js/
│   ├── config.js           # URL da API e constantes do sistema
│   ├── api.js              # Comunicacao com backend (fetch + JSONP fallback)
│   ├── auth.js             # Login/logout e sessao
│   ├── scanner.js          # Leitura de QRcode via camera
│   ├── tarefas.js          # Iniciar/finalizar tarefas + cronometro
│   ├── carregamento.js     # Distribuicao de volumes entre workers
│   └── gestor.js           # Dashboard, historico, cadastros, alertas
│
├── apps-script/
│   ├── Code.gs             # Roteador principal (doGet/doPost)
│   ├── Auth.gs             # Autenticacao (cracha + senha condicional)
│   ├── Tarefas.gs          # CRUD de tarefas e registros + distribuicao
│   ├── Carregamento.gs     # Registro de cargas e workers
│   ├── Gestor.gs           # Painel gestor + historico + cadastros + alertas
│   ├── Timeout.gs          # Auto-timeout via trigger (30 min)
│   └── Utils.gs            # Utilitarios (getSheet, buscarNomeDoca, etc)
│
└── README.md
```

---

## Google Sheets - Estrutura (7 abas)

### Funcionarios
| Coluna | Tipo | Exemplo | Descricao |
|--------|------|---------|-----------|
| codigo | texto | PL4 | Codigo unico do cracha (QRcode) |
| nome | texto | Angelo Lopes | Nome completo |
| nome_completo | texto | Angelo Lopes | Nome completo |
| cargo | texto | Operador | Cargo/funcao |
| ativo | booleano | TRUE | Se esta ativo |
| perfil | texto | funcionario | "funcionario" ou "gestor" |
| senha | texto | 1234 | Senha (obrigatoria para gestores, opcional para funcionarios) |

### Tarefas
| Coluna | Tipo | Exemplo | Descricao |
|--------|------|---------|-----------|
| id_tarefa | texto | T001 | Identificador unico |
| nome | texto | Carregamento | Nome da tarefa |
| usa_qrcode_carga | booleano | TRUE | Se exige scan de QRcode de carga |
| tempo_maximo_min | numero | 240 | Tempo maximo em minutos |
| ativa | booleano | TRUE | Se esta disponivel |

### Registros
| Coluna | Tipo | Exemplo | Descricao |
|--------|------|---------|-----------|
| id_registro | texto | R20240115143022PL4 | ID unico (timestamp + codigo) |
| codigo_func | texto | PL4 | Codigo do funcionario |
| id_tarefa | texto | T001 | Referencia a tarefa |
| nome_tarefa | texto | Carregamento | Nome (desnormalizado) |
| data_inicio | datetime | 2024-01-15 14:30:22 | Quando iniciou |
| data_fim | datetime | 2024-01-15 16:45:10 | Quando finalizou (vazio se em andamento) |
| status | texto | em_andamento | "em_andamento", "finalizada" ou "timeout" |
| finalizado_por | texto | funcionario | "funcionario" ou "sistema" |

### Cargas
| Coluna | Tipo | Exemplo | Descricao |
|--------|------|---------|-----------|
| id_registro | texto | R20240115143022PL4 | Referencia ao registro |
| codigo_func | texto | PL4 | Quem fez o carregamento |
| numero_carga | texto | C350 | Numero da carga (do QRcode) |
| qtd_volumes | numero | 410 | Quantidade de volumes |
| doca | texto | D01 | Codigo da doca (escaneado antes da carga) |
| data_leitura | datetime | 2024-01-15 14:30:25 | Quando o QRcode foi lido |
| ajudante | booleano | TRUE | Se ha ajudante nesta carga (maximo 1 por carga) |

### Docas
| Coluna | Tipo | Exemplo | Descricao |
|--------|------|---------|-----------|
| codigo | texto | D01 | Codigo do QRcode da doca |
| doca | texto | Doca Norte | Nome da doca exibido no sistema |

### Alertas
| Coluna | Tipo | Exemplo | Descricao |
|--------|------|---------|-----------|
| id_registro | texto | A20240115143022PL4 | ID unico do alerta |
| codigo_func | texto | PL4 | Funcionario que recebeu o alerta |
| data_alerta | datetime | 2024-01-15 14:30:22 | Data/hora do registro |
| descricao | texto | Atraso recorrente | Descricao do alerta |

### Config
| Coluna | Tipo | Exemplo | Descricao |
|--------|------|---------|-----------|
| chave | texto | timeout_padrao_min | Nome da configuracao |
| valor | texto | 240 | Valor da configuracao |

Configuracoes iniciais:
- `timeout_padrao_min`: 240 (4 horas)
- `intervalo_alerta_min`: 180 (3 horas)
- `versao_sistema`: 1.0

---

## Endpoints da API

Todos via parametro `acao` no GET. POST tambem suportado, com fallback JSONP para contornar CORS do GitHub Pages.

| Acao | Descricao |
|------|-----------|
| `verificar_cracha` | Verifica se o cracha existe e se requer senha |
| `login` | Valida codigo + senha (senha so exigida se cadastrada) |
| `verificar_doca` | Valida codigo da doca e retorna o nome |
| `listar_tarefas` | Lista tarefas ativas |
| `status_funcionario` | Retorna tarefa em andamento (se houver) |
| `iniciar_tarefa` | Inicia uma tarefa |
| `finalizar_tarefa` | Finaliza tarefa e calcula distribuicao de volumes |
| `registrar_carga` | Registra leitura do QRcode de carga + doca + ajudante |
| `workers_carga` | Workers da mesma carga + flag ajudante (monitoramento tempo real) |
| `distribuicao_carga` | Distribuicao calculada de volumes |
| `painel_gestor` | Visao geral de todos os funcionarios |
| `historico` | Registros filtrados por data e funcionario |
| `registrar_alerta` | Registra alerta para um funcionario |
| `listar_alertas` | Lista alertas (todos ou de um funcionario) |
| `cadastrar_funcionario` | Cadastra novo funcionario (com senha) |
| `cadastrar_tarefa` | Cadastra nova tarefa |

Formato de resposta:
```json
{ "sucesso": true, "dados": { ... }, "mensagem": "..." }
```

Comunicacao: `api.js` tenta `fetch()` primeiro; se falhar por CORS, usa JSONP (injeta `<script>` com callback). Acoes de escrita (POST) tambem funcionam via GET como fallback.

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

## Painel do gestor (5 abas)

1. **Tempo Real**: Lista de funcionarios com status (ocioso/em andamento/alerta/timeout), filtros por tarefa e status, mostra doca e carga quando aplicavel
2. **Tarefas**: Mesmo painel do funcionario (Carregamento em destaque + Outras Tarefas) — gestores tambem executam tarefas
3. **Historico**: Filtro por data + Todos/Individual (scan QRcode do funcionario). Tabela com nome do funcionario, tarefa, doca, carga, volumes proporcionais e status. Usa cache de distribuicao por carga para evitar timeout
4. **Alertas**: Registrar alertas para funcionarios (scan do cracha + exibe nome do funcionario + descricao) e visualizar alertas recentes
5. **Cadastro**: Cadastro de funcionarios (com senha) e tarefas

---

## Nomes vs codigos

O sistema armazena codigos internamente mas exibe **nomes** no frontend:
- **Funcionarios**: codigo `PL4` -> exibe `Angelo Lopes` (da aba Funcionarios)
- **Funcionarios (nome_completo)**: codigo `PL4` -> exibe `Angelo Lopes` (da coluna `nome_completo` da aba Funcionarios)
- **Docas**: codigo `D01` -> exibe `Doca Norte` (da aba Docas)

---

## QRcode - Formatos

| QRcode | Conteudo | Exemplo |
|--------|----------|---------|
| Cracha | Codigo do funcionario | `PL4` |
| Doca | Codigo da doca | `D01` |
| Carga | NUMERO_CARGA\|QTD_VOLUMES | `C350\|410` |

---

## Configuracao e deploy

### Google Sheets
- **ID da planilha**: `1sChUfWfpYeSM8povUqwQQT0WbsxVyniMlZSa7AOdb5Y`
- [Link da planilha](https://docs.google.com/spreadsheets/d/1sChUfWfpYeSM8povUqwQQT0WbsxVyniMlZSa7AOdb5Y/edit?usp=sharing)
- 7 abas: Funcionarios, Tarefas, Registros, Cargas, Docas, Alertas, Config

### Google Apps Script
1. Copiar todos os arquivos `.gs` da pasta `apps-script/` para o projeto
2. Publicar como Web App ("Qualquer pessoa" pode acessar)
3. Copiar a URL gerada para `js/config.js`
4. Configurar trigger: executar `configurarTriggerTimeout()` uma vez (cria trigger de 30 min)

### GitHub Pages
- Fazer merge para `main` -> deploy automatico
- HTTPS automatico (necessario para camera do MC22)

### Zebra MC22
- Navegador Chrome Android, tela 4.3"
- Camera traseira para QRcode (biblioteca html5-qrcode via CDN)
- Scanner embutido envia Enter apos leitura — sistema responde automaticamente
- Conexao WiFi

---

## Limites e consideracoes

- Google Apps Script: 6 min/execucao, ~20.000 chamadas/dia
- Google Sheets: performance degrada acima de ~50.000 linhas por aba
- Latencia: 1-3 segundos por requisicao
- Historico usa cache de distribuicao por carga para evitar timeout em consultas grandes
- Sugestao: rotina mensal para arquivar registros antigos
