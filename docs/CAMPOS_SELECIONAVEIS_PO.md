# Campos selecionáveis do cadastro PO/IP

Os formulários de PO e IP devem usar seletores para valores controlados. A tela
de preenchimento não permite criar opções diretamente: a manutenção fica em
**Cadastros → Valores das entidades** (`/catalog/values`). Essa tela grava
auditoria e publica os novos valores para os formulários.

| Campo | Entidade de opções | Onde manter valores |
| --- | --- | --- |
| Importadora | Importer | `/catalog/values`; novas opções também precisam de escopo atribuído ao usuário. |
| Fornecedor | Supplier | Opções históricas observadas e cadastros ativos de `/catalog` → Fornecedores. |
| Descrição e código do produto | Product | Pares código/descrição observados e produtos ativos de `/catalog`; escolher a descrição preenche o código. |
| Incoterm, modal, POL, POD e moeda | Entidade correspondente | `/catalog/values` |
| Categoria, grupo, finalidade e demanda | Entidade correspondente | `/catalog/values` |
| Status, canal aduaneiro e tipo de container | Entidade correspondente | `/catalog/values` |

M021 cria as entidades de opções e carrega valores distintos já encontrados
nas colunas das abas Pré e Pós. Produtos e fornecedores aparecem como opções
com base nos pares e nomes observados na origem, além dos cadastros ativos. Isso
não altera nem associa automaticamente as linhas históricas. As opções continuam
extensíveis na tela própria ou no catálogo revisado.
Datas, diferenças, totais, alertas e conferências permanecem calculados pela
API, de acordo com `ACOMPANHAMENTO_CALCULOS_PO.md`.

O cadastro oficial de fornecedor/produto exige confirmação no catálogo
existente. As opções históricas permitem transcrever um pedido sem converter
automaticamente ou reescrever os registros antigos.
