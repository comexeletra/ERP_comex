/**
 * Content model of the onboarding guide (/onboarding). The texts live in the dictionaries under `onboarding`;
 * this module holds what is not text: the chapter order, which screen supports which stage, the HML prints of
 * each walkthrough step with the area to highlight, and the links of the videos recorded by the team.
 * It imports no values from other `lib/` modules, so `node --test` can load it on its own.
 */

export const ONBOARDING_CHAPTERS = ["purpose", "process", "screens"] as const;
export type OnboardingChapter = typeof ONBOARDING_CHAPTERS[number];

export const ONBOARDING_STAGES = ["T0", "T1", "T2", "T3", "T4", "T5"] as const;
export type OnboardingStage = typeof ONBOARDING_STAGES[number];

/** Same keys as the sidebar items, so the guide names each screen exactly as the menu does. */
export const ONBOARDING_SCREEN_KEYS = ["preShipment", "productPortfolio", "postShipment", "invoiceAudit",
  "endToEnd", "indicators", "dataQuality"] as const;
export type OnboardingScreenKey = typeof ONBOARDING_SCREEN_KEYS[number];

/**
 * Prints taken in HML (dark theme, pt-BR), cropped without the sidebar and kept in `public/onboarding/<name>.png`.
 * The sizes let the page reserve the space of each image before it loads.
 */
export const ONBOARDING_SHOT_SIZES = {
  "po-portfolio": { width: 1752, height: 905 },
  "po-portfolio-list": { width: 1752, height: 906 },
  "po-detail": { width: 1759, height: 901 },
  "po-data": { width: 1752, height: 904 },
  "po-quantities": { width: 1752, height: 910 },
  "po-lines": { width: 1752, height: 901 },
  "po-ip-data": { width: 1752, height: 907 },
  "product-lines": { width: 1752, height: 901 },
  "product-lines-without-ip": { width: 1752, height: 904 },
  "ip-list": { width: 1752, height: 907 },
  "ip-detail": { width: 1752, height: 900 },
  "ip-distribution": { width: 1752, height: 899 },
  "ip-post-shipment": { width: 1752, height: 910 },
  "ip-documents": { width: 1752, height: 866 },
  "invoice-audit-files": { width: 1752, height: 892 },
  "invoice-audit-summary": { width: 1752, height: 899 },
  "invoice-audit-conference": { width: 1752, height: 897 },
  "invoice-audit-corrections": { width: 1752, height: 896 },
  "invoice-audit-lines": { width: 1752, height: 899 },
  "e2e-stages": { width: 1752, height: 904 },
  "e2e-horizon": { width: 1752, height: 895 },
  "e2e-charts": { width: 1752, height: 909 },
  "e2e-table": { width: 1752, height: 904 },
  "reports-pre": { width: 1752, height: 905 },
  "reports-pre-table": { width: 1748, height: 909 },
  "reports-post": { width: 1747, height: 909 },
  "reports-post-charts": { width: 1752, height: 907 },
  "reports-clearance": { width: 1752, height: 892 },
  "quality-current": { width: 1752, height: 899 },
  "quality-current-list": { width: 1752, height: 914 },
  "quality-load": { width: 1751, height: 886 },
  "quality-load-list": { width: 1752, height: 907 },
} as const;
export type OnboardingShot = keyof typeof ONBOARDING_SHOT_SIZES;

export function onboardingShotSrc(shot: OnboardingShot): string {
  return `/onboarding/${shot}.png`;
}

/** Area of a print highlighted in a step, in percent of the image width and height. */
export type OnboardingFocus = { x: number; y: number; w: number; h: number };
export type OnboardingStep = { shot: OnboardingShot; box: OnboardingFocus };

/**
 * Where the step number sits so it never covers the highlighted control: above the area, below it when the area
 * starts at the top of the print, and inside only when the area fills the print from top to bottom.
 */
export function focusBadgePlacement(box: OnboardingFocus): "above" | "below" | "inside" {
  if (box.y >= 8) return "above";
  return box.y + box.h <= 92 ? "below" : "inside";
}

export type OnboardingScreen = {
  key: OnboardingScreenKey;
  href: string;
  /** Stages of the T0–T5 flow this screen follows; empty for a screen that supports every stage. */
  stages: readonly OnboardingStage[];
  /** One print and highlighted area per step, in the order of the steps in the dictionaries. */
  steps: readonly OnboardingStep[];
};

export const ONBOARDING_SCREENS: readonly OnboardingScreen[] = [
  {
    key: "preShipment", href: "/", stages: ["T1", "T2", "T3"],
    steps: [
      { shot: "po-portfolio", box: { x: 1.4, y: 19.6, w: 98.3, h: 27 } },
      { shot: "po-portfolio", box: { x: 1.4, y: 48.7, w: 98.3, h: 12.4 } },
      { shot: "po-portfolio-list", box: { x: 2.9, y: 9.1, w: 14.2, h: 4.6 } },
      { shot: "po-portfolio-list", box: { x: 84.8, y: 24.9, w: 8.2, h: 4.9 } },
      { shot: "po-detail", box: { x: 1.5, y: 26.7, w: 97.9, h: 5.8 } },
      { shot: "po-detail", box: { x: 3, y: 55.9, w: 95.1, h: 27.1 } },
      { shot: "po-data", box: { x: 2.7, y: 59.7, w: 95.4, h: 20.1 } },
      { shot: "po-quantities", box: { x: 3, y: 35.3, w: 95.4, h: 36.4 } },
      { shot: "po-lines", box: { x: 2.9, y: 42.2, w: 95.4, h: 17.5 } },
      { shot: "po-ip-data", box: { x: 3, y: 8.6, w: 95.4, h: 84 } },
    ],
  },
  {
    key: "productPortfolio", href: "/purchase-orders/lines", stages: ["T2", "T3"],
    steps: [
      { shot: "product-lines", box: { x: 1.6, y: 21.2, w: 98.2, h: 39.7 } },
      { shot: "product-lines-without-ip", box: { x: 26.7, y: 33, w: 23.9, h: 8.1 } },
      { shot: "product-lines-without-ip", box: { x: 3, y: 78.1, w: 95.4, h: 21.9 } },
      { shot: "product-lines-without-ip", box: { x: 3, y: 71.7, w: 14, h: 4.6 } },
    ],
  },
  {
    key: "postShipment", href: "/processes", stages: ["T3", "T4", "T5"],
    steps: [
      { shot: "ip-list", box: { x: 1.7, y: 18.7, w: 98.2, h: 21.4 } },
      { shot: "ip-list", box: { x: 3.1, y: 50.6, w: 95.4, h: 49.2 } },
      { shot: "ip-list", box: { x: 95.1, y: 10.7, w: 4.8, h: 4.6 } },
      { shot: "ip-detail", box: { x: 1.6, y: 35.3, w: 98.2, h: 38.8 } },
      { shot: "ip-distribution", box: { x: 3, y: 32.3, w: 95.4, h: 26.1 } },
      { shot: "ip-distribution", box: { x: 3, y: 65.6, w: 95.5, h: 22.2 } },
      { shot: "ip-post-shipment", box: { x: 3, y: 55.5, w: 95.4, h: 44.5 } },
      { shot: "ip-documents", box: { x: 3.1, y: 28.9, w: 95.4, h: 33.5 } },
    ],
  },
  {
    key: "invoiceAudit", href: "/invoices/audit", stages: ["T3"],
    steps: [
      { shot: "invoice-audit-files", box: { x: 3.1, y: 26.9, w: 95.4, h: 8.6 } },
      { shot: "invoice-audit-files", box: { x: 3.1, y: 38.1, w: 64.8, h: 10.3 } },
      { shot: "invoice-audit-summary", box: { x: 2.9, y: 36.7, w: 95.4, h: 41.2 } },
      { shot: "invoice-audit-conference", box: { x: 3.2, y: 2.8, w: 95.4, h: 27.1 } },
      { shot: "invoice-audit-conference", box: { x: 3.2, y: 31.7, w: 95.4, h: 45.5 } },
      { shot: "invoice-audit-corrections", box: { x: 2.7, y: 1.1, w: 96.9, h: 85.5 } },
      { shot: "invoice-audit-lines", box: { x: 3.2, y: 7.8, w: 95.4, h: 63 } },
      { shot: "invoice-audit-lines", box: { x: 3.2, y: 74.1, w: 95.4, h: 13.8 } },
    ],
  },
  {
    key: "endToEnd", href: "/end-to-end", stages: ["T0", "T1", "T2", "T3", "T4", "T5"],
    steps: [
      { shot: "e2e-stages", box: { x: 1.5, y: 23.6, w: 18.4, h: 4.8 } },
      { shot: "e2e-stages", box: { x: 1.5, y: 32.1, w: 98.3, h: 4.9 } },
      { shot: "e2e-stages", box: { x: 1.5, y: 72.9, w: 98.3, h: 26.7 } },
      { shot: "e2e-horizon", box: { x: 1.3, y: 17.3, w: 98.3, h: 26.3 } },
      { shot: "e2e-horizon", box: { x: 1.3, y: 50.1, w: 98.3, h: 47.4 } },
      { shot: "e2e-charts", box: { x: 1.5, y: 26.6, w: 98.3, h: 72.4 } },
      { shot: "e2e-table", box: { x: 3.1, y: 9.3, w: 95.4, h: 90.7 } },
    ],
  },
  {
    key: "indicators", href: "/reports/pre", stages: ["T3", "T4", "T5"],
    steps: [
      { shot: "reports-pre", box: { x: 1.4, y: 14.9, w: 16.3, h: 4.9 } },
      { shot: "reports-pre", box: { x: 1.4, y: 21.7, w: 98.3, h: 6 } },
      { shot: "reports-pre", box: { x: 1.4, y: 29.4, w: 98.3, h: 63.8 } },
      { shot: "reports-pre-table", box: { x: 1.4, y: 0.7, w: 98.5, h: 98.9 } },
      { shot: "reports-post", box: { x: 1.2, y: 29.4, w: 98.6, h: 23.7 } },
      { shot: "reports-post-charts", box: { x: 1.5, y: 36.9, w: 98.3, h: 43.2 } },
      { shot: "reports-clearance", box: { x: 1.7, y: 16.3, w: 98.3, h: 63 } },
    ],
  },
  {
    key: "dataQuality", href: "/quality", stages: [],
    steps: [
      { shot: "quality-current", box: { x: 1.3, y: 16.1, w: 17, h: 5 } },
      { shot: "quality-current", box: { x: 1.3, y: 26.6, w: 98.3, h: 12.7 } },
      { shot: "quality-current", box: { x: 1.3, y: 41.4, w: 98.3, h: 43.2 } },
      { shot: "quality-current-list", box: { x: 1.4, y: 0.9, w: 98.3, h: 12.7 } },
      { shot: "quality-current-list", box: { x: 1.9, y: 19.5, w: 97.7, h: 11.9 } },
      { shot: "quality-load", box: { x: 1.3, y: 42.6, w: 98.3, h: 28.6 } },
      { shot: "quality-load-list", box: { x: 1.4, y: 19.6, w: 98.3, h: 12 } },
    ],
  },
];

/** Query parameter that opens the guide on the walkthrough of one screen: `/onboarding?tela=<key>`. */
export const onboardingScreenParam = "tela";

export function onboardingHelpHref(screen: OnboardingScreenKey): string {
  return `/onboarding?${onboardingScreenParam}=${screen}`;
}

/** The screen asked in the query, or null when the value is missing, repeated or unknown. */
export function parseOnboardingScreen(value: string | string[] | undefined): OnboardingScreenKey | null {
  return typeof value === "string" && (ONBOARDING_SCREEN_KEYS as readonly string[]).includes(value)
    ? value as OnboardingScreenKey : null;
}

// Address prefixes of each screen, detail pages included; the longest prefix wins (product lines before POs).
const screenPaths: readonly [string, OnboardingScreenKey][] = [
  ["/purchase-orders/lines", "productPortfolio"],
  ["/purchase-orders", "preShipment"],
  ["/processes", "postShipment"],
  ["/invoices/audit", "invoiceAudit"],
  ["/end-to-end", "endToEnd"],
  ["/reports", "indicators"],
  ["/quality", "dataQuality"],
];

/** Screen of the guide that explains the page at `pathname`, or null when the guide has no walkthrough for it. */
export function onboardingScreenForPath(pathname: string): OnboardingScreenKey | null {
  if (pathname === "/") return "preShipment";
  const match = screenPaths.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match ? match[1] : null;
}

/**
 * Chapter 2 walkthrough: the T0–T5 flow over the same HML prints, one step per place where a stage is recorded
 * or followed. `stage` links the step to the End to End model (owner and deadline); null marks the overview steps.
 * `screen` is the sidebar screen that the step's button opens.
 */
export type OnboardingProcessStep = OnboardingStep & { stage: OnboardingStage | null; screen: OnboardingScreenKey };
export const ONBOARDING_PROCESS_STEPS: readonly OnboardingProcessStep[] = [
  { stage: null, screen: "endToEnd", shot: "e2e-stages", box: { x: 1.5, y: 72.9, w: 98.3, h: 26.7 } },
  { stage: "T0", screen: "preShipment", shot: "po-quantities", box: { x: 51, y: 8.4, w: 11.3, h: 9.5 } },
  { stage: "T1", screen: "preShipment", shot: "po-quantities", box: { x: 15, y: 8.4, w: 35.4, h: 9.5 } },
  { stage: "T2", screen: "preShipment", shot: "po-quantities", box: { x: 3, y: 19.3, w: 11.3, h: 7.3 } },
  { stage: "T3", screen: "preShipment", shot: "po-data", box: { x: 2.7, y: 69.7, w: 95.4, h: 10.2 } },
  { stage: "T3", screen: "preShipment", shot: "po-ip-data", box: { x: 15.8, y: 47.6, w: 34.5, h: 9.5 } },
  { stage: "T4", screen: "preShipment", shot: "po-ip-data", box: { x: 51, y: 47.6, w: 22.8, h: 9.5 } },
  { stage: "T5", screen: "preShipment", shot: "po-ip-data", box: { x: 4.1, y: 58.4, w: 58, h: 7.7 } },
  { stage: null, screen: "endToEnd", shot: "e2e-table", box: { x: 3.1, y: 9.3, w: 95.4, h: 90.7 } },
];

/**
 * Videos recorded by the team, one slot per chapter or screen. A slot without a link shows that the video is
 * still being recorded. Only corporate hosts are accepted (see `isAllowedVideoUrl`); add the shared link here.
 */
export type OnboardingVideoSlot = "purpose" | "process" | OnboardingScreenKey;
export const ONBOARDING_VIDEO_URLS: Readonly<Record<OnboardingVideoSlot, string | null>> = {
  purpose: null,
  process: null,
  preShipment: null,
  productPortfolio: null,
  postShipment: null,
  invoiceAudit: null,
  endToEnd: null,
  indicators: null,
  dataQuality: null,
};

const allowedVideoHosts = [/^[a-z0-9-]+\.sharepoint\.com$/u, /^([a-z0-9-]+\.)?stream\.microsoft\.com$/u];

/** Video links must be HTTPS on SharePoint or Microsoft Stream, where the company keeps its recordings. */
export function isAllowedVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      && allowedVideoHosts.some(host => host.test(url.hostname));
  } catch {
    return false;
  }
}

/** The link of a slot, or null when there is none yet or it is not on an allowed host. */
export function onboardingVideoUrl(slot: OnboardingVideoSlot): string | null {
  const url = ONBOARDING_VIDEO_URLS[slot];
  return url && isAllowedVideoUrl(url) ? url : null;
}

/** What the guide remembers in the browser: the open chapter and the chapters already seen. */
export type OnboardingProgress = { chapter: OnboardingChapter; seen: OnboardingChapter[] };
export type ProgressStorage = Pick<Storage, "getItem" | "setItem">;
export const onboardingStorageKey = "erp-comex-onboarding";

const isChapter = (value: unknown): value is OnboardingChapter =>
  typeof value === "string" && (ONBOARDING_CHAPTERS as readonly string[]).includes(value);

/** Reads the stored progress; nothing stored or an unknown value starts the guide from the first chapter. */
export function parseOnboardingProgress(raw: string | null | undefined): OnboardingProgress {
  const start: OnboardingProgress = { chapter: ONBOARDING_CHAPTERS[0], seen: [ONBOARDING_CHAPTERS[0]] };
  if (!raw) return start;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return start;
    const { chapter, seen } = value as { chapter?: unknown; seen?: unknown };
    if (!isChapter(chapter)) return start;
    const seenChapters = Array.isArray(seen) ? seen.filter(isChapter) : [];
    return { chapter, seen: ONBOARDING_CHAPTERS.filter(item => item === chapter || seenChapters.includes(item)) };
  } catch {
    return start;
  }
}

/** Opens a chapter and marks it as seen. */
export function visitChapter(progress: OnboardingProgress, chapter: OnboardingChapter): OnboardingProgress {
  return { chapter, seen: ONBOARDING_CHAPTERS.filter(item => item === chapter || progress.seen.includes(item)) };
}

export function writeOnboardingProgress(storage: ProgressStorage | null, progress: OnboardingProgress): void {
  try {
    storage?.setItem(onboardingStorageKey, JSON.stringify(progress));
  } catch {
    // Private windows and blocked site data keep the progress only in this page.
  }
}
