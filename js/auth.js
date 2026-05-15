// auth.js - Logica de login/logout

const Auth = {
  salvarSessao(funcionario) {
    sessionStorage.setItem('funcionario', JSON.stringify(funcionario));
  },

  marcarAtividade() {
    sessionStorage.setItem('atividade_ts', String(Date.now()));
  },

  // Verifica se o usuario ficou sem tarefa ativa por tempo demais e desloga.
  // temTarefaAtiva = true: reseta o timer (usuario esta trabalhando).
  // Retorna true se deslogou.
  verificarIdleLogout(temTarefaAtiva) {
    if (temTarefaAtiva) {
      this.marcarAtividade();
      return false;
    }
    const ts = parseInt(sessionStorage.getItem('atividade_ts') || '0', 10);
    if (ts === 0) {
      this.marcarAtividade();
      return false;
    }
    if ((Date.now() - ts) > CONFIG.IDLE_LOGOUT_MS) {
      sessionStorage.clear();
      window.location.href = 'index.html?motivo=inatividade';
      return true;
    }
    return false;
  },

  obterSessao() {
    const dados = sessionStorage.getItem('funcionario');
    return dados ? JSON.parse(dados) : null;
  },

  estaLogado() {
    return this.obterSessao() !== null;
  },

  eGestor() {
    const func = this.obterSessao();
    return func && func.perfil === 'gestor';
  },

  logout() {
    sessionStorage.clear();
    window.location.href = 'index.html';
  },

  async login(codigo, senha) {
    const dados = await API.get({
      acao: 'login',
      codigo: codigo.trim().toUpperCase(),
      senha: senha
    });

    if (dados.sucesso) {
      this.salvarSessao(dados.dados);
      this.marcarAtividade();

      if (dados.dados.perfil === 'gestor') {
        window.location.href = 'gestor.html';
      } else {
        window.location.href = 'painel.html';
      }
    }

    return dados;
  },

  verificarAuth(paginaAtual) {
    if (!this.estaLogado()) {
      window.location.href = 'index.html';
      return false;
    }

    const func = this.obterSessao();

    if (paginaAtual === 'painel' && func.perfil === 'gestor') {
      window.location.href = 'gestor.html';
      return false;
    }

    if (paginaAtual === 'gestor' && func.perfil !== 'gestor') {
      window.location.href = 'painel.html';
      return false;
    }

    return true;
  },

  atualizarHeader() {
    const func = this.obterSessao();
    if (!func) return;

    const userInfo = document.querySelector('.user-info');
    if (userInfo) {
      userInfo.textContent = func.nome;
    }

    const btnLogout = document.querySelector('.btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => this.logout());
    }
  }
};
