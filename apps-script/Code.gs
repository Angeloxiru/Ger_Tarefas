// Code.gs - Roteador principal (doGet / doPost)
// Este arquivo deve ser copiado para o Google Apps Script

// ID da planilha Google Sheets
var SPREADSHEET_ID = '1sChUfWfpYeSM8povUqwQQT0WbsxVyniMlZSa7AOdb5Y';

function doGet(e) {
  var acao = e.parameter.acao;
  var resultado;

  try {
    switch (acao) {
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
        resultado = { sucesso: false, mensagem: 'Acao desconhecida: ' + acao };
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

      case 'cadastrar_funcionario':
        resultado = Gestor_cadastrarFuncionario(dados);
        break;

      case 'cadastrar_tarefa':
        resultado = Gestor_cadastrarTarefa(dados);
        break;

      default:
        resultado = { sucesso: false, mensagem: 'Acao POST desconhecida: ' + acao };
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
