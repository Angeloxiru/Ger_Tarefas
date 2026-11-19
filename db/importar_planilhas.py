"""Converte as planilhas Google (baixadas em .xlsx) em comandos para o banco Turso.

Uso:
    python3 db/importar_planilhas.py Ger_Tarefas.xlsx Controle_de_Coletores.xlsx dados.json

Gera um JSON com a lista de comandos [sql, args]. Depois aplique com:
    node db/aplicar.js <url> <token> dados.json

Regras de conversao:
- Datas da planilha estao no horario de Brasilia (UTC-3): viram ISO UTC.
- IDs de registro repetidos (toque duplo no app antigo) ganham sufixo -2, -3...
- Mesma carga lida duas vezes no mesmo registro (toque duplo): fica a primeira.
  Cargas DIFERENTES no mesmo registro (lancamento manual) sao mantidas.
"""
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta

import openpyxl


def abas(arquivo):
    wb = openpyxl.load_workbook(arquivo, data_only=True, read_only=True)
    out = {}
    for ws in wb.worksheets:
        linhas = [r for r in ws.iter_rows(values_only=True) if any(v not in (None, '') for v in r)]
        if not linhas:
            continue
        cab = [str(c).strip() if c is not None else '' for c in linhas[0]]
        out[ws.title] = [dict(zip(cab, r)) for r in linhas[1:]]
    return out


def iso(v):
    if v in (None, ''):
        return None
    if isinstance(v, datetime):
        return (v + timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:%S.') + f'{(v.microsecond // 1000):03d}Z'
    return str(v)


def txt(v):
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return s or None


def inteiro(v):
    if v in (None, ''):
        return None
    return int(round(float(v)))


def booleano(v):
    if isinstance(v, bool):
        return 1 if v else 0
    return 1 if str(v).strip().lower() in ('true', '1', 'sim', 'verdadeiro') else 0


def main(arq_tarefas, arq_coletores, saida):
    t = abas(arq_tarefas)
    c = abas(arq_coletores)
    cmds = []
    resumo = {}

    def add(tabela, colunas, valores):
        cmds.append([f"INSERT INTO {tabela} ({', '.join(colunas)}) VALUES ({', '.join('?' * len(colunas))})", valores])
        resumo[tabela] = resumo.get(tabela, 0) + 1

    for f in t['Funcionarios']:
        if not txt(f.get('codigo')):
            continue
        add('funcionarios', ['codigo', 'nome', 'nome_completo', 'cargo', 'ativo', 'perfil', 'senha'],
            [txt(f['codigo']).upper(), txt(f.get('nome')) or txt(f['codigo']), txt(f.get('nome_completo')), txt(f.get('cargo')),
             booleano(f.get('ativo')), (txt(f.get('perfil')) or 'funcionario').lower(), txt(f.get('senha'))])

    for x in t['Tarefas']:
        add('tarefas', ['id_tarefa', 'nome', 'usa_qrcode_carga', 'tempo_maximo_min', 'ativa'],
            [txt(x['id_tarefa']), txt(x['nome']), booleano(x.get('usa_qrcode_carga')), inteiro(x.get('tempo_maximo_min')) or 240, booleano(x.get('ativa'))])

    for d in t['Docas']:
        add('docas', ['codigo', 'nome'], [txt(d['codigo']), txt(d['doca'])])

    for k in t.get('Config', []):
        add('config', ['chave', 'valor'], [txt(k['chave']), txt(k['valor'])])

    # Registros (historico + abertos), IDs duplicados ganham sufixo
    regs = t['Registros'] + t.get('RegistrosAbertos', [])
    por_id = defaultdict(list)
    for r in regs:
        por_id[txt(r['id_registro'])].append(r)
    variantes = {}   # id original -> [ids na ordem de data_inicio]
    duplicados = 0
    for rid, lista in por_id.items():
        lista.sort(key=lambda r: r['data_inicio'])
        ids = [rid if i == 0 else f'{rid}-{i + 1}' for i in range(len(lista))]
        duplicados += len(lista) - 1
        variantes[rid] = ids
        for novo, r in zip(ids, lista):
            add('registros', ['id_registro', 'codigo_func', 'id_tarefa', 'nome_tarefa', 'data_inicio', 'data_fim', 'status', 'finalizado_por', 'volumes_proporcionais'],
                [novo, txt(r['codigo_func']).upper(), txt(r['id_tarefa']), txt(r['nome_tarefa']), iso(r['data_inicio']), iso(r.get('data_fim')),
                 txt(r['status']), txt(r.get('finalizado_por')), inteiro(r.get('volumes_proporcionais'))])
    resumo['registros_ids_repetidos_renomeados'] = duplicados

    # Cargas: liga cada leitura ao registro certo
    cargas_por_reg = defaultdict(list)
    for x in t['Cargas']:
        cargas_por_reg[txt(x['id_registro'])].append(x)
    descartadas = 0
    for rid, lista in cargas_por_reg.items():
        lista.sort(key=lambda x: x['data_leitura'])
        ids = variantes.get(rid, [rid])
        # registro repetido: n-esima leitura -> n-esimo registro; o que sobrar fica no primeiro
        pares = [(ids[i] if i < len(ids) else ids[0], x) for i, x in enumerate(lista)]
        vistos = set()
        for novo, x in pares:
            chave = (novo, txt(x['numero_carga']))
            if chave in vistos:
                descartadas += 1             # mesma carga de novo no mesmo registro
                continue
            vistos.add(chave)
            add('cargas', ['id_registro', 'codigo_func', 'numero_carga', 'qtd_volumes', 'doca', 'data_leitura', 'ajudante'],
                [novo, txt(x['codigo_func']).upper(), txt(x['numero_carga']), inteiro(x['qtd_volumes']), txt(x.get('doca')),
                 iso(x['data_leitura']), booleano(x.get('ajudante'))])
    resumo['cargas_repetidas_descartadas'] = descartadas

    for a in t['Alertas']:
        add('alertas', ['id_alerta', 'codigo_func', 'data_alerta', 'descricao', 'emissor'],
            [txt(a['id_registro']), txt(a['codigo_func']).upper(), iso(a['data_alerta']), txt(a['descricao']), (txt(a.get('emissor')) or '').upper() or None])

    # Coletores: situacao atual pela ultima acao do Log
    ultima = {}
    for linha in c['Log']:
        ultima[txt(linha['Coletor']).upper()] = linha
        add('coletores_log', ['data_hora', 'coletor', 'codigo_func', 'nome', 'acao', 'origem'],
            [iso(linha['DataHora']), txt(linha['Coletor']).upper(), txt(linha['CodFun']).upper(), txt(linha['Nome']),
             'Retirada' if 'retirada' in str(linha['EntradaSaida']).lower() else 'Devolução', 'importado'])
    nomes = {txt(f['codigo']).upper(): txt(f.get('nome')) for f in t['Funcionarios'] if txt(f.get('codigo'))}
    por_nome = {v: k for k, v in nomes.items()}
    for x in c['Coletores']:
        col = txt(x['Coletor']).upper()
        status = txt(x.get('Status')) or 'Base'
        resp = desde = None
        if status.lower() != 'base':
            u = ultima.get(col)
            if u and 'retirada' in str(u['EntradaSaida']).lower():
                resp, desde = txt(u['CodFun']).upper(), iso(u['DataHora'])
            else:
                resp = por_nome.get(status)
        add('coletores', ['coletor', 'ativo', 'responsavel', 'desde'], [col, 1, resp, desde])

    for o in c.get('registro_diario', []):
        desc = txt(o.get('Registro')) or ''
        tipo = 'atraso_6h' if 'mais de 6h' in desc else 'assumido' if 'assumido' in desc else 'leitura_errada' if desc.startswith('Leitura errada') else 'outro'
        add('ocorrencias', ['data_hora', 'coletor', 'codigo_func', 'nome', 'tipo', 'descricao'],
            [iso(o['DataHora']), txt(o.get('Coletor')), (txt(o.get('CodFun')) or '').upper() or None, txt(o.get('Nome')), tipo, desc])

    with open(saida, 'w', encoding='utf-8') as f:
        json.dump({'comandos': cmds, 'resumo': resumo}, f, ensure_ascii=False)
    print(json.dumps(resumo, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(*sys.argv[1:4])
