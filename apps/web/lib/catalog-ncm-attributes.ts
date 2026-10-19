export type NcmDomainOption = { code: string; description: string };
export type NcmAttributeReference = {
  code: string;
  displayName: string;
  domain?: NcmDomainOption[];
};
export type NcmCreationAct = {
  tipoOrgaoAtoIni: string | null;
  numeroAtoIni: string | null;
  anoAtoIni: string | null;
};

function joinPortuguese(items: string[], conjunction = "ou"): string {
  if (items.length < 2) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

export function describeNcmDomainOption(option: NcmDomainOption): string {
  return option.description === option.code ? option.code : `${option.description} (${option.code})`;
}

export function describeNcmCreationAct(act: NcmCreationAct | null | undefined): string | null {
  if (!act) return null;
  const parts = [act.tipoOrgaoAtoIni,
    act.numeroAtoIni ? `nº ${act.numeroAtoIni}${act.anoAtoIni ? `/${act.anoAtoIni}` : ""}` : null,
    !act.numeroAtoIni && act.anoAtoIni ? `ano ${act.anoAtoIni}` : null].filter(Boolean);
  return parts.length ? `Ato legal de criação: ${parts.join(" · ")}` : null;
}

export function describeNcmFillType(fillType: string | null): string | null {
  switch (fillType?.toUpperCase()) {
    case "LISTA_ESTATICA": return "Escolha uma opção da lista oficial";
    case "COMPOSTO": return "Preencha as informações que compõem este campo";
    case "BOOLEANO": return "Responda Sim ou Não";
    case "TEXTO": return "Informe a resposta em texto";
    case "NUMERO_INTEIRO": return "Informe um número inteiro";
    case "NUMERO_REAL": return "Informe um número";
    case "DATA": return "Informe uma data";
    default: return null;
  }
}

function describeValue(value: string, attribute: NcmAttributeReference): string {
  if (/^true$/iu.test(value)) return "Sim";
  if (/^false$/iu.test(value)) return "Não";
  const option = attribute.domain?.find(item => item.code === value);
  return option ? describeNcmDomainOption(option) : `opção ${value}`;
}

export function describeNcmAttributeCondition(
  condition: string | null,
  controllingAttribute?: NcmAttributeReference,
  attributesByCode: ReadonlyMap<string, NcmAttributeReference> = new Map(),
): string {
  if (!condition) return "Obrigatório quando uma condição definida pelo Siscomex for atendida.";

  const parts = condition.trim().split(/\s+(E|OU)\s+/iu);
  const connectors = parts.filter((_, index) => index % 2 === 1).map(value => value.toUpperCase());
  const clauses = parts.filter((_, index) => index % 2 === 0).map(part => {
    const match = /^['"]?(ATT_[A-Z0-9_]+)['"]?\s+(igual(?:\s+a)?|diferente(?:\s+de)?)\s+(?:'([^']*)'|"([^"]*)"|(.+?))\s*$/iu.exec(part.trim());
    if (!match) return null;
    return { code: match[1].toUpperCase(), operator: /^igual/iu.test(match[2]) ? "equal" : "different",
      value: (match[3] ?? match[4] ?? match[5] ?? "").trim() };
  });
  if (clauses.some(clause => !clause || !clause.value) || new Set(connectors).size > 1) {
    return "Obrigatório conforme uma regra específica do Siscomex. Consulte a referência técnica.";
  }

  const rules = clauses as Array<{ code: string; operator: string; value: string }>;
  const sameCode = rules.every(rule => rule.code === rules[0].code);
  const sameOperator = rules.every(rule => rule.operator === rules[0].operator);
  const attribute = attributesByCode.get(rules[0].code)
    ?? (controllingAttribute?.code === rules[0].code ? controllingAttribute : undefined);
  if (sameCode && sameOperator && attribute) {
    const values = rules.map(rule => describeValue(rule.value, attribute));
    const name = `“${attribute.displayName}”`;
    if (rules[0].operator === "equal" && (rules.length === 1 || connectors[0] === "OU")) {
      return `Obrigatório quando ${name} for ${joinPortuguese(values)}.`;
    }
    if (rules[0].operator === "different" && (rules.length === 1 || connectors[0] === "E")) {
      return `Obrigatório quando ${name} não for ${joinPortuguese(values, "nem")}.`;
    }
  }

  const rendered = rules.map(rule => {
    const reference = attributesByCode.get(rule.code)
      ?? (controllingAttribute?.code === rule.code ? controllingAttribute : undefined);
    if (!reference) return null;
    return `“${reference.displayName}” ${rule.operator === "equal" ? "for" : "não for"} ${describeValue(rule.value, reference)}`;
  });
  if (rendered.some(value => value === null)) {
    return "Obrigatório conforme uma regra específica do Siscomex. Consulte a referência técnica.";
  }
  return `Obrigatório quando ${joinPortuguese(rendered as string[], connectors[0] === "E" ? "e" : "ou")}.`;
}
