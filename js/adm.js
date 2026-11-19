// adm.js - Telas exclusivas do perfil ADM (dentro do painel do gestor)
//
// - Coletores: situacao de cada coletor (antigo painel do Ger_Gestao_Coletores)
// - Irregularidades: ocorrencias dos coletores (antigo e-mail diario), guardadas por 45 dias
// - Exportacao: planilha .xlsx de tarefas finalizadas por periodo

const Adm = {
  _xlsxCarregado: false,

  _esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  _dataHora(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  },

  _hoje() {
    return Backend.util.diaSP(new Date());
  },

  // Mostra as abas do ADM e preenche as datas padrao
  iniciar() {
    if (!Auth.eAdm()) return;
    document.querySelectorAll('.tab-adm').forEach(el => el.classList.remove('hidden'));
    document.querySelector('.tabs').classList.add('tabs-adm');
    const hoje = this._hoje();
    ['adm-oc-inicio', 'adm-oc-fim', 'adm-exp-fim'].forEach(id => { document.getElementById(id).value = hoje; });
    document.getElementById('adm-exp-inicio').value = hoje.slice(0, 8) + '01';
  },

  // ---------------- Coletores ----------------
  async carregarColetores() {
    const el = document.getElementById('adm-coletores-lista');
    el.innerHTML = '<div class="loading visivel"><div class="spinner"></div><p>Carregando...</p></div>';
    const r = await API.get({ acao: 'adm_coletores' });
    if (!r.sucesso) {
      el.innerHTML = `<div class="msg msg-error">${this._esc(r.mensagem)}</div>`;
      return;
    }
    const fora = r.dados.filter(c => !c.na_base).length;
    const atrasados = r.dados.filter(c => !c.na_base && c.minutos_fora >= 360).length;
    el.innerHTML = `
      <div class="adm-resumo">
        <div class="card text-center"><div class="adm-num">${r.dados.length}</div><div class="adm-rot">Coletores</div></div>
        <div class="card text-center"><div class="adm-num verde">${r.dados.length - fora}</div><div class="adm-rot">Na base</div></div>
        <div class="card text-center"><div class="adm-num azul">${fora}</div><div class="adm-rot">Em uso</div></div>
        <div class="card text-center"><div class="adm-num vermelho">${atrasados}</div><div class="adm-rot">Mais de 6h</div></div>
      </div>
      <div class="table-wrapper"><table class="data-table">
        <thead><tr><th>Coletor</th><th>Situação</th><th>Desde</th><th>Tempo fora</th></tr></thead>
        <tbody>${r.dados.map(c => {
          const tempo = c.na_base ? '' : `${Math.floor(c.minutos_fora / 60)}h ${c.minutos_fora % 60}m`;
          const classe = c.na_base ? '' : (c.minutos_fora >= 360 ? 'badge-danger' : 'badge-warning');
          return `<tr>
            <td><strong>${this._esc(c.coletor)}</strong></td>
            <td>${c.na_base ? '<span class="badge badge-success">Base</span>' : `<span class="badge ${classe}">${this._esc(c.nome || c.cod_fun)}</span>`}</td>
            <td>${c.na_base ? '' : this._dataHora(c.desde)}</td>
            <td>${tempo}</td></tr>`;
        }).join('')}</tbody></table></div>`;
  },

  // ---------------- Irregularidades ----------------
  async carregarOcorrencias() {
    const el = document.getElementById('adm-oc-lista');
    const ini = document.getElementById('adm-oc-inicio').value;
    const fim = document.getElementById('adm-oc-fim').value;
    if (!ini || !fim) { el.innerHTML = '<div class="msg msg-warning">Informe as duas datas.</div>'; return; }
    el.innerHTML = '<div class="loading visivel"><div class="spinner"></div><p>Carregando...</p></div>';
    const r = await API.get({ acao: 'adm_ocorrencias', data_inicio: ini, data_fim: fim });
    if (!r.sucesso) { el.innerHTML = `<div class="msg msg-error">${this._esc(r.mensagem)}</div>`; return; }
    if (!r.dados.length) { el.innerHTML = '<div class="card text-center"><p>Nenhuma irregularidade no período.</p></div>'; return; }

    const rotulos = {
      leitura_errada: ['Leitura errada', 'badge-warning'], limite_tentativas: ['3 erros seguidos', 'badge-danger'],
      assumido: ['Coletor assumido', 'badge-info'], atraso_6h: ['Mais de 6h', 'badge-danger'], outro: ['Outro', 'badge-info']
    };
    el.innerHTML = `<p class="adm-contagem">${r.dados.length} registro(s). Guardados por 45 dias.</p>` + r.dados.map(o => {
      const [rot, cls] = rotulos[o.tipo] || rotulos.outro;
      return `<div class="card adm-oc">
        <div class="adm-oc-topo"><span class="badge ${cls}">${rot}</span><span class="adm-oc-data">${this._dataHora(o.data_hora)}</span></div>
        <div class="adm-oc-quem"><strong>${this._esc(o.nome || o.codigo_func || '-')}</strong> ${o.codigo_func ? '(' + this._esc(o.codigo_func) + ')' : ''} · ${this._esc(o.coletor || '-')}</div>
        <div class="adm-oc-desc">${this._esc(o.descricao)}</div></div>`;
    }).join('');
  },

  // ---------------- Exportacao ----------------
  _carregarXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/xlsx.full.min.js?v=' + CONFIG.APP_VERSION;
      s.onload = ok;
      s.onerror = () => falha(new Error('Não foi possível carregar o gerador de Excel.'));
      document.head.appendChild(s);
    });
  },

  // Monta as linhas com as mesmas colunas da exportacao antiga (Exportacao.gs),
  // com "Qtd Itens" pela parte de cada pessoa e "Volume por hora" calculado.
  montarLinhas(dados) {
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return dados.map(d => {
      const horas = Number(d.duracao_dias) * 24;
      const itens = Number(d.qtd_itens) || 0;
      const p = Backend.util.partesSP(new Date(d.data_inicio));
      return [
        d.nome_tarefa, 1, itens, Number(d.duracao_dias),
        itens && horas > 0 ? Math.round((itens / horas) * 100) / 100 : 0,
        d.nome_funcionario, `${p.day}/${meses[Number(p.month) - 1]}`
      ];
    });
  },

  async exportar() {
    const ini = document.getElementById('adm-exp-inicio').value;
    const fim = document.getElementById('adm-exp-fim').value;
    const msg = document.getElementById('adm-exp-msg');
    if (!ini || !fim) { msg.className = 'msg msg-warning'; msg.textContent = 'Informe as duas datas.'; return; }
    if (fim < ini) { msg.className = 'msg msg-warning'; msg.textContent = 'A data final é anterior à inicial.'; return; }

    msg.className = 'msg msg-info';
    msg.textContent = 'Gerando planilha...';
    try {
      const [r] = await Promise.all([API.get({ acao: 'adm_exportacao', data_inicio: ini, data_fim: fim }), this._carregarXlsx()]);
      if (!r.sucesso) throw new Error(r.mensagem);

      const cabecalho = ['Tarefas Diárias', 'Qtd de Tarefas', 'Qtd Itens', 'Soma de Tempo', 'Volume por hora', 'Nome do funcionário', 'Data'];
      const linhas = this.montarLinhas(r.dados);
      const ws = XLSX.utils.aoa_to_sheet([cabecalho].concat(linhas));
      for (let i = 0; i < linhas.length; i++) {
        const c = ws[XLSX.utils.encode_cell({ r: i + 1, c: 3 })];
        if (c) c.z = '[hh]:mm:ss';
      }
      ws['!cols'] = [{ wch: 18 }, { wch: 13 }, { wch: 10 }, { wch: 14 }, { wch: 15 }, { wch: 32 }, { wch: 8 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Exportação');
      const nome = `tarefas_${ini}_a_${fim}.xlsx`;
      XLSX.writeFile(wb, nome);
      msg.className = 'msg msg-success';
      msg.textContent = `${linhas.length} linha(s) exportada(s) em ${nome}.`;
    } catch (e) {
      msg.className = 'msg msg-error';
      msg.textContent = e.message || 'Erro ao exportar.';
    }
  }
};
