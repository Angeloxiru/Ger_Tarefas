# Passo a passo para criar o projeto no claude.ai

## 1. Conectar o banco (uma vez)
1. claude.ai > Configurações > Conectores > Adicionar conector personalizado.
2. Nome: Turso. URL: https://mcp.turso.ai/mcp
3. Clique em conectar e faça login na Turso no navegador para autorizar (OAuth, sem chave de API).
4. Se a Turso pedir o escopo, escolha a organização/grupo onde está o banco "tarefas".

## 2. Habilitar criação de arquivos (para o PDF)
claude.ai > Configurações > Recursos (Capabilities) > ativar "Execução de código e criação de arquivos".

## 3. Criar o projeto
1. Projetos > Criar projeto. Nome: Bonificação Logística.
2. Descrição: o parágrafo de "DESCRIÇÃO DO PROJETO" do arquivo 1.
3. Instruções: todo o bloco "INSTRUÇÕES DO PROJETO" do arquivo 1. Sempre que o arquivo 1 mudar, colar o bloco de novo nas configurações do projeto.
4. Conhecimento do projeto:
   - 2_regras_de_calculo.md
   - 3_dicionario_de_dados.md
   - 4_modelo_relatorio_pdf.md
   - 6_padrao_relatorio_performance.md (procedimento obrigatório do relatório)
   - 7_gerador_relatorio_performance.py (código que gera o PDF)
   - 8_rotina_conflitos_alertas.md (procedimento da rotina diária de conflitos e alertas)
   - 8_rotina_conflitos_alertas.py (script da rotina diária)
   - 9_fechamento_equipe.md (procedimento do Desempenho da Equipe)
   - 9_gerador_resumo_equipe.py (código do resumo do RH, impressão e conferência)
   - Documento "Programa de Bonificação por Níveis" (política oficial)
   - Os arquivos 6 a 9 ficam dentro de uma pasta `claude/` no conhecimento do projeto.

## 4. Tarefa agendada da rotina diária
Criar no claude.ai a tarefa agendada "Rotina diária de conflitos e alertas", todos os dias às 06:00 (Brasília), pedindo para seguir o arquivo 8_rotina_conflitos_alertas.md. Ela é a única rotina com permissão de escrita no banco (INSERT em `conflitos` e `alertas` e UPDATE de `conflitos.id_alerta`).

## 5. Em cada conversa
- Ative o conector Turso no menu de ferramentas da conversa (ícone de ferramentas/conectores).
- Exemplos de pedidos:
  - "Apure os níveis de todos os funcionários em novembro/2026."
  - "Gere o PDF de performance do PL33 em novembro/2026."
  - "Liste os conflitos entre os sistemas em novembro/2026."
  - "Rode o Desempenho da Equipe de novembro/2026."

## Cuidados
- O conector da Turso também consegue alterar e apagar bancos. As instruções proíbem isso (exceto a rotina diária de conflitos), mas confira sempre o que o Claude pede para executar e não aprove ações de escrita.
- Sempre que alguém registrar alertas, atualizar cadastros ou importar o WMS, os dados novos já aparecem para o projeto (ele consulta o banco na hora).
- Mudanças nas regras ou no visual do relatório: pedir ao Claude para atualizar juntos os arquivos do grupo (seção 3 do CLAUDE.md) e registrar a decisão no histórico do arquivo 2.
