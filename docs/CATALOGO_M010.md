# Catálogo operacional revisado — M010

Este corte distingue **candidato histórico** de **cadastro operacional revisado**.
A planilha é a fonte histórica de verdade até a adoção formal do ERP. Seus
valores são preservados como reais, mesmo quando não seguem o padrão de novos
lançamentos. O cadastro operacional pode associar valores observados a entidades
canônicas, mas não altera o valor bruto nem reescreve a origem.

## Origem e limites

- `/api/v1/importers` lista os nomes de importador presentes em POs históricas
  no escopo do usuário. Ainda não há código oficial de empresa/filial TOTVS nem
  CRUD de importadoras. Não traduzir esses nomes para códigos externos.
- `/api/v1/suppliers/candidates`, `/products/candidates` e `/ncms/candidates`
  agrupam respectivamente os valores literais `R`, `T` e `V` das observações
  históricas **com PO**, por importador. Informam contagem e uma aba/linha de
  exemplo. As 144 linhas sem PO não entram nessa consulta porque seu importador
  não foi vinculado de forma autorizada. Valores históricos de NCM fora de oito
  dígitos continuam sendo valores reais da planilha, não erros históricos nem
  alvos de correção retroativa; o cadastro canônico de novos NCMs exige oito
  dígitos.
- As observações históricas preservam código, descrição, quantidade, preço,
  moeda, status e células brutas. A PO continua a entrada central. O IP segue
  como execução logística com vínculos muitos para muitos com as POs.

## Contrato REST

Cada um dos recursos `/api/v1/suppliers`, `/products` e `/ncms` oferece:

| Método | Caminho | Resultado |
|---|---|---|
| GET | `/` | Lista operacional com `importer`, `search`, `page`, `pageSize` e escopo aplicado antes de contagem/paginação. |
| GET | `/candidates` | Lista de valores literais da origem, separada dos cadastros. |
| GET | `/{id}` | Registro no escopo, com `ETag: "version"`; fora do escopo retorna 404. |
| POST | `/` | Cria registro operacional após revisão humana; exige `Idempotency-Key`, importador, código, nome, evidência e motivo. Replay igual retorna 200; novo registro retorna 201. |
| PATCH | `/{id}` | Altera nome, situação, evidência ou vigência; exige `If-Match` forte e motivo. Versão divergente retorna 409. Inativação preserva histórico. |

O código canônico remove somente espaços nas pontas; o valor literal enviado
fica em `catalog.entry_alias`. A unicidade por `(importer, kind, normalized_code)`
rejeita duplicação por espaço/caixa com 409. NCM exige oito dígitos e início de
vigência informado por quem revisou. Evidência e motivo são texto verificável
fornecido pelo usuário, sem validação automática do documento externo. Criar ou
editar não vincula aliases adicionais nem reclassifica observações antigas.

`Master` e `Administrador` escrevem os três tipos dentro de seus importadores.
`Compras` escreve fornecedor/produto; `Fiscal` escreve NCM. Os demais papéis
consultam. Master obtém o conjunto de importadores conhecidos; Administrador
permanece restrito aos próprios grants. `catalog.entry`, alias, recibo de
idempotência, auditoria por campo e outbox são gravados na mesma transação. A
chave de idempotência é única por ator. O log de auditoria é append-only.

## Histórico de alterações — M017

Cada linha operacional da tela **Cadastros** oferece a consulta paginada de seu
histórico. `GET /api/v1/{suppliers|products|ncms}/{id}/history` exige
`catalog.read`; a API confirma o tipo e o importador do registro no escopo da
sessão antes de consultar a view `audit.catalog_entry_history`. A view contém
somente eventos `CATALOG_ENTRY` e não concede acesso à tabela de auditoria.
Eventos são exibidos do mais recente ao mais antigo, com campo, valores anterior
e novo, ator, instante e motivo. A M017 e a interface permanecem locais até
passarem pela CI e pelo release revisado `deploy/hostinger/release-m017.sh`.

## Aceite e pendências

Na cópia restaurada, conferir candidatos, escopo restrito, 401/403/404, código
literal/normalizado, replay/conflito, `If-Match`, inativação, auditoria/outbox
e rollback de falha injetada na outbox. Na URL pública, abrir **Cadastros** e
verificar estados de carregamento, vazio e erro. Criar um cadastro real apenas
com evidência de negócio; os testes automatizados criam dados só na cópia.

M028 amplia `/catalog/values` com prioridade, unidade, solicitante, centro de
custo, despachante e agente de carga. Valores já usados nos itens de PO e nos
IPs são incluídos nas listas; isso permite selecionar e alimentar novas opções,
mas não os torna cadastros oficiais nem cria vínculos retroativos.

Continuam pendentes: empresa/filial oficial por importador; identificadores
canônicos e aliases que ligam os valores literais aos cadastros; fonte e
vigência fiscal para novos NCMs; e origem das linhas oficiais TOTVS. Essas
decisões não invalidam os valores históricos da planilha. Sem a fonte oficial
de linhas/quantidades, não calcular saldo ou atendimento quantitativo.
