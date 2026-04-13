// carregamento.js - Logica especifica do carregamento
// Suporta multiplos trabalhadores na mesma carga com distribuicao proporcional de volumes

const Carregamento = {
  intervaloWorkers: null,

  // Registrar leitura de QRcode de carga
  async registrarCarga(codigoFunc, idRegistro, numeroCarga, qtdVolumes) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(CONFIG.API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          acao: 'registrar_carga',
          codigo_func: codigoFunc,
          id_registro: idRegistro,
          numero_carga: numeroCarga,
          qtd_volumes: qtdVolumes
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

  // Buscar trabalhadores na mesma carga
  async buscarWorkersCarga(numeroCarga) {
    try {
      const url = `${CONFIG.API_URL}?acao=workers_carga&numero_carga=${encodeURIComponent(numeroCarga)}`;
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

  // Calcular distribuicao proporcional de volumes
  // Cada trabalhador recebe volumes proporcionais ao seu tempo de execucao
  calcularDistribuicao(workers, totalVolumes) {
    if (!workers || workers.length === 0) return [];

    const agora = Date.now();

    // Calcular tempo de cada worker
    const workersComTempo = workers.map(w => {
      const inicio = new Date(w.data_inicio).getTime();
      let fim;

      if (w.status === 'finalizada' || w.status === 'timeout') {
        fim = new Date(w.data_fim).getTime();
      } else {
        fim = agora;
      }

      const tempoMs = Math.max(fim - inicio, 60000); // Minimo 1 minuto
      return {
        ...w,
        tempo_ms: tempoMs
      };
    });

    // Calcular tempo total de todos os workers
    const tempoTotal = workersComTempo.reduce((acc, w) => acc + w.tempo_ms, 0);

    // Distribuir volumes proporcionalmente
    let volumesDistribuidos = 0;
    const resultado = workersComTempo.map((w, index) => {
      let volumesProporcional;

      // Ultimo worker recebe o restante para evitar erros de arredondamento
      if (index === workersComTempo.length - 1) {
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

    return resultado;
  },

  // Renderizar informacoes dos trabalhadores na mesma carga
  renderizarWorkers(containerId, workers, totalVolumes) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!workers || workers.length <= 1) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    const distribuicao = this.calcularDistribuicao(workers, totalVolumes);

    const cores = ['#1a73e8', '#0d9f6e', '#f59e0b', '#8b5cf6', '#ec4899'];

    let barraHtml = distribuicao.map((w, i) => {
      const cor = cores[i % cores.length];
      return `<div class="bar-segment" style="width:${w.percentual}%;background:${cor}">${w.volumes_proporcionais}</div>`;
    }).join('');

    let legendaHtml = distribuicao.map((w, i) => {
      const cor = cores[i % cores.length];
      return `
        <div class="legend-item">
          <span class="legend-name">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${cor};margin-right:6px;"></span>
            ${w.nome_func} (${w.tempo_formatado})
          </span>
          <span class="legend-value">${w.volumes_proporcionais} vol. (${w.percentual}%)</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="volume-distribution">
        <div class="dist-title">Distribuicao de Volumes (${workers.length} trabalhadores)</div>
        <div class="volume-bar">${barraHtml}</div>
        <div class="volume-legend">${legendaHtml}</div>
      </div>
    `;
  },

  // Iniciar monitoramento periodico de workers na carga
  iniciarMonitoramento(numeroCarga, totalVolumes, containerId) {
    this.pararMonitoramento();

    const atualizar = async () => {
      const resultado = await this.buscarWorkersCarga(numeroCarga);
      if (resultado.sucesso && resultado.dados) {
        this.renderizarWorkers(containerId, resultado.dados.workers, totalVolumes);
      }
    };

    atualizar();
    this.intervaloWorkers = setInterval(atualizar, CONFIG.INTERVALO_VERIFICAR_CARGA);
  },

  // Parar monitoramento
  pararMonitoramento() {
    if (this.intervaloWorkers) {
      clearInterval(this.intervaloWorkers);
      this.intervaloWorkers = null;
    }
  }
};
