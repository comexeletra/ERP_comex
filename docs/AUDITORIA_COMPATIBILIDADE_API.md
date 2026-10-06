# Auditoria de compatibilidade da API

Verificada em 2026-10-06 comparando as chamadas do Next.js com o código M021,
último release registrado antes desta auditoria (`ed1fc25`), e com o roteador
local. A comparação encontrou incompatibilidades entre frontend e API.

**Resolução:** M022–M024 foram validadas em cópia restaurada e publicadas na
VPS. O ledger terminou em 24/24, health autenticado respondeu 200, e
`GET /api/v1/processes/:id/followup` respondeu 401 sem sessão (rota existente).
O commit `49fd6fc85390` está `READY` na Vercel Production e atende o alias
`fup-comex-eletra.vercel.app`. Evidências, backup e rollback estão em
[`deploy/hostinger/README.md`](../deploy/hostinger/README.md).

## Incompatibilidades encontradas

| Chamada da interface | M021 documentada | Efeito e tratamento |
| --- | --- | --- |
| `POST /api/v1/purchase-orders/complete` | Não existe | O formulário usa as rotas antigas por etapa como fallback. |
| `PATCH /api/v1/purchase-orders/:id/items/followup` | Não existe | A interface salva item a item em M021. Uma falha parcial é informada. |
| `GET /api/v1/processes/:id/followup` | Não existe | Causava o HTTP 404 do painel Pós Embarque. A tela agora verifica o suporte ao ciclo do IP em `GET /processes/:id` antes de chamar esta rota; na M021, não faz a chamada incompatível e exibe POs/distribuições disponíveis. |
| `POST /api/v1/processes/:id/close` e `/reopen` | Não existem | A interface oculta essas ações se a resposta do IP não tiver `lifecycleStatus`. |
| `events`, histórico de alterações do IP/PO | Estrutura M022 | Não existia na API M021; migrations e API foram publicadas coordenadamente em 2026-10-06. |
| `actualPortDepartureDate` | Campo M024 | Não existia na M021; migration e API M024 foram publicadas juntas em 2026-10-06. |

As rotas de gravação do Pós Embarque e dos documentos já existiam em M021; a
lacuna que produziu o erro apresentado é especificamente a rota **GET** usada
para compor a tela. Os contratos automatizados atuais verificam a API local
atual e, por si só, não detectam diferenças para uma versão remota antiga.

## Associação PO–IP

Cadastrar um IP cria o registro do IP. Isso, isoladamente, não o associa a uma
PO. Na tela da PO, o cadastro rápido seleciona o IP recém-criado; para persistir
o vínculo operacional, ainda é necessário informar a quantidade e acionar
“Distribuir quantidade”. Essa ação grava item da PO, IP e quantidade. O IP
também pode reunir distribuições de várias POs. A mensagem após criar IP foi
ajustada para explicitar o próximo passo.

Se ainda não houver distribuição, o IP corretamente mostrará zero POs
operacionais. POs ligadas por importação histórica aparecem separadamente dos
vínculos feitos por distribuição.

## Compatibilidade e fluxo PO–IP

O fallback continua evitando que uma API antiga esconda associações já gravadas;
ele não cria associação automaticamente. Cadastrar um IP pela PO o seleciona,
mas o vínculo só é gravado depois de informar quantidade e acionar “Distribuir
quantidade”. O fluxo completo está publicado com M022–M024; evidências e
rollback constam em `deploy/hostinger/README.md`.
