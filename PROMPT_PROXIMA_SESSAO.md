# Prompt para a próxima sessão — ERP Comex após RF03/DEV14 M011

Continue do estado real do repositório e leia primeiro **Estado atual —
2026-10-01** e **Atualização do incremento atual — 2026-10-02** em
`CHECKLIST_IMPLEMENTACAO.md`. Consulte
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
  opções, mantém o filtro de texto e ordena crescente/decrescente. A captura do
  usuário mostrou HTTP 400 ao carregar as opções: o cliente enviava `page` e
  `pageSize`, parâmetros rejeitados pelo schema estrito desse endpoint. Commit
  `f024bba` remove esses parâmetros da chamada, preservando aba, importador,
  busca, gaps e filtros ativos; deployment Vercel
  `dpl_ChT9kHNabdkQZZvSFmY9Eqk4diei` está `READY` com alias público. Na próxima
  conferência, atualizar `/source-audit` e abrir filtros por coluna para
  confirmar que as opções carregam. A API original já havia sido compilada e
  opções/seleção/ordenação passaram em handler real na VPS em transação
  `READ ONLY` com escopo ELETRA CWB. Backup de reversão da API:
  `/var/backups/import-erp/source-audit-api-20261001T140519Z`.
- O usuário reportou que o menu fechava ao clicar na barra de rolagem ou usar a
  roda do mouse. O listener global de `scroll` também capturava a rolagem dentro
  do próprio menu; commit `f868848` mantém o menu aberto quando o evento começa
  no popover e fecha ao rolar fora dele. Deployment
  `dpl_5HFsBrG5Pd54KJVq2DNgRLBDhBcT` está `READY` com alias público. Pedir
  conferência de rolagem da lista na sessão autenticada.
- Commits mais recentes no checkout de retomada: `cb306e5`
  melhora a apresentação de dados internos; `7e9105a` expande os campos da
  origem sob os registros; `cbba192` exibe cabeçalhos de coluna nos campos
  expandidos. Em 2026-10-02, GETs sem sessão confirmaram HTTP 200 em `/`,
  `/requests`, `/catalog`, `/source-audit`, `/processes`,
  `/pending-import-items` e `/unassigned-po-items`; `/api/v1/requests`,
  `/api/v1/importers` e `/api/v1/suppliers/candidates` responderam 401. API
  VPS `systemd` `active`, `/health/live` 200 e `/health/ready` anônimo 401.
  No pacote isolado `/tmp/erp-api-validation-20261002`, depois da autorização do
  usuário, os quatro módulos API do checkout compilaram com sucesso. A
  expectativa do teste de qualidade foi atualizada para o campo
  `sourceColumnHeaders: {}` quando a fixture não tem cabeçalho; após autorização
  adicional, a suíte unitária passou 23/23 (13 autorização/PO, 7 qualidade e 3
  solicitações). As três integrações de catálogo, PO e IP/processos passaram em
  transações `READ ONLY` usando o build atual. Uma consulta agregada `READ ONLY`
  encontrou dois usuários ativos `Master`, cujo papel concede acesso global;
  não há identidades inativas, papéis `Importação`/`Consulta`, escopos de
  importador ou sessões ativas (uma sessão expirada). Há duas credenciais locais
  ativas; a auditoria apontou uma com troca de senha obrigatória. O usuário
  confirmou depois que fez login com sucesso e alterou a senha padrão; a auditoria
  de credenciais/sessões é um retrato anterior. Um teste `requests.real-read.mjs`
  consultou a lista com identidade Master real e obteve 200 com zero solicitações;
  sem identidade, recebeu 401. Não foram lidos nomes, emails, hashes ou tokens.
  A chave SSH serve para a VPS, não autentica a aplicação. O teste de usuário
  restrito continua sintético, sem grant real ativo. O build atual não foi
  instalado nem publicado. O login manual foi confirmado pelo usuário; ainda
  falta homologar as telas e fluxos autenticados. O agente não teve acesso à
  sessão de navegador do usuário.
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
- Regra confirmada pelo usuário: a planilha é a fonte histórica verdadeira
  enquanto o ERP não for declarado padrão operacional. Todos os valores são
  reais conforme preenchidos, exceto células com erro de cálculo do Excel que
  devem ser revisadas. Não tratar ausência de PO/IP, NCM fora de oito dígitos,
  diferenças de nomes ou outro formato legado como erro, nem normalizar o
  histórico por cima do valor bruto. Aplicar padrões somente a novos registros;
  todas as datas visíveis devem usar `MM/DD/YYYY` (mês/dia/ano), inclusive em
  tabelas e filtros. Quando houver horário, exibir `MM/DD/YYYY HH:mm`. Entradas
  de data devem aceitar esse formato e validar uma data real. Preservar os
  valores históricos armazenados; não exibir timestamps ISO como
  `YYYY-MM-DDTHH:mm:ss`.
  BRL é a moeda padrão de novos lançamentos e, quando aplicável, também deve ser
  guardado o valor CNY; qualquer conversão para BRL precisa conservar taxa, data
  e fonte. O histórico mantém a moeda original.
- A tabela `/source-audit` foi alinhada a essa regra no commit `ffb07fb`:
  `Sem PO` e `Sem IP` agora aparecem como sinais preenchidos na origem, e o
  indicador/filtro de erro conta somente `source_row.error_columns`, sem somar
  outras pendências abertas de `data_issue`. Frontend Vercel
  `dpl_CHWEAuxasqFcUXfEsw34NutAZScZ` está `READY` com alias público. API
  compilada e instalada na VPS; `systemd` ativo, ready HTTPS 200 e anônimo 401.
  Reversão da API em `/var/backups/import-erp/source-audit-api-20261001T163609Z`.
  Sem migration ou escrita no banco.
- A planilha em uso pode ter colunas novas e o usuário poderá reenviá-la até o
  ERP virar a fonte da operação. A tela atual cobre somente `B:AZ` e `B:AS`.
  Quando o arquivo atualizado for fornecido, comparar hash, abas, cabeçalhos,
  linhas, entidades e valores; ampliar extração e visualização sem descartar
  colunas nem sobrescrever o snapshot anterior. Diferenças de contagens entre
  snapshots antigos só devem ser tratadas como mudança de versão, não como
  linhas faltantes do histórico aceito.
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

Última conferência pública sem sessão: 2026-10-02. As sete telas verificadas
responderam 200; `/api/v1/requests`, `/api/v1/importers` e
`/api/v1/suppliers/candidates` responderam 401. O build API atual passou em
`/tmp/erp-api-validation-20261002`, a suíte unitária passou 23/23 e as três
integrações RF02/RF06/RF04 passaram em `READ ONLY`. Não instale nem publique o
build de validação. A consulta real encontrou dois usuários Master ativos; o
papel Master concede acesso global. A rota da lista de solicitações respondeu
200 para uma identidade Master real e 401 sem identidade; a lista está vazia.
Não há identidades inativas, papéis `Importação`/`Consulta`, escopos por
importador ou sessões ativas (há uma sessão expirada) no instante da auditoria.
Duas credenciais locais estavam ativas; uma exigia troca de senha. Depois, o
usuário confirmou login manual bem-sucedido e troca da senha padrão. Não leia nem
copie nomes, emails, hashes ou tokens. O par SSH autentica a VPS, não a aplicação.
Em 2026-10-02, o usu?rio autorizou edi??o somente quando a solicita??o estiver
`SUBMITTED`, sem transi??o de status nesse comando. A implementa??o usa `If-Match`,
valida escopo e estado, grava cabe?alho/itens, auditoria e outbox na mesma transa??o,
e a tela mant?m o rascunho em conflito de vers?o. M012 concede UPDATE/DELETE de itens
? role de runtime. O build API passou, a su?te API passou 26/26, e o typecheck/build
de produ??o web passaram. M012 foi aplicada ao banco operacional depois da valida??o
em c?pia restaurada, incluindo DML real pela role `import_erp_app` em transa??o
revertida. Ledger operacional: M001?M012, zero pend?ncias.

Backup da valida??o em c?pia:
`/var/backups/import-erp/erp_po_totvs_test_20261002T185047Z.dump`, SHA-256
`292cb489b75dc9f8e42bcfe3be4d43d344f2e3198899601aa412e7e54f24542d`. Backup
pr?-release aplicado:
`/var/backups/import-erp/erp_po_totvs_test_20261002T190606Z.dump`, SHA-256
`78232483deb7f06038c008b12577ae232eb7bbc05772b6c08374645c8bb2fdde`. API ativa,
readiness OK e rota an?nima 401. C?digo anterior em
`/var/backups/import-erp/m012-api-20261002T190614Z`; ao reverter o c?digo, mantenha
M012 aplicada. A interface n?o foi publicada: a cria??o do commit pela integra??o
GitHub retornou 403 `Resource not accessible by integration`, e este ambiente n?o
tem Vercel CLI ou token. Os arquivos da implementa??o permanecem no checkout local.
Pr?ximo: habilitar escrita pela integra??o GitHub/Vercel, publicar somente os arquivos
desta implementa??o e confirmar Vercel `READY` e o alias p?blico. N?o repetir testes
j? aprovados sem indica??o de falha.

Registre com Product Owner de Importação/Compras se quantidade, unidade e
produto oficial precisam existir antes da submissão; quem aprova finalidade e
centro de custo; estados e transições de solicitação; e regra de cancelamento.
Identifique Compras/TI TOTVS para empresa/filial e identidade canônica de
fornecedor, Fiscal para novos cadastros NCM/vigência e Dados/Compras para aliases
de operação nova. Essas validações não reabrem nem corrigem valores da planilha
histórica, que o usuário confirmou como reais.

As leituras autenticadas RF06/RF04 e do novo catálogo foram reportadas como
aprovadas pelo usuário; recupere apenas os dados de perfil e escopo para o
registro auditável. O teste técnico anterior de escopo usou grant sintético
sobre dados reais. Cadastros canônicos para a operação nova ainda exigem
empresa/filial TOTVS, identidade de fornecedor, aliases, classificação NCM e
unidades aprovados; mantenha o valor histórico bruto ao criar esses vínculos.

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
   incluindo colunas adicionais quando o usuário enviar nova versão da planilha;
   dashboard/BI com grão, BRL/CNY, conversão rastreável, atualização e RLS,
   depois E2E, segurança, recuperação, treinamento e corte.

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
rastreio, sem mostrar seu conteúdo. Considere a confirmação do usuário como
evidência de aprovação dos testes de interface relatados; não atribua perfil,
importador ou escopo que não tenham sido informados. Preserve essa pendência no
checklist antes de declarar aceite de acesso restrito. Não faça alterações de
código, migration, banco ou deploy para contornar a ausência desses detalhes.
Preserve `hast.md` e `api-migration-test.tar.gz`.
