// gestor.js - Logica do painel do gestor

const Gestor = {
  intervaloPainel: null,

  async buscarPainel(filtros) {
    const params = { acao: 'painel_gestor' };
    if (filtros) {
      if (filtros.tarefa) params.filtro_tarefa = filtros.tarefa;
      if (filtros.status) params.filtro_status = filtros.status;
      if (filtros.data) params.filtro_data = filtros.data;
    }
    return await API.get(params);
  },

  async buscarHistorico(dataInicio, dataFim) {
    const params = { acao: 'historico' };
    if (dataInicio) params.data_inicio = dataInicio;
    if (dataFim) params.data_fim = dataFim;
    return await API.get(params);
  },

  async cadastrarFuncionario(dados) {
    return await API.get({
      acao: 'cadastrar_funcionario',
      ...dados
    });
  },

  async cadastrarTarefa(dados) {
    return await API.get({
      acao: 'cadastrar_tarefa',
      nome: dados.nome,
      usa_qrcode_carga: String(dados.usa_qrcode_carga),
      tempo_maximo_min: String(dados.tempo_maximo_min)
    });
  },

  async buscarDistribuicaoCarga(numeroCarga) {
    return await API.get({
      acao: 'distribuicao_carga',
      numero_carga: numeroCarga
    });
  },

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

  iniciarAtualizacao(callback) {
    this.pararAtualizacao();
    this.intervaloPainel = setInterval(callback, CONFIG.INTERVALO_PAINEL_GESTOR);
  },

  pararAtualizacao() {
    if (this.intervaloPainel) {
      clearInterval(this.intervaloPainel);
      this.intervaloPainel = null;
    }
  }
};
