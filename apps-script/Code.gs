// Code.gs - Roteador principal (doGet / doPost)
// Este arquivo deve ser copiado para o Google Apps Script

// ID da planilha Google Sheets
var SPREADSHEET_ID = '1sChUfWfpYeSM8povUqwQQT0WbsxVyniMlZSa7AOdb5Y';

// Versao do backend. Bumpe a cada mudanca no Apps Script publicada.
// Consulte com: <API_URL>?acao=versao — mostra qual codigo o /exec esta executando.
var BACKEND_VERSION = 'abertas-7';

function doGet(e) {
  var acao = e.parameter.acao;
  var resultado;

  try {
    switch (acao) {
      case 'versao':
        // Diagnostico: confirma qual codigo a implantacao (/exec) esta servindo.
        // Se retornar "Ação desconhecida", a implantacao esta rodando codigo antigo.
        // Alem da versao, inspeciona (via Function.toString) qual DEFINICAO das funcoes
        // criticas esta ativa — pega o caso de funcao duplicada em arquivo antigo que
        // sobrescreve a nova (doGet novo convivendo com Tarefas_iniciar antigo).
        var diag = { versao_backend: BACKEND_VERSION };
        try {
          diag.iniciar_grava_em = (Tarefas_iniciar.toString().indexOf('RegistrosAbertos') >= 0) ? 'RegistrosAbertos (novo)' : 'Registros (ANTIGO)';
        } catch (er1) { diag.iniciar_grava_em = 'ERRO: ' + er1.message; }
        try {
          diag.finalizar_le_de = (Tarefas_finalizar.toString().indexOf('RegistrosAbertos') >= 0) ? 'RegistrosAbertos (novo)' : 'Registros (ANTIGO)';
        } catch (er2) { diag.finalizar_le_de = 'ERRO: ' + er2.message; }
        try {
          diag.status_le_de = (Tarefas_statusFuncionario.toString().indexOf('RegistrosAbertos') >= 0) ? 'RegistrosAbertos (novo)' : 'Registros (ANTIGO)';
        } catch (er3) { diag.status_le_de = 'ERRO: ' + er3.message; }
        try {
          diag.timeout_le_de = (verificarTimeouts.toString().indexOf('RegistrosAbertos') >= 0) ? 'RegistrosAbertos (novo)' : 'Registros (ANTIGO)';
        } catch (er4) { diag.timeout_le_de = 'ERRO: ' + er4.message; }
        resultado = { sucesso: true, dados: diag };
        break;

      case 'verificar_cracha':
        resultado = Auth_verificarCracha(e.parameter.codigo);
        break;

      case 'login':
        resultado = Auth_login(e.parameter.codigo, e.parameter.senha);
        break;

      case 'listar_tarefas':
        resultado = Tarefas_listar();
        break;

      case 'status_funcionario':
        resultado = Tarefas_statusFuncionario(e.parameter.codigo);
        break;

      case 'painel_gestor':
        resultado = Gestor_painel(e.parameter);
        break;

      case 'historico':
        resultado = Gestor_historico(e.parameter);
        break;

      case 'verificar_doca':
        resultado = verificarDoca(e.parameter.codigo);
        break;

      case 'workers_carga':
        resultado = Carregamento_workersCarga(e.parameter.numero_carga);
        break;

      case 'distribuicao_carga':
        resultado = Carregamento_distribuicao(e.parameter.numero_carga);
        break;

      // Acoes POST via GET (fallback CORS)
      case 'iniciar_tarefa':
        resultado = Tarefas_iniciar(e.parameter.codigo_func, e.parameter.id_tarefa);
        break;

      case 'finalizar_tarefa':
        resultado = Tarefas_finalizar(e.parameter.codigo_func, e.parameter.id_registro);
        break;

      case 'registrar_carga':
        resultado = Carregamento_registrar(e.parameter);
        break;

      case 'registrar_alerta':
        resultado = Gestor_registrarAlerta(e.parameter);
        break;

      case 'listar_alertas':
        resultado = Gestor_listarAlertas(e.parameter.codigo_func);
        break;

      case 'raiox':
        resultado = Gestor_raiox(e.parameter);
        break;

      case 'cadastrar_funcionario':
        resultado = Gestor_cadastrarFuncionario(e.parameter);
        break;

      case 'cadastrar_tarefa':
        resultado = Gestor_cadastrarTarefa({
          nome: e.parameter.nome,
          usa_qrcode_carga: e.parameter.usa_qrcode_carga === 'true',
          tempo_maximo_min: parseInt(e.parameter.tempo_maximo_min, 10) || 240
        });
        break;

      default:
        resultado = { sucesso: false, mensagem: 'Ação desconhecida: ' + acao };
    }
  } catch (erro) {
    resultado = { sucesso: false, mensagem: 'Erro interno: ' + erro.message };
  }

  return responder(resultado, e.parameter.callback);
}

function doPost(e) {
  var resultado;

  try {
    var dados = JSON.parse(e.postData.contents);
    var acao = dados.acao;

    switch (acao) {
      case 'iniciar_tarefa':
        resultado = Tarefas_iniciar(dados.codigo_func, dados.id_tarefa);
        break;

      case 'finalizar_tarefa':
        resultado = Tarefas_finalizar(dados.codigo_func, dados.id_registro);
        break;

      case 'registrar_carga':
        resultado = Carregamento_registrar(dados);
        break;

      case 'registrar_alerta':
        resultado = Gestor_registrarAlerta(dados);
        break;

      case 'cadastrar_funcionario':
        resultado = Gestor_cadastrarFuncionario(dados);
        break;

      case 'cadastrar_tarefa':
        resultado = Gestor_cadastrarTarefa(dados);
        break;

      default:
        resultado = { sucesso: false, mensagem: 'Ação POST desconhecida: ' + acao };
    }
  } catch (erro) {
    resultado = { sucesso: false, mensagem: 'Erro interno: ' + erro.message };
  }

  return responder(resultado);
}

// Funcao auxiliar para retornar resposta - suporta JSONP quando callback informado
function responder(dados, callback) {
  var json = JSON.stringify(dados);

  if (callback) {
    // JSONP: retorna como JavaScript executavel
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
