# Tarefa: ICMS de importação por UF (CE, AM, PR) e simulador de tributos

**Estado:** implementado na branch `homologacao` em 28/10/2026 (API `1096cf5` e `fbd0ef4`,
web `b061de8`, M073 aplicada só no HML, API HML no release `fbd0ef4`). Evidências em
`deploy/hostinger/README.md`. Alíquotas de ICMS ainda não revisadas; aguarda validação
do usuário antes do PR para `main`. Continua
`docs/PLANO_ALIQUOTAS_NCM.md`.

## Objetivo

Permitir escolher a UF do estabelecimento importador (Ceará, Amazonas ou Paraná)
e estimar automaticamente, para uma NCM e um valor aduaneiro, o II, o IPI, o PIS,
a COFINS e o ICMS da importação, com a memória de cálculo e a fonte de cada
alíquota. O resultado é uma **estimativa** e não substitui a apuração da DI/Duimp.

## Requisitos

1. **ICMS por UF, com vigência.** Tabela própria com a alíquota interna, o
   adicional de fundo de pobreza (FCP/FECOP, quando houver), a vigência, a base
   legal e a situação "revisado/não revisado". UFs aceitas: CE, AM e PR
   (extensível depois). Valores iniciais, marcados **não revisado** até a
   confirmação do fiscal:

   | UF | Alíquota | Base legal citada pelas fontes consultadas |
   |---|---|---|
   | PR | 19,5% | Lei estadual de 2023, vigência 12/03/2024 (as fontes divergem sobre quando 2 pontos são FECOP) |
   | CE | 20% | Lei nº 18.305/2023, vigência 01/01/2024 |
   | AM | 20% | Lei Complementar nº 19/1997, art. 12, I, "b" |

   As fontes encontradas são sites comerciais de tabelas tributárias, não os textos
   oficiais: o fiscal confere e marca como revisado.
2. **Despesas na base por UF.** Para cada UF, o fiscal indica se a Taxa Siscomex,
   o AFRMM e outras despesas aduaneiras entram na base do ICMS (padrão inicial:
   todas entram, não revisado).
3. **Benefícios por UF.** Regras cadastradas pelo fiscal, com UF, NCM específica
   ou todas, tipo (**redução de base** em % ou **diferimento** em %), vigência,
   base legal e motivo. Sobreposição de vigência para a mesma UF e NCM é recusada.
   Nenhum benefício é presumido.
4. **Cálculo** (na API, aritmética decimal, arredondamento de cada tributo a
   2 casas, meio para cima):
   - II = VA × alíquota aplicada do II
   - IPI = (VA + II) × alíquota do IPI (NT = sem IPI, informado como NT)
   - PIS = VA × alíquota de PIS; COFINS = VA × alíquota de COFINS
   - Soma = VA + II + IPI + PIS + COFINS + despesas que a UF inclui
   - Base cheia do ICMS = Soma ÷ (1 − (alíquota + FCP))
   - Base tributável = base cheia × (1 − redução de base)
   - ICMS = base tributável × (alíquota + FCP); diferido = ICMS × % de diferimento;
     ICMS a recolher no desembaraço = ICMS − diferido
   - Regra de redução de base "por dentro" a confirmar com o fiscal antes da
     liberação.
5. **Estimativa incompleta, nunca inventada.** Se o II estiver "requer análise"
   ou ausente, ou a UF não tiver alíquota vigente na data, a resposta lista o que
   falta e não devolve total.
6. **Simulador na tela.** No detalhe da NCM (tela Alíquotas por NCM e bloco da
   NCM cadastrada): seletor de UF (CE, AM, PR), data, valor aduaneiro em R$
   (ou FOB, frete e seguro na moeda e taxa de câmbio, que a tela converte em VA),
   Taxa Siscomex, AFRMM e outras despesas. Resultado em tabela com base, alíquota,
   valor e fonte de cada tributo, e avisos de "não revisado".
7. **Gestão.** Na tela Alíquotas por NCM, seção "ICMS por UF" para editar
   alíquota, FCP, despesas na base, benefícios e a UF de cada importadora.
   Permissão nova `icms-rates.manage`, só para **Master e Administrador**
   (decisão do usuário); leitura com `catalog.read`. Toda alteração com motivo,
   auditoria e outbox. A permissão `tax-rates.manage` das alíquotas federais e
   das exceções de PIS/COFINS não muda.
8. **UF pela importadora.** O simulador oferece a importadora e preenche a UF,
   que pode ser trocada. Vínculo inicial (decisão do usuário): ELETRA CWB → PR,
   ELETRA FOR → CE, ELETRA MATRIZ → CE (Fortaleza), ELETRA MAO → AM. O vínculo
   fica numa tabela própria da M073, sem alterar `catalog.operational_value`.
9. Textos nos três dicionários; tabelas com o arrasto padrão; tokens de layout.

## Restrições

- Mesma independência da sincronização de NCM e do TTCE (`AGENTS.md`).
- O simulador não grava nada: nenhuma simulação é armazenada nem associada a
  PO/IP.
- Migration nova (M073) só cria tabelas; aplicada primeiro somente no HML.
- Rota de cálculo própria, por exemplo
  `GET /api/v1/ncm-rates/:code/estimate?uf=&date=&customsValue=&siscomexFee=&afrmm=&otherExpenses=`.

## Critérios de aceite

- Exemplo numérico de referência por UF calculado à mão e coberto por teste
  (incluindo FCP, redução de base, diferimento e IPI NT).
- Estimativa incompleta quando falta II, alíquota de UF ou vigência.
- Validação de entradas (valores ≥ 0, até 2 casas, UF aceita, data).
- Autorização: leitura por todos com `catalog.read`; gestão do ICMS só por
  Master e Administrador (Fiscal recebe 403); auditoria com valores anteriores.
- Ao escolher a importadora, a UF é preenchida conforme o vínculo.
- Contrato web/API; regressão do fluxo NCM; API HML implantada e verificada;
  Preview `Ready`.

## Fora do escopo

Outras UFs, ICMS-ST, ICMS interestadual e de saída, CBS/IBS, preferências de
origem, vínculo da estimativa a itens de PO/IP, cálculo de AFRMM e Taxa
Siscomex (valores informados pelo usuário), exportação Excel.

## Plano

1. Testes do cálculo (função pura) com os exemplos de referência.
2. M073: ICMS por UF, despesas na base, benefícios e UF por importadora;
   seed não revisado.
3. Rotas de leitura, cálculo e gestão com testes de contrato e autorização.
4. Simulador e seção "ICMS por UF" na web, i18n e testes de layout.
5. HML: backup, M073, release da API, verificação; push `homologacao` e Preview.
