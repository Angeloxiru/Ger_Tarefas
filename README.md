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
│   ├── api.js              # Comunicacao com backend (fetch + JSONP fallback + retry)
│   ├── auth.js             # Login/logout e sessao
│   ├── ui.js               # Modal de confirmacao customizado
│   ├── scanner.js          # Leitura de QRcode via camera
│   ├── tarefas.js          # Iniciar/finalizar tarefas + cronometro
│   ├── carregamento.js     # Distribuicao de volumes entre workers
│   └── gestor.js           # Dashboard, historico, alertas, Raio X
│
├── manifest.json           # PWA manifest
├── service-worker.js       # PWA service worker (cache-first)
├── icon-192.png            # Icone PWA 192x192
└── icon-512.png            # Icone PWA 512x512
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

## Google Sheets - Estrutura (8 abas)

> **Aba quente `RegistrosAbertos`:** guarda **apenas** as tarefas em andamento (poucas
> linhas). Mesmas colunas de `Registros`. Ao finalizar ou dar timeout, a linha é **movida**
> para `Registros` (histórico). Os caminhos de alta frequência (verificar status, iniciar,
> painel Tempo Real e o trigger de timeout) leem só desta aba, evitando varrer o histórico
> inteiro a cada requisição. Ver seção "Índice de tarefas abertas" abaixo.


### Funcionarios
| Coluna | Tipo | Exemplo | Descricao |
|--------|------|---------|-----------|
| codigo | texto | PL4 | Codigo unico do cracha (QRcode) |
| nome | texto | Angelo | Nome |
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
| volumes_proporcionais | numero | 245 | Volumes atribuidos ao worker (gravado na finalizacao) |

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
| `raiox` | Resumo por periodo (equipe ou individual) — ver secao Raio X |

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
- 8 abas: Funcionarios, Tarefas, Registros, **RegistrosAbertos**, Cargas, Docas, Alertas, Config

### Google Apps Script
1. Copiar todos os arquivos `.gs` da pasta `apps-script/` para o projeto
2. Publicar como Web App ("Qualquer pessoa" pode acessar)
3. Copiar a URL gerada para `js/config.js` (campo `API_URL`)
4. Configurar trigger: executar `configurarTriggerTimeout()` uma vez (cria trigger de 30 min)

> **Versão do backend — leia antes de republicar.** O Apps Script tem seu próprio
> marcador: `BACKEND_VERSION` no topo de `Code.gs`. **A cada mudança nos `.gs`, bumpe esse
> valor** (ex.: `abertas-1` → `abertas-2`). Depois de republicar, o **último passo** é abrir
> no navegador `<API_URL>?acao=versao` e confirmar que voltou o número novo. Se voltar o
> número antigo, a implantação **não** está servindo o código novo — provavelmente o
> `config.js` aponta para uma implantação diferente da que você editou (confira que a URL da
> implantação ativa é idêntica ao `API_URL`). Sem esse check, é impossível saber qual código
> o `/exec` executa — foi o que causou o incidente das tarefas nascendo na aba errada.
>
> Atenção: republicar o `.gs` **não** troca automaticamente o que o `/exec` executa. É preciso
> **Implantar → Gerenciar implantações → Editar (lápis) → Versão: Nova versão → Implantar**,
> na mesma implantação cuja URL está no `config.js` (isso mantém a URL).
5. **Índice de tarefas abertas (uma vez):** executar `inicializarPlanilha()` para criar a
   aba `RegistrosAbertos` (não altera abas já existentes) e, numa planilha que já tem dados,
   executar `migrarRegistrosAbertos()` **uma única vez** para mover as tarefas que estão
   `em_andamento` de `Registros` para `RegistrosAbertos`. É idempotente — rodar de novo não
   duplica nada. Sem esse passo, tarefas abertas antes do deploy ficariam invisíveis para o
   status/painel até serem migradas.

#### Índice de tarefas abertas (por que existe)

Antes, quase toda chamada fazia `getDataRange().getValues()` na aba `Registros` inteira —
inclusive o simples "tenho tarefa aberta?" no login. Com o histórico crescendo (~12 mil
linhas/mês para 50 operadores), cada requisição passava a carregar meses de dados mortos.
Agora as tarefas em andamento vivem numa aba pequena (`RegistrosAbertos`), e o custo dos
caminhos quentes passa a ser proporcional ao número de pessoas ativas **agora**, não ao
tamanho do histórico. Cálculos de carga (distribuição, monitoramento em tempo real) e o
Histórico do gestor unem as duas abas quando precisam de workers finalizados e ativos juntos.
A API pública não muda: mesmos endpoints, mesmas respostas.

### Como fazer um deploy (procedimento padrao)

Existem **dois** deploys independentes. Saber qual você está fazendo evita 90% dos erros.

#### A) Deploy de BACKEND (mudou algum `.gs`)
1. Copie os `.gs` alterados para o projeto Apps Script.
2. **Bumpe `BACKEND_VERSION`** no topo de `Code.gs` (ex.: `abertas-2` → `abertas-3`).
3. **Republique na MESMA implantação** (ver regra de ouro abaixo): Implantar → Gerenciar
   implantações → Editar (lápis) → Versão: **Nova versão** → Implantar.
4. **Verifique:** abra `<API_URL>?acao=versao` no navegador e confirme que voltou o número
   novo. Se voltou o antigo, a implantação não pegou — **não avance** enquanto não bater.

#### B) Deploy de FRONTEND (mudou HTML/CSS/JS)
A cada deploy de frontend, bumpe **3 números**. O resto é automático.

| Arquivo | Campo | Exemplo |
|---------|-------|---------|
| `js/config.js` | `APP_VERSION` | `'v7'` → `'v8'` |
| `service-worker.js` | `CACHE_NAME` | `'ger-tarefas-v7'` → `'ger-tarefas-v8'` |
| Todos os 4 HTMLs | `?v=` nos `<script>` | `?v=7` → `?v=8` |

Depois: commite, faça push para `main` e aguarde 1-2 min para o GitHub Pages processar. O
browser detecta o novo `service-worker.js`, ativa (`skipWaiting`), apaga o cache antigo,
notifica as abas (`SW_UPDATED`) e recarrega. O guard de versão no `localStorage` cobre
browsers sem PWA. **Como conferir num coletor:** a tela de login mostra `Versão vX` — tem que
exibir o número novo. Se mostrar o antigo, aquele aparelho não atualizou.

---

### ⚠️ REGRA DE OURO do Apps Script — leia sempre

**NUNCA crie uma implantação NOVA a cada deploy. Sempre atualize a MESMA, mantendo a URL fixa.**

Por quê: cada implantação nova gera uma **URL diferente**, e as URLs antigas **continuam vivas
rodando o código que estava nelas**. Se você troca a URL no `config.js`, os coletores com o
`config.js` **em cache** continuam chamando a URL antiga — ou seja, um **servidor velho** — e o
app se comporta como código antigo mesmo com o backend novo publicado. Foi exatamente isso que
causou o incidente das "tarefas nascendo na aba `Registros`": o backend estava certo, mas os
coletores falavam com uma implantação antiga via `config.js` cacheado.

Consequências práticas:
- **Mantenha uma única implantação** (Web App) e sempre a atualize por *Nova versão*. A URL
  `.../exec` não muda, então o `config.js` nunca precisa mudar e cache velho continua correto.
- **Só troque `API_URL` em último caso.** Se trocar, é **obrigatório** bumpar a versão de
  FRONTEND (item B) no mesmo deploy, para o kill-switch limpar o cache e os coletores baixarem
  a URL nova. Sem isso, aparelhos ficam presos na URL antiga.

---

### Troubleshooting — "as tarefas nascem na aba errada / comportamento de código antigo"

Siga nesta ordem; cada passo isola uma camada:

1. **O `/exec` roda o código novo?** Abra `<API_URL>?acao=versao`.
   - `versao_backend` é o esperado **e** `iniciar_grava_em: "RegistrosAbertos (novo)"` → o
     backend está OK, o problema é no frontend/cache → vá ao passo 2.
   - `versao_backend` antigo, ou `iniciar_grava_em: "Registros (ANTIGO)"` → a implantação está
     velha ou há função duplicada num `.gs` antigo. Republique (Nova versão) e/ou remova o
     arquivo duplicado; confirme que `function Tarefas_iniciar` existe em **um só** arquivo.
2. **O coletor está no frontend novo?** Veja `Versão vX` na tela de login do aparelho. Se
   estiver antiga, o `config.js` (e talvez a `API_URL`) está em cache velho. Bumpe a versão de
   frontend (item B), faça merge na `main` e reabra o app; se persistir, limpe os dados do app.
3. **A aba `RegistrosAbertos` está consistente?** Rode `verificarConsistencia()` no editor:
   deve logar `0 em_andamento presos em Registros`. Se houver linhas presas (ex.: criadas
   enquanto rodava código antigo), rode `migrarRegistrosAbertos()` para movê-las.

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

---

## Historico de versoes

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
