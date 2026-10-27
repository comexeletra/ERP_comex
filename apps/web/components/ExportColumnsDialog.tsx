"use client";

import { useState } from "react";
import { choosableColumns, columnsBody, exportStageMeasures, initialSelection, readSavedColumns,
  setColumns, writeSavedColumns, type ExportColumnDef, type ExportColumnFilters, type ExportContext } from "../lib/export-columns";
import ConfirmDialog from "./ConfirmDialog";
import { useI18n } from "./I18nProvider";

export type ExportColumnsBody = ReturnType<typeof columnsBody>;

const browserStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

// Consecutive columns shown together: a list, or the grid of End to End stages and measures.
function sections(columns: ExportColumnDef[]): { grid: boolean; columns: ExportColumnDef[] }[] {
  const result: { grid: boolean; columns: ExportColumnDef[] }[] = [];
  for (const column of columns) {
    const grid = column.stage !== undefined;
    const last = result.at(-1);
    if (last?.grid === grid) last.columns.push(column);
    else result.push({ grid, columns: [column] });
  }
  return result;
}

/**
 * Chooses the columns of an Excel export: the data columns of the screen table, in its order. Required
 * columns stay checked; the choice is remembered per screen. Mounted only while open.
 */
export default function ExportColumnsDialog({ context, filters = {}, busy = false, onExport, onCancel }: {
  context: ExportContext; filters?: ExportColumnFilters; busy?: boolean;
  onExport: (body: ExportColumnsBody) => void; onCancel: () => void;
}) {
  const { m } = useI18n();
  const t = m.exportColumns;
  const [selection, setSelection] = useState(() => initialSelection(context, readSavedColumns(browserStorage(), context)));
  const columns = choosableColumns(context, filters);
  const selected = new Set(selection);
  const chosenCount = columns.filter(column => selected.has(column.key)).length;
  const all = columns.map(column => column.key);
  const toggle = (keys: string[], checked: boolean) => setSelection(current => setColumns(context, current, keys, checked));
  const allChecked = (keys: string[]) => keys.every(key => selected.has(key));

  function option(column: ExportColumnDef) {
    return <label key={column.key} className="export-columns-option">
      <input type="checkbox" checked={selected.has(column.key)} disabled={column.required}
        onChange={event => toggle([column.key], event.target.checked)} />
      <span>{column.label(m, filters)}{column.required && <small className="muted"> · {t.required}</small>}</span>
    </label>;
  }

  function grid(stageColumns: ExportColumnDef[]) {
    const stages = [...new Set(stageColumns.map(column => column.stage!))];
    const keysOf = (match: (column: ExportColumnDef) => boolean) => stageColumns.filter(match).map(column => column.key);
    return <fieldset key="stages" className="export-columns-stages">
      <legend>{t.stages}</legend>
      <div className="table-scroll"><table className="export-columns-grid">
        <thead><tr><th scope="col">{t.stage}</th>{exportStageMeasures.map(measure => {
          const keys = keysOf(column => column.measure === measure);
          return <th key={measure} scope="col"><label className="export-columns-option">
            <input type="checkbox" checked={allChecked(keys)} aria-label={t.wholeMeasure(m.e2eLines[measure])}
              onChange={event => toggle(keys, event.target.checked)} />
            <span>{m.e2eLines[measure]}</span>
          </label></th>;
        })}</tr></thead>
        <tbody>{stages.map(stage => {
          const keys = keysOf(column => column.stage === stage);
          return <tr key={stage}>
            <th scope="row"><label className="export-columns-option">
              <input type="checkbox" checked={allChecked(keys)} aria-label={t.wholeStage(m.e2eLines.stageTitles[stage])}
                onChange={event => toggle(keys, event.target.checked)} />
              <span>{m.e2eLines.stageTitles[stage]}</span>
            </label></th>
            {exportStageMeasures.map(measure => {
              const column = stageColumns.find(item => item.stage === stage && item.measure === measure)!;
              return <td key={measure}><input type="checkbox" checked={selected.has(column.key)}
                aria-label={column.label(m, filters)} onChange={event => toggle([column.key], event.target.checked)} /></td>;
            })}
          </tr>;
        })}</tbody>
      </table></div>
    </fieldset>;
  }

  function confirm() {
    writeSavedColumns(browserStorage(), context, selection);
    onExport(columnsBody(context, selection, m, filters));
  }

  return <ConfirmDialog open title={t.title} confirmLabel={t.confirm} busy={busy} onConfirm={confirm} onCancel={onCancel}>
    <p>{t.help}</p>
    <div className="button-row">
      <button className="button secondary" type="button" onClick={() => toggle(all, true)}>{t.selectAll}</button>
      <button className="button secondary" type="button" onClick={() => toggle(all, false)}>{t.clearAll}</button>
    </div>
    <p className="muted" role="status">{t.count(chosenCount, columns.length)}</p>
    <div className="export-columns">
      {sections(columns).map((section, index) => section.grid ? grid(section.columns)
        : <div key={index} className="export-columns-list">{section.columns.map(option)}</div>)}
    </div>
  </ConfirmDialog>;
}
