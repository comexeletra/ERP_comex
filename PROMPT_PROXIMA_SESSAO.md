# Prompt para a próxima sessão — ERP Comex após RF03/DEV14 M011

Continue do estado real do repositório e leia primeiro **Estado atual —
2026-10-01** em `CHECKLIST_IMPLEMENTACAO.md`. Consulte
`Plano_Implementacao_ERP_PO_TOTVS.md`, em especial 2.2, 6.1, 9, 10, 13.2,
14.2, 20, 24.1, 26 e 28. Registros antigos do checklist são históricos.

## Estado de partida

- Produção: `https://fup-comex-eletra.vercel.app/`, Next.js na Vercel, Fastify
  e PostgreSQL na VPS Hostinger. O banco operacional é `erp_po_totvs_test`
  **apesar de `_test`**; não é descartável. M001–M011 estão aplicadas.
- RF02/DEV06 ganhou catálogo manual revisado nos commits `af9e297`,
  `992adf9`, `309824e` e `4463493`. Vercel
  `dpl_B6gFiKAdHZmcyb6sXh8cbZA1np9L` está `READY` no alias público.
  `/catalog` e a carteira pública responderam 200; rotas de catálogo anônimas,
  401. API `systemd` ativa e HTTPS ready 200. Reversão da API:
  `/var/backups/import-erp/m010-api-af9e297-20261001T113550Z`.
- RF03/DEV14 commit `6a74f4b` está publicado. Vercel
  `dpl_DVDRS8TtDjs9ffW5254s2VQL4Q43` `READY` no alias público;
  `/requests` respondeu 200 e API anônima 401. M011 cria solicitação nativa e
  itens descritos pelo solicitante, com número interno, versão, autor, escopo,
  motivo, chave idempotente e auditoria/outbox. Lista e detalhe estão
  disponíveis. Backup anterior à migration:
  `/var/backups/import-erp/erp_po_totvs_test_20261001T121101Z.dump`, SHA-256
  `394c5def6653be18a4c74f749974603167611673df8b35f762850fb66e7e84fb`;
  rollback do código da API em
  `/var/backups/import-erp/rf03-m011-api-20261001T121107Z`.
- RF13 recebeu a visão `/source-audit` no commit `1c718ab`, já publicado na
  produção. A tela responde 200; mostra as linhas das duas abas em grade,
  filtros por coluna, busca, categorias de gaps, indicadores e paginação. A
  API read-only respeita o escopo de importador; chamada sem sessão retorna
  401. Serviço ativo e ready HTTPS 200. Sem migration ou alteração do banco;
  rollback da API em `/var/backups/import-erp/source-audit-api-20261001T125916Z`.
  O registro da entrega e seus limites está em `CHECKLIST_IMPLEMENTACAO.md` e
  `docs/AUDITORIA_TABELA_ORIGEM.md`.
- Hotfix `852254e` corrigiu o `500` observado pelo usuário: a role de runtime
  não tem SELECT em `migration.import_batch`; a consulta agora não lê essa
  tabela e mantém o ID do lote sem ampliar grants. API reimplantada e pronta;
  backup de reversão em `/var/backups/import-erp/source-audit-api-20261001T131042Z`.
- A solicitação seguinte adicionou filtros no estilo Excel. Commit `187f0d4`
  publicado: o menu por coluna lista valores distintos selecionáveis, busca
  opções, mantém o filtro de texto e ordena crescente/decrescente. A API foi
  compilada e as opções/seleção/ordenação passaram em handler real na VPS em
  transação `READ ONLY` com escopo ELETRA CWB. Backup de reversão da API:
  `/var/backups/import-erp/source-audit-api-20261001T140519Z`.
- Backup pré-M010 restaurado:
  `/var/backups/import-erp/erp_po_totvs_test_20261001T113403Z.dump`, SHA-256
  `4fcc31fdb6cb530f89f308bfbd7ac7a505d078891f0c46eb7a608ff3ed204e86`.
  A M010 passou antes em cópia isolada, inclusive 401/403/404, escopo,
  idempotência, `If-Match`, auditoria e rollback da outbox. Builds API/web,
  20 testes existentes e leitura `READ ONLY` operacional passaram na VPS.
- Carga histórica inalterada: 7.130 linhas de origem, 336 POs, 6.796
  observações com PO, 200 IPs, 449 vínculos PO–IP, 422 custos históricos e
  451 pendências. O catálogo operacional está vazio até revisão humana real.
  Observações da origem são candidatos, não fornecedor/produto/NCM oficiais.
- O usuário autorizou VPS e publicação neste histórico. A chave privada SSH
  permanece somente no checkout em
  `C:\04_Portal_analytics\ERP_interno_Import\Import_eletra\.local-keys\rf06_ed25519`;
  a pública tem `.pub`. Fingerprint:
  `SHA256:S5y5JFC6znJh9aId1V6GLzIjYsnQ9x963Pti7wL7ivs`. Não mostrar nem
  versionar a privada. Preservar os não rastreados `hast.md` e
  `api-migration-test.tar.gz`.
- O computador corporativo serve para edição/inspeção. Instalação congelada,
  builds, testes integrados e banco ficam na VPS. Antes de cada migration,
  validar uma cópia restaurada e fazer backup verificável do operacional.

## Próxima atividade prioritária

Homologue RF03/DEV14 e as leituras RF06/RF04/catalog com Master e usuário de
Importação com escopo real na URL pública. Não cadastre amostras fictícias no
banco operacional. Se houver solicitação operacional real aprovada, confirme
criação/lista/detalhe, numeração server-side, autoria, importador e motivo.
Usuários restritos devem ver apenas seu escopo; `/api/v1/requests` sem sessão
deve continuar 401. RF03 permanece parcial até validar workflow/edição com
`If-Match`, campos de item exigidos, permissões e aceite formal.

Registre com Product Owner de Importação/Compras se quantidade, unidade e
produto oficial precisam existir antes da submissão; quem aprova finalidade e
centro de custo; estados e transições de solicitação; e regra de cancelamento.
Identifique Compras/TI TOTVS para empresa/filial e identidade de fornecedor,
Fiscal para NCM/vigência e Dados/Compras para aliases conflitantes. Mantenha os
itens livres atuais rotulados como texto informado pelo solicitante.

Em paralelo, obtenha homologação real de leitura RF06/RF04 e do novo catálogo
com Master e usuário restrito. O teste anterior de escopo usou grant sintético
sobre dados reais. Identifique quem aprova mapeamento de empresa/filial TOTVS,
identidade de fornecedor, aliases conflitantes, classificação NCM e unidades.
Não promova células R/T/V, unidade ou saldo a dado oficial sem confirmação.

## Dependências para os incrementos seguintes

1. Completar RF02/DEV06 com importadoras oficiais, aliases adicionais com
   revisão de conflitos e vigência aprovada; RF05 com itens operacionais
   explicitamente separados dos históricos e das linhas oficiais TOTVS.
2. Completar RF03/RF04 com associação auditada e workflow de IP somente após
   definir prova da identidade de destino, tratamento de status histórico
   entregue/cancelado, permissão do comando e invariantes concorrentes.
3. RF06/DEV16, RF07/DEV17, RF11/DEV23 e RF12/DEV24: linhas oficiais e saldos
   após fonte TOTVS aprovada; alocação quantitativa, invoices/comparação,
   documentos privados e auditoria/outbox transacional.
4. RF08/DEV18–19, RF09/DEV20 e RF10/DEV21–22: embarques, containers,
   desembaraço/NF, custos/reversões/rateio. Custos de IP compartilhado
   permanecem no IP até aprovar política de alocação e moeda.
5. RF13, RF14/DEV25–28 e DEV29–30: prévia/reconciliação de importação,
   dashboard/BI com grão, moeda, atualização e RLS, depois E2E, segurança,
   recuperação, treinamento e corte.

Mantenha a PO como entrada central e o IP como execução logística que pode
atender várias POs; uma PO pode dividir-se entre vários IPs. Para cada entrega,
aplique a definição de pronto da seção 28. Se a decisão de negócio bloquear
parte do módulo, entregue a parte comprovável e registre a dependência sem
inventar autoridade para dados da origem.

## Fechamento da próxima sessão

Atualize `CHECKLIST_IMPLEMENTACAO.md` com status, commits, migrations, testes,
deploy, casos de aceite e decisões pendentes. Atualize este prompt retirando
tarefas concluídas. Informe o que o usuário pode testar na URL pública e o que
ainda requer confirmação de negócio. Registre o caminho da chave SSH para
rastreio, sem mostrar seu conteúdo.
