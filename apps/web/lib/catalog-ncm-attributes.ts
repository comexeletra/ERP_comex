import type { Messages } from "./i18n/pt-BR";

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

/** Joins "A, B or C"; `conjunction` carries its own spacing because Chinese uses none. */
function joinList(items: string[], conjunction: string, m: Messages): string {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(m.ncm.listSeparator)}${conjunction}${items.at(-1)}`;
}

export function describeNcmDomainOption(option: NcmDomainOption): string {
  return option.description === option.code ? option.code : `${option.description} (${option.code})`;
}

export function describeNcmCreationAct(act: NcmCreationAct | null | undefined, m: Messages): string | null {
  if (!act) return null;
  const parts = [act.tipoOrgaoAtoIni,
    act.numeroAtoIni ? m.ncm.actNumber(`${act.numeroAtoIni}${act.anoAtoIni ? `/${act.anoAtoIni}` : ""}`) : null,
    !act.numeroAtoIni && act.anoAtoIni ? m.ncm.actYear(act.anoAtoIni) : null].filter(Boolean);
  return parts.length ? m.ncm.creationAct(parts.join(" · ")) : null;
}

export function describeNcmFillType(fillType: string | null, m: Messages): string | null {
  return (m.ncm.fillTypes as Record<string, string>)[fillType?.toUpperCase() ?? ""] ?? null;
}

function describeValue(value: string, attribute: NcmAttributeReference, m: Messages): string {
  if (/^true$/iu.test(value)) return m.ncm.yes;
  if (/^false$/iu.test(value)) return m.ncm.no;
  const option = attribute.domain?.find(item => item.code === value);
  return option ? describeNcmDomainOption(option) : m.ncm.option(value);
}

export function describeNcmAttributeCondition(
  condition: string | null,
  m: Messages,
  controllingAttribute?: NcmAttributeReference,
  attributesByCode: ReadonlyMap<string, NcmAttributeReference> = new Map(),
): string {
  if (!condition) return m.ncm.genericCondition;

  const parts = condition.trim().split(/\s+(E|OU)\s+/iu);
  const connectors = parts.filter((_, index) => index % 2 === 1).map(value => value.toUpperCase());
  const clauses = parts.filter((_, index) => index % 2 === 0).map(part => {
    const match = /^['"]?(ATT_[A-Z0-9_]+)['"]?\s+(igual(?:\s+a)?|diferente(?:\s+de)?)\s+(?:'([^']*)'|"([^"]*)"|(.+?))\s*$/iu.exec(part.trim());
    if (!match) return null;
    return { code: match[1].toUpperCase(), operator: /^igual/iu.test(match[2]) ? "equal" : "different",
      value: (match[3] ?? match[4] ?? match[5] ?? "").trim() };
  });
  if (clauses.some(clause => !clause || !clause.value) || new Set(connectors).size > 1) {
    return m.ncm.specificRule;
  }

  const rules = clauses as Array<{ code: string; operator: string; value: string }>;
  const sameCode = rules.every(rule => rule.code === rules[0].code);
  const sameOperator = rules.every(rule => rule.operator === rules[0].operator);
  const attribute = attributesByCode.get(rules[0].code)
    ?? (controllingAttribute?.code === rules[0].code ? controllingAttribute : undefined);
  if (sameCode && sameOperator && attribute) {
    const values = rules.map(rule => describeValue(rule.value, attribute, m));
    const name = `“${attribute.displayName}”`;
    if (rules[0].operator === "equal" && (rules.length === 1 || connectors[0] === "OU")) {
      return m.ncm.requiredWhenIs(name, joinList(values, m.ncm.or, m));
    }
    if (rules[0].operator === "different" && (rules.length === 1 || connectors[0] === "E")) {
      return m.ncm.requiredWhenIsNot(name, joinList(values, m.ncm.nor, m));
    }
  }

  const rendered = rules.map(rule => {
    const reference = attributesByCode.get(rule.code)
      ?? (controllingAttribute?.code === rule.code ? controllingAttribute : undefined);
    if (!reference) return null;
    const name = `“${reference.displayName}”`;
    const value = describeValue(rule.value, reference, m);
    return rule.operator === "equal" ? m.ncm.clauseIs(name, value) : m.ncm.clauseIsNot(name, value);
  });
  if (rendered.some(value => value === null)) {
    return m.ncm.specificRule;
  }
  return m.ncm.requiredWhen(joinList(rendered as string[], connectors[0] === "E" ? m.ncm.and : m.ncm.or, m));
}
