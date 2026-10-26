"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { e2eToday, formatE2eDate } from "../lib/e2e-analysis";
import E2eTabs from "./E2eTabs";
import { getMessages, useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";

const fieldKeys = ["t0Days", "t1Days", "t2Days", "t3MtsDays", "t3NotMtsDays", "t4SeaDays", "t4AirDays", "t5Days"] as const;
type FieldKey = typeof fieldKeys[number];
type TargetSet = Record<FieldKey, number> & { id: string; validFrom: string; version: string };
type Draft = Record<FieldKey | "validFrom" | "reason", string> & { id?: string; version?: string };

/** Editing keeps the set's identity and version; a new set only starts from the latest values. */
const draftFrom = (base: TargetSet | undefined, editing: boolean): Draft => ({
  ...Object.fromEntries(fieldKeys.map(key => [key, base ? String(base[key]) : ""])) as Record<FieldKey, string>,
  validFrom: "", reason: "", ...(base && editing ? { id: base.id, validFrom: base.validFrom, version: base.version } : {}),
});

/** Target days of each End to End stage, kept by the administrator per necessity date. */
export default function E2eTargetsView() {
  const { m, locale } = useI18n();
  const t = m.e2eTargets;
  const [sets, setSets] = useState<TargetSet[]>();
  const [canManage, setCanManage] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([apiFetch("/api/v1/e2e-targets", { signal: controller.signal }), apiFetch("/auth/me", { signal: controller.signal })])
      .then(async ([targets, me]) => {
        const list = await readApiJson<{ items: TargetSet[] }>(targets);
        const identity = await readApiJson<{ roles: string[] }>(me);
        if (controller.signal.aborted) return;
        setSets(list.items); setError("");
        setCanManage(identity.roles.some(role => ["Master", "Administrador"].includes(role)));
      })
      .catch(() => { if (!controller.signal.aborted) setError(getMessages().e2eTargets.loadFailed); });
    return () => controller.abort();
  }, [reload]);

  const today = e2eToday();
  const inForce = sets?.filter(set => today >= set.validFrom).at(-1)?.id;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = { validFrom: draft.validFrom, reason: draft.reason,
        ...Object.fromEntries(fieldKeys.map(key => [key, Number(draft[key])])) };
      const response = await apiFetch(draft.id ? `/api/v1/e2e-targets/${draft.id}` : "/api/v1/e2e-targets", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json", ...(draft.version ? { "X-Record-Version": draft.version } : {}) },
        body: JSON.stringify(body),
      });
      await readApiJson(response);
      setDraft(undefined); setNotice(getMessages().e2eTargets.saved); setReload(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError);
    } finally { setBusy(false); }
  }

  return <main className="shell e2e-flow">
    <PageHeader eyebrow={m.e2eLines.eyebrow} title={t.title}><p>{t.intro}</p></PageHeader>
    <E2eTabs current="targets" />
    {!canManage && sets && <div className="notice"><p>{t.readOnly}</p></div>}
    {error && <div className="notice error" role="alert"><p>{error}</p></div>}
    {notice && <div className="notice success" role="status"><p>{notice}</p></div>}
    <section className="card">
      {!sets && !error && <p role="status">{t.loading}</p>}
      {sets && <div className="table-scroll"><table>
        <thead><tr><th>{t.validFrom}</th>{fieldKeys.map(key => <th key={key}>{t.fields[key]}</th>)}<th /></tr></thead>
        <tbody>{sets.map(set => <tr key={set.id}>
          <td>{formatE2eDate(set.validFrom, locale)}{set.id === inForce && <> <span className="badge badge-success">{t.inForce}</span></>}</td>
          {fieldKeys.map(key => <td key={key}>{t.days(set[key])}</td>)}
          <td>{canManage && <button className="button secondary" type="button" onClick={() => setDraft(draftFrom(set, true))}>{t.edit}</button>}</td>
        </tr>)}</tbody>
      </table></div>}
      {canManage && !draft && <p><button className="button" type="button" onClick={() => setDraft(draftFrom(sets?.at(-1), false))}>{t.add}</button></p>}
    </section>
    {draft && <section className="card">
      <form className="e2e-targets-form" onSubmit={save}>
        <label>{t.validFrom}<input type="date" required value={draft.validFrom}
          onChange={event => setDraft({ ...draft, validFrom: event.target.value })} /></label>
        {fieldKeys.map(key => <label key={key}>{t.fields[key]}<input type="number" required min={0} max={365} step={1}
          value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
        <label className="e2e-targets-reason">{t.reason}<textarea required minLength={3} maxLength={1000} value={draft.reason}
          onChange={event => setDraft({ ...draft, reason: event.target.value })} /></label>
        <div className="button-row">
          <button className="button" type="submit" disabled={busy}>{busy ? t.saving : t.save}</button>
          <button className="button secondary" type="button" disabled={busy} onClick={() => setDraft(undefined)}>{t.cancel}</button>
        </div>
      </form>
    </section>}
  </main>;
}
