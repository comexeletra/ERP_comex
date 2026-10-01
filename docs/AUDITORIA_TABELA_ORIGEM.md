# Tabela de auditoria da origem

A página `/source-audit` exibe as linhas preservadas de `migration.source_row` em uma grade ampla, semelhante a uma planilha. Ela é somente leitura e não promove valores históricos a cadastros ou dados operacionais.

## Uso

- As abas `Pré Embarque` e `Pós Embarque` mostram todas as colunas originais mapeadas, identificadas pela letra da coluna Excel. `Todas as linhas` combina as duas abas; células que não pertencem àquela aba ficam vazias.
- Os campos sob cada cabeçalho aplicam uma busca por trecho de texto. Vários filtros de coluna são combinados por AND. Pressione Enter em um filtro ou use `Aplicar filtros`.
- Importador, busca geral e categoria de gap podem ser combinados com os filtros de coluna. A busca por gap inclui falta de PO, falta de IP válido e problemas abertos de qualidade ou erros de célula.
- A grade fixa linha, aba e indicadores de auditoria durante a rolagem horizontal. O número de linha é o da origem; passe sobre ele para ver o arquivo importado.
- A tela pagina os resultados em 25, 50 ou 100 linhas. Totais e indicadores respeitam o escopo do usuário e os filtros de busca/importador/coluna; o filtro de categoria de gap só reduz as linhas exibidas.

## Acesso e semântica

`GET /api/v1/source-rows` exige `processes.read`. A consulta restringe o conjunto por `authorizationContext.importerScopes` antes de contagens, filtragem e paginação. Os valores das células são entregues do JSON preservado da origem; `source_row`, `data_issue`, POs e processos são lidos sem escrita.

Os indicadores são sinalizadores para revisão, não conclusões contábeis ou fiscais. `Sem PO` considera a coluna `N` da aba Pré Embarque; a aba Pós Embarque não possui esse campo. `Sem IP válido` considera `AB` em Pré Embarque e `B` em Pós Embarque, excluindo vazio, cancelado e marcador `#`. Problemas de qualidade consideram pendências abertas e células com erro da importação. A tela não corrige a origem nem infere fornecedor, produto, NCM, unidade ou saldo oficial.

Não há migration para esta entrega. O endpoint deve continuar protegido pela autenticação/gateway já existentes e conservar a paginação antes de devolver linhas ao navegador.
