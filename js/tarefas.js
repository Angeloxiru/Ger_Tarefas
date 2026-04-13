// tarefas.js - Logica de iniciar/finalizar tarefas

const Tarefas = {
  intervaloCronometro: null,
  intervaloCarga: null,

  // Listar tarefas disponiveis
  async listarTarefas() {
    try {
      const url = `${CONFIG.API_URL}?acao=listar_tarefas`;
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

  // Verificar status do funcionario (se tem tarefa em andamento)
  async verificarStatus(codigoFunc) {
    try {
      const url = `${CONFIG.API_URL}?acao=status_funcionario&codigo=${encodeURIComponent(codigoFunc)}`;
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

  // Iniciar uma tarefa
  async iniciarTarefa(codigoFunc, idTarefa) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(CONFIG.API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          acao: 'iniciar_tarefa',
          codigo_func: codigoFunc,
          id_tarefa: idTarefa
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

  // Finalizar tarefa em andamento
  async finalizarTarefa(codigoFunc, idRegistro) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      const resposta = await fetch(CONFIG.API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          acao: 'finalizar_tarefa',
          codigo_func: codigoFunc,
          id_registro: idRegistro
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

  // Iniciar cronometro
  iniciarCronometro(dataInicio, elementoId) {
    const elemento = document.getElementById(elementoId);
    if (!elemento) return;

    const inicio = new Date(dataInicio).getTime();

    const atualizar = () => {
      const agora = Date.now();
      const diff = agora - inicio;

      const horas = Math.floor(diff / 3600000);
      const minutos = Math.floor((diff % 3600000) / 60000);
      const segundos = Math.floor((diff % 60000) / 1000);

      elemento.textContent =
        String(horas).padStart(2, '0') + ':' +
        String(minutos).padStart(2, '0') + ':' +
        String(segundos).padStart(2, '0');

      // Atualizar cor do cronometro
      elemento.classList.remove('verde', 'amarelo', 'vermelho');
      if (diff >= CONFIG.TIMEOUT_MS) {
        elemento.classList.add('vermelho');
      } else if (diff >= CONFIG.ALERTA_MS) {
        elemento.classList.add('amarelo');
      } else {
        elemento.classList.add('verde');
      }

      // Mostrar/esconder alerta de timeout
      const alerta = document.getElementById('alerta-timeout');
      if (alerta) {
        if (diff >= CONFIG.ALERTA_MS) {
          alerta.classList.add('visivel');
        } else {
          alerta.classList.remove('visivel');
        }
      }
    };

    atualizar();
    this.intervaloCronometro = setInterval(atualizar, CONFIG.INTERVALO_CRONOMETRO);
  },

  // Parar cronometro
  pararCronometro() {
    if (this.intervaloCronometro) {
      clearInterval(this.intervaloCronometro);
      this.intervaloCronometro = null;
    }
  },

  // Parar verificacao de carga
  pararVerificacaoCarga() {
    if (this.intervaloCarga) {
      clearInterval(this.intervaloCarga);
      this.intervaloCarga = null;
    }
  },

  // Formatar duracao em ms para texto legivel
  formatarDuracao(ms) {
    const horas = Math.floor(ms / 3600000);
    const minutos = Math.floor((ms % 3600000) / 60000);

    if (horas > 0) {
      return `${horas}h ${minutos}min`;
    }
    return `${minutos}min`;
  }
};
