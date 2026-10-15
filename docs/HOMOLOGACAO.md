# Ambiente de homologação

A branch `homologacao` gera deployments Preview para validação antes de qualquer
promoção para `main`.

O Preview deve apontar exclusivamente para o banco vazio `erp_po_totvs_hml` e
para a API isolada de homologação. As variáveis `PREVIEW_PUBLIC_ORIGIN`,
`PREVIEW_API_URL` e `PREVIEW_API_TOKEN` devem existir somente no escopo Preview
da Vercel. O segredo da API não deve ser registrado neste repositório.

Configure `PREVIEW_PUBLIC_ORIGIN` com o alias HTTPS estável da branch e use o
mesmo valor em `APP_PUBLIC_ORIGIN` na API. Não promova nem mescle esta branch em
`main` como parte dos testes.
