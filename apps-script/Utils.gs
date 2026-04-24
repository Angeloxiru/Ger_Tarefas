// Utils.gs - Funcoes auxiliares

// Obter referencia a uma aba da planilha
function getSheet(nomeAba) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(nomeAba);

  if (!sheet) {
    throw new Error('Aba "' + nomeAba + '" nao encontrada na planilha.');
  }

  return sheet;
}

// Formatar data para ISO string
function formatarData(data) {
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (data instanceof Date) return data.toISOString();
  return String(data);
}

// Obter valor de configuracao da aba Config
function getConfigValor(chave, valorPadrao) {
  try {
    var sheet = getSheet('Config');
    var dados = sheet.getDataRange().getValues();
    var headers = dados[0];

    var idxChave = headers.indexOf('chave');
    var idxValor = headers.indexOf('valor');

    for (var i = 1; i < dados.length; i++) {
      if (dados[i][idxChave] === chave) {
        return dados[i][idxValor];
      }
    }
  } catch (e) {
    Logger.log('Erro ao buscar config "' + chave + '": ' + e.message);
  }

  return valorPadrao;
}

// Gerar ID unico baseado em timestamp
function gerarId(prefixo, sufixo) {
  var agora = new Date();
  var timestamp = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  return (prefixo || '') + timestamp + (sufixo || '');
}

// Inicializar planilha com as abas necessarias (executar apenas uma vez)
function inicializarPlanilha() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Aba Funcionarios
  var sheetFunc = criarAbaSeNecessario(ss, 'Funcionarios');
  if (sheetFunc.getLastRow() === 0) {
    sheetFunc.appendRow(['codigo', 'nome', 'cargo', 'ativo', 'perfil', 'senha']);
  }

  // Aba Tarefas
  var sheetTarefas = criarAbaSeNecessario(ss, 'Tarefas');
  if (sheetTarefas.getLastRow() === 0) {
    sheetTarefas.appendRow(['id_tarefa', 'nome', 'usa_qrcode_carga', 'tempo_maximo_min', 'ativa']);
    // Tarefas iniciais
    sheetTarefas.appendRow(['T001', 'Carregamento', true, 240, true]);
    sheetTarefas.appendRow(['T002', 'Limpeza', false, 240, true]);
    sheetTarefas.appendRow(['T003', 'Conferencia', false, 240, true]);
    sheetTarefas.appendRow(['T004', 'Avarias', false, 240, true]);
  }

  // Aba Registros
  var sheetReg = criarAbaSeNecessario(ss, 'Registros');
  if (sheetReg.getLastRow() === 0) {
    sheetReg.appendRow(['id_registro', 'codigo_func', 'id_tarefa', 'nome_tarefa', 'data_inicio', 'data_fim', 'status', 'finalizado_por']);
  }

  // Aba Cargas
  var sheetCargas = criarAbaSeNecessario(ss, 'Cargas');
  if (sheetCargas.getLastRow() === 0) {
    sheetCargas.appendRow(['id_registro', 'codigo_func', 'numero_carga', 'qtd_volumes', 'doca', 'data_leitura']);
  }

  // Aba Config
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
