import type { Messages } from "./i18n/pt-BR";

export type E2eFlowConfig = {
  /** Dias entre a entrega do plano comercial e a data de necessidade. */
  horizonte: number;
  /** T1 · PCM aprova a Solicitação de Compra. */
  sc: number;
  /** T2 · Comex cria, aprova e envia a PO. */
  po: number;
  /** T3 · produção HQ — MTS (Make to Stock). */
  prodMts: number;
  /** T3 · produção HQ — não MTS. */
  prodNaoMts: number;
  /** T4 · transporte SEA. */
  maritimo: number;
  /** T4 · transporte AIR. */
  aereo: number;
  /** T5 · pós-embarque até a chegada na empresa. */
  desembaraco: number;
  /** Tempo de cada fase na animação. */
  intervaloMs: number;
  autoplay: boolean;
};

export const DEFAULT_E2E_FLOW_CONFIG: E2eFlowConfig = {
  horizonte: 120,
  sc: 8,
  po: 7,
  prodMts: 45,
  prodNaoMts: 30,
  maritimo: 55,
  aereo: 10,
  desembaraco: 10,
  intervaloMs: 4000,
  autoplay: true,
};

export const E2E_PHASE_COUNT = 6;

export type E2eIconName = "plan" | "cart" | "send" | "factory" | "ship" | "plane" | "truck";
export type E2eSide = "br" | "cn";

export type E2ePhase = {
  code: string; icon: E2eIconName; side: E2eSide; name: string; from: string; to: string; owner: string; lt: string;
  title: string; dFrom: string; dTo: string; win: string; rule: string; docs: string[];
};

export type E2eScenario = { mts: boolean; air: boolean };
export type E2eTick = { label: string; left: string; transform: string; tone?: "ink" | "late" };
export type E2eSegment = { phase: number; days: number; widthPct: number; label: string };
export type E2eMilestone = { label: string; offset: number; side: E2eSide };

export function formatDayOffset(value: number) {
  return value >= 0 ? `D-${value}` : `D+${-value}`;
}

/** Centro da coluna `k` de uma grade de 6 colunas com 16px de espaçamento. */
export function railCenter(k: number) {
  return `calc(${(((2 * k + 1) / 12) * 100).toFixed(4)}% + ${(((2 * k - 5) * 16) / 12).toFixed(3)}px)`;
}

export function buildE2eFlow(config: E2eFlowConfig, { mts, air }: E2eScenario, m: Messages) {
  const t = m.e2e;
  const { horizonte: H, sc, po, desembaraco: clr } = config;
  const prod = mts ? config.prodMts : config.prodNaoMts;
  const tr = air ? config.aereo : config.maritimo;
  const durations = [sc, po, prod, tr, clr];
  const total = durations.reduce((sum, days) => sum + days, 0);
  const slack = H - total;
  const months = Math.round(H / 30);
  const offsets = [H, H];
  for (const days of durations) offsets.push(offsets[offsets.length - 1] - days);
  const win = (k: number) => `${formatDayOffset(offsets[k])} → ${formatDayOffset(offsets[k + 1])}`;
  const transport = air ? t.transportAir : t.transportSea;
  const arrival = air ? t.arrivalAirport : t.arrivalPort;

  const phases: E2ePhase[] = [
    { code: "T0", icon: "plan", side: "br", name: t.t0.name, from: t.t0.from, to: t.t0.to,
      owner: t.t0.owner, lt: `D-${H}`, title: t.t0.title, dFrom: t.t0.dFrom, dTo: t.t0.dTo,
      win: t.t0.win(H), rule: t.t0.rule(months), docs: [...t.t0.docs] },
    { code: "T1", icon: "cart", side: "br", name: t.t1.name, from: t.t1.from, to: t.t1.to,
      owner: t.t1.owner, lt: t.days(sc), title: t.t1.title, dFrom: t.t1.dFrom,
      dTo: t.t1.dTo, win: win(1), rule: t.t1.rule(sc), docs: [...t.t1.docs] },
    { code: "T2", icon: "send", side: "br", name: t.t2.name, from: t.t2.from, to: t.t2.to,
      owner: t.t2.owner, lt: t.days(po), title: t.t2.title, dFrom: t.t2.dFrom,
      dTo: t.t2.dTo, win: win(2), rule: t.t2.rule(po), docs: [...t.t2.docs] },
    { code: "T3", icon: "factory", side: "cn", name: t.t3.name, from: t.t3.from, to: t.t3.to,
      owner: t.t3.owner(mts), lt: t.days(prod), title: t.t3.title, dFrom: t.t3.dFrom,
      dTo: t.t3.dTo, win: win(3), rule: t.t3.rule(config.prodMts, config.prodNaoMts), docs: [...t.t3.docs] },
    { code: "T4", icon: air ? "plane" : "ship", side: "cn", name: transport, from: t.t4.from, to: arrival,
      owner: t.t4.owner(air), lt: t.days(tr), title: t.t4.title(transport),
      dFrom: t.t4.dFrom, dTo: arrival, win: win(4), rule: t.t4.rule(config.maritimo, config.aereo),
      docs: [...(air ? t.t4.docsAir : t.t4.docsSea)] },
    { code: "T5", icon: "truck", side: "cn", name: t.t5.name, from: t.t5.from,
      to: t.t5.to, owner: t.t5.owner, lt: t.days(clr), title: t.t5.title,
      dFrom: t.t5.dFrom, dTo: t.t5.dTo, win: win(5), rule: t.t5.rule(clr), docs: [...t.t5.docs] },
  ];

  const milestoneLabels = [...t.milestones, arrival, t.finalMilestone];
  const milestones: E2eMilestone[] = milestoneLabels.map((label, k) => ({ label, offset: offsets[k], side: k <= 3 ? "br" : "cn" }));

  // Régua: o eixo cobre o horizonte ou, se maior, o lead time total.
  const span = Math.max(H, total);
  const position = (offset: number) => `${(((H - offset) / span) * 100).toFixed(3)}%`;
  const ticks: E2eTick[] = [{ label: formatDayOffset(H), left: "0%", transform: "none" }];
  for (let offset = H - 30; offset > 0; offset -= 30) {
    ticks.push({ label: formatDayOffset(offset), left: position(offset), transform: "translateX(-50%)" });
  }
  if (slack < 0) {
    ticks.push({ label: "D-0", left: position(0), transform: "translateX(-50%)", tone: "ink" });
    ticks.push({ label: `D+${-slack}`, left: "100%", transform: "translateX(-100%)", tone: "late" });
  } else {
    ticks.push({ label: `D-0 · ${t.needDate}`, left: "100%", transform: "translateX(-100%)", tone: "ink" });
  }

  const segments: E2eSegment[] = durations.map((days, index) => {
    const widthPct = (days / span) * 100;
    return { phase: index + 1, days, widthPct, label: widthPct >= 6 ? `T${index + 1} · ${days}d` : `T${index + 1}` };
  });
  const slackPct = (Math.max(0, slack) / span) * 100;
  const slackLabel = slack > 0 ? (slackPct >= 8 ? t.slack(slack) : `${slack}d`) : "";

  return {
    phases, durations, total, slack, months, milestones, ticks, segments, slackPct, slackLabel,
    overflowLeft: slack < 0 ? position(0) : null,
  };
}
