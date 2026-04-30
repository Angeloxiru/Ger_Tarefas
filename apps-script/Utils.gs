// Utils.gs - Funcoes auxiliares

// Singleton: abre a planilha uma unica vez por execucao do GAS
var _ss = null;
function getSpreadsheet() {
  if (!_ss) _ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return _ss;
}

// Obter referencia a uma aba da planilha
function getSheet(nomeAba) {
  var sheet = getSpreadsheet().getSheetByName(nomeAba);
  if (!sheet) {
    throw new Error('Aba "' + nomeAba + '" nao encontrada na planilha.');
  }
  return sheet;
}

// Ler dados de uma aba com cache (CacheService, TTL em segundos)
// Usar apenas para abas que mudam raramente: Funcionarios, Tarefas, Docas, Config
function getSheetDataCached(nomeAba, ttlSegundos) {
  var cache = CacheService.getScriptCache();
  var chave = 'sheet_' + nomeAba;
  var cached = cache.get(chave);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  var dados = getSheet(nomeAba).getDataRange().getValues();
  try {
    // CacheService tem limite de 100KB por entrada
    cache.put(chave, JSON.stringify(dados), ttlSegundos || 300);
  } catch (e) {
    Logger.log('Cache cheio para aba ' + nomeAba + ': ' + e.message);
  }
  return dados;
}

// Invalidar cache de uma aba (chamar apos escrita)
function invalidarCache(nomeAba) {
  CacheService.getScriptCache().remove('sheet_' + nomeAba);
}

// Formatar data para ISO string
function formatarData(data) {
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (data instanceof Date) return data.toISOString();
  return String(data);
}

// Obter valor de configuracao da aba Config (cache de 24h)
function getConfigValor(chave, valorPadrao) {
  try {
    var dados = getSheetDataCached('Config', 86400);
    var headers = dados[0];
    var idxChave = headers.indexOf('chave');
    var idxValor = headers.indexOf('valor');
    for (var i = 1; i < dados.length; i++) {
      if (dados[i][idxChave] === chave) return dados[i][idxValor];
    }
  } catch (e) {
    Logger.log('Erro ao buscar config "' + chave + '": ' + e.message);
  }
  return valorPadrao;
}

// Buscar nome da doca pelo codigo na aba Docas (cache de 1h)
function buscarNomeDoca(codigoDoca) {
  if (!codigoDoca) return '';
  try {
    var dados = getSheetDataCached('Docas', 3600);
    var headers = dados[0];
    var idxCodigo = headers.indexOf('codigo');
    var idxDoca = headers.indexOf('doca');
    var codigoBusca = String(codigoDoca).trim().toUpperCase();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][idxCodigo]).trim().toUpperCase() === codigoBusca) {
        return dados[i][idxDoca];
      }
    }
  } catch (e) {
    Logger.log('Erro ao buscar doca: ' + e.message);
  }
  return '';
}

// Buscar mapa de nomes de funcionarios (cache de 10min)
function buscarMapaNomes() {
  var dados = getSheetDataCached('Funcionarios', 600);
  var headers = dados[0];
  var idxCodigo = headers.indexOf('codigo');
  var idxNome = headers.indexOf('nome');
  var mapa = {};
  for (var i = 1; i < dados.length; i++) {
    mapa[String(dados[i][idxCodigo]).trim().toUpperCase()] = dados[i][idxNome];
  }
  return mapa;
}

// Verificar doca - endpoint
function verificarDoca(codigo) {
  if (!codigo) {
    return { sucesso: false, mensagem: 'Código da doca não informado.' };
  }
  var nome = buscarNomeDoca(codigo);
  if (!nome) {
    return { sucesso: false, mensagem: 'Doca não encontrada para o código: ' + codigo };
  }
  return { sucesso: true, dados: { codigo: codigo, nome: nome } };
}

// Gerar ID unico baseado em timestamp
function gerarId(prefixo, sufixo) {
  var agora = new Date();
  var timestamp = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  return (prefixo || '') + timestamp + (sufixo || '');
}

// Inicializar planilha com as abas necessarias (executar apenas uma vez)
function inicializarPlanilha() {
  var ss = getSpreadsheet();

  var sheetFunc = criarAbaSeNecessario(ss, 'Funcionarios');
  if (sheetFunc.getLastRow() === 0) {
    sheetFunc.appendRow(['codigo', 'nome', 'cargo', 'ativo', 'perfil', 'senha']);
  }

  var sheetTarefas = criarAbaSeNecessario(ss, 'Tarefas');
  if (sheetTarefas.getLastRow() === 0) {
    sheetTarefas.appendRow(['id_tarefa', 'nome', 'usa_qrcode_carga', 'tempo_maximo_min', 'ativa']);
    sheetTarefas.appendRow(['T001', 'Carregamento', true, 240, true]);
    sheetTarefas.appendRow(['T002', 'Limpeza', false, 240, true]);
    sheetTarefas.appendRow(['T003', 'Conferencia', false, 240, true]);
    sheetTarefas.appendRow(['T004', 'Avarias', false, 240, true]);
  }

  var sheetReg = criarAbaSeNecessario(ss, 'Registros');
  if (sheetReg.getLastRow() === 0) {
    sheetReg.appendRow(['id_registro', 'codigo_func', 'id_tarefa', 'nome_tarefa', 'data_inicio', 'data_fim', 'status', 'finalizado_por']);
  }

  var sheetCargas = criarAbaSeNecessario(ss, 'Cargas');
  if (sheetCargas.getLastRow() === 0) {
    sheetCargas.appendRow(['id_registro', 'codigo_func', 'numero_carga', 'qtd_volumes', 'doca', 'data_leitura', 'ajudante']);
  }

  var sheetConfig = criarAbaSeNecessario(ss, 'Config');
  if (sheetConfig.getLastRow() === 0) {
    sheetConfig.appendRow(['chave', 'valor']);
    sheetConfig.appendRow(['timeout_padrao_min', 240]);
    sheetConfig.appendRow(['intervalo_alerta_min', 180]);
    sheetConfig.appendRow(['versao_sistema', '1.0']);
  }

  Logger.log('Planilha inicializada com sucesso!');
}

// Criar aba se nao existir
function criarAbaSeNecessario(ss, nomeAba) {
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) {
    sheet = ss.insertSheet(nomeAba);
  }
  return sheet;
}
