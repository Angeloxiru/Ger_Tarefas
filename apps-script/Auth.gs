// Auth.gs - Funcoes de autenticacao

// Verifica se o cracha existe e se exige senha
function Auth_verificarCracha(codigo) {
  if (!codigo) {
    return { sucesso: false, mensagem: 'Código do crachá não informado.' };
  }

  codigo = codigo.trim().toUpperCase();

  var dados = getSheetDataCached('Funcionarios', 600);
  var headers = dados[0];

  var idxCodigo = headers.indexOf('codigo');
  var idxNome = headers.indexOf('nome');
  var idxAtivo = headers.indexOf('ativo');
  var idxSenha = headers.indexOf('senha');

  for (var i = 1; i < dados.length; i++) {
    var row = dados[i];
    if (String(row[idxCodigo]).trim().toUpperCase() === codigo) {
      if (!row[idxAtivo]) {
        return { sucesso: false, mensagem: 'Funcionário inativo. Procure o supervisor.' };
      }

      var temSenha = idxSenha >= 0 && String(row[idxSenha]).trim() !== '';

      return {
        sucesso: true,
        dados: {
          nome: row[idxNome],
          requer_senha: temSenha
        }
      };
    }
  }

  return { sucesso: false, mensagem: 'Crachá não encontrado. Verifique o código.' };
}

function Auth_login(codigo, senha) {
  if (!codigo) {
    return { sucesso: false, mensagem: 'Código do crachá não informado.' };
  }

  codigo = codigo.trim().toUpperCase();

  var dados = getSheetDataCached('Funcionarios', 600);
  var headers = dados[0];

  var idxCodigo = headers.indexOf('codigo');
  var idxNome = headers.indexOf('nome');
  var idxCargo = headers.indexOf('cargo');
  var idxAtivo = headers.indexOf('ativo');
  var idxPerfil = headers.indexOf('perfil');
  var idxSenha = headers.indexOf('senha');

  for (var i = 1; i < dados.length; i++) {
    var row = dados[i];
    if (String(row[idxCodigo]).trim().toUpperCase() === codigo) {
      if (!row[idxAtivo]) {
        return { sucesso: false, mensagem: 'Funcionário inativo. Procure o supervisor.' };
      }

      var senhaArmazenada = idxSenha >= 0 ? String(row[idxSenha]).trim() : '';
      if (senhaArmazenada !== '') {
        if (!senha || senha.trim() !== senhaArmazenada) {
          return { sucesso: false, mensagem: 'Senha incorreta.' };
        }
      }

      return {
        sucesso: true,
        dados: {
          codigo: String(row[idxCodigo]).trim(),
          nome: row[idxNome],
          cargo: row[idxCargo],
          perfil: row[idxPerfil] || 'funcionario'
        },
        mensagem: 'Login realizado com sucesso.'
      };
    }
  }

  return { sucesso: false, mensagem: 'Crachá não encontrado. Verifique o código.' };
}
