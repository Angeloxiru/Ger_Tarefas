# Ger_Tarefas

# Sistema de Registro de Atividades - Documento Técnico

## 1. Visão geral do projeto

Sistema 100% web para registro de atividades operacionais em tempo real, utilizado por 31 a 50 funcionários através de coletores de dados Zebra MC22. O sistema permite login via QRcode do crachá, registro de tarefas (uma por vez) e acompanhamento em tempo real por supervisores.

**Stack tecnológica:**
- **Frontend:** HTML/CSS/JavaScript hospedado no GitHub Pages
- **Backend:** Google Apps Script (API REST)
- **Banco de dados:** Google Sheets (múltiplas abas)
- **Repositório:** GitHub (com deploy via GitHub Pages)

---

## 2. Estrutura do repositório GitHub

```
nome-do-repositorio/
│
├── index.html              ← Tela de login (scan QRcode crachá)
├── painel.html             ← Painel do funcionário (tarefas)
├── carregamento.html       ← Tela específica de carregamento (scan QRcode carga)
├── gestor.html             ← Painel do supervisor/gestor
│
├── css/
│   └── style.css           ← Estilos globais (responsivo p/ tela do MC22)
│
├── js/
│   ├── config.js           ← URL do Google Apps Script (Web App)
│   ├── auth.js             ← Lógica de login/logout
│   ├── scanner.js          ← Lógica de leitura de QRcode (câmera)
│   ├── tarefas.js          ← Lógica de iniciar/finalizar tarefas
│   ├── carregamento.js     ← Lógica específica do carregamento
│   └── gestor.js           ← Lógica do painel do gestor
│
├── libs/
│   └── html5-qrcode.min.js ← Biblioteca para leitura de QRcode via câmera
│
└── README.md               ← Documentação do projeto
```

---

## 3. Estrutura do Google Sheets (banco de dados)

A planilha terá **5 abas**, cada uma funcionando como uma "tabela" do banco de dados:

### Aba 1: `Funcionarios`
| Coluna | Tipo | Exemplo | Descrição |
|--------|------|---------|-----------|
| codigo | texto | PL4 | Código único do crachá (QRcode) |
| nome | texto | Angelo Lopes | Nome completo |
| cargo | texto | Operador | Cargo/função |
| ativo | booleano | TRUE | Se o funcionário está ativo no sistema |
| perfil | texto | funcionario | "funcionario" ou "gestor" |

### Aba 2: `Tarefas`
| Coluna | Tipo | Exemplo | Descrição |
|--------|------|---------|-----------|
| id_tarefa | texto | T001 | Identificador único |
| nome | texto | Carregamento | Nome da tarefa |
| usa_qrcode_carga | booleano | TRUE | Se a tarefa exige scan de QRcode de carga |
| tempo_maximo_min | número | 240 | Tempo máximo em minutos (para auto-timeout) |
| ativa | booleano | TRUE | Se a tarefa está disponível para seleção |

### Aba 3: `Registros`
| Coluna | Tipo | Exemplo | Descrição |
|--------|------|---------|-----------|
| id_registro | texto | R20240115143022PL4 | ID único (timestamp + código) |
| codigo_func | texto | PL4 | Código do funcionário |
| id_tarefa | texto | T001 | Referência à tarefa |
| nome_tarefa | texto | Carregamento | Nome da tarefa (desnormalizado p/ performance) |
| data_inicio | datetime | 2024-01-15 14:30:22 | Quando iniciou |
| data_fim | datetime | 2024-01-15 16:45:10 | Quando finalizou (vazio se em andamento) |
| status | texto | em_andamento | "em_andamento", "finalizada" ou "timeout" |
| finalizado_por | texto | funcionario | "funcionario" ou "sistema" (auto-timeout) |

### Aba 4: `Cargas`
| Coluna | Tipo | Exemplo | Descrição |
|--------|------|---------|-----------|
| id_registro | texto | R20240115143022PL4 | Referência ao registro |
| codigo_func | texto | PL4 | Quem fez o carregamento |
| numero_carga | texto | CG-2024-00158 | Número da carga (do QRcode) |
| qtd_volumes | número | 45 | Quantidade de volumes (do QRcode) |
| data_leitura | datetime | 2024-01-15 14:30:25 | Quando o QRcode foi lido |

### Aba 5: `Config`
| Coluna | Tipo | Exemplo | Descrição |
|--------|------|---------|-----------|
| chave | texto | timeout_padrao_min | Nome da configuração |
| valor | texto | 240 | Valor da configuração |

Configurações iniciais sugeridas:
- `timeout_padrao_min`: 240 (4 horas — tempo máximo antes do auto-encerramento)
- `intervalo_alerta_min`: 180 (3 horas — quando começa a alertar)
- `versao_sistema`: 1.0

---

## 4. Google Apps Script - Endpoints da API

O Apps Script será publicado como **Web App** e funcionará como uma API REST.

### Estrutura dos arquivos no Apps Script:

```
├── Code.gs            ← doGet/doPost (roteador principal)
├── Auth.gs            ← Funções de autenticação
├── Tarefas.gs         ← CRUD de tarefas e registros
├── Carregamento.gs    ← Funções específicas de carregamento
├── Gestor.gs          ← Funções do painel do gestor
├── Timeout.gs         ← Lógica de auto-timeout (trigger agendado)
└── Utils.gs           ← Funções auxiliares
```

### Endpoints disponíveis (via parâmetro `acao`):

| Ação | Método | Descrição |
|------|--------|-----------|
| `login` | GET | Valida código do crachá e retorna dados do funcionário |
| `listar_tarefas` | GET | Lista tarefas disponíveis (ativas) |
| `iniciar_tarefa` | POST | Inicia uma tarefa para o funcionário |
| `finalizar_tarefa` | POST | Finaliza a tarefa em andamento |
| `status_funcionario` | GET | Retorna se tem tarefa em andamento e detalhes |
| `registrar_carga` | POST | Registra leitura do QRcode de carga |
| `painel_gestor` | GET | Retorna visão geral de todos os funcionários |
| `cadastrar_tarefa` | POST | (gestor) Cadastra nova tarefa |
| `cadastrar_funcionario` | POST | (gestor) Cadastra novo funcionário |

### Formato de comunicação:

**Requisição (Frontend → Backend):**
```
GET: https://script.google.com/.../exec?acao=login&codigo=PL4
POST: corpo em JSON via fetch()
```

**Resposta (Backend → Frontend):**
```json
{
  "sucesso": true,
  "dados": { ... },
  "mensagem": "Login realizado com sucesso"
}
```

---

## 5. Fluxo de uso do sistema

### 5.1 Login
1. Funcionário abre o navegador no MC22 → acessa a URL do GitHub Pages
2. Tela de login aparece com botão "Escanear Crachá"
3. Funcionário escaneia o QRcode do crachá → código é capturado (ex: "PL4")
4. Sistema envia o código para o backend → valida se existe e está ativo
5. Se válido → redireciona para o painel de tarefas
6. Código fica salvo no `sessionStorage` do navegador

### 5.2 Iniciar uma tarefa comum (Limpeza, Conferência, etc.)
1. No painel, funcionário vê a lista de tarefas disponíveis
2. Seleciona a tarefa desejada → clica em "Iniciar"
3. Sistema verifica se já tem tarefa em andamento → se sim, bloqueia
4. Se não → cria registro com status "em_andamento" e hora de início
5. Tela mostra: tarefa em andamento + cronômetro + botão "Finalizar"

### 5.3 Iniciar tarefa de carregamento
1. Funcionário seleciona "Carregamento" → sistema abre tela de scan
2. Funcionário escaneia QRcode da carga → extrai número da carga + volumes
3. Sistema registra a tarefa + dados da carga simultaneamente
4. Tela mostra: dados da carga + cronômetro + botão "Finalizar"

### 5.4 Finalizar tarefa
1. Funcionário clica em "Finalizar"
2. Sistema registra data_fim e muda status para "finalizada"
3. Funcionário volta ao painel e pode iniciar nova tarefa

---

## 6. Estratégia anti-esquecimento de tarefas

Este é um ponto crítico. A estratégia é em **3 camadas**:

### Camada 1: Alerta visual no frontend
- Quando a tarefa em andamento ultrapassa o `intervalo_alerta_min` (ex: 3h), o painel muda de cor e exibe alerta pulsante: **"Atenção: tarefa aberta há mais de 3 horas. Deseja finalizar?"**
- O cronômetro muda de cor (verde → amarelo → vermelho)

### Camada 2: Bloqueio de nova tarefa
- O funcionário **não consegue** iniciar uma nova tarefa sem finalizar a anterior
- Ao fazer login, o sistema verifica automaticamente se há tarefa em andamento e já mostra a tela de tarefa ativa (não o menu de escolha)

### Camada 3: Auto-timeout via trigger agendado (Google Apps Script)
- Um **trigger de tempo** no Apps Script roda a cada 30 minutos
- Ele verifica todos os registros com status "em_andamento"
- Se o tempo desde `data_inicio` for maior que `tempo_maximo_min` da tarefa:
  - Muda status para `"timeout"`
  - Registra `finalizado_por` como `"sistema"`
  - Registra `data_fim` como o momento do timeout
- O gestor pode ver no painel quais tarefas foram encerradas por timeout

### Resumo visual da proteção:

| Tempo | O que acontece |
|-------|----------------|
| 0 - 3h | Tarefa rodando normalmente (cronômetro verde) |
| 3h | Alerta visual no frontend (cronômetro amarelo/vermelho) |
| 3h+ | Alerta pulsante pedindo para finalizar |
| 4h | Auto-timeout pelo backend (tarefa encerrada automaticamente) |
| Próximo login | Se tinha tarefa aberta, mostra direto a tarefa ativa |

---

## 7. QRcode - Formato dos dados

### QRcode do crachá:
Conteúdo simples, apenas o código do funcionário:
```
PL4
```

### QRcode da carga:
Conteúdo em formato estruturado (sugestão: separado por pipe):
```
CG-2024-00158|45
```
Onde:
- `CG-2024-00158` = número da carga
- `45` = quantidade de volumes

O frontend faz o `split("|")` para extrair as informações.

---

## 8. Painel do gestor

O gestor acessa `gestor.html` (login com perfil "gestor"). Funcionalidades:

- **Visão em tempo real:** Lista de todos os funcionários com status atual (ocioso, em tarefa, timeout)
- **Filtros:** Por tarefa, por status, por data
- **Cadastro de tarefas:** Adicionar novas tarefas dinamicamente
- **Cadastro de funcionários:** Adicionar novos funcionários
- **Histórico:** Consulta de registros por período
- **Alertas:** Destaque para tarefas em timeout ou próximas do timeout

---

## 9. Considerações técnicas importantes

### Sobre o Zebra MC22:
- Possui navegador Android (Chrome)
- Tela pequena (~4.3") → todo o CSS precisa ser responsivo e com botões grandes
- Leitor de QRcode embutido → pode ser usado via câmera com a biblioteca `html5-qrcode`
- Conexão WiFi → sujeita a quedas → frontend deve tratar erros de rede

### Sobre Google Apps Script como backend:
- Limite de execução: 6 minutos por execução
- Limite de chamadas: ~20.000/dia para conta gratuita
- Latência: pode ter delay de 1-3 segundos por requisição
- O Web App precisa ser publicado como "Qualquer pessoa" para o frontend acessar

### Sobre Google Sheets como banco:
- Limite de 10 milhões de células por planilha
- Performance degrada acima de ~50.000 linhas por aba
- Sugestão: criar uma rotina mensal para arquivar registros antigos em outra planilha

### Sobre GitHub Pages:
- Apenas arquivos estáticos (HTML, CSS, JS)
- Toda lógica de negócio fica no Apps Script
- HTTPS automático (necessário para acessar câmera no MC22)

---

## 10. Próximos passos para implementação

A implementação será feita em fases:

### Fase 1 - Base
1. Criar a planilha Google Sheets com as 5 abas
2. Popular a aba `Funcionarios` com os dados iniciais
3. Popular a aba `Tarefas` com as tarefas iniciais
4. Popular a aba `Config` com as configurações padrão

### Fase 2 - Backend
5. Criar o projeto no Google Apps Script
6. Implementar o roteador principal (doGet/doPost)
7. Implementar autenticação (login)
8. Implementar CRUD de registros de tarefas
9. Implementar registro de cargas
10. Implementar o trigger de auto-timeout
11. Publicar como Web App e testar os endpoints

### Fase 3 - Frontend
12. Criar a tela de login com scanner QRcode
13. Criar o painel de tarefas do funcionário
14. Criar a tela de carregamento (scan de carga)
15. Criar o painel do gestor
16. Testar responsividade no tamanho de tela do MC22

### Fase 4 - Integração e testes
17. Conectar frontend ao backend
18. Testar fluxo completo em dispositivo real
19. Testar cenários de timeout
20. Ajustar e publicar no GitHub Pages

---

## 11. Informações para iniciar
1. **Configurações e criações das abas na planilha** link da planilha "https://docs.google.com/spreadsheets/d/1sChUfWfpYeSM8povUqwQQT0WbsxVyniMlZSa7AOdb5Y/edit?usp=sharing"
2. **Lista completa de tarefas iniciais** (Carregamento, Limpeza, Conferência, Avarias)
