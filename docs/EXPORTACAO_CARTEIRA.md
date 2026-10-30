# Exportações Excel

As telas **Carteira de POs** (`/`), **Carteira por produto** (`/purchase-orders/lines`) e **End to End**
(`/end-to-end`) exportam a lista filtrada para Excel. O botão de exportar abre a janela de escolha de colunas:

- a janela oferece somente as colunas de dado da tabela da tela, na ordem da tabela e com os mesmos nomes, no idioma
  selecionado; o arquivo usa esses nomes como cabeçalho;
- as colunas obrigatórias ficam sempre marcadas: `PO TOTVS` na carteira de POs; `PO` e `Produto` nas outras duas;
- na Carteira por produto, `Produto` sai em duas colunas (código e descrição), como aparece na célula da tabela;
- no End to End, as colunas das etapas T0 a T5 são escolhidas numa grade de etapas e medidas; a coluna
  "Atraso acumulado até Tx" só existe quando a tela está na visão acumulada de uma etapa, como na tabela, e as datas
  previstas saem em itálico;
- a escolha fica salva no navegador, separada por tela; ao abrir pela primeira vez, todas as colunas vêm marcadas.

O arquivo respeita os filtros aplicados e o escopo do usuário. Na carteira de POs, inclusive o filtro de ciclo (ativas,
encerradas, canceladas, excluídas ou todas). A carteira de POs não inclui saldos nem valores monetários.

Os valores (status, datas) saem como a API os guarda, em português. Cada exportação é limitada a 5.000 POs ou 30.000 linhas de produto. A tela
acompanha a tarefa na fila e baixa o arquivo quando o worker termina. As planilhas ficam disponíveis por 24 horas.

**Regra:** a exportação acompanha a tabela. Ao mudar uma coluna de dado numa dessas tabelas, atualize o catálogo da API
(`apps/api/src/export-columns.ts`), o espelho do web (`apps/web/lib/export-columns.ts`) e os textos nos três idiomas,
no mesmo commit. Os testes `apps/api/test/export-columns.test.mjs` e `apps/web/test/export-columns.test.mjs` falham
quando a tabela e o catálogo divergem. Decisões em `docs/PLANO_EXPORTACAO_COLUNAS.md`.
