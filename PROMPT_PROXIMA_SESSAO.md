# Prompt para a próxima sessão — avanço das funcionalidades do ERP Comex

Continue o desenvolvimento do ERP Comex a partir do estado real do repositório. Leia primeiro **Estado atual — 2026-09-30** em `CHECKLIST_IMPLEMENTACAO.md` e consulte `Plano_Implementacao_ERP_PO_TOTVS.md`, especialmente as seções **2.2**, **6.1**, **9**, **10**, **13.2**, **14.2**, **20**, **24.1**, **26** e **28**. Os registros antigos do checklist são históricos e podem descrever estados superados.

## Objetivo

Avançar para as demais funcionalidades do MVP, além da carteira de POs. Entregue incrementos operacionais completos e verificáveis, com modelo, API, tela, autorização, auditoria e testes proporcionais ao risco. Não concentre a sessão em repetir o trabalho de filtros e navegação RF06/DEV13 já publicado. Mantenha a PO como entrada central e o IP como execução logística que pode atender várias POs; uma PO pode se dividir entre vários IPs.

## Estado de partida

- Produção: `https://fup-comex-eletra.vercel.app/`, frontend Next.js na Vercel, API Fastify e PostgreSQL na VPS Hostinger. O banco operacional se chama `erp_po_totvs_test` **apesar do sufixo `_test`**; nunca o trate como descartável. M001–M009 estão aplicadas.
- O incremento de leitura RF06 foi publicado no commit `d6b4604`, validado na VPS e na Vercel; a documentação foi publicada no commit `26d0aad`. RF06/DEV13 continuam parciais pelos itens oficiais TOTVS, atendimento, alocações e homologação com usuário real.
- O incremento de leitura RF04/DEV14 foi publicado no commit `50b27f9`; Vercel `dpl_DHivfZpKwMJ61zqw3HcQGQLkhWJF` está `READY` no alias público. Lista/detalhe de IPs e filas sem IP/sem PO estão disponíveis. Instalação congelada, builds, 20 testes API e teste de leitura real passaram na VPS. Não houve migration. RF03/RF04 continuam parciais por associação, solicitação nativa, edição, workflow e homologação com usuário real. Reversão da API: `/var/backups/import-erp/rf04-api-50b27f9`.
- A carga aprovada contém 7.130 linhas de origem, 336 POs, 6.796 observações com PO, 200 IPs, 449 vínculos PO–IP, 422 custos históricos e 451 pendências de qualidade. Há 1.772 linhas sem IP e 144 sem PO, com interseção de 128; consulte o checklist antes de usar números em testes.
- O usuário já acessou a aplicação e autorizou acesso à VPS. A chave privada SSH está neste checkout em `C:\04_Portal_analytics\ERP_interno_Import\Import_eletra\.local-keys\rf06_ed25519`; a pública está no mesmo local com extensão `.pub`. Ambas são ignoradas pelo Git. Fingerprint: `SHA256:S5y5JFC6znJh9aId1V6GLzIjYsnQ9x963Pti7wL7ivs`. Destino: `root@srv1054123.hstgr.cloud` (`72.60.250.212`). Nunca versionar nem exibir a chave privada.
- O computador corporativo serve para editar e inspecionar. Build e testes integrados da aplicação e do banco devem ocorrer na VPS. Preserve os arquivos não rastreados `hast.md` e `api-migration-test.tar.gz`.

## Próximo incremento prioritário — RF02/DEV06 e RF05

1. Inspecione código, migrations, permissões, origem aprovada e cadastros reais. Defina o primeiro corte vertical de importadoras, fornecedores, produtos, NCM, aliases e itens operacionais. Preserve códigos e nomes de origem, histórico e vigência. Não converta fornecedor, unidade, NCM ou saldo de uma célula em dado oficial sem confirmação.
2. Entregue modelo, API e tela utilizáveis para o recorte sustentado pelas evidências, com autorização por importador, validação, auditoria, versões e testes. Para escrita, use `If-Match`, `Idempotency-Key` quando aplicável, motivo e transação. Migre primeiro em cópia restaurada; faça backup verificável antes de aplicar migration ao banco operacional.
3. Mantenha PO como entrada central e IP como execução que pode atender várias POs. Cadastros e itens novos devem explicitar se são operacionais confirmados ou históricos. Não crie linhas oficiais TOTVS nem saldo até existir fonte e regra aprovadas.
4. Verifique Master e escopo restrito em dados reais, 401/403/404, conflitos de versão, reversão e estados de carregamento/vazio/erro. Faça instalação congelada, build e testes na VPS; publique no repositório de produção somente após validação; confira serviço, Vercel e URL pública.
5. Registre no checklist o que foi entregue e as decisões pendentes. A associação de linhas sem IP/sem PO depende de regra sobre prova da identidade de destino, tratamento de status histórico entregue/cancelado, permissão de comando e invariantes de concorrência. Não implemente associação automática sem essas decisões.

## Sequência das próximas entregas

Após o incremento acima, avance em cortes verticais nesta ordem, revisando dependências e prioridades com a evidência encontrada:

1. `RF03/DEV14` completo e `RF04/DEV15`: solicitação nativa, associação auditada de pendências, edição permitida e workflow de IP com pré-condições, permissões e histórico. A homologação da leitura RF06/RF04 pode ocorrer em paralelo.
2. `RF06/DEV16`, `RF07/DEV17`, `RF11/DEV23` e `RF12/DEV24`: linhas oficiais e saldos somente após fonte TOTVS e regras confirmadas; alocações quantitativas, invoices/comparação, documentos privados e auditoria/outbox transacional.
3. `RF08/DEV18–19`, `RF09/DEV20`, `RF10/DEV21–22`: embarques, containers, desembaraço/NF e custos/reversões/rateio. Preserve relações múltiplas e moeda; não atribua custo de IP compartilhado a cada PO sem política aprovada.
4. `RF13` e `RF14/DEV25–28`: interface de prévia/reconciliação da importação, dashboard, relatórios e BI com grãos, moeda, cobertura, atualização e RLS comprovados. Depois, `DEV29–30`: E2E, segurança, desempenho, recuperação, treinamento e corte.

Para cada entrega, aplique a **definição de pronto da seção 28**. Se uma dependência de negócio bloquear parte do módulo, entregue a parte sustentada pelos dados, documente o bloqueio específico e prossiga para outra funcionalidade viável. Não marque RF/DEV como concluído apenas por existir endpoint ou tela.

## Fechamento da sessão

Atualize `CHECKLIST_IMPLEMENTACAO.md` com status, commits, migrations, testes, deploy, casos de aceite e próximos passos. Atualize este prompt para a sessão seguinte, retirando tarefas concluídas. Informe ao usuário o que já pode testar na URL pública, o que depende de confirmação de negócio e a localização da chave SSH para rastreio, sem mostrar seu conteúdo.
