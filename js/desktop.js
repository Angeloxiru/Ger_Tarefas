// desktop.js - Melhorias do painel do gestor/ADM quando usado no COMPUTADOR
//
// "Computador" = navegador sem coletor vinculado (sem QR COLETOR:xx lido).
// Nesse caso o <body> recebe a classe "modo-computador" e:
// - o layout usa toda a largura da tela (CSS em css/style.css, secao "Modo computador");
// - Historico ganha filtro por tipo de tarefa, lista de funcionarios (sem precisar escanear
//   cracha), limite de linhas, resumo e coluna de duracao;
// - Coletores (ADM) vira o painel em cartoes do antigo Ger_Gestao_Coletores, com historico
//   de cada coletor ao clicar e atualizacao automatica a cada 30 s.
// - Tempo Real: quem esta em tarefa primeiro (alertas no topo), busca por nome e
//   atualizacao a cada 1 minuto com o horario da ultima atualizacao;
// - Historico pode ser baixado em Excel exatamente como filtrado na tela;
// - Coletores: status "Conserto" (enviar/liberar pelo historico do coletor).
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
    CONFIG.INTERVALO_PAINEL_GESTOR = 60000;      // Tempo Real: atualiza a cada 1 minuto
    this._prepararTempoReal();
    this._prepararHistorico();
  },

  // ======================= Tempo Real =======================

  _prepararTempoReal() {
    const filtros = document.querySelector('#tab-tempo-real .gestor-filters');
    if (!filtros) return;
    filtros.insertAdjacentHTML('beforeend', `
      <input type="search" id="desk-busca-func" class="desk-busca" placeholder="Buscar funcionário..." autocomplete="off">
      <span id="desk-atualizado" class="desk-atualizado-tr"></span>`);
    document.getElementById('desk-busca-func').addEventListener('input', () => this.aplicarBusca());
  },

  // Ordem: em tarefa primeiro (timeout, alerta e mais antigas no topo), depois ociosos por nome
  ordenarFuncionarios(lista) {
    const agora = Date.now();
    const peso = f => {
      if (!f.tarefa_atual) return 0;
      const ms = agora - new Date(f.tarefa_atual.data_inicio).getTime();
      return ms >= CONFIG.TIMEOUT_MS ? 3 : ms >= CONFIG.ALERTA_MS ? 2 : 1;
    };
    return lista.slice().sort((a, b) => {
      const pa = peso(a), pb = peso(b);
      if (pa !== pb) return pb - pa;
      if (pa > 0) return new Date(a.tarefa_atual.data_inicio) - new Date(b.tarefa_atual.data_inicio);
      return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
  },

  // Chamado depois de cada atualizacao do Tempo Real
  aposAtualizarTempoReal() {
    const el = document.getElementById('desk-atualizado');
    if (el) el.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' · atualiza a cada 1 min';
    this.aplicarBusca();
  },

  aplicarBusca() {
    const campo = document.getElementById('desk-busca-func');
    const termo = campo ? campo.value.trim().toLowerCase() : '';
    const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    document.querySelectorAll('#lista-funcionarios .func-card').forEach(card => {
      const nome = card.querySelector('.func-name');
      card.style.display = !termo || norm(nome ? nome.textContent : '').includes(norm(termo)) ? '' : 'none';
    });
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
    this._ultimoHistorico = lista;
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
      <div class="desk-barra"><span class="desk-rot">${lista.length} linha(s) na tela</span>
        <button class="btn btn-success" id="desk-hist-excel">Baixar Excel</button></div>
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
    document.getElementById('desk-hist-excel').addEventListener('click', () => this.exportarHistorico());
  },

  // Baixa em .xlsx exatamente o que esta na tela (mesmos filtros)
  async exportarHistorico() {
    const btn = document.getElementById('desk-hist-excel');
    const lista = this._ultimoHistorico || [];
    if (!lista.length) return;
    btn.disabled = true;
    btn.textContent = 'Gerando...';
    try {
      await Adm._carregarXlsx();
      const rot = { em_andamento: 'Em andamento', finalizada: 'Finalizada', timeout: 'Timeout' };
      const dia = iso => iso ? new Date(iso) : null;
      const linhas = lista.map(r => {
        const ini = dia(r.data_inicio), fim = dia(r.data_fim);
        const dur = r.status === 'finalizada' && ini && fim ? (fim - ini) / 86400000 : null;
        // Data/hora do Excel (numero de serie) ja no horario de Brasilia (UTC-3).
        // Calculado aqui para a biblioteca nao aplicar o fuso do computador de novo.
        const excel = d => d ? (d.getTime() - 3 * 3600000) / 86400000 + 25569 : null;
        return [r.nome_func || r.codigo_func, r.codigo_func, r.nome_tarefa, excel(ini), excel(fim), dur,
          rot[r.status] || r.status, r.nome_doca || '', r.numero_carga || '',
          r.volumes_proporcionais != null ? Number(r.volumes_proporcionais) : (r.qtd_volumes != null ? Number(r.qtd_volumes) : '')];
      });
      const cab = ['Funcionário', 'Código', 'Tarefa', 'Início', 'Fim', 'Duração', 'Situação', 'Doca', 'Carga', 'Volumes'];
      const ws = XLSX.utils.aoa_to_sheet([cab].concat(linhas));
      for (let i = 1; i <= linhas.length; i++) {
        ['D', 'E'].forEach(c => { const cel = ws[c + (i + 1)]; if (cel) cel.z = 'dd/mm/yyyy hh:mm'; });
        const d = ws['F' + (i + 1)]; if (d) d.z = '[hh]:mm';
      }
      ws['!cols'] = [{ wch: 24 }, { wch: 8 }, { wch: 16 }, { wch: 17 }, { wch: 17 }, { wch: 9 }, { wch: 13 }, { wch: 12 }, { wch: 10 }, { wch: 9 }];
      ws['!autofilter'] = { ref: `A1:J${linhas.length + 1}` };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Histórico');
      const ini = document.getElementById('hist-data-inicio').value, fim = document.getElementById('hist-data-fim').value;
      XLSX.writeFile(wb, `historico_${ini}_a_${fim}.xlsx`);
    } catch (e) {
      alert(e.message || 'Erro ao gerar o Excel.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Baixar Excel';
    }
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
    const conserto = lista.filter(c => c.em_conserto).length;
    const atrasados = lista.filter(c => !c.na_base && c.minutos_fora >= 360).length;
    const duplicados = lista.filter(c => !c.na_base && porPessoa[c.cod_fun] > 1).length;
    const agora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    el.innerHTML = `
      <div class="desk-resumo desk-resumo-5">
        <div class="card"><div class="desk-num">${lista.length}</div><div class="desk-rot">Total de coletores</div></div>
        <div class="card"><div class="desk-num base">${lista.length - emUso - conserto}</div><div class="desk-rot">Na base</div></div>
        <div class="card"><div class="desk-num uso">${emUso}</div><div class="desk-rot">Em uso</div></div>
        <div class="card"><div class="desk-num alerta">${atrasados}</div><div class="desk-rot">Fora há mais de 6h</div></div>
        <div class="card"><div class="desk-num conserto">${conserto}</div><div class="desk-rot">Em conserto</div></div>
      </div>
      ${duplicados ? `<div class="msg msg-error desk-aviso">Atenção: ${duplicados} coletores estão com a mesma pessoa (cartões piscando).</div>` : ''}
      <div class="desk-col-grade">${lista.map(c => {
        const dup = !c.na_base && porPessoa[c.cod_fun] > 1;
        const atrasado = !c.na_base && c.minutos_fora >= 360;
        const classe = c.em_conserto ? 'conserto' : c.na_base ? 'base' : (atrasado ? 'atrasado' : 'uso');
        const tempo = c.na_base ? '' : `${Math.floor(c.minutos_fora / 60)}h ${c.minutos_fora % 60}m`;
        return `<button class="desk-col ${classe}${dup ? ' duplicado' : ''}" data-coletor="${this._esc(c.coletor)}">
          <span class="desk-col-nome">${this._esc(c.coletor)}</span>
          <span class="desk-col-status"><i></i>${c.em_conserto ? 'Conserto' : c.na_base ? 'Base' : this._esc(c.nome || c.cod_fun)}</span>
          ${tempo ? `<span class="desk-col-tempo">${tempo} fora</span>` : '<span class="desk-col-tempo">&nbsp;</span>'}
          ${dup ? '<span class="desk-col-alerta">Mesma pessoa em 2 coletores</span>' : ''}
          ${atrasado && !dup ? '<span class="desk-col-alerta">Mais de 6h fora</span>' : ''}
        </button>`;
      }).join('')}</div>
      <div class="desk-legenda">
        <span><i class="base"></i>Base</span><span><i class="uso"></i>Em uso</span>
        <span><i class="atrasado"></i>Mais de 6h fora</span><span><i class="conserto"></i>Conserto</span><span><i class="duplicado"></i>Mesma pessoa em 2 coletores</span>
        <span class="desk-atualizado">Atualizado às ${agora} · atualiza sozinho a cada 30 s · clique num coletor para ver o histórico</span>
      </div>`;

    this._coletores = {};
    lista.forEach(c => { this._coletores[c.coletor] = c; });
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
      <div class="desk-modal-acoes"></div>
      <div class="desk-modal-corpo"><div class="loading visivel"><div class="spinner"></div></div></div></div>`;
    document.body.appendChild(div);
    const fechar = () => div.remove();
    div.querySelector('.desk-fechar').addEventListener('click', fechar);
    div.addEventListener('click', e => { if (e.target === div) fechar(); });

    // Conserto: enviar (so na base) ou liberar
    const c = (this._coletores || {})[coletor] || {};
    const acoes = div.querySelector('.desk-modal-acoes');
    if (c.em_conserto) {
      acoes.innerHTML = '<div class="msg msg-warning">Em conserto: não pode ser retirado.</div><button class="btn btn-success desk-conserto" data-v="0">Liberar do conserto</button>';
    } else if (c.na_base) {
      acoes.innerHTML = '<button class="btn btn-outline desk-conserto" data-v="1">Enviar para conserto</button>';
    } else {
      acoes.innerHTML = '<p class="desk-rot">Para enviar para conserto, o coletor precisa ser devolvido à base.</p>';
    }
    const bc = acoes.querySelector('.desk-conserto');
    if (bc) bc.addEventListener('click', async () => {
      bc.disabled = true;
      const sessao = Auth.obterSessao() || {};
      const r = await API.get({ acao: 'adm_coletor_conserto', coletor, em_conserto: bc.dataset.v, codigo_adm: sessao.codigo });
      if (!r.sucesso) { acoes.insertAdjacentHTML('beforeend', `<div class="msg msg-error">${this._esc(r.mensagem)}</div>`); bc.disabled = false; return; }
      fechar();
      this.painelColetores();
    });

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
