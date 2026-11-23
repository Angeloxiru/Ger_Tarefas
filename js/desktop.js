// desktop.js - Melhorias do painel do gestor/ADM quando usado no COMPUTADOR
//
// "Computador" = navegador sem coletor vinculado (sem QR COLETOR:xx lido).
// Nesse caso o <body> recebe a classe "modo-computador" e:
// - o layout usa toda a largura da tela (CSS em css/style.css, secao "Modo computador");
// - Historico ganha filtro por tipo de tarefa, lista de funcionarios (sem precisar escanear
//   cracha), limite de linhas, resumo e coluna de duracao;
// - Coletores (ADM) vira o painel em cartoes do antigo Ger_Gestao_Coletores, com historico
//   de cada coletor ao clicar e atualizacao automatica a cada 30 s.
// No coletor Zebra (com vinculo) nada disso e ativado: as telas continuam como antes.

const Desktop = {
  ativo: false,
  _timerColetores: null,

  _esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  _dataHora(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  },

  _duracao(ms) {
    if (!(ms >= 0)) return '-';
    const min = Math.round(ms / 60000);
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  },

  iniciar() {
    let vinculo = '';
    try { vinculo = localStorage.getItem('coletor_vinculado') || ''; } catch (e) {}
    if (vinculo) return;            // coletor Zebra: nao muda nada
    this.ativo = true;
    document.body.classList.add('modo-computador');
    this._prepararHistorico();
  },

  // ======================= Historico =======================

  async _prepararHistorico() {
    const aba = document.getElementById('tab-historico');
    if (!aba) return;
    const card = aba.querySelector('.card');
    const botao = card.querySelector('button[onclick="buscarHistorico()"]');

    // No computador nao ha leitor de cracha: o filtro "Individual por scan" vira uma lista
    const grupoOriginal = document.getElementById('filtro-func-individual').closest('.form-group');
    grupoOriginal.classList.add('hidden');

    const bloco = document.createElement('div');
    bloco.className = 'desk-filtros';
    bloco.innerHTML = `
      <div class="form-group"><label for="desk-hist-tarefa">Tipo de tarefa</label>
        <select id="desk-hist-tarefa"><option value="">Todas</option></select></div>
      <div class="form-group"><label for="desk-hist-func">Funcionário</label>
        <select id="desk-hist-func"><option value="">Todos</option></select></div>
      <div class="form-group"><label for="desk-hist-status">Situação</label>
        <select id="desk-hist-status">
          <option value="">Todas</option><option value="finalizada">Finalizadas</option>
          <option value="em_andamento">Em andamento</option><option value="timeout">Timeout</option>
        </select></div>
      <div class="form-group"><label for="desk-hist-limite">Máximo de linhas</label>
        <select id="desk-hist-limite"><option>200</option><option>500</option><option>1000</option><option>2000</option></select></div>`;
    card.insertBefore(bloco, botao);

    // Datas e filtros na mesma linha (grade), botao ao lado
    const datas = Array.from(card.querySelectorAll(':scope > .form-group')).filter(g => !g.classList.contains('hidden'));
    datas.reverse().forEach(g => bloco.prepend(g));
    bloco.appendChild(botao);
    botao.classList.add('desk-botao-buscar');

    const [t, f] = await Promise.all([API.get({ acao: 'listar_tarefas' }), API.get({ acao: 'raiox', tipo: 'funcionarios' })]);
    const selT = document.getElementById('desk-hist-tarefa');
    if (t.sucesso) t.dados.forEach(x => selT.insertAdjacentHTML('beforeend', `<option value="${this._esc(x.id_tarefa)}">${this._esc(x.nome)}</option>`));
    const selF = document.getElementById('desk-hist-func');
    if (f.sucesso) f.dados.funcionarios.forEach(x => selF.insertAdjacentHTML('beforeend', `<option value="${this._esc(x.codigo)}">${this._esc(x.nome)}</option>`));
  },

  // Parametros extras usados por buscarHistorico() no gestor.html
  filtrosHistorico() {
    return {
      funcionarios: document.getElementById('desk-hist-func').value,
      extras: {
        tarefas: document.getElementById('desk-hist-tarefa').value,
        limite: document.getElementById('desk-hist-limite').value
      },
      status: document.getElementById('desk-hist-status').value
    };
  },

  renderizarHistorico(containerId, registros, status) {
    const el = document.getElementById(containerId);
    const lista = status ? registros.filter(r => r.status === status) : registros;
    if (!lista.length) { el.innerHTML = '<div class="card text-center"><p>Nenhum registro encontrado.</p></div>'; return; }

    let tempo = 0, volumes = 0;
    const pessoas = new Set();
    lista.forEach(r => {
      pessoas.add(r.codigo_func);
      if (r.status === 'finalizada' && r.data_fim) tempo += new Date(r.data_fim) - new Date(r.data_inicio);
      if (r.volumes_proporcionais != null) volumes += Number(r.volumes_proporcionais);
    });
    const badge = { em_andamento: 'badge-info', finalizada: 'badge-success', timeout: 'badge-danger' };
    const rotulo = { em_andamento: 'Em andamento', finalizada: 'Finalizada', timeout: 'Timeout' };

    el.innerHTML = `
      <div class="desk-resumo">
        <div class="card"><div class="desk-num">${lista.length}</div><div class="desk-rot">Registros</div></div>
        <div class="card"><div class="desk-num">${pessoas.size}</div><div class="desk-rot">Funcionários</div></div>
        <div class="card"><div class="desk-num">${this._duracao(tempo)}</div><div class="desk-rot">Tempo (finalizadas)</div></div>
        <div class="card"><div class="desk-num">${volumes.toLocaleString('pt-BR')}</div><div class="desk-rot">Volumes</div></div>
      </div>
      <div class="table-wrapper"><table class="data-table desk-tabela">
        <thead><tr><th>Funcionário</th><th>Tarefa</th><th>Início</th><th>Fim</th><th>Duração</th><th>Situação</th><th>Doca</th><th>Carga</th><th>Volumes</th></tr></thead>
        <tbody>${lista.map(r => `<tr>
          <td>${this._esc(r.nome_func || r.codigo_func)}</td>
          <td>${this._esc(r.nome_tarefa)}</td>
          <td>${this._dataHora(r.data_inicio)}</td>
          <td>${this._dataHora(r.data_fim)}</td>
          <td class="num">${r.status === 'finalizada' && r.data_fim ? this._duracao(new Date(r.data_fim) - new Date(r.data_inicio)) : '-'}</td>
          <td><span class="badge ${badge[r.status] || ''}">${rotulo[r.status] || this._esc(r.status)}</span></td>
          <td>${this._esc(r.nome_doca || '-')}</td>
          <td>${this._esc(r.numero_carga || '-')}</td>
          <td class="num">${r.volumes_proporcionais != null ? r.volumes_proporcionais : (r.qtd_volumes || '-')}</td>
        </tr>`).join('')}</tbody></table></div>`;
  },

  // ======================= Painel de coletores (ADM) =======================

  async painelColetores() {
    const el = document.getElementById('adm-coletores-lista');
    if (!el.querySelector('.desk-col-grade')) {
      el.innerHTML = '<div class="loading visivel"><div class="spinner"></div><p>Carregando...</p></div>';
    }
    const r = await API.get({ acao: 'adm_coletores' });
    if (!r.sucesso) { el.innerHTML = `<div class="msg msg-error">${this._esc(r.mensagem)}</div>`; return; }

    const lista = r.dados;
    const porPessoa = {};
    lista.filter(c => !c.na_base).forEach(c => { porPessoa[c.cod_fun] = (porPessoa[c.cod_fun] || 0) + 1; });
    const emUso = lista.filter(c => !c.na_base).length;
    const atrasados = lista.filter(c => !c.na_base && c.minutos_fora >= 360).length;
    const duplicados = lista.filter(c => !c.na_base && porPessoa[c.cod_fun] > 1).length;
    const agora = new Date().toLocaleTimeString('pt-BR');

    el.innerHTML = `
      <div class="desk-resumo">
        <div class="card"><div class="desk-num">${lista.length}</div><div class="desk-rot">Total de coletores</div></div>
        <div class="card"><div class="desk-num base">${lista.length - emUso}</div><div class="desk-rot">Na base</div></div>
        <div class="card"><div class="desk-num uso">${emUso}</div><div class="desk-rot">Em uso</div></div>
        <div class="card"><div class="desk-num alerta">${atrasados}</div><div class="desk-rot">Fora há mais de 6h</div></div>
      </div>
      ${duplicados ? `<div class="msg msg-error desk-aviso">Atenção: ${duplicados} coletores estão com a mesma pessoa (cartões piscando).</div>` : ''}
      <div class="desk-col-grade">${lista.map(c => {
        const dup = !c.na_base && porPessoa[c.cod_fun] > 1;
        const atrasado = !c.na_base && c.minutos_fora >= 360;
        const classe = c.na_base ? 'base' : (atrasado ? 'atrasado' : 'uso');
        const tempo = c.na_base ? '' : `${Math.floor(c.minutos_fora / 60)}h ${c.minutos_fora % 60}m`;
        return `<button class="desk-col ${classe}${dup ? ' duplicado' : ''}" data-coletor="${this._esc(c.coletor)}">
          <span class="desk-col-nome">${this._esc(c.coletor)}</span>
          <span class="desk-col-status"><i></i>${c.na_base ? 'Base' : this._esc(c.nome || c.cod_fun)}</span>
          ${tempo ? `<span class="desk-col-tempo">${tempo} fora</span>` : '<span class="desk-col-tempo">&nbsp;</span>'}
          ${dup ? '<span class="desk-col-alerta">Mesma pessoa em 2 coletores</span>' : ''}
          ${atrasado && !dup ? '<span class="desk-col-alerta">Mais de 6h fora</span>' : ''}
        </button>`;
      }).join('')}</div>
      <div class="desk-legenda">
        <span><i class="base"></i>Base</span><span><i class="uso"></i>Em uso</span>
        <span><i class="atrasado"></i>Mais de 6h fora</span><span><i class="duplicado"></i>Mesma pessoa em 2 coletores</span>
        <span class="desk-atualizado">Atualizado às ${agora} · atualiza sozinho a cada 30 s · clique num coletor para ver o histórico</span>
      </div>`;

    el.querySelectorAll('.desk-col').forEach(b => b.addEventListener('click', () => this.historicoColetor(b.dataset.coletor)));

    clearTimeout(this._timerColetores);
    this._timerColetores = setTimeout(() => {
      const aba = document.getElementById('tab-adm-coletores');
      if (aba && aba.classList.contains('ativo') && !document.hidden) this.painelColetores();
    }, 30000);
  },

  async historicoColetor(coletor) {
    const div = document.createElement('div');
    div.className = 'modal-overlay visivel desk-modal';
    div.innerHTML = `<div class="modal">
      <div class="desk-modal-topo"><div><div class="modal-title">${this._esc(coletor)}</div>
        <div class="desk-rot">Últimas movimentações (o log guarda 7 dias)</div></div>
        <button class="btn btn-secondary desk-fechar">Fechar</button></div>
      <div class="desk-modal-corpo"><div class="loading visivel"><div class="spinner"></div></div></div></div>`;
    document.body.appendChild(div);
    const fechar = () => div.remove();
    div.querySelector('.desk-fechar').addEventListener('click', fechar);
    div.addEventListener('click', e => { if (e.target === div) fechar(); });

    const r = await API.get({ acao: 'adm_coletor_historico', coletor });
    const corpo = div.querySelector('.desk-modal-corpo');
    if (!r.sucesso) { corpo.innerHTML = `<div class="msg msg-error">${this._esc(r.mensagem)}</div>`; return; }
    if (!r.dados.length) { corpo.innerHTML = '<p class="text-center">Nenhuma movimentação nos últimos 7 dias.</p>'; return; }
    const origem = { app: '', assumido: 'assumido', importado: 'planilha antiga' };
    corpo.innerHTML = `<table class="data-table desk-tabela"><thead><tr><th>Data/hora</th><th>Movimento</th><th>Funcionário</th><th></th></tr></thead><tbody>
      ${r.dados.map(m => `<tr><td>${this._dataHora(m.data_hora)}</td>
        <td><span class="badge ${m.acao === 'Retirada' ? 'badge-warning' : 'badge-success'}">${this._esc(m.acao)}</span></td>
        <td>${this._esc(m.nome || m.codigo_func)} (${this._esc(m.codigo_func)})</td>
        <td class="desk-rot">${origem[m.origem] || ''}</td></tr>`).join('')}</tbody></table>`;
  }
};
