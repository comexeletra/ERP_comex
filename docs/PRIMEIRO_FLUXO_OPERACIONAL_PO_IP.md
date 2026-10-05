# Primeiro fluxo operacional de PO e IP

Publicado em 2026-10-04 na VPS e na Vercel. **Ainda falta o aceite funcional com
analistas antes de substituir a ferramenta de preenchimento.** A migration M018
passou em PostgreSQL isolado, em cópia restaurada do banco operacional e no banco
operacional. A API e a interface do commit `3fc1ee8` estão publicadas.

## Fluxo entregue no código

1. Cadastrar uma referência de PO que já existe no TOTVS e editar fornecedor,
   data e observações. O cadastro local não cria nem altera a PO no TOTVS.
2. Cadastrar e editar IP, incluindo status, prioridade e observações.
3. Adicionar e corrigir itens transcritos da PO: linha externa opcional, produto,
   quantidade pedida, unidade e preço/moeda opcionais.
4. Distribuir uma quantidade do item para um IP da mesma importadora; consultar
   pedido informado, distribuído e restante por item; editar ou cancelar a
   distribuição. O IP pode atender várias POs, e uma PO pode usar vários IPs.
5. Rejeitar distribuição acima da quantidade informada e redução do pedido abaixo
   do total já distribuído. Uma trava na linha do item serializa alterações
   simultâneas. Comandos usam escopo da importadora, versão, auditoria e outbox.

O saldo exibido é **saldo da transcrição operacional**, sem confirmação automática
com o TOTVS. Observações históricas da planilha permanecem separadas.

## Aceite antes de trocar a ferramenta de preenchimento

- M018 e `operations.integration.mjs` passaram num PostgreSQL 17 isolado em
  2026-10-04. O teste cobre PO em dois IPs, IP com duas POs, excesso de
  quantidade, correção, cancelamento, versão, escopo e concorrência.
- Na VPS, o mesmo teste passou em cópia restaurada antes da migration operacional.
  O backup verificado é
  `/var/backups/import-erp/erp_po_totvs_test_20261005T003022Z.dump`, SHA-256
  `0d4ffe5038b3b1c72f35184630aaf9e3fb07d9859260e3bab9455fa201762bff`.
  O ledger operacional está em 18/18, a API está ativa e o HTTPS público da API
  respondeu 200 no health check autenticado.
- Confirmar com analistas os campos mínimos e a identidade da linha do TOTVS.
- Executar uma PO dividida entre dois IPs e um IP com duas POs em paralelo com
  o trabalho atual, sem alterar a carga histórica.
- Validar com os analistas o preenchimento e os cálculos de Invoice, BL, NF,
  marcos, desembaraço e custos publicados em M019–M020. As regras e seus limites
  estão em [ACOMPANHAMENTO_CALCULOS_PO.md](ACOMPANHAMENTO_CALCULOS_PO.md).

O código anterior da API foi preservado em
`/var/backups/import-erp/m018-api-20261005T003032Z`. A Vercel marcou o deployment
`dpl_A8eyBHpHvvVJmZ2tKtJ3sDuoAFiJ` como `READY` para `3fc1ee8`, com alias
`https://fup-comex-eletra.vercel.app`. O push ao GitHub acionou esse deployment
automaticamente; a compatibilidade completa foi restabelecida após a migration e
a publicação da API. Em futuros releases dependentes de migration, controlar a
sequência do deploy da interface.
Uma planilha mais atual será enviada posteriormente; sua importação histórica e
reconciliação são uma etapa separada deste fluxo operacional.
