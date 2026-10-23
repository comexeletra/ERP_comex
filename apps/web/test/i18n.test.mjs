import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { defaultLocale, localeOptions, locales, localeStorageKey, normalizeLocale, readStoredLocale, storeLocale }
  from "../lib/i18n/locales.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function shape(value, path = "") {
  if (typeof value === "function") return [[path, `function/${value.length}`]];
  if (typeof value === "string") return [[path, "string"]];
  assert.equal(typeof value, "object", `${path} must be a string, a function or a section`);
  return Object.keys(value).sort().flatMap(key => shape(value[key], path ? `${path}.${key}` : key));
}

function texts(value, path = "") {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") {
    const sample = value(...Array.from({ length: value.length }, (_, index) => index + 2));
    return [[path, sample]];
  }
  return Object.entries(value).flatMap(([key, child]) => texts(child, path ? `${path}.${key}` : key));
}

test("offers Portuguese, Chinese and English, defaulting to Portuguese", () => {
  assert.deepEqual([...locales], ["pt-BR", "zh-CN", "en"]);
  assert.equal(defaultLocale, "pt-BR");
  assert.deepEqual(localeOptions.map(option => option.short), ["PT", "中文", "EN"]);
});

test("normalizes unknown stored values to Portuguese", () => {
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeLocale("es"), "pt-BR");
  assert.equal(normalizeLocale(null), "pt-BR");
});

test("persists the chosen language and survives blocked storage", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readStoredLocale(storage), "pt-BR");
  storeLocale(storage, "zh-CN");
  assert.equal(values.get(localeStorageKey), "zh-CN");
  assert.equal(readStoredLocale(storage), "zh-CN");

  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readStoredLocale(blocked), "pt-BR");
  assert.doesNotThrow(() => storeLocale(blocked, "en"));
});

test("the three dictionaries have exactly the same keys and parameters", () => {
  const reference = shape(ptBR);
  assert.deepEqual(shape(en), reference);
  assert.deepEqual(shape(zhCN), reference);
});

test("no dictionary has empty texts", () => {
  for (const [name, dictionary] of Object.entries({ ptBR, en, zhCN })) {
    for (const [path, text] of texts(dictionary)) {
      assert.equal(typeof text, "string", `${name}.${path}`);
      assert.ok(text.trim(), `${name}.${path} is empty`);
    }
  }
});

test("the Chinese dictionary is written in Chinese, not copied from another language", () => {
  const chinese = /[一-鿿]/u;
  const translated = texts(zhCN).filter(([, text]) => chinese.test(text)).length;
  assert.ok(translated / texts(zhCN).length > 0.9, `only ${translated} Chinese texts`);
});

test("the language selector is in the side menu and on the login page", async () => {
  const sidebar = await source("components/AppSidebar.tsx");
  const login = await source("app/login/page.tsx");
  const layout = await source("app/layout.tsx");
  const switcher = await source("components/LanguageSwitcher.tsx");
  assert.match(sidebar, /<LanguageSwitcher className="sidebar-language" \/>/u);
  assert.match(login, /<LanguageSwitcher className="auth-language" \/>/u);
  assert.match(layout, /<I18nProvider><AuthGate>\{children\}<\/AuthGate><\/I18nProvider>/u);
  assert.match(switcher, /aria-pressed=\{option\.locale === locale\}/u);
});
