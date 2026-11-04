# Tarefa: filtros com seleção múltipla no End to End

Aprovada pelo usuário em 2026-11-04.

## Objetivo

Os filtros de lista do End to End passam a aceitar mais de um valor, como no Power BI: caixas de marcar, "Selecionar tudo" e busca.

## Requisitos

1. PO, Importadora, Produto, IP, Status, Grupo e Finalidade viram listas com caixa de marcar por valor, busca no topo e "Selecionar tudo".
2. "Selecionar tudo" marcado, ou nenhum valor marcado, significa sem filtro ("Todas"). Com parte dos valores marcada, "Selecionar tudo" fica no estado intermediário.
3. Com texto na busca, "Selecionar tudo" marca ou desmarca só os resultados visíveis.
4. Fechado, o campo mostra "Todas", o valor escolhido (quando é um só) ou "N selecionados".
5. A filtragem compara o valor exato (sem diferenciar maiúsculas e espaços nas pontas) com qualquer um dos escolhidos. PO, Importadora, Produto e IP do End to End deixam de buscar por trecho.
6. Gráfico de status: o clique escolhe só aquele status, Ctrl+clique (ou Cmd+clique) adiciona ou remove o status da seleção, e clicar no único status selecionado limpa.
7. Os valores se aplicam à tabela, ao resumo, aos gráficos e à exportação, e ficam na URL como chave repetida (`?group=A&group=B`).
8. Um status fechado (ENTREGUE, CANCELADO) entre os escolhidos vale mais que a Situação "Em aberto".
9. Textos novos nos três idiomas.

## Restrições

- Etapa atual, Tipo de demanda, Situação e datas continuam com escolha única.
- A Carteira por produto continua igual na tela (texto com busca por trecho e um único status); a API mantém os parâmetros dela.
- Componente com tokens, `Tooltip`, menu no portal como o `SearchableSelect`, teclado (setas, espaço, Esc) e regras em `components.css`.
- Até 500 valores por campo na API (400 acima disso).

## Contrato da API

`GET /api/v1/purchase-order-lines`, `GET /api/v1/purchase-order-lines/e2e-stages` e `POST /api/v1/exports/purchase-order-lines`:

| Parâmetro | Antes | Agora |
| --- | --- | --- |
| `status`, `group`, `purpose` | um valor | um ou mais (chave repetida na URL, array no JSON), comparação exata |
| `importers`, `purchaseOrders`, `ipNumbers`, `productCodes` | — | listas exatas, novas |
| `importer`, `purchaseOrder`, `ipNumber`, `product` | trecho | sem mudança (Carteira por produto) |

## Fora do escopo

- Seleção múltipla em outras telas, em Etapa atual e em Tipo de demanda.
- Ctrl+clique nos gráficos de prazo e de faixa de atraso.

## Plano

1. API: schema com listas, SQL com `ANY`, regra Status × Situação, resumo e testes.
2. Web `lib/`: filtros com listas, URL, corpo da API e exportação, com testes.
3. Componente `MultiSelectFilter` (CSS, i18n, testes) no formulário do End to End.
4. Gráfico de status com seleção múltipla e Ctrl+clique.
5. Verificação completa, push para `homologacao`, release da API no HML e validação.
