-- =====================================================================
-- Ger_Tarefas - Banco de dados (Turso / libSQL / SQLite)
--
-- Convencoes:
-- - Datas/horas em texto ISO 8601 UTC com milissegundos: 2026-11-19T18:10:51.774Z
--   (comparacao por texto funciona e ordena corretamente). O app converte
--   para o horario de Brasilia (UTC-3) na exibicao e nos filtros por dia.
-- - Booleanos como INTEGER 0/1.
-- - Codigos (cracha, coletor, doca) sem diferenciar maiusculas (COLLATE NOCASE).
--
-- Cadastros (funcionarios, tarefas, docas, coletores, config) sao mantidos
-- direto pelo console do Turso. O app so le esses dados.
-- =====================================================================

-- ------------------------------ Cadastros ------------------------------

CREATE TABLE IF NOT EXISTS funcionarios (
  codigo        TEXT PRIMARY KEY COLLATE NOCASE,          -- codigo do cracha (QR), ex.: PL4
  nome          TEXT NOT NULL,                            -- nome curto exibido no app
  nome_completo TEXT,                                     -- usado na exportacao
  cargo         TEXT,
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  perfil        TEXT NOT NULL DEFAULT 'funcionario' CHECK (perfil IN ('funcionario', 'gestor', 'adm')),
  senha         TEXT,                                     -- vazio = entra sem senha
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  codigo_wms    TEXT                                      -- codigo do funcionario no outro app (WMS), ex.: 33
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_funcionarios_codigo_wms ON funcionarios (codigo_wms) WHERE codigo_wms IS NOT NULL;

CREATE TABLE IF NOT EXISTS tarefas (
  id_tarefa        TEXT PRIMARY KEY,                      -- ex.: T001
  nome             TEXT NOT NULL,
  usa_qrcode_carga INTEGER NOT NULL DEFAULT 0 CHECK (usa_qrcode_carga IN (0, 1)),
  tempo_maximo_min INTEGER NOT NULL DEFAULT 240,          -- passou disso: timeout automatico
  ativa            INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1))
);

CREATE TABLE IF NOT EXISTS docas (
  codigo TEXT PRIMARY KEY COLLATE NOCASE,                 -- conteudo do QR da doca
  nome   TEXT NOT NULL                                    -- ex.: Doca 1
);

CREATE TABLE IF NOT EXISTS coletores (
  coletor      TEXT PRIMARY KEY COLLATE NOCASE,           -- ex.: GC07 (QR de configuracao COLETOR:GC07)
  ativo        INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  -- Situacao atual (mantida pelo app junto com coletores_log):
  responsavel  TEXT COLLATE NOCASE,                       -- codigo do funcionario; NULL = na base
  desde        TEXT,                                      -- quando foi retirado
  alerta_6h_em TEXT,                                      -- quando o alerta de 6h desta retirada foi gerado
  em_conserto  INTEGER NOT NULL DEFAULT 0 CHECK (em_conserto IN (0, 1))  -- 1 = em manutencao, nao pode ser retirado
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

-- ------------------------------ Movimento ------------------------------

-- Todas as tarefas (abertas e encerradas). Substitui as abas Registros e RegistrosAbertos.
CREATE TABLE IF NOT EXISTS registros (
  id_registro           TEXT PRIMARY KEY,                 -- R + aaaammddhhmmss (Brasilia) + codigo
  codigo_func           TEXT NOT NULL COLLATE NOCASE,
  id_tarefa             TEXT NOT NULL,
  nome_tarefa           TEXT NOT NULL,                    -- nome na epoca (desnormalizado)
  data_inicio           TEXT NOT NULL,
  data_fim              TEXT,
  status                TEXT NOT NULL CHECK (status IN ('em_andamento', 'finalizada', 'timeout')),
  finalizado_por        TEXT CHECK (finalizado_por IN ('funcionario', 'sistema')),
  volumes_proporcionais INTEGER                           -- parte dos volumes da carga (carregamento)
);

-- O banco nao deixa a mesma pessoa ter duas tarefas abertas (substitui o "lock"
-- da planilha e elimina as duplicatas por toque duplo).
CREATE UNIQUE INDEX IF NOT EXISTS ux_registros_um_aberto_por_func
  ON registros (codigo_func) WHERE status = 'em_andamento';
CREATE INDEX IF NOT EXISTS ix_registros_abertos   ON registros (status, data_inicio) WHERE status = 'em_andamento';
CREATE INDEX IF NOT EXISTS ix_registros_inicio    ON registros (data_inicio);
CREATE INDEX IF NOT EXISTS ix_registros_func_ini  ON registros (codigo_func, data_inicio);

-- Leitura do QR de carga. Normalmente uma por registro de carregamento; o historico
-- tem alguns registros com duas cargas diferentes (lancadas a mao). Nesses casos
-- vale a primeira (menor id) para exibicao, e todas entram na distribuicao da carga.
CREATE TABLE IF NOT EXISTS cargas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  id_registro  TEXT NOT NULL,
  codigo_func  TEXT NOT NULL COLLATE NOCASE,
  numero_carga TEXT NOT NULL,
  qtd_volumes  INTEGER NOT NULL,
  doca         TEXT COLLATE NOCASE,
  data_leitura TEXT NOT NULL,
  ajudante     INTEGER NOT NULL DEFAULT 0 CHECK (ajudante IN (0, 1))
);
-- Impede a mesma carga duas vezes no mesmo registro (toque duplo)
CREATE UNIQUE INDEX IF NOT EXISTS ux_cargas_registro_numero ON cargas (id_registro, numero_carga);
CREATE INDEX IF NOT EXISTS ix_cargas_registro ON cargas (id_registro);
CREATE INDEX IF NOT EXISTS ix_cargas_numero ON cargas (numero_carga);

CREATE TABLE IF NOT EXISTS alertas (
  id_alerta   TEXT PRIMARY KEY,                           -- A + aaaammddhhmmssSSS + codigo
  codigo_func TEXT NOT NULL COLLATE NOCASE,
  data_alerta TEXT NOT NULL,
  descricao   TEXT NOT NULL,
  emissor     TEXT COLLATE NOCASE                         -- codigo de quem registrou
);
CREATE INDEX IF NOT EXISTS ix_alertas_func_data ON alertas (codigo_func, data_alerta);
CREATE INDEX IF NOT EXISTS ix_alertas_data ON alertas (data_alerta);

-- Historico de retiradas/devolucoes. Linhas com mais de 7 dias sao apagadas pela rotina diaria.
CREATE TABLE IF NOT EXISTS coletores_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  data_hora   TEXT NOT NULL,
  coletor     TEXT NOT NULL COLLATE NOCASE,
  codigo_func TEXT NOT NULL COLLATE NOCASE,
  nome        TEXT,
  acao        TEXT NOT NULL CHECK (acao IN ('Retirada', 'Devolução')),
  origem      TEXT NOT NULL DEFAULT 'app'                 -- app | assumido | importado
);
CREATE INDEX IF NOT EXISTS ix_coletores_log_data ON coletores_log (data_hora);
CREATE INDEX IF NOT EXISTS ix_coletores_log_coletor ON coletores_log (coletor, data_hora);

-- Irregularidades e ocorrencias (antigo registro_diario). Mantidas por 45 dias.
CREATE TABLE IF NOT EXISTS ocorrencias (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  data_hora   TEXT NOT NULL,
  coletor     TEXT COLLATE NOCASE,
  codigo_func TEXT COLLATE NOCASE,
  nome        TEXT,
  tipo        TEXT NOT NULL DEFAULT 'outro',              -- leitura_errada | limite_tentativas | assumido | atraso_6h | conserto | outro
  descricao   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ocorrencias_data ON ocorrencias (data_hora);

-- ------------------------------ Tarefas do outro app (WMS) ------------------------------
-- Importadas pelo ADM (aba Exp/Imp) a partir do relatorio "Tarefas Realizadas" (.xlsx).
-- Chave = numero da tarefa: importar de novo a mesma tarefa SOBRESCREVE a linha.

-- Aplicacoes (tipos de tarefa) do WMS, atualizadas a cada importacao
CREATE TABLE IF NOT EXISTS lkp_aplicacoes (
  cod_aplicacao TEXT PRIMARY KEY,                         -- ex.: CSE020WIS
  nome          TEXT NOT NULL,                            -- ex.: Separacao por paletes
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wms_tarefas (
  numero           TEXT PRIMARY KEY,                      -- Numero da tarefa no WMS
  endereco_inicial TEXT NOT NULL,                         -- ex.: 12B00101A
  deposito         TEXT,                                  -- 1   (1o caractere)
  predio           TEXT,                                  -- 2   (2o caractere)
  rua              TEXT,                                  -- B   (3o caractere)
  posicao          TEXT,                                  -- 001 (4o ao 6o)
  andar            TEXT,                                  -- 01A (7o ao 9o)
  dt_aceite        TEXT NOT NULL,                         -- ISO UTC (arquivo vem no horario de Brasilia)
  dt_conclusao     TEXT,
  execucao_seg     INTEGER,                               -- Execucao em segundos (= conclusao - aceite)
  cod_aplicacao    TEXT NOT NULL,                         -- ex.: CSE020WIS
  tarefa           TEXT NOT NULL,                         -- nome final: Separacao Manual / Separacao Empilhadeira / nome da aplicacao
  cod_func_wms     TEXT NOT NULL,                         -- Cod. Funcionario no WMS, ex.: 33
  nome_func_wms    TEXT,                                  -- nome como veio no arquivo
  codigo_func      TEXT COLLATE NOCASE,                   -- nosso codigo (PL33) na hora da importacao; NULL = sem vinculo
  qtde_itens       INTEGER,
  qt_enderecos     INTEGER,                               -- so vem em Separacao
  id_importacao    INTEGER,
  importado_em     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_wms_tarefas_aceite ON wms_tarefas (dt_aceite);
CREATE INDEX IF NOT EXISTS ix_wms_tarefas_func ON wms_tarefas (codigo_func, dt_aceite);
CREATE INDEX IF NOT EXISTS ix_wms_tarefas_tarefa ON wms_tarefas (tarefa, dt_aceite);

-- Registro de cada importacao (quem, quando, quantas linhas)
CREATE TABLE IF NOT EXISTS wms_importacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  data_hora   TEXT NOT NULL,
  arquivo     TEXT,
  linhas      INTEGER NOT NULL,
  novas       INTEGER NOT NULL,
  atualizadas INTEGER NOT NULL,
  sem_vinculo INTEGER NOT NULL,
  periodo_ini TEXT,
  periodo_fim TEXT,
  importado_por TEXT
);

-- ------------------------------ Views ------------------------------
-- As views sao apagadas e recriadas a cada aplicacao do esquema (db/aplicar.js),
-- para que mudancas na definicao cheguem ao banco que ja existe.

-- Listas de apoio (lookup) para filtros e conferencias no console
DROP VIEW IF EXISTS lkp_funcionarios;
CREATE VIEW lkp_funcionarios AS
  SELECT codigo, nome, nome_completo, cargo, perfil FROM funcionarios WHERE ativo = 1;

DROP VIEW IF EXISTS lkp_tarefas;
CREATE VIEW lkp_tarefas AS
  SELECT id_tarefa, nome, usa_qrcode_carga, tempo_maximo_min FROM tarefas WHERE ativa = 1;

DROP VIEW IF EXISTS lkp_docas;
CREATE VIEW lkp_docas AS
  SELECT codigo, nome FROM docas;

DROP VIEW IF EXISTS lkp_coletores;
CREATE VIEW lkp_coletores AS
  SELECT coletor FROM coletores WHERE ativo = 1;

-- Registros com nomes, carga e doca (historico, conferencias)
DROP VIEW IF EXISTS vw_registros;
CREATE VIEW vw_registros AS
SELECT r.id_registro, r.codigo_func, f.nome AS nome_func, f.nome_completo,
       r.id_tarefa, r.nome_tarefa, r.data_inicio, r.data_fim, r.status, r.finalizado_por,
       r.volumes_proporcionais,
       c.numero_carga, c.qtd_volumes, c.doca, d.nome AS nome_doca, c.ajudante,
       CASE WHEN r.data_fim IS NOT NULL
            THEN CAST(ROUND((julianday(r.data_fim) - julianday(r.data_inicio)) * 86400000) AS INTEGER) END AS duracao_ms
FROM registros r
LEFT JOIN funcionarios f ON f.codigo = r.codigo_func
LEFT JOIN cargas c ON c.id = (SELECT MIN(x.id) FROM cargas x WHERE x.id_registro = r.id_registro)
LEFT JOIN docas d ON d.codigo = c.doca;

-- Tarefas em andamento com tempo decorrido e limite
DROP VIEW IF EXISTS vw_tarefas_abertas;
CREATE VIEW vw_tarefas_abertas AS
SELECT r.id_registro, r.codigo_func, f.nome AS nome_func, r.id_tarefa, r.nome_tarefa, r.data_inicio,
       COALESCE(t.tempo_maximo_min, 240) AS tempo_maximo_min,
       CAST((julianday('now') - julianday(r.data_inicio)) * 1440 AS INTEGER) AS minutos_decorridos,
       CASE WHEN (julianday('now') - julianday(r.data_inicio)) * 1440 >= COALESCE(t.tempo_maximo_min, 240)
            THEN 1 ELSE 0 END AS vencida
FROM registros r
LEFT JOIN tarefas t ON t.id_tarefa = r.id_tarefa
LEFT JOIN funcionarios f ON f.codigo = r.codigo_func
WHERE r.status = 'em_andamento';

-- Situacao de cada coletor (painel do ADM)
DROP VIEW IF EXISTS vw_coletores_situacao;
CREATE VIEW vw_coletores_situacao AS
SELECT c.coletor, c.ativo, c.em_conserto, c.responsavel AS cod_fun, f.nome AS nome, c.desde,
       CASE WHEN c.responsavel IS NULL THEN 1 ELSE 0 END AS na_base,
       CASE WHEN c.desde IS NOT NULL AND c.responsavel IS NOT NULL
            THEN CAST((julianday('now') - julianday(c.desde)) * 1440 AS INTEGER) END AS minutos_fora
FROM coletores c
LEFT JOIN funcionarios f ON f.codigo = c.responsavel;

-- Base da exportacao (ADM): uma linha por tarefa finalizada.
-- qtd_itens = parte da carga de cada pessoa (volumes_proporcionais); se ainda nao
-- calculado e a pessoa carregou sozinha, usa o total da carga.
DROP VIEW IF EXISTS vw_exportacao;
CREATE VIEW vw_exportacao AS
SELECT r.id_registro, r.nome_tarefa, r.codigo_func,
       COALESCE(NULLIF(f.nome_completo, ''), f.nome, r.codigo_func) AS nome_funcionario,
       r.data_inicio, r.data_fim,
       (julianday(r.data_fim) - julianday(r.data_inicio)) AS duracao_dias,
       CASE WHEN c.id IS NULL THEN 0
            ELSE COALESCE(r.volumes_proporcionais,
                          CASE WHEN (SELECT COUNT(*) FROM cargas c2 WHERE c2.numero_carga = c.numero_carga) = 1
                                    AND c.ajudante = 0 THEN c.qtd_volumes END,
                          0) END AS qtd_itens
FROM registros r
LEFT JOIN funcionarios f ON f.codigo = r.codigo_func
LEFT JOIN cargas c ON c.id = (SELECT MIN(x.id) FROM cargas x WHERE x.id_registro = r.id_registro)
WHERE r.status = 'finalizada' AND r.data_fim IS NOT NULL AND r.data_fim >= r.data_inicio;

-- Tarefas do WMS com o nome do funcionario no nosso cadastro
DROP VIEW IF EXISTS vw_wms_tarefas;
CREATE VIEW vw_wms_tarefas AS
SELECT w.numero, w.tarefa, w.cod_aplicacao, a.nome AS aplicacao,
       w.codigo_func, COALESCE(f.nome, w.nome_func_wms) AS nome_func, w.cod_func_wms, w.nome_func_wms,
       w.endereco_inicial, w.deposito, w.predio, w.rua, w.posicao, w.andar,
       w.dt_aceite, w.dt_conclusao, w.execucao_seg, w.qtde_itens, w.qt_enderecos,
       substr(datetime(w.dt_aceite, '-3 hours'), 1, 10) AS dia
FROM wms_tarefas w
LEFT JOIN funcionarios f ON f.codigo = w.codigo_func
LEFT JOIN lkp_aplicacoes a ON a.cod_aplicacao = w.cod_aplicacao;

-- Resumo por dia (Brasilia), funcionario e tarefa
DROP VIEW IF EXISTS vw_wms_resumo_dia;
CREATE VIEW vw_wms_resumo_dia AS
SELECT dia, codigo_func, nome_func, tarefa,
       COUNT(*) AS qtd_tarefas,
       SUM(COALESCE(qtde_itens, 0)) AS itens,
       SUM(COALESCE(qt_enderecos, 0)) AS enderecos,
       SUM(COALESCE(execucao_seg, 0)) AS execucao_seg
FROM vw_wms_tarefas
GROUP BY dia, codigo_func, nome_func, tarefa;

-- Nomes finais de tarefa do WMS (para filtros)
DROP VIEW IF EXISTS lkp_tarefas_wms;
CREATE VIEW lkp_tarefas_wms AS
SELECT tarefa, COUNT(*) AS qtd FROM wms_tarefas GROUP BY tarefa;
