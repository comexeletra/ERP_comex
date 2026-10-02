# Trabalhar no ERP Comex no computador do trabalho e no de casa

Este guia permite alternar entre os dois computadores e continuar mudanças que
serão publicadas. O repositório GitHub é a fonte do código. Cada computador tem
seu próprio checkout; alterações locais só chegam ao outro depois de **commit e
push**. Antes de editar no outro computador, faça **pull**.

## 1. Entenda o que é publicado

| Parte | Onde está | Como uma alteração chega lá |
|---|---|---|
| Código | `comexeletra/ERP_comex`, branch `main` | `git push` para o repositório da empresa |
| Frontend | Projeto Vercel `erp-comex`, Root Directory `apps/web` | A branch `main` é a origem do deployment; conferir se o commit ficou `READY` e se o alias público o recebeu |
| API | Serviço Fastify `import-erp-api` na VPS Hostinger | Publicação **separada** na VPS; `git push` sozinho não instala a API |
| Dados | PostgreSQL da VPS, banco `erp_po_totvs_test` | Migrations só por release controlado; o sufixo `_test` não torna esse banco descartável |

Endereço público da aplicação: `https://fup-comex-eletra.vercel.app/`.
Consulte [CHECKLIST_ATUAL_IMPLEMENTACAO.md](CHECKLIST_ATUAL_IMPLEMENTACAO.md)
para saber o que já foi entregue, o que falta e qual evidência ainda não existe.
O commit enviado ao Git não comprova, por si só, que a API da VPS foi atualizada.

## 2. Preparar cada computador

Para editar, executar os projetos Node e enviar código, instale:

1. Git e acesso GitHub com permissão no repositório `comexeletra/ERP_comex`.
2. Um editor de código.
3. Node.js **24.x** e Corepack. Os dois projetos usam **pnpm 12.6.0** conforme
   seus `package.json`; os lockfiles estão no Git.

Confira no terminal PowerShell:

```powershell
git --version
node --version
corepack pnpm --version
```

Se `corepack` não existir, instale/habilite-o antes de instalar as dependências.
Configure seu nome e e-mail de commit no Git da máquina, caso ainda não estejam
configurados. O acesso ao GitHub precisa funcionar nas duas máquinas; a senha de
login do ERP não autentica o GitHub.

```powershell
git config user.name
git config user.email
```

Se algum resultado estiver vazio, configure-o, substituindo pelos seus dados:

```powershell
git config --global user.name "Seu Nome"
git config --global user.email "seu.email@exemplo.com"
```

**Opcional conforme a tarefa:** Python 3 com as dependências de
`deploy/hostinger/requirements-historical-import.txt` para trabalhar no
importador Excel; PostgreSQL **isolado** para executar a API e testes de
integração localmente; acesso Vercel para acompanhar a publicação; acesso SSH
próprio à VPS para instalar a API. Docker não é necessário para apenas editar,
compilar ou executar o frontend.

## 3. Preparar o computador de casa uma única vez

Clone o repositório que alimenta a produção. Neste checkout do trabalho o remoto
da empresa se chama `production`; `origin` aponta para um repositório pessoal.
Renomear o remoto após o clone em casa deixa os comandos iguais nas duas máquinas:

```powershell
git clone https://github.com/comexeletra/ERP_comex.git
cd ERP_comex
git remote rename origin production
git remote -v
git switch main
git pull --ff-only production main
```

O endereço de `production` deve ser
`https://github.com/comexeletra/ERP_comex.git`. Se já existir um clone em casa,
confira `git remote -v` antes de adicionar ou renomear qualquer remoto. Nunca
assuma que `origin` é o repositório de produção.

Instale dependências separadamente, pois `apps/api` e `apps/web` têm lockfiles
próprios:

```powershell
cd apps/api
corepack pnpm install --frozen-lockfile
cd ../web
corepack pnpm install --frozen-lockfile
```

O frontend pode ser iniciado com `corepack pnpm dev` dentro de `apps/web`. Em
desenvolvimento, ele encaminha `/auth/*` e `/api/v1/*` para
`http://localhost:4000` por padrão. Sem API local, páginas que dependem de dados
não funcionarão integralmente. A API local exige um PostgreSQL isolado e um
`apps/api/.env` próprio, baseado em [apps/api/.env.example](apps/api/.env.example).
As variáveis de desenvolvimento do web estão em
[apps/web/.env.example](apps/web/.env.example). Não use a conexão do banco
operacional para desenvolver em casa ou no trabalho.

## 4. Rotina ao alternar as máquinas

**Ao começar**, na raiz do checkout:

```powershell
git status -sb
git switch main
git pull --ff-only production main
git log -1 --oneline
```

O `pull --ff-only` para se houver commits locais divergentes; resolva a
divergência antes de editar ou enviar. Depois faça as alterações e use os
comandos adequados à tarefa, por exemplo `corepack pnpm build` em `apps/api` ou
`apps/web`. A CI da API está em `.github/workflows/api-ci.yml`; ela não substitui
a conferência da publicação na Vercel nem a instalação da API na VPS.

**Antes de sair**, registre e envie o que deseja continuar na outra máquina:

```powershell
git status --short
git diff --check
git add .
git diff --cached --stat
git diff --cached --check
git commit -m "Descreva a alteração"
git push production main
git status -sb
```

Confira `git diff --cached --stat` antes do commit; se aparecer algo indevido,
retire-o da área de preparação com `git restore --staged caminho/do/arquivo`.
Um arquivo apenas salvo no editor, uma alteração sem commit ou um `git stash` local **não
aparecem na outra máquina**. Se a tarefa ainda não estiver pronta para `main`,
envie-a numa branch própria:

```powershell
git switch -c trabalho/minha-tarefa
git add .
git commit -m "WIP: descrever o ponto de parada"
git push -u production trabalho/minha-tarefa
```

No outro computador, recupere a branch e continue nela:

```powershell
git fetch production
git switch --track production/trabalho/minha-tarefa
```

Integre a branch à `main` quando estiver pronta para produção.
Não use `git push --force` para sincronizar os computadores.

## 5. Quando a mudança deve ir à produção

**Frontend (`apps/web`):** envie o commit ao repositório da empresa e confira
no projeto Vercel `erp-comex` se o deployment de Production do **mesmo commit**
está `READY` e atribuído ao endereço público. Confira a tela alterada com o
perfil adequado; HTTP 200 na página não valida dados e autorização autenticados.
Preview ainda não tem API e banco segregados para esse aceite.

**API (`apps/api`):** o push disponibiliza o código, mas o serviço da VPS continua
na versão instalada até um release separado. Use o procedimento de
[deploy/hostinger/README.md](deploy/hostinger/README.md) e os scripts da mudança
correspondente; confirme commit/artefato instalado, serviço e health checks.
Quando houver migration, valide-a antes em cópia restaurada, faça backup
verificável e use a credencial separada de migrations. O banco
`erp_po_totvs_test` é operacional. Se não tiver acesso de release na máquina de
casa, você pode desenvolver, validar e enviar o código de lá; a instalação da
API deve ser feita por quem tem esse acesso. Registre no checklist quando o
código estiver no Git, na VPS e homologado: são estados diferentes.

**Acesso de release:** para publicar a API a partir de casa, use uma chave SSH
própria e autorizada naquela máquina. A chave privada usada no computador do
trabalho está fora do Git; não a coloque no repositório nem em commits. As
credenciais da API e das migrations permanecem protegidas na VPS. O token da
Vercel permanece no painel do projeto. Nenhum desses segredos é necessário
para apenas editar e enviar código.

## 6. Arquivos que o Git não transfere

Arquivos `.env` com valores reais, `.local-keys/`, `.vercel/`, `node_modules/`,
planilhas XLSX, ZIPs e backups são ignorados ou mantidos fora do repositório.
Os modelos `.env.example` são versionados. Configure somente
o que a sua tarefa exigir em cada computador. Não envie esses arquivos por
commit. Para trabalhar com uma planilha histórica, obtenha a cópia autorizada
separadamente e confira seu hash antes de executar o importador.

## 7. Onde retomar o contexto

1. [CHECKLIST_ATUAL_IMPLEMENTACAO.md](CHECKLIST_ATUAL_IMPLEMENTACAO.md): estado
   vigente de RF01–RF16 e DEV01–DEV30, pendências e ordem de trabalho.
2. [Plano_Implementacao_ERP_PO_TOTVS.md](Plano_Implementacao_ERP_PO_TOTVS.md):
   regras de negócio, arquitetura e critérios de aceite.
3. [README.md](README.md), [VERCEL_SETUP.md](VERCEL_SETUP.md) e
   [deploy/hostinger/README.md](deploy/hostinger/README.md): execução e operação.
4. `git status -sb`, `git log -5 --oneline` e `git remote -v`: estado real do
   checkout antes de iniciar qualquer nova mudança.

O histórico em [CHECKLIST_IMPLEMENTACAO.md](CHECKLIST_IMPLEMENTACAO.md) documenta
entregas antigas. Trechos .NET/SQLite e números de migrations de datas anteriores
não descrevem, por si só, a stack executável atual.
