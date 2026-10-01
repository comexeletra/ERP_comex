# Tabela de auditoria da origem

A página `/source-audit` exibe as linhas preservadas de `migration.source_row` em uma grade ampla, semelhante a uma planilha. A planilha é a fonte histórica de verdade enquanto o ERP não for formalmente adotado como padrão da operação. Os valores históricos são reais conforme registrados; a única revisão de conteúdo pendente são células com erro de cálculo do Excel. Valores fora do padrão de colunas futuras devem continuar visíveis e inalterados. Todas as datas da interface usam `MM/DD/YYYY` (mês/dia/ano), ou `MM/DD/YYYY HH:mm` quando exibem horário. Entradas aceitam `MM/DD/YYYY` e validam uma data real. A apresentação não altera os valores históricos armazenados.

## Uso

- As abas `Pré Embarque` e `Pós Embarque` mostram as colunas mapeadas nesta versão, identificadas pela letra da coluna Excel. `Todas as linhas` combina as duas abas; células que não pertencem àquela aba ficam vazias. O usuário informou que a planilha atual recebeu colunas adicionais; a grade ainda usa os intervalos fixos `B:AZ` e `B:AS`. Cobertura dessas colunas novas está pendente até receber a versão atualizada do arquivo.
- O botão `Filtro` sob cada cabeçalho abre um menu de planilha com valores distintos selecionáveis, ordenação crescente/decrescente, campo de texto por trecho e busca dentro da lista de valores. A lista mostra até 200 possibilidades por vez; use a busca do menu para localizar valores adicionais. Vários filtros de coluna são combinados por AND.
- Importador, busca geral e sinais da origem podem ser combinados com os filtros de coluna. Os sinais mostram falta de PO, falta de IP válido e células com erro de cálculo; a falta de PO/IP reproduz o preenchimento histórico e não é declarada erro.
- A grade fixa linha, aba e indicadores de auditoria durante a rolagem horizontal. O número de linha é o da origem; passe sobre ele para ver o identificador do lote.
- A tela pagina os resultados em 25, 50 ou 100 linhas. Totais e indicadores respeitam o escopo do usuário e os filtros de busca/importador/coluna; o filtro de categoria de gap só reduz as linhas exibidas.

## Acesso e semântica

`GET /api/v1/source-rows` e `GET /api/v1/source-rows/column-values` exigem `processes.read`. Ambas restringem o conjunto por `authorizationContext.importerScopes`; o endpoint de valores aplica os demais filtros e exclui o filtro da própria coluna para oferecer opções dependentes. Os valores das células são entregues do JSON preservado da origem; linhas, observações de PO, POs e processos são lidos sem escrita. O indicador de erro da planilha vem exclusivamente de `source_row.error_columns`, que preserva as colunas com erro do Excel.

Os indicadores são sinalizadores para auditoria, não conclusões contábeis ou fiscais nem declaração de que a planilha está errada. `Sem PO` considera a coluna `N` da aba Pré Embarque; a aba Pós Embarque não possui esse campo. `Sem IP válido` considera `AB` em Pré Embarque e `B` em Pós Embarque, excluindo vazio, cancelado e marcador `#`; a ausência reproduz o estado real da planilha. Problemas de qualidade devem apontar células com erro de cálculo do Excel. Formatos históricos não padronizados são mantidos como reais, sem correção retroativa. A tela não altera a origem.

Enquanto a planilha continuar sendo a fonte mestra, uma nova versão poderá ser enviada para incorporar novas colunas, entidades e valores. Cada reenvio deve gerar um snapshot com hash e prévia de diferenças, sem sobrescrever silenciosamente o histórico; novas colunas precisam ser descobertas e expostas pela grade.

Não há migration para esta entrega. O endpoint deve continuar protegido pela autenticação/gateway já existentes e conservar a paginação antes de devolver linhas ao navegador.
