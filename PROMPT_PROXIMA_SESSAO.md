# Prompt para a próxima sessão — RF06 / DEV13

Continue o desenvolvimento do ERP Comex a partir do estado real do repositório.
Leia primeiro a seção **Estado atual — 2026-09-30** de
`CHECKLIST_IMPLEMENTACAO.md` e, no
`Plano_Implementacao_ERP_PO_TOTVS.md`, as seções **2.2**, **13.2**, **14.2**,
**24.1**, **30.1** e **31**. Os trechos antigos do checklist são histórico,
inclusive os que ainda dizem que a Vercel responde 404 ou que não há dados.

## Objetivo

Revisar com dados reais e avançar a **RF06 — carteira central e detalhe das POs
TOTVS (DEV13)**. A PO é a entrada principal; o IP é uma execução logística
ligada a uma ou mais POs. Entregue um primeiro incremento funcional completo e
verificável na carteira/detalhe, com backend, tela e testes proporcionais ao
risco. Registre separadamente os requisitos que ainda dependem de itens
oficiais TOTVS, confirmação de fornecedor, saldo ou regras de alocação.

## Contexto operacional

- Frontend Next.js na Vercel: `https://fup-comex-eletra.vercel.app/`.
- API Fastify e PostgreSQL na VPS Hostinger. O banco em uso é
  `erp_po_totvs_test`, apesar do nome. M001–M009 aplicadas. O usuário já
  conseguiu entrar com login local; o Master cria e administra os acessos.
- Commit de referência: `9a1175e`. A carga aprovada tem 7.130 source rows,
  336 POs, 6.796 observações com PO, 200 IPs, 449 vínculos PO–IP,
  422 custos históricos e 451 pendências de qualidade. Há 144 linhas sem PO;
  5.152 observações com PO têm IP válido e 1.644 não têm.
- O backup posterior à carga é
  `/var/backups/import-erp/erp_po_totvs_test_20260930T162926Z.dump` e foi
  restaurado e conferido. A chave SSH temporária anterior foi removida.
- A planilha `Follow Up Import 2026.xlsx` é ignorada pelo Git. O computador
  corporativo serve para editar e inspecionar; execução da aplicação, build,
  testes integrados e banco ficam na VPS. Preserve `hast.md` e
  `api-migration-test.tar.gz`, que são não rastreados.

## Trabalho desta sessão

1. Compare a carteira, o detalhe, as três rotas de leitura de PO e seus testes
   com os critérios RF06/DEV13. Identifique o que funciona, o que está
   incompleto e o que exige uma decisão de negócio. Não trate campos brutos do
   Excel como fornecedor, saldo ou item oficial confirmado.
2. Valide os casos de aceite de leitura: 336 POs paginadas em 50 por página;
   busca por PO 18751 e 18223; histórico completo e linhagem até aba/linha;
   PO com vários IPs; IP compartilhado por várias POs; custo mostrado no IP sem
   somá-lo indevidamente como custo integral de cada PO. Confirme escopo por
   importador e respostas 401/403/404 sem pedir senha ao usuário.
3. Implemente o primeiro conjunto de melhorias de RF06 que já tem dados e
   regras suficientes: filtros de PO, importador, produto e IP utilizáveis na
   tela; paginação com total de páginas; estados de carregamento, vazio e erro
   corretos; navegação clara entre carteira e detalhe. Ajuste a API apenas
   quando necessário. Preserve as observações históricas e a distinção entre
   dado de origem e dado operacional.
4. Execute build e testes na VPS, preferencialmente contra cópia restaurada
   quando houver alteração de banco. Depois de verificar o resultado, publique
   o código no repositório de produção e confirme o deploy. Se for necessário
   novo acesso à VPS, prepare o trabalho independente primeiro e peça uma
   única autorização de chave, sem solicitar senhas ou tokens no chat.
5. Atualize o checklist com evidência, status de RF06/DEV13, lacunas restantes
   e próximo passo. Informe ao usuário o que pode testar na URL pública e o
   que ainda não está disponível.

Critério de conclusão deste incremento: carteira e detalhe utilizáveis com a
carga real, filtros e paginação coerentes com 336 POs/6.796 observações,
autorização preservada e evidência de teste. **RF06 só será marcada concluída
quando todos os critérios do plano estiverem implementados e aceitos.**
