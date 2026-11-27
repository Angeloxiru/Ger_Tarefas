#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
8_rotina_conflitos_alertas.py  (versão 1.1 de 26/11/2026)

Rotina diária de conflitos e alertas (regra 12 das Regras de cálculo).
Procedimento completo: arquivo 8_rotina_conflitos_alertas.md do projeto.

O script NÃO acessa o banco. Ele:
  1. monta as consultas de leitura (todas filtradas por funcionário e período);
  2. calcula os conflitos em Python (regra 12, v1.1: SOMA do tempo em comum da tarefa do app com
     todas as tarefas do WMS do funcionário maior que 5 min; registra a tarefa do WMS de maior
     sobreposição; data do conflito = início do primeiro trecho em comum);
  3. agrupa os conflitos pendentes de cada funcionário, dentro do mesmo mês, de 3 em 3;
  4. gera os arquivos .sql de gravação (INSERT OR IGNORE em conflitos e alertas, UPDATE do vínculo),
     que podem ser rodados de novo sem duplicar nada.

Uso:
  python3 8_rotina_conflitos_alertas.py consultas  --ini AAAA-MM-DD --fim AAAA-MM-DD [--app app.json]
  python3 8_rotina_conflitos_alertas.py calcular   --ini AAAA-MM-DD --fim AAAA-MM-DD \
        --app app.json --wms wms.json --conflitos conflitos.json --alertas alertas.json --saida pasta

  --ini / --fim: dias de Brasília, fim exclusivo. Padrão da rotina: ini = hoje - 5 dias, fim = hoje.
  Sem --ini/--fim, usa o padrão da rotina.

Os JSON de entrada são o resultado do conector Turso como ele retorna ({"columns": [...], "rows": [...]}),
salvos sem copiar valores à mão. A coluna "pad" é ignorada.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

BR = timezone(timedelta(hours=-3))
EMISSOR = "PL1"
TOLERANCIA_SEG = 300          # regra 12 (v1.1): conflito só com MAIS de 5 minutos em comum, somando o WMS
LIMITE_WMS_SEG = 86400        # premissa: nenhuma tarefa do WMS com 24h ou mais
PREFIXO = "Alerta gerado por 3 conflitos: "
LOTE = 150                    # linhas por comando SQL
PAD = "CASE WHEN ROW_NUMBER() OVER () = 1 THEN printf('%100000s','') END AS pad"


# ---------------------------------------------------------------- utilidades
def dia_br(s):
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=BR)


def iso_utc(dt):
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (dt.microsecond // 1000)


def parse(s):
    if s is None or s == "":
        return None
    return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc)


def mes_ini(dt_br):
    return dt_br.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def carregar(caminho):
    """Lê o resultado do conector (dict com columns/rows, ou texto/lista que o contenha).
    Use a palavra 'vazio' no lugar do arquivo quando a consulta voltar sem nenhuma linha."""
    if caminho == "vazio":
        return []
    with open(caminho, encoding="utf-8") as f:
        bruto = f.read()
    try:
        dado = json.loads(bruto)
    except json.JSONDecodeError:
        dado = json.loads(bruto[bruto.index("{"):bruto.rindex("}") + 1])
    if isinstance(dado, list):  # formato de resultado de ferramenta salvo em arquivo
        for item in dado:
            if isinstance(item, dict) and "text" in item:
                t = item["text"]
                dado = json.loads(t[t.index("{"):t.rindex("}") + 1])
                break
    if isinstance(dado, dict) and "columns" not in dado:
        for v in dado.values():
            if isinstance(v, str) and '"columns"' in v:
                dado = json.loads(v[v.index("{"):v.rindex("}") + 1])
                break
    cols = dado["columns"]
    return [{c: v for c, v in zip(cols, r) if c != "pad"} for r in dado["rows"]]


def janela(args):
    hoje = datetime.now(BR).replace(hour=0, minute=0, second=0, microsecond=0)
    ini = dia_br(args.ini) if args.ini else hoje - timedelta(days=5)
    fim = dia_br(args.fim) if args.fim else hoje
    if fim <= ini:
        sys.exit("ERRO: --fim precisa ser depois de --ini")
    return ini, fim


def limites(ini, fim):
    return {
        "ini": iso_utc(ini), "fim": iso_utc(fim),
        "ini_m": iso_utc(ini - timedelta(days=1)), "fim_m": iso_utc(fim + timedelta(days=1)),
        "mes": iso_utc(mes_ini(ini)),
    }


def lista_in(funcs):
    return ", ".join(q(f) for f in sorted(funcs))


# ---------------------------------------------------------------- consultas
def consultas(args):
    ini, fim = janela(args)
    L = limites(ini, fim)
    print("-- Janela (Brasília): %s a %s (fim exclusivo)" % (ini.date(), fim.date()))
    print("-- C1 (app Tarefas da janela, funcionários ativos)")
    print("""SELECT r.id_registro, r.codigo_func, r.nome_tarefa, r.status, r.data_inicio, r.data_fim, %s
FROM registros r
WHERE r.codigo_func IN (SELECT codigo FROM funcionarios WHERE ativo = 1)
  AND r.status IN ('finalizada','timeout')
  AND r.data_inicio >= '%s' AND r.data_inicio < '%s'
ORDER BY r.data_inicio;""" % (PAD, L["ini"], L["fim"]))
    if not args.app:
        print("\n-- Rode C1, salve o resultado e chame de novo com --app para gerar C2, C3 e C4.")
        return
    app = carregar(args.app)
    funcs = {r["codigo_func"].upper() for r in app}
    if not funcs:
        print("\n-- C1 sem nenhuma tarefa na janela: nada a verificar. Não rode C2, C3 e C4.")
        return
    print("\n-- C2 (WMS dos funcionários que têm tarefa no app, janela com margem de 1 dia)")
    print("""SELECT numero, codigo_func, tarefa, dt_aceite, dt_conclusao, %s
FROM wms_tarefas
WHERE codigo_func IN (%s)
  AND dt_aceite >= '%s' AND dt_aceite < '%s'
ORDER BY dt_aceite;""" % (PAD, lista_in(funcs), L["ini_m"], L["fim_m"]))
    print("\n-- C3 (conflitos já gravados desde o início do mês da janela)")
    print("""SELECT id_registro, codigo_func, nome_tarefa, inicio_app, fim_app, numero_wms, tarefa_wms,
       inicio_sobreposicao, sobreposicao_seg, id_alerta, %s
FROM conflitos
WHERE inicio_sobreposicao >= '%s'
ORDER BY inicio_sobreposicao;""" % (PAD, L["mes"]))
    print("\n-- C4 (alertas já gravados no período, para não repetir id_alerta)")
    print("""SELECT id_alerta, codigo_func, data_alerta, substr(descricao, 1, 40) AS inicio_descricao, %s
FROM alertas
WHERE codigo_func IN (%s)
  AND data_alerta >= '%s' AND data_alerta < '%s'
ORDER BY data_alerta;""" % (PAD, lista_in(funcs), L["mes"], L["fim_m"]))


# ---------------------------------------------------------------- cálculo
def fmt_dur(seg):
    m = seg // 60
    if m >= 60:
        return "%dh%02d" % (m // 60, m % 60)
    if m < 10 and seg % 60:
        return "%d min %02d s" % (m, seg % 60)
    return "%d min" % m


def mais_wms(c):
    """v1.1: quando o conflito soma mais de uma tarefa do WMS, indica quantas a mais."""
    n = int(c.get("qtd_wms") or 1) - 1
    return " e mais %d" % n if n > 0 else ""


def calcular(args):
    ini, fim = janela(args)
    L = limites(ini, fim)
    ini_u, fim_u = parse(L["ini"]), parse(L["fim"])
    agora = datetime.now(timezone.utc)
    avisos = []

    app = carregar(args.app)
    wms = carregar(args.wms)
    existentes = carregar(args.conflitos)
    alertas_bd = carregar(args.alertas)

    # --- WMS por funcionário
    wms_por_func = {}
    longas = []
    sem_conclusao = []
    for w in wms:
        a, c = parse(w["dt_aceite"]), parse(w["dt_conclusao"])
        if c is None:
            sem_conclusao.append(w["numero"])
            continue
        if (c - a).total_seconds() >= LIMITE_WMS_SEG:
            longas.append(w["numero"])
        wms_por_func.setdefault(str(w["codigo_func"]).upper(), []).append((a, c, w))
    if longas:
        print(json.dumps({"PARADO": "há tarefa do WMS com 24h ou mais; nada foi gravado",
                          "tarefas_wms": longas}, ensure_ascii=False, indent=1))
        sys.exit(2)
    if sem_conclusao:
        avisos.append("Tarefas do WMS sem dt_conclusao (ignoradas na checagem): %s" % ", ".join(sem_conclusao))
    for lst in wms_por_func.values():
        lst.sort(key=lambda t: (t[0], str(t[2]["numero"])))

    # --- conflitos da janela
    ja = {e["id_registro"]: e for e in existentes}
    novos = []
    sem_fim = []
    for r in app:
        ri, rf = parse(r["data_inicio"]), parse(r["data_fim"])
        if not (ini_u <= ri < fim_u):
            continue
        if rf is None:
            sem_fim.append(r["id_registro"])
            continue
        if r["id_registro"] in ja:
            continue
        # v1.1: soma dos trechos em comum com TODAS as tarefas do WMS que se sobrepõem à tarefa do app
        trechos = []  # (inicio do trecho, segundos, tarefa do WMS)
        for a, c, w in wms_por_func.get(str(r["codigo_func"]).upper(), []):
            if a >= rf:
                break
            if c <= ri:
                continue
            ini_s = max(ri, a)
            seg = int(round((min(rf, c) - ini_s).total_seconds()))
            if seg > 0:
                trechos.append((ini_s, seg, w))
        total = sum(t[1] for t in trechos)
        if total > TOLERANCIA_SEG:
            # registra a tarefa do WMS de maior sobreposição (empate: a de aceite mais cedo)
            maior = max(trechos, key=lambda t: t[1])
            w = maior[2]
            novos.append({
                "codigo_func": str(r["codigo_func"]).upper(), "id_registro": r["id_registro"],
                "nome_tarefa": r["nome_tarefa"], "inicio_app": r["data_inicio"], "fim_app": r["data_fim"],
                "numero_wms": str(w["numero"]), "tarefa_wms": w["tarefa"],
                "aceite_wms": w["dt_aceite"], "conclusao_wms": w["dt_conclusao"],
                "inicio_sobreposicao": iso_utc(min(t[0] for t in trechos)), "sobreposicao_seg": total,
                "data_deteccao": iso_utc(agora), "id_alerta": None, "qtd_wms": len(trechos),
            })
    if sem_fim:
        avisos.append("Tarefas do app sem data_fim (ignoradas): %s" % ", ".join(sem_fim))

    # --- agrupamento de 3 em 3, por funcionário e mês (Brasília) do início da sobreposição
    pendentes = {}
    for c in [e for e in existentes if not e.get("id_alerta")] + novos:
        dt = parse(c["inicio_sobreposicao"]).astimezone(BR)
        pendentes.setdefault((str(c["codigo_func"]).upper(), dt.strftime("%Y-%m")), []).append(c)

    ids_bd = {a["id_alerta"]: a for a in alertas_bd}
    ids_usados = set()
    alertas_novos, vinculos = [], []
    sobras = []
    for (func, mes), lst in sorted(pendentes.items()):
        lst.sort(key=lambda c: (c["inicio_sobreposicao"], c["id_registro"]))
        while len(lst) >= 3:
            grupo, lst = lst[:3], lst[3:]
            terceiro = parse(grupo[2]["inicio_sobreposicao"])
            dt = terceiro
            while True:
                ida = "A" + dt.astimezone(BR).strftime("%Y%m%d%H%M%S") + func
                existente = ids_bd.get(ida)
                livre = ida not in ids_usados and (
                    existente is None or str(existente.get("inicio_descricao", "")).startswith(PREFIXO[:30]))
                if livre:
                    break
                dt = dt + timedelta(seconds=1)
            ids_usados.add(ida)
            partes = []
            for c in grupo:
                a_br, f_br = parse(c["inicio_app"]).astimezone(BR), parse(c["fim_app"]).astimezone(BR)
                partes.append("%s %s-%s %s x WMS %s%s (%s, %s em comum)" % (
                    a_br.strftime("%d/%m"), a_br.strftime("%H:%M"), f_br.strftime("%H:%M"),
                    c["nome_tarefa"], c["numero_wms"], mais_wms(c), c["tarefa_wms"],
                    fmt_dur(int(c["sobreposicao_seg"]))))
            alertas_novos.append({"id_alerta": ida, "codigo_func": func, "data_alerta": iso_utc(terceiro),
                                  "descricao": PREFIXO + "; ".join(partes), "emissor": EMISSOR,
                                  "ja_existia": ida in ids_bd})
            for c in grupo:
                c["id_alerta"] = ida
                vinculos.append((c["id_registro"], ida))
        if lst:
            sobras.append({"codigo_func": func, "mes": mes, "pendentes": len(lst)})

    # --- arquivos SQL
    os.makedirs(args.saida, exist_ok=True)
    arquivos = []
    cols = ["codigo_func", "id_registro", "nome_tarefa", "inicio_app", "fim_app", "numero_wms", "tarefa_wms",
            "aceite_wms", "conclusao_wms", "inicio_sobreposicao", "sobreposicao_seg", "data_deteccao"]

    def gravar(nome, sql):
        p = os.path.join(args.saida, nome)
        with open(p, "w", encoding="utf-8") as f:
            f.write(sql)
        arquivos.append(p)

    # conflitos novos já vão com id_alerta NULL; o vínculo é feito no passo 3
    for i in range(0, len(novos), LOTE):
        lote = novos[i:i + LOTE]
        vals = ",\n".join("(" + ", ".join(q(c[k]) for k in cols) + ")" for c in lote)
        gravar("1_conflitos_%02d.sql" % (i // LOTE + 1),
               "INSERT OR IGNORE INTO conflitos (%s) VALUES\n%s;" % (", ".join(cols), vals))
    novos_alertas = [a for a in alertas_novos if not a["ja_existia"]]
    for i in range(0, len(novos_alertas), LOTE):
        lote = novos_alertas[i:i + LOTE]
        vals = ",\n".join("(%s, %s, %s, %s, %s)" % (q(a["id_alerta"]), q(a["codigo_func"]), q(a["data_alerta"]),
                                                    q(a["descricao"]), q(a["emissor"])) for a in lote)
        gravar("2_alertas_%02d.sql" % (i // LOTE + 1),
               "INSERT OR IGNORE INTO alertas (id_alerta, codigo_func, data_alerta, descricao, emissor) VALUES\n%s;" % vals)
    for i in range(0, len(vinculos), LOTE):
        lote = vinculos[i:i + LOTE]
        casos = "\n".join("  WHEN %s THEN %s" % (q(r), q(a)) for r, a in lote)
        ids = ", ".join(q(r) for r, _ in lote)
        gravar("3_vinculo_%02d.sql" % (i // LOTE + 1),
               "UPDATE conflitos SET id_alerta = CASE id_registro\n%s\nEND\nWHERE id_registro IN (%s) AND id_alerta IS NULL;"
               % (casos, ids))

    def br(s):
        return parse(s).astimezone(BR).strftime("%d/%m %H:%M")

    resumo = {
        "janela_brasilia": "%s a %s (fim exclusivo)" % (ini.date(), fim.date()),
        "tarefas_app_verificadas": sum(1 for r in app if ini_u <= parse(r["data_inicio"]) < fim_u),
        "tarefas_wms_lidas": len(wms),
        "conflitos_novos": len(novos),
        "alertas_novos": len(novos_alertas),
        "alertas_ja_existentes_so_vinculo": len(alertas_novos) - len(novos_alertas),
        "lista_conflitos_novos": ["%s | %s-%s (%s) | %s x WMS %s%s (%s) | %s em comum" % (
            c["codigo_func"], br(c["inicio_app"]), parse(c["fim_app"]).astimezone(BR).strftime("%H:%M"),
            c["id_registro"],c["nome_tarefa"], c["numero_wms"], mais_wms(c), c["tarefa_wms"],
            fmt_dur(c["sobreposicao_seg"]))
            for c in novos],
        "lista_alertas": ["%s | %s | %s | %s" % (a["codigo_func"], a["id_alerta"], br(a["data_alerta"]), a["descricao"])
                          for a in alertas_novos],
        "pendentes_por_funcionario_mes": sobras,
        "avisos": avisos,
        "arquivos_sql_na_ordem": arquivos,
    }
    with open(os.path.join(args.saida, "resumo.json"), "w", encoding="utf-8") as f:
        json.dump(resumo, f, ensure_ascii=False, indent=1)
    print(json.dumps(resumo, ensure_ascii=False, indent=1))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("modo", choices=["consultas", "calcular"])
    p.add_argument("--ini")
    p.add_argument("--fim")
    p.add_argument("--app")
    p.add_argument("--wms")
    p.add_argument("--conflitos")
    p.add_argument("--alertas")
    p.add_argument("--saida", default="saida_conflitos")
    a = p.parse_args()
    if a.modo == "consultas":
        consultas(a)
    else:
        for k in ("app", "wms", "conflitos", "alertas"):
            if not getattr(a, k):
                sys.exit("ERRO: faltou --%s" % k)
        calcular(a)


if __name__ == "__main__":
    main()
