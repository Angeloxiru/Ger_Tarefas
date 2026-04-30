// tarefas.js - Logica de iniciar/finalizar tarefas

const Tarefas = {
  intervaloCronometro: null,
  intervaloCarga: null,

  async listarTarefas() {
    const chave = 'cache_tarefas';
    try {
      const cached = sessionStorage.getItem(chave);
      if (cached) {
        const { dados, expira } = JSON.parse(cached);
        if (Date.now() < expira) return { sucesso: true, dados };
      }
    } catch (e) {}

    const resp = await API.get({ acao: 'listar_tarefas' });

    if (resp.sucesso && resp.dados) {
      try {
        sessionStorage.setItem(chave, JSON.stringify({
          dados: resp.dados,
          expira: Date.now() + 10 * 60 * 1000 // 10 minutos
        }));
      } catch (e) {}
    }

    return resp;
  },

  async verificarStatus(codigoFunc) {
    return await API.get({
      acao: 'status_funcionario',
      codigo: codigoFunc
    });
  },

  async iniciarTarefa(codigoFunc, idTarefa) {
    return await API.get({
      acao: 'iniciar_tarefa',
      codigo_func: codigoFunc,
      id_tarefa: idTarefa
    });
  },

  async finalizarTarefa(codigoFunc, idRegistro) {
    return await API.get({
      acao: 'finalizar_tarefa',
      codigo_func: codigoFunc,
      id_registro: idRegistro
    });
  },

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

      elemento.classList.remove('verde', 'amarelo', 'vermelho');
      if (diff >= CONFIG.TIMEOUT_MS) {
        elemento.classList.add('vermelho');
      } else if (diff >= CONFIG.ALERTA_MS) {
        elemento.classList.add('amarelo');
      } else {
        elemento.classList.add('verde');
      }

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

  pararCronometro() {
    if (this.intervaloCronometro) {
      clearInterval(this.intervaloCronometro);
      this.intervaloCronometro = null;
    }
  },

  pararVerificacaoCarga() {
    if (this.intervaloCarga) {
      clearInterval(this.intervaloCarga);
      this.intervaloCarga = null;
    }
  },

  formatarDuracao(ms) {
    const horas = Math.floor(ms / 3600000);
    const minutos = Math.floor((ms % 3600000) / 60000);

    if (horas > 0) {
      return `${horas}h ${minutos}min`;
    }
    return `${minutos}min`;
  }
};
