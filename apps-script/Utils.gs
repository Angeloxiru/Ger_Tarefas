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

  // Aba "quente": guarda APENAS as tarefas em andamento (poucas linhas).
  // Os caminhos de alta frequencia (status, iniciar, painel, timeout) leem so daqui,
  // evitando varrer o historico inteiro a cada requisicao. Mesma ordem de colunas de Registros.
  var sheetRegAbertos = criarAbaSeNecessario(ss, 'RegistrosAbertos');
  if (sheetRegAbertos.getLastRow() === 0) {
    sheetRegAbertos.appendRow(['id_registro', 'codigo_func', 'id_tarefa', 'nome_tarefa', 'data_inicio', 'data_fim', 'status', 'finalizado_por']);
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

// Indexa os registros por id_registro unindo o historico (Registros) e os abertos
// (RegistrosAbertos). Retorna { id: { data_inicio, data_fim, status } }.
// Necessario nos calculos de carga, que podem envolver workers ja finalizados
// (no historico) e outros ainda em andamento (na aba quente) ao mesmo tempo.
function _indexarRegistrosPorId() {
  var mapa = {};
  var fontes = ['Registros', 'RegistrosAbertos'];
  for (var s = 0; s < fontes.length; s++) {
    var d = getSheet(fontes[s]).getDataRange().getValues();
    var h = d[0];
    var iId = h.indexOf('id_registro');
    var iIni = h.indexOf('data_inicio');
    var iFim = h.indexOf('data_fim');
    var iSt = h.indexOf('status');
    for (var x = 1; x < d.length; x++) {
      var id = d[x][iId];
      if (id !== '' && id !== null && mapa[id] === undefined) {
        mapa[id] = { data_inicio: d[x][iIni], data_fim: d[x][iFim], status: d[x][iSt] };
      }
    }
  }
  return mapa;
}

// Mover um registro da aba quente (RegistrosAbertos) para o historico (Registros),
// finalizando-o. Centraliza o encerramento usado por finalizar_tarefa e pelo timeout.
// Usa lock para evitar que dois processos movam a mesma linha (duplicidade).
// Grava primeiro no historico e so entao remove da aba de abertas: se algo falhar
// no meio, o pior caso e uma duplicata recuperavel, nunca perda do registro.
// Retorna os dados basicos do registro movido, ou null se ele nao existir mais em aberto.
function moverParaHistorico(idRegistro, dataFim, status, finalizadoPor, codigoFuncEsperado) {
  var lock = LockService.getScriptLock();
  var temLock = false;
  try { lock.waitLock(20000); temLock = true; } catch (e) {}

  try {
    var sheetAbertas = getSheet('RegistrosAbertos');
    var dadosAb = sheetAbertas.getDataRange().getValues();
    var hAb = dadosAb[0];
    var abId = hAb.indexOf('id_registro');
    var abCodFunc = hAb.indexOf('codigo_func');

    var linhaAb = -1;
    for (var i = 1; i < dadosAb.length; i++) {
      if (dadosAb[i][abId] === idRegistro) {
        // Se informado, so move se a linha pertencer ao funcionario esperado
        if (codigoFuncEsperado &&
            String(dadosAb[i][abCodFunc]).trim().toUpperCase() !== String(codigoFuncEsperado).trim().toUpperCase()) {
          return null;
        }
        linhaAb = i;
        break;
      }
    }
    if (linhaAb === -1) return null;

    var rowAb = dadosAb[linhaAb];

    // Montar a linha do historico respeitando a ordem de colunas da aba Registros
    var sheetReg = getSheet('Registros');
    var hReg = sheetReg.getRange(1, 1, 1, sheetReg.getLastColumn()).getValues()[0];

    var novaLinha = [];
    for (var c = 0; c < hReg.length; c++) {
      var nomeCol = hReg[c];
      if (nomeCol === 'data_fim') {
        novaLinha.push(dataFim);
      } else if (nomeCol === 'status') {
        novaLinha.push(status);
      } else if (nomeCol === 'finalizado_por') {
        novaLinha.push(finalizadoPor);
      } else {
        var idxOrigem = hAb.indexOf(nomeCol);
        novaLinha.push(idxOrigem >= 0 ? rowAb[idxOrigem] : '');
      }
    }

    sheetReg.appendRow(novaLinha);
    sheetAbertas.deleteRow(linhaAb + 1);

    return {
      id_registro: idRegistro,
      codigo_func: rowAb[hAb.indexOf('codigo_func')],
      id_tarefa: rowAb[hAb.indexOf('id_tarefa')],
      nome_tarefa: rowAb[hAb.indexOf('nome_tarefa')],
      data_inicio: formatarData(rowAb[hAb.indexOf('data_inicio')])
    };
  } finally {
    if (temLock) { try { lock.releaseLock(); } catch (e) {} }
  }
}

// Migracao unica: mover as tarefas em andamento que ja existem na aba Registros
// para a aba RegistrosAbertos. Executar UMA vez, apos criar a aba (inicializarPlanilha),
// ao migrar uma planilha existente para esta versao. Idempotente: rodar de novo nao duplica
// (nao havera mais linhas em_andamento em Registros depois da primeira execucao).
function migrarRegistrosAbertos() {
  var sheetReg = getSheet('Registros');
  var dados = sheetReg.getDataRange().getValues();
  var h = dados[0];
  var idxStatus = h.indexOf('status');

  var sheetAbertas = getSheet('RegistrosAbertos');
  var hAb = sheetAbertas.getRange(1, 1, 1, sheetAbertas.getLastColumn()).getValues()[0];

  var linhasParaRemover = [];
  var movidos = 0;
  for (var i = 1; i < dados.length; i++) {
    if (dados[i][idxStatus] === 'em_andamento') {
      var novaLinha = [];
      for (var c = 0; c < hAb.length; c++) {
        var idxOrigem = h.indexOf(hAb[c]);
        novaLinha.push(idxOrigem >= 0 ? dados[i][idxOrigem] : '');
      }
      sheetAbertas.appendRow(novaLinha);
      linhasParaRemover.push(i + 1);
      movidos++;
    }
  }
  // Remover de baixo pra cima para nao baguncar os indices
  for (var r = linhasParaRemover.length - 1; r >= 0; r--) {
    sheetReg.deleteRow(linhasParaRemover[r]);
  }
  Logger.log('Migracao concluida: ' + movidos + ' registro(s) em andamento movido(s) para RegistrosAbertos.');
  return movidos;
}

// Diagnostico de consistencia (rodar no editor). Reporta:
// - quantas linhas em_andamento AINDA estao na aba Registros (deveria ser 0 no modelo novo)
// - quantas linhas existem em RegistrosAbertos
// Se houver em_andamento em Registros, rode migrarRegistrosAbertos() para mover.
function verificarConsistencia() {
  var dadosReg = getSheet('Registros').getDataRange().getValues();
  var hReg = dadosReg[0];
  var idxStatusReg = hReg.indexOf('status');
  var emAndamentoNoHistorico = 0;
  for (var i = 1; i < dadosReg.length; i++) {
    if (dadosReg[i][idxStatusReg] === 'em_andamento') emAndamentoNoHistorico++;
  }

  var abertas = getSheet('RegistrosAbertos').getLastRow() - 1; // menos o cabecalho
  if (abertas < 0) abertas = 0;

  var msg = 'Consistencia: ' + emAndamentoNoHistorico + ' em_andamento presos em Registros | ' +
            abertas + ' linha(s) em RegistrosAbertos.' +
            (emAndamentoNoHistorico > 0 ? ' >> Rode migrarRegistrosAbertos() para corrigir.' : ' >> OK.');
  Logger.log(msg);
  return { em_andamento_em_registros: emAndamentoNoHistorico, linhas_em_abertos: abertas };
}
