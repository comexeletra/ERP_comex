"use client";

import { useState } from "react";
import { apiFetch } from "../lib/api";
import { emptyE2eStageFilter, productLineFilterBody, type E2eStageFilter, type ProductLineFilters } from "../lib/purchase-order-lines";
import type { ExportColumnsBody } from "./ExportColumnsDialog";
import { getMessages } from "./I18nProvider";

/** Queues the product line Excel export with the chosen columns, waits for the worker and downloads the file. */
export function useProductLineExport(filePrefix: string) {
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");

  async function downloadExcel(filters: ProductLineFilters, stage: E2eStageFilter = emptyE2eStageFilter,
    columns?: ExportColumnsBody) {
    if (exporting) return;
    const t = getMessages().productLines;
    setExporting(true); setExportError(""); setExportStatus(t.exportQueued);
    try {
      const created = await apiFetch("/api/v1/exports/purchase-order-lines", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...productLineFilterBody(filters, stage), ...columns }),
      });
      if (!created.ok) {
        const body = await created.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? t.exportStartFailed);
      }
      const { id } = await created.json() as { id: string };
      let complete = false;
      while (!complete) {
        await new Promise(resolve => window.setTimeout(resolve, 1500));
        const statusResponse = await apiFetch(`/api/v1/exports/${id}`);
        if (!statusResponse.ok) throw new Error(t.exportStatusFailed);
        const status = await statusResponse.json() as { status: string; errorCode?: string | null };
        if (status.status === "failed") {
          throw new Error(status.errorCode === "EXPORT_TOO_LARGE" ? t.exportTooLarge : t.exportFailed);
        }
        if (status.status === "completed") complete = true;
        else setExportStatus(status.status === "running" ? t.exportRunning : t.exportWaiting);
      }
      setExportStatus(t.downloading);
      const file = await apiFetch(`/api/v1/exports/${id}/download`);
      if (!file.ok) throw new Error(t.fileExpired);
      const url = URL.createObjectURL(await file.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : t.exportError);
    } finally { setExporting(false); setExportStatus(""); }
  }

  return { exporting, exportStatus, exportError, downloadExcel };
}
