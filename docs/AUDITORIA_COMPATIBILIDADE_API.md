# Auditoria de compatibilidade da API

Verificada em 2026-10-06 comparando as chamadas do Next.js atual com o código
M021, último release documentado na VPS (`ed1fc25`), e com o roteador local
atual. A VPS não foi consultada nesta auditoria; M021 é a versão registrada nos
checklists, não uma confirmação do estado remoto ao vivo.

## Incompatibilidades encontradas

| Chamada da interface | M021 documentada | Efeito e tratamento |
| --- | --- | --- |
| `POST /api/v1/purchase-orders/complete` | Não existe | O formulário usa as rotas antigas por etapa como fallback. |
| `PATCH /api/v1/purchase-orders/:id/items/followup` | Não existe | A interface salva item a item em M021. Uma falha parcial é informada. |
| `GET /api/v1/processes/:id/followup` | Não existe | Causava o HTTP 404 do painel Pós Embarque. A tela agora verifica o suporte ao ciclo do IP em `GET /processes/:id` antes de chamar esta rota; na M021, não faz a chamada incompatível e exibe POs/distribuições disponíveis. |
| `POST /api/v1/processes/:id/close` e `/reopen` | Não existem | A interface oculta essas ações se a resposta do IP não tiver `lifecycleStatus`. |
| `events`, histórico de alterações do IP/PO | Estrutura M022 | Não disponível na API M021. O histórico local requer a publicação coordenada de M022–M024. |
| `actualPortDepartureDate` | Campo M024 | Não disponível até a migration e o código M024 serem publicados juntos. |

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

## Limite e publicação necessária

O fallback evita que o 404 esconda associações já gravadas, mas não cria
associação automaticamente nem substitui a leitura de documentos, eventos e
campos novos. Para habilitar o fluxo completo, validar M022–M024 em cópia
restaurada e publicar migrations e API coordenadamente, conforme
`deploy/hostinger/README.md`. Essa auditoria e a alteração de interface não
executam mudanças na VPS ou no banco operacional.
