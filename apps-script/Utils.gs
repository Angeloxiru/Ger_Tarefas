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

// Buscar nome da doca pelo codigo na aba Docas
function buscarNomeDoca(codigoDoca) {
  if (!codigoDoca) return '';
  try {
    var sheet = getSheet('Docas');
    var dados = sheet.getDataRange().getValues();
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

// Buscar mapa de nomes de funcionarios
function buscarMapaNomes() {
  var sheet = getSheet('Funcionarios');
  var dados = sheet.getDataRange().getValues();
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
    sheetCargas.appendRow(['id_registro', 'codigo_func', 'numero_carga', 'qtd_volumes', 'doca', 'data_leitura', 'ajudante']);
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
