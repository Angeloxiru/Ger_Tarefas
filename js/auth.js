// auth.js - Logica de login/logout

const Auth = {
  // Salvar dados do funcionario na sessao
  salvarSessao(funcionario) {
    sessionStorage.setItem('funcionario', JSON.stringify(funcionario));
  },

  // Obter dados do funcionario da sessao
  obterSessao() {
    const dados = sessionStorage.getItem('funcionario');
    return dados ? JSON.parse(dados) : null;
  },

  // Verificar se esta logado
  estaLogado() {
    return this.obterSessao() !== null;
  },

  // Verificar se e gestor
  eGestor() {
    const func = this.obterSessao();
    return func && func.perfil === 'gestor';
  },

  // Fazer logout
  logout() {
    sessionStorage.removeItem('funcionario');
    window.location.href = 'index.html';
  },

  // Fazer login via API
  async login(codigo) {
    try {
      const url = `${CONFIG.API_URL}?acao=login&codigo=${encodeURIComponent(codigo.trim().toUpperCase())}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      const dados = await resposta.json();

      if (dados.sucesso) {
        this.salvarSessao(dados.dados);

        if (dados.dados.perfil === 'gestor') {
          window.location.href = 'gestor.html';
        } else {
          window.location.href = 'painel.html';
        }
      }

      return dados;
    } catch (erro) {
      if (erro.name === 'AbortError') {
        return { sucesso: false, mensagem: 'Tempo de conexao esgotado. Verifique sua rede.' };
      }
      return { sucesso: false, mensagem: 'Erro de conexao. Verifique sua rede WiFi.' };
    }
  },

  // Verificar autenticacao e redirecionar se necessario
  verificarAuth(paginaAtual) {
    if (!this.estaLogado()) {
      window.location.href = 'index.html';
      return false;
    }

    const func = this.obterSessao();

    // Se gestor tentando acessar pagina de funcionario
    if (paginaAtual === 'painel' && func.perfil === 'gestor') {
      window.location.href = 'gestor.html';
      return false;
    }

    // Se funcionario tentando acessar pagina de gestor
    if (paginaAtual === 'gestor' && func.perfil !== 'gestor') {
      window.location.href = 'painel.html';
      return false;
    }

    return true;
  },

  // Atualizar header com informacoes do usuario
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
