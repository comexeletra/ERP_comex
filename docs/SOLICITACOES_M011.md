# Solicitações nativas — M011

## Corte implementado

M011 cria `procurement.import_request` e `procurement.import_request_item`,
separados de `migration.source_row` e das observações históricas de PO. O
servidor gera o número `SR-AAAA-NNNNNN`, mantém status inicial `SUBMITTED`,
versão, importador observado, referência do solicitante, motivo obrigatório,
itens descritos pelo solicitante e campos livres opcionais de finalidade/centro
de custo. `source_kind=NATIVE` impede que este fluxo seja confundido com linhas
importadas. O solicitante autenticado é gravado como autor.

`POST /api/v1/requests` exige papel `Importação`, `Administrador` ou `Master`,
escopo explícito de importador e `Idempotency-Key`. O handler valida que o
importador existe em PO/IP operacional. Solicitação, itens, recibo idempotente,
auditoria e outbox são gravados numa única transação. Repetição do mesmo payload
retorna a solicitação existente; mesma chave com payload diferente retorna 409.
Lista e detalhe aplicam o escopo antes de revelar solicitações. GETs devolvem
ETag baseado em `version`. M012 acrescentou PATCH com `If-Match` para editar
solicitações `SUBMITTED` no escopo do usuário, mantendo itens, auditoria e
outbox na mesma transação. M013 acrescenta
`GET /api/v1/requests/{id}/history`, com paginação e resumo dos campos alterados,
após validar o escopo antes de consultar a auditoria. Ainda não existe comando
de transição de status.

Tela: `/requests`. Permite registrar itens como descrições fornecidas pelo
solicitante e consultar as solicitações recentes. A tela declara que finalidade
e centro de custo são referências livres e ainda não oficiais. Nenhuma linha
histórica cria uma solicitação ou ganha associação por este corte.

## Pendências para fechar RF03

- Validar em produção e homologar no navegador com Master e usuário restrito
  reais; o papel `Importação` somente escreve no escopo concedido.
- Aprovar catálogo e regras de finalidade, centro de custo, unidade, produto e
  captura de quantidade/data necessária. Esses campos não foram fabricados nem
  promovidos da planilha.
- Definir workflow, transições, cancelamento, permissões, eventos e
  pré-condições antes de habilitar mudanças de status.
- Definir regra de conversão das linhas históricas sem IP/sem PO e evidência da
  identidade do destino; tratar status legado entregue/cancelado e concorrência.
  Até lá, filas continuam de leitura e não alimentam solicitações nativas.

O módulo permanece parcial enquanto esses critérios e a homologação formal não
forem demonstrados (Plano, seções 13.2 e 28).
