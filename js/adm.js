// adm.js - Telas exclusivas do perfil ADM (dentro do painel do gestor)
//
// - Coletores: situacao de cada coletor (antigo painel do Ger_Gestao_Coletores)
// - Irregularidades: ocorrencias dos coletores (antigo e-mail diario), guardadas por 45 dias
// - Exp/Imp: exporta .xlsx de tarefas finalizadas por periodo e importa o relatorio
//   "Tarefas Realizadas" do WMS (outro app) para a tabela wms_tarefas

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
    if (typeof Desktop !== 'undefined' && Desktop.ativo) return Desktop.painelColetores();
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
            <td>${c.em_conserto ? '<span class="badge">Conserto</span>' : c.na_base ? '<span class="badge badge-success">Base</span>' : `<span class="badge ${classe}">${this._esc(c.nome || c.cod_fun)}</span>`}</td>
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
      assumido: ['Coletor assumido', 'badge-info'], atraso_6h: ['Mais de 6h', 'badge-danger'],
      conserto: ['Conserto', 'badge-warning'], outro: ['Outro', 'badge-info']
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
  },

  // ---------------- Importacao WMS ----------------
  _importacao: null,

  // Data do Excel (numero de serie ou texto dd/mm/aaaa hh:mm:ss) no horario de Brasilia -> ISO UTC
  _dataExcel(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000) + 3 * 3600000).toISOString();
    if (v instanceof Date) return v.toISOString();
    const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}-03:00`).toISOString();
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString();
  },

  _segundos(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Math.round(v * 86400);          // fracao de dia do Excel
    const p = String(v).trim().split(':').map(Number);
    if (p.some(isNaN)) return null;
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : null;
  },

  async lerImportacao() {
    const input = document.getElementById('adm-imp-arquivo');
    const previa = document.getElementById('adm-imp-previa');
    const msg = document.getElementById('adm-imp-msg');
    msg.className = 'msg hidden';
    previa.innerHTML = '';
    this._importacao = null;
    const arq = input.files && input.files[0];
    if (!arq) return;
    previa.innerHTML = '<div class="loading visivel"><div class="spinner"></div><p>Lendo arquivo...</p></div>';
    try {
      await this._carregarXlsx();
      const wb = XLSX.read(await arq.arrayBuffer(), { type: 'array', cellDates: false });
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
      const hi = linhas.findIndex(l => l.some(c => String(c || '').trim() === 'Número'));
      if (hi < 0) throw new Error('Não encontrei a coluna "Número". Confira se é o relatório "Tarefas Realizadas".');
      const cab = linhas[hi].map(c => String(c || '').trim());
      const col = nome => cab.indexOf(nome);
      const obrig = ['Número', 'Endereço Inicial', 'Dt. Aceite', 'Dt. Conclusão', 'Execução', 'Cód. Aplicação', 'Aplicação', 'Cód. Funcionário', 'Funcionário', 'Qtde. Itens'];
      const faltando = obrig.filter(c => col(c) < 0);
      if (faltando.length) throw new Error('Colunas não encontradas: ' + faltando.join(', '));
      const iQt = col('Qt Endereços');
      const registros = [];
      let invalidas = 0;
      for (const l of linhas.slice(hi + 1)) {
        if (!l || l[col('Número')] === null || String(l[col('Número')]).trim() === '') continue;
        const r = {
          numero: String(l[col('Número')]).trim(),
          endereco_inicial: String(l[col('Endereço Inicial')] || '').trim(),
          dt_aceite: this._dataExcel(l[col('Dt. Aceite')]),
          dt_conclusao: this._dataExcel(l[col('Dt. Conclusão')]),
          execucao_seg: this._segundos(l[col('Execução')]),
          cod_aplicacao: String(l[col('Cód. Aplicação')] || '').trim(),
          aplicacao: String(l[col('Aplicação')] || '').trim(),
          cod_func_wms: String(l[col('Cód. Funcionário')] === null ? '' : l[col('Cód. Funcionário')]).trim(),
          nome_func_wms: String(l[col('Funcionário')] || '').trim(),
          qtde_itens: l[col('Qtde. Itens')],
          qt_enderecos: iQt >= 0 ? l[iQt] : null
        };
        if (r.execucao_seg === null && r.dt_aceite && r.dt_conclusao) r.execucao_seg = Math.round((new Date(r.dt_conclusao) - new Date(r.dt_aceite)) / 1000);
        if (!r.dt_aceite || !r.cod_aplicacao || !r.cod_func_wms) { invalidas++; continue; }
        registros.push(r);
      }
      if (!registros.length) throw new Error('Nenhuma tarefa válida no arquivo.');

      const res = await API.get({ acao: 'adm_wms_importar', registros, simular: true });
      if (!res.sucesso) throw new Error(res.mensagem);
      this._importacao = { registros, arquivo: arq.name };
      const d = res.dados;
      const sem = Object.entries(d.funcionarios_sem_vinculo);
      previa.innerHTML = `
        <div class="adm-imp-resumo">
          <div><b>${d.linhas.toLocaleString('pt-BR')}</b> tarefas</div>
          <div><b>${d.novas.toLocaleString('pt-BR')}</b> novas</div>
          <div><b>${d.atualizadas.toLocaleString('pt-BR')}</b> já existem (serão atualizadas)</div>
          <div class="${d.sem_vinculo ? 'adm-imp-alerta' : ''}"><b>${d.sem_vinculo}</b> sem funcionário vinculado</div>
        </div>
        <p class="adm-nota">Período: ${this._dataHora(d.periodo_ini)} a ${this._dataHora(d.periodo_fim)}${invalidas ? ` · ${invalidas} linha(s) ignorada(s) por falta de dados` : ''}${d.repetidas_no_arquivo ? ` · ${d.repetidas_no_arquivo} repetida(s) no arquivo` : ''}</p>
        <table class="data-table adm-imp-tabela"><thead><tr><th>Tarefa</th><th>Qtd</th></tr></thead><tbody>
          ${Object.entries(d.por_tarefa).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<tr><td>${this._esc(t)}</td><td>${n}</td></tr>`).join('')}
        </tbody></table>
        ${sem.length ? `<div class="msg msg-warning" style="margin-top:12px;">Códigos do WMS sem funcionário no cadastro (as tarefas serão importadas mesmo assim): ${sem.map(([c, n]) => `${this._esc(c)} = ${this._esc(n)}`).join('; ')}. Para vincular, preencha <code>codigo_wms</code> na tabela funcionarios e importe de novo.</div>` : ''}
        <button class="btn btn-success" id="adm-imp-confirmar" style="margin-top:12px;">Confirmar importação</button>`;
      document.getElementById('adm-imp-confirmar').addEventListener('click', () => this.confirmarImportacao());
    } catch (e) {
      previa.innerHTML = '';
      msg.className = 'msg msg-error';
      msg.textContent = e.message || 'Erro ao ler o arquivo.';
    }
  },

  async confirmarImportacao() {
    if (!this._importacao) return;
    const btn = document.getElementById('adm-imp-confirmar');
    const msg = document.getElementById('adm-imp-msg');
    btn.disabled = true;
    msg.className = 'msg msg-info';
    msg.textContent = 'Importando...';
    const sessao = Auth.obterSessao() || {};
    const res = await API.get({
      acao: 'adm_wms_importar', registros: this._importacao.registros, arquivo: this._importacao.arquivo,
      codigo_adm: sessao.codigo,
      aoProgresso: (n, total) => { msg.textContent = `Importando... ${n.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}`; }
    });
    if (!res.sucesso) {
      msg.className = 'msg msg-error';
      msg.textContent = res.mensagem + ' Nada foi perdido: pode tentar de novo, as tarefas já gravadas serão só atualizadas.';
      btn.disabled = false;
      return;
    }
    msg.className = 'msg msg-success';
    msg.textContent = `Importação concluída: ${res.dados.novas} novas e ${res.dados.atualizadas} atualizadas.`;
    this._importacao = null;
    document.getElementById('adm-imp-previa').innerHTML = '';
    document.getElementById('adm-imp-arquivo').value = '';
    this.carregarImportacoes();
  },

  async carregarImportacoes() {
    const el = document.getElementById('adm-imp-historico');
    if (!el) return;
    const r = await API.get({ acao: 'adm_wms_importacoes' });
    if (!r.sucesso) { el.innerHTML = `<div class="msg msg-error">${this._esc(r.mensagem)}</div>`; return; }
    if (!r.dados.length) { el.innerHTML = '<p class="adm-nota" style="margin-top:0;">Nenhuma importação ainda.</p>'; return; }
    el.innerHTML = `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Quando</th><th>Arquivo</th><th>Linhas</th><th>Novas</th><th>Atualizadas</th><th>Sem vínculo</th><th>Período</th><th>Por</th></tr></thead><tbody>
      ${r.dados.map(i => `<tr><td>${this._dataHora(i.data_hora)}</td><td>${this._esc(i.arquivo || '-')}</td><td>${i.linhas}</td><td>${i.novas}</td>
        <td>${i.atualizadas}</td><td>${i.sem_vinculo}</td><td>${this._dataHora(i.periodo_ini)} a ${this._dataHora(i.periodo_fim)}</td>
        <td>${this._esc(i.nome_adm || i.importado_por || '-')}</td></tr>`).join('')}</tbody></table></div>`;
  }
};
