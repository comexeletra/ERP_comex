import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { focusBadgePlacement, isAllowedVideoUrl, ONBOARDING_CHAPTERS, ONBOARDING_HELP_TOPICS, ONBOARDING_NCM_STEPS,
  ONBOARDING_NCM_TARGETS, ONBOARDING_PROCESS_STEPS, ONBOARDING_SCREEN_KEYS, ONBOARDING_SCREENS, ONBOARDING_SHOT_SIZES,
  ONBOARDING_STAGES, ONBOARDING_VIDEO_URLS, onboardingShotSrc, onboardingHelpForPath, onboardingHelpHref,
  onboardingStorageKey, onboardingVideoUrl, parseOnboardingHelp, parseOnboardingProgress, visitChapter,
  writeOnboardingProgress } from "../lib/onboarding.ts";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const dictionaries = { ptBR, en, zhCN };
const [header, help, sidebar, page, guide, process, screens, walkthrough, video, styles, layout, ncm, catalogPage,
  valuesPage] = await Promise.all([
  source("components/PageHeader.tsx"), source("components/ScreenHelpLink.tsx"),
  source("components/AppSidebar.tsx"), source("app/onboarding/page.tsx"), source("components/OnboardingGuide.tsx"),
  source("components/OnboardingProcess.tsx"), source("components/OnboardingScreens.tsx"),
  source("components/OnboardingWalkthrough.tsx"), source("components/OnboardingVideo.tsx"),
  source("app/styles/features/onboarding.css"), source("app/layout.tsx"), source("components/OnboardingNcm.tsx"),
  source("app/catalog/page.tsx"), source("app/catalog/values/page.tsx"),
]);
const shotsFolder = new URL("../public/onboarding/", import.meta.url);

/** Width and height of a PNG, read from its IHDR chunk. */
async function pngSize(url) {
  const bytes = await readFile(url);
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", url.pathname);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("the guide opens from the top of the sidebar for every role", () => {
  assert.match(page, /<OnboardingGuide key=\{initialHelp \?\? ""\} initialHelp=\{initialHelp\} \/>/u);
  assert.match(sidebar, /\{ label: "start", items: \[\s*\{ label: "onboarding", href: "\/onboarding", icon: "guide" \}/u);
  assert.match(sidebar, /const groups: SidebarGroup\[\] = \[\s*\{ label: "start"/u);
  for (const [name, m] of Object.entries(dictionaries)) {
    assert.ok(m.sidebar.groups.start && m.sidebar.items.onboarding, name);
  }
});

test("the guide has four chapters in order: purpose, process, screens and NCM", () => {
  assert.deepEqual([...ONBOARDING_CHAPTERS], ["purpose", "process", "screens", "ncm"]);
  for (const [name, m] of Object.entries(dictionaries)) {
    for (const chapter of ONBOARDING_CHAPTERS) assert.ok(m.onboarding.chapters[chapter], `${name}.${chapter}`);
  }
});

test("each screen of the guide is the sidebar item with the same name and address", () => {
  assert.deepEqual(ONBOARDING_SCREENS.map(screen => screen.key), [...ONBOARDING_SCREEN_KEYS]);
  for (const screen of ONBOARDING_SCREENS) {
    assert.match(sidebar, new RegExp(`\\{ label: "${screen.key}", href: "${screen.href.replace(/\//gu, "\\/")}"`, "u"), screen.key);
  }
});

test("each screen of the guide is found from its address, detail pages included, and only those", () => {
  const cases = {
    "/": "preShipment", "/purchase-orders/abc-123": "preShipment", "/purchase-orders/new": "preShipment",
    "/purchase-orders/lines": "productPortfolio", "/processes": "postShipment", "/processes/abc-123": "postShipment",
    "/invoices/audit": "invoiceAudit", "/end-to-end": "endToEnd", "/end-to-end/po": "endToEnd",
    "/reports/pre": "indicators", "/reports/post": "indicators", "/quality": "dataQuality",
    "/onboarding": null, "/catalog": null, "/requests": null, "/purchase-orders-old": null, "/qualityx": null,
    // NCM rates is only about NCM; Cadastros and entity values show the link while NCM is the open choice.
    "/catalog/ncm-rates": "ncm", "/catalog/values": null, "/catalog/ncm-ratesx": null,
  };
  for (const [path, screen] of Object.entries(cases)) assert.equal(onboardingHelpForPath(path), screen, path);
  // The address of every screen in the guide leads back to it.
  for (const screen of ONBOARDING_SCREENS) assert.equal(onboardingHelpForPath(screen.href), screen.key, screen.href);
});

test("the help link opens the guide on the walkthrough of the screen, and odd queries are ignored", () => {
  assert.deepEqual([...ONBOARDING_HELP_TOPICS], [...ONBOARDING_SCREEN_KEYS, "ncm"]);
  assert.equal(onboardingHelpHref("invoiceAudit"), "/onboarding?tela=invoiceAudit");
  assert.equal(onboardingHelpHref("ncm"), "/onboarding?tela=ncm");
  assert.equal(parseOnboardingHelp("invoiceAudit"), "invoiceAudit");
  assert.equal(parseOnboardingHelp("ncm"), "ncm");
  for (const value of [undefined, "", "catalog", "__proto__", "toString", ["endToEnd", "quality"]]) {
    assert.equal(parseOnboardingHelp(value), null, String(value));
  }
  assert.match(header, /<ScreenHelpLink topic=\{help\} \/>/u);
  assert.match(help, /topic \?\? onboardingHelpForPath\(pathname\)/u);
  assert.match(help, /href=\{onboardingHelpHref\(current\)\}/u);
  assert.match(page, /parseOnboardingHelp\(\(await searchParams\)\[onboardingScreenParam\]\)/u);
  assert.match(page, /<OnboardingGuide key=\{initialHelp \?\? ""\} initialHelp=\{initialHelp\} \/>/u);
  assert.match(guide, /<OnboardingScreens initialScreen=\{initialScreen\} \/>/u);
  assert.match(guide, /<OnboardingNcm fromHelp=\{initialHelp === "ncm"\} \/>/u);
  for (const [name, m] of Object.entries(dictionaries)) assert.ok(m.onboarding.help && m.onboarding.helpAria("x"), name);
});

test("Cadastros and entity values show the help link of the NCM chapter while NCM is the open choice", () => {
  assert.match(catalogPage,
    /<PageHeader eyebrow=\{m\.sidebar\.groups\.management\} title=\{t\.title\} help=\{resource === "ncms" \? "ncm" : undefined\} \/>/u);
  // Only the NCM view of entity values has the link: the other fields are not explained in the NCM chapter.
  assert.equal(valuesPage.match(/help="ncm"/gu)?.length, 1);
  assert.match(valuesPage, /if \(entity === "ncm"\) return <main className="shell">\s*<PageHeader help="ncm"/u);
});

test("the NCM walkthrough opens the screen of each step and is told in all three languages", async () => {
  assert.ok(ONBOARDING_NCM_STEPS.length >= 10);
  assert.deepEqual(Object.keys(ONBOARDING_NCM_TARGETS), ["catalog", "entityValues", "ncmRates", "invoiceAudit"]);
  for (const href of Object.values(ONBOARDING_NCM_TARGETS)) {
    await readFile(new URL(`../app${href}/page.tsx`, import.meta.url));
  }
  // Every screen of the cycle appears, in its order: Cadastros, entity values, rates and invoice audit.
  assert.deepEqual([...new Set(ONBOARDING_NCM_STEPS.map(step => step.target))], Object.keys(ONBOARDING_NCM_TARGETS));
  assert.match(ncm, /<OnboardingWalkthrough steps=\{ONBOARDING_NCM_STEPS\} texts=\{t\.ncm\.steps\}/u);
  assert.match(ncm, /href=\{ONBOARDING_NCM_TARGETS\[target\]\}/u);
  assert.match(ncm, /<OnboardingVideo slot="ncm" \/>/u);
  assert.ok("ncm" in ONBOARDING_VIDEO_URLS);
  for (const [name, m] of Object.entries(dictionaries)) {
    const t = m.onboarding.ncm;
    assert.ok(m.onboarding.chapters.ncm && t.heading && t.lead && t.name && t.faqTitle, name);
    assert.equal(t.steps.length, ONBOARDING_NCM_STEPS.length, `${name}: texts × prints`);
    assert.equal(t.faq.length, ptBR.onboarding.ncm.faq.length, `${name}: questions`);
    for (const item of t.faq) assert.ok(item.question && item.answer, name);
  }
});

test("the NCM chapter says that a reference rate is not the tax due", () => {
  assert.match(ncm, /<p className="notice warning">\{t\.ncm\.notice\}<\/p>/u);
  assert.match(ptBR.onboarding.ncm.notice, /não são o imposto devido/u);
  assert.match(en.onboarding.ncm.notice, /not the tax due/u);
  assert.match(zhCN.onboarding.ncm.notice, /不是应纳税额/u);
});

test("the process walkthrough goes through T0 to T5 in order, opening a screen of the menu at each step", () => {
  const stages = ONBOARDING_PROCESS_STEPS.map(step => step.stage).filter(stage => stage !== null);
  assert.deepEqual([...new Set(stages)], [...ONBOARDING_STAGES]);
  assert.deepEqual(stages, [...stages].sort());
  for (const step of ONBOARDING_PROCESS_STEPS) assert.ok(ONBOARDING_SCREEN_KEYS.includes(step.screen), step.screen);
  for (const [name, m] of Object.entries(dictionaries)) {
    const texts = Object.values(m.onboarding.process.steps);
    assert.equal(texts.length, ONBOARDING_PROCESS_STEPS.length, `${name}: texts × prints`);
    // The first step of each stage starts with its code, so texts and highlighted prints stay in the same order.
    ONBOARDING_PROCESS_STEPS.forEach((step, k) => {
      if (step.stage !== null && ONBOARDING_PROCESS_STEPS[k - 1]?.stage !== step.stage) {
        assert.ok(texts[k].startsWith(step.stage), `${name} ${k + 1}`);
      }
    });
  }
  for (const screen of ONBOARDING_SCREENS) {
    for (const stage of screen.stages) assert.ok(ONBOARDING_STAGES.includes(stage), `${screen.key}: ${stage}`);
  }
});

test("each walkthrough step has a print and a highlighted area inside it, in all three languages", () => {
  for (const [chapter, steps] of Object.entries({ process: ONBOARDING_PROCESS_STEPS, ncm: ONBOARDING_NCM_STEPS })) {
    for (const [k, { shot, box }] of steps.entries()) {
      assert.ok(shot in ONBOARDING_SHOT_SIZES, `${chapter} ${k + 1}: ${shot}`);
      assert.ok(box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= 100 && box.y + box.h <= 100,
        `${chapter} ${k + 1}: the highlight leaves the print`);
    }
  }
  for (const screen of ONBOARDING_SCREENS) {
    assert.ok(screen.steps.length >= 2, screen.key);
    for (const [name, m] of Object.entries(dictionaries)) {
      const item = m.onboarding.screens.items[screen.key];
      assert.ok(item.summary && item.when, `${name}.${screen.key}`);
      assert.equal(Object.keys(item.steps).length, screen.steps.length, `${name}.${screen.key}: texts × prints`);
    }
    for (const [k, { shot, box }] of screen.steps.entries()) {
      assert.ok(shot in ONBOARDING_SHOT_SIZES, `${screen.key} ${k + 1}: ${shot}`);
      assert.ok(box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= 100 && box.y + box.h <= 100,
        `${screen.key} ${k + 1}: the highlight leaves the print`);
    }
  }
});

test("the step number sits outside the highlighted control whenever the print leaves room for it", () => {
  assert.equal(focusBadgePlacement({ x: 95, y: 10.7, w: 4.8, h: 4.6 }), "above");
  assert.equal(focusBadgePlacement({ x: 3, y: .9, w: 95, h: 12.7 }), "below");
  assert.equal(focusBadgePlacement({ x: 3, y: .7, w: 95, h: 98.9 }), "inside");
  assert.match(walkthrough, /<span className=\{badgeClass\[focusBadgePlacement\(step\.box\)\]\}>/u);
});

test("every print exists with the declared size and every print in the folder is used", async () => {
  const used = new Set([...ONBOARDING_SCREENS.flatMap(screen => screen.steps), ...ONBOARDING_PROCESS_STEPS,
    ...ONBOARDING_NCM_STEPS].map(step => step.shot));
  assert.deepEqual([...used].sort(), Object.keys(ONBOARDING_SHOT_SIZES).sort());
  const files = (await readdir(shotsFolder)).sort();
  assert.deepEqual(files, Object.keys(ONBOARDING_SHOT_SIZES).map(shot => `${shot}.png`).sort());
  for (const [shot, size] of Object.entries(ONBOARDING_SHOT_SIZES)) {
    assert.equal(onboardingShotSrc(shot), `/onboarding/${shot}.png`);
    assert.deepEqual(await pngSize(new URL(`${shot}.png`, shotsFolder)), { ...size }, shot);
  }
});

test("the process chapter takes the stages and deadlines from the End to End model", () => {
  assert.match(process, /buildE2eFlow\(DEFAULT_E2E_FLOW_CONFIG, \{ mts: false, air: false \}, m\)/u);
  assert.match(process, /\{phase\.code\} · \{phase\.owner\} · \{phase\.lt\}/u);
  // Both chapters use the same walkthrough over HML prints.
  assert.match(process, /<OnboardingWalkthrough steps=\{ONBOARDING_PROCESS_STEPS\} texts=\{t\.process\.steps\}/u);
  assert.match(screens, /<OnboardingWalkthrough steps=\{screen\.steps\} texts=\{item\.steps\} name=\{name\} \/>/u);
  // No deadline is written in the guide texts: a change of target in e2e-flow.ts reaches the guide by itself.
  for (const [name, m] of Object.entries(dictionaries)) {
    assert.doesNotMatch(JSON.stringify(m.onboarding), /\d+\s*(dias|days|d\b|天)/u, name);
  }
});

test("prints are described for screen readers and carry the step as caption; videos open only corporate links", () => {
  assert.match(walkthrough, /alt=\{t\.figure\(name, current \+ 1\)\}/u);
  assert.match(walkthrough, /<span className="sr-only">\{t\.enlarge\}<\/span>/u);
  assert.match(walkthrough, /<figcaption aria-live="polite">/u);
  assert.match(walkthrough, /<span className="onboarding-shot-focus" aria-hidden="true"/u);
  assert.match(video, /target="_blank" rel="noopener noreferrer"/u);
  assert.match(video, /onboardingVideoUrl\(slot\)/u);
  for (const [slot, url] of Object.entries(ONBOARDING_VIDEO_URLS)) {
    if (url !== null) assert.ok(isAllowedVideoUrl(url), `${slot}: ${url}`);
  }
  assert.equal(isAllowedVideoUrl("https://eletra.sharepoint.com/:v:/s/comex/video"), true);
  assert.equal(isAllowedVideoUrl("https://web.microsoftstream.com/video/1"), false);
  assert.equal(isAllowedVideoUrl("https://stream.microsoft.com/video/1"), true);
  assert.equal(isAllowedVideoUrl("http://eletra.sharepoint.com/video"), false);
  assert.equal(isAllowedVideoUrl("https://eletra.sharepoint.com.attacker.example/video"), false);
  assert.equal(isAllowedVideoUrl("https://user:secret@eletra.sharepoint.com/video"), false);
  assert.equal(isAllowedVideoUrl("javascript:alert(1)"), false);
  assert.equal(onboardingVideoUrl("process"), ONBOARDING_VIDEO_URLS.process);
});

test("the walkthrough animation stands still with reduced motion and loads after the shared styles", () => {
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{ \.onboarding \*, \.onboarding \*::after \{ animation: none !important; transition: none !important; \} \}/u);
  // The highlight slides between areas and pulses; the print fades in when the step changes to another print.
  assert.match(styles, /\.onboarding-shot-focus \{[^}]*transition: left/u);
  assert.match(styles, /\.onboarding-shot-focus::after \{[^}]*animation: onboarding-pulse/u);
  assert.match(styles, /\.onboarding-shot-image \{[^}]*animation: onboarding-fade/u);
  assert.match(layout, /import "\.\/styles\/features\/onboarding\.css";/u);
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

test("the guide remembers the open chapter and the chapters seen, and starts over when the stored value is odd", () => {
  const start = { chapter: "purpose", seen: ["purpose"] };
  for (const raw of [null, undefined, "", "not json", "null", "[]", '{"chapter":"other"}']) {
    assert.deepEqual(parseOnboardingProgress(raw), start, String(raw));
  }

  const storage = memoryStorage();
  const progress = visitChapter(visitChapter(parseOnboardingProgress(null), "screens"), "process");
  assert.deepEqual(progress, { chapter: "process", seen: ["purpose", "process", "screens"] });
  writeOnboardingProgress(storage, progress);
  assert.deepEqual(parseOnboardingProgress(storage.getItem(onboardingStorageKey)), progress);
  assert.doesNotThrow(() => writeOnboardingProgress(blocked, progress));
  assert.doesNotThrow(() => writeOnboardingProgress(null, progress));

  assert.deepEqual(parseOnboardingProgress('{"chapter":"screens","seen":["x","purpose"]}'),
    { chapter: "screens", seen: ["purpose", "screens"] });
});

test("the guide page uses the shared header, the chapter tabs and remembers the progress", () => {
  assert.match(guide, /<PageHeader eyebrow=\{t\.eyebrow\} title=\{t\.title\(productName\)\}/u);
  assert.match(guide, /<nav className="tabs onboarding-chapters" aria-label=\{t\.chaptersLabel\}>/u);
  assert.match(guide, /useSyncExternalStore\(subscribe, storedProgress, \(\) => ""\)/u);
  assert.match(guide, /parseOnboardingProgress\(/u);
  assert.match(guide, /writeOnboardingProgress\(/u);
});
