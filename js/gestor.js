// gestor.js - Logica do painel do gestor

const Gestor = {
  intervaloPainel: null,

  // Buscar dados do painel
  async buscarPainel(filtros) {
    try {
      let url = `${CONFIG.API_URL}?acao=painel_gestor`;

      if (filtros) {
        if (filtros.tarefa) url += `&filtro_tarefa=${encodeURIComponent(filtros.tarefa)}`;
        if (filtros.status) url += `&filtro_status=${encodeURIComponent(filtros.status)}`;
        if (filtros.data) url += `&filtro_data=${encodeURIComponent(filtros.data)}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      return await resposta.json();
    } catch (erro) {
      if (erro.name === 'AbortError') {
        return { sucesso: false, mensagem: 'Tempo de conexao esgotado.' };
      }
      return { sucesso: false, mensagem: 'Erro de conexao.' };
    }
  },

  // Buscar historico de registros
  async buscarHistorico(dataInicio, dataFim) {
    try {
      let url = `${CONFIG.API_URL}?acao=historico`;
      if (dataInicio) url += `&data_inicio=${encodeURIComponent(dataInicio)}`;
      if (dataFim) url += `&data_fim=${encodeURIComponent(dataFim)}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      return await resposta.json();
    } catch (erro) {
      if (erro.name === 'AbortError') {
        return { sucesso: false, mensagem: 'Tempo de conexao esgotado.' };
      }
      return { sucesso: false, mensagem: 'Erro de conexao.' };
    }
  },

  // Cadastrar novo funcionario
  async cadastrarFuncionario(dados) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(CONFIG.API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          acao: 'cadastrar_funcionario',
          ...dados
        })
      });
      clearTimeout(timeout);

      return await resposta.json();
    } catch (erro) {
      if (erro.name === 'AbortError') {
        return { sucesso: false, mensagem: 'Tempo de conexao esgotado.' };
      }
      return { sucesso: false, mensagem: 'Erro de conexao.' };
    }
  },

  // Cadastrar nova tarefa
  async cadastrarTarefa(dados) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(CONFIG.API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          acao: 'cadastrar_tarefa',
          ...dados
        })
      });
      clearTimeout(timeout);

      return await resposta.json();
    } catch (erro) {
      if (erro.name === 'AbortError') {
        return { sucesso: false, mensagem: 'Tempo de conexao esgotado.' };
      }
      return { sucesso: false, mensagem: 'Erro de conexao.' };
    }
  },

  // Buscar distribuicao de volumes de uma carga especifica
  async buscarDistribuicaoCarga(numeroCarga) {
    try {
      const url = `${CONFIG.API_URL}?acao=distribuicao_carga&numero_carga=${encodeURIComponent(numeroCarga)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      return await resposta.json();
    } catch (erro) {
      if (erro.name === 'AbortError') {
        return { sucesso: false, mensagem: 'Tempo de conexao esgotado.' };
      }
      return { sucesso: false, mensagem: 'Erro de conexao.' };
    }
  },

  // Renderizar lista de funcionarios no painel
  renderizarFuncionarios(containerId, funcionarios) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!funcionarios || funcionarios.length === 0) {
      container.innerHTML = '<div class="card text-center"><p>Nenhum funcionario encontrado.</p></div>';
      return;
    }

    const agora = Date.now();

    container.innerHTML = funcionarios.map(func => {
      let statusClasse = 'ocioso';
      let statusTexto = 'Ocioso';
      let tempoTexto = '';

      if (func.tarefa_atual) {
        const inicio = new Date(func.tarefa_atual.data_inicio).getTime();
        const diff = agora - inicio;

        if (diff >= CONFIG.TIMEOUT_MS) {
          statusClasse = 'timeout';
          statusTexto = `${func.tarefa_atual.nome_tarefa} (TIMEOUT)`;
        } else if (diff >= CONFIG.ALERTA_MS) {
          statusClasse = 'alerta';
          statusTexto = `${func.tarefa_atual.nome_tarefa} (ALERTA)`;
        } else {
          statusClasse = 'em-andamento';
          statusTexto = func.tarefa_atual.nome_tarefa;
        }

        tempoTexto = Tarefas.formatarDuracao(diff);

        // Indicar se ha carga associada
        if (func.tarefa_atual.carga) {
          statusTexto += ` - ${func.tarefa_atual.carga.numero_carga}`;
          if (func.tarefa_atual.carga.total_workers > 1) {
            statusTexto += ` (${func.tarefa_atual.carga.total_workers} trab.)`;
          }
        }
      }

      return `
        <div class="card func-card" data-codigo="${func.codigo}">
          <div class="status-dot ${statusClasse}"></div>
          <div class="func-info">
            <div class="func-name">${func.nome}</div>
            <div class="func-status">${statusTexto}</div>
          </div>
          ${tempoTexto ? `<div class="func-time">${tempoTexto}</div>` : ''}
        </div>
      `;
    }).join('');
  },

  // Renderizar historico em tabela
  renderizarHistorico(containerId, registros) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!registros || registros.length === 0) {
      container.innerHTML = '<div class="card text-center"><p>Nenhum registro encontrado.</p></div>';
      return;
    }

    let html = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Func.</th>
              <th>Tarefa</th>
              <th>Inicio</th>
              <th>Fim</th>
              <th>Status</th>
              <th>Carga</th>
              <th>Vol.</th>
            </tr>
          </thead>
          <tbody>
    `;

    html += registros.map(reg => {
      let badgeClass = 'badge-secondary';
      if (reg.status === 'em_andamento') badgeClass = 'badge-info';
      else if (reg.status === 'finalizada') badgeClass = 'badge-success';
      else if (reg.status === 'timeout') badgeClass = 'badge-danger';

      const inicio = reg.data_inicio ? new Date(reg.data_inicio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
      const fim = reg.data_fim ? new Date(reg.data_fim).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-';

      return `
        <tr>
          <td>${reg.codigo_func}</td>
          <td>${reg.nome_tarefa}</td>
          <td>${inicio}</td>
          <td>${fim}</td>
          <td><span class="badge ${badgeClass}">${reg.status}</span></td>
          <td>${reg.numero_carga || '-'}</td>
          <td>${reg.volumes_proporcionais != null ? reg.volumes_proporcionais : (reg.qtd_volumes || '-')}</td>
        </tr>
      `;
    }).join('');

    html += '</tbody></table></div>';
    container.innerHTML = html;
  },

  // Iniciar atualizacao automatica do painel
  iniciarAtualizacao(callback) {
    this.pararAtualizacao();
    this.intervaloPainel = setInterval(callback, CONFIG.INTERVALO_PAINEL_GESTOR);
  },

  // Parar atualizacao automatica
  pararAtualizacao() {
    if (this.intervaloPainel) {
      clearInterval(this.intervaloPainel);
      this.intervaloPainel = null;
    }
  }
};
