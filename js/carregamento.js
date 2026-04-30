// carregamento.js - Logica especifica do carregamento
// Suporta multiplos trabalhadores na mesma carga com distribuicao proporcional de volumes

const Carregamento = {
  intervaloWorkers: null,

  async registrarCarga(codigoFunc, idRegistro, numeroCarga, qtdVolumes, doca, ajudante) {
    return await API.get({
      acao: 'registrar_carga',
      codigo_func: codigoFunc,
      id_registro: idRegistro,
      numero_carga: numeroCarga,
      qtd_volumes: qtdVolumes,
      doca: doca || '',
      ajudante: ajudante ? 'true' : 'false'
    });
  },

  async buscarWorkersCarga(numeroCarga) {
    return await API.get({
      acao: 'workers_carga',
      numero_carga: numeroCarga
    });
  },

  calcularDistribuicao(workers, totalVolumes, temAjudante) {
    if (!workers || workers.length === 0) return [];

    const agora = Date.now();

    const mapaWorkers = {};
    workers.forEach(w => {
      if (w.status === 'timeout') return;

      const cod = (w.codigo_func || '').toString().trim().toUpperCase();
      const inicio = new Date(w.data_inicio).getTime();
      const fim = w.status === 'finalizada' ? new Date(w.data_fim).getTime() : agora;
      const tempo = Math.max(fim - inicio, 60000);

      if (!mapaWorkers[cod]) {
        mapaWorkers[cod] = {
          codigo_func: w.codigo_func,
          nome_func: w.nome_func || w.codigo_func,
          tempo_ms: 0,
          status: w.status
        };
      }

      mapaWorkers[cod].tempo_ms += tempo;
      if (w.status === 'finalizada') mapaWorkers[cod].status = 'finalizada';
    });

    const validos = Object.values(mapaWorkers);
    const finalizados = validos.filter(w => w.status === 'finalizada');
    const emAndamento = validos.filter(w => w.status === 'em_andamento');
    // Se algum worker ainda esta ativo, incluir todos; senao usar apenas os finalizados
    const paraCalculo = emAndamento.length > 0 ? validos : finalizados;

    if (paraCalculo.length === 0) return [];

    // Se tem ajudante, adicionar worker virtual com tempo integral da carga
    if (temAjudante) {
      let menorInicio = Infinity;
      let maiorFim = 0;
      workers.forEach(w => {
        if (w.status === 'timeout') return;
        const ini = new Date(w.data_inicio).getTime();
        const fi = w.status === 'finalizada' ? new Date(w.data_fim).getTime() : agora;
        if (ini < menorInicio) menorInicio = ini;
        if (fi > maiorFim) maiorFim = fi;
      });
      const tempoAjudante = Math.max(maiorFim - menorInicio, 60000);
      paraCalculo.push({
        codigo_func: 'AJUDANTE',
        nome_func: 'Ajudante',
        tempo_ms: tempoAjudante,
        status: finalizados.length > 0 ? 'finalizada' : 'em_andamento'
      });
    }

    const tempoTotal = paraCalculo.reduce((acc, w) => acc + w.tempo_ms, 0);

    let volumesDistribuidos = 0;
    return paraCalculo.map((w, index) => {
      let volumesProporcional;
      if (index === paraCalculo.length - 1) {
        volumesProporcional = totalVolumes - volumesDistribuidos;
      } else {
        volumesProporcional = Math.round((w.tempo_ms / tempoTotal) * totalVolumes);
        volumesDistribuidos += volumesProporcional;
      }
      return {
        codigo_func: w.codigo_func,
        nome_func: w.nome_func || w.codigo_func,
        tempo_ms: w.tempo_ms,
        tempo_formatado: Tarefas.formatarDuracao(w.tempo_ms),
        volumes_proporcionais: volumesProporcional,
        percentual: ((w.tempo_ms / tempoTotal) * 100).toFixed(1),
        status: w.status
      };
    });
  },

  renderizarWorkers(containerId, workers, totalVolumes, temAjudante) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!workers || workers.length <= 1) {
      if (!temAjudante) {
        if (!workers || workers.length === 0 || workers[0].status === 'timeout') {
          container.innerHTML = '';
          container.classList.add('hidden');
          return;
        }
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
      }
    }

    container.classList.remove('hidden');

    const distribuicao = this.calcularDistribuicao(workers, totalVolumes, temAjudante);
    const cores = ['#1a73e8', '#0d9f6e', '#f59e0b', '#8b5cf6', '#ec4899'];

    // Barra mostra apenas os validos (distribuicao)
    let barraHtml = distribuicao.map((w, i) => {
      const cor = cores[i % cores.length];
      return `<div class="bar-segment" style="width:${w.percentual}%;background:${cor}">${w.volumes_proporcionais}</div>`;
    }).join('');

    // Legenda: validos com volumes + timeout riscado/excluido
    const validosSet = new Set(distribuicao.map(w => w.codigo_func));
    let legendaHtml = '';

    distribuicao.forEach((w, i) => {
      const cor = cores[i % cores.length];
      legendaHtml += `
        <div class="legend-item">
          <span class="legend-name">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${cor};margin-right:6px;"></span>
            ${w.nome_func} (${w.tempo_formatado})
          </span>
          <span class="legend-value">${w.volumes_proporcionais} vol. (${w.percentual}%)</span>
        </div>
      `;
    });

    // Adicionar workers com timeout como excluidos
    workers.filter(w => w.status === 'timeout').forEach(w => {
      legendaHtml += `
        <div class="legend-item" style="opacity:0.5;text-decoration:line-through;">
          <span class="legend-name">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;margin-right:6px;"></span>
            ${w.nome_func || w.codigo_func} (timeout)
          </span>
          <span class="legend-value" style="color:#ef4444;">excluído</span>
        </div>
      `;
    });

    const totalWorkers = workers ? workers.length : 0;
    const excluidos = workers ? workers.filter(w => w.status === 'timeout').length : 0;
    const numParticipantes = distribuicao.length;
    const titulo = excluidos > 0
      ? `Distribuição (${totalWorkers - excluidos} válidos${temAjudante ? ' + ajudante' : ''}, ${excluidos} excluído por timeout)`
      : `Distribuição de Volumes (${numParticipantes} participantes${temAjudante ? ', incl. ajudante' : ''})`;

    container.innerHTML = `
      <div class="volume-distribution">
        <div class="dist-title">${titulo}</div>
        ${barraHtml ? `<div class="volume-bar">${barraHtml}</div>` : ''}
        <div class="volume-legend">${legendaHtml}</div>
      </div>
    `;
  },

  iniciarMonitoramento(numeroCarga, totalVolumes, containerId) {
    this.pararMonitoramento();

    const atualizar = async () => {
      const resultado = await this.buscarWorkersCarga(numeroCarga);
      if (resultado.sucesso && resultado.dados) {
        this.renderizarWorkers(containerId, resultado.dados.workers, totalVolumes, resultado.dados.tem_ajudante);
      }
    };

    atualizar();
    this.intervaloWorkers = setInterval(atualizar, CONFIG.INTERVALO_VERIFICAR_CARGA);
  },

  pararMonitoramento() {
    if (this.intervaloWorkers) {
      clearInterval(this.intervaloWorkers);
      this.intervaloWorkers = null;
    }
  }
};
