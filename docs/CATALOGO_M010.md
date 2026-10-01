# Catálogo operacional revisado — M010

Este corte distingue **candidato histórico** de **cadastro operacional revisado**.
Nenhuma linha da PO TOTVS, fornecedor oficial, unidade, saldo ou NCM fiscal é
inferida da planilha. O cadastro manual não altera observações de origem e não
atribui automaticamente um produto ou fornecedor a uma PO.

## Origem e limites

- `/api/v1/importers` lista os nomes de importador presentes em POs históricas
  no escopo do usuário. Ainda não há código oficial de empresa/filial TOTVS nem
  CRUD de importadoras. Não traduzir esses nomes para códigos externos.
- `/api/v1/suppliers/candidates`, `/products/candidates` e `/ncms/candidates`
  agrupam respectivamente os valores literais `R`, `T` e `V` das observações
  históricas **com PO**, por importador. Informam contagem e uma aba/linha de
  exemplo. As 144 linhas sem PO não entram nessa consulta porque seu importador
  não foi vinculado de forma autorizada. NCM com formato diferente de oito
  dígitos aparece como candidato inválido; não é corrigido automaticamente.
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

## Aceite e pendências

Na cópia restaurada, conferir candidatos, escopo restrito, 401/403/404, código
literal/normalizado, replay/conflito, `If-Match`, inativação, auditoria/outbox
e rollback de falha injetada na outbox. Na URL pública, abrir **Cadastros** e
verificar estados de carregamento, vazio e erro. Criar um cadastro real apenas
com evidência de negócio; os testes automatizados criam dados só na cópia.

Continuam pendentes: empresa/filial oficial por importador; documentos/códigos
aprovados de fornecedor; política de aliases múltiplos e conflitos de atributos
de produto; fonte e vigência fiscal de NCM; lista de unidades; origem das linhas
oficiais TOTVS, finalidade e centro de custo. Sem essas decisões, RF02/DEV06 e
RF05 permanecem parciais. Não calcular saldo ou atendimento quantitativo.
