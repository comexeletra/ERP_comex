"use client";

import type { ChangeEvent } from "react";

/**
 * A file field that shows the name of the file the page actually read. The native input is cleared after each
 * read (so the same file can be chosen again), which made the browser show "no file chosen" next to a loaded file.
 */
export default function FilePickerField({ label, fileName, chooseLabel, emptyLabel, accept, disabled, onSelect }: {
  label: string; fileName: string | null; chooseLabel: string; emptyLabel: string; accept: string; disabled: boolean;
  onSelect: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return <label className="file-picker">{label}
    <input className="sr-only" type="file" accept={accept} disabled={disabled} onChange={onSelect} />
    <span className="file-picker-control">
      <span className="file-picker-button">{chooseLabel}</span>
      <span className={fileName ? "file-picker-name" : "file-picker-name file-picker-empty"}>{fileName || emptyLabel}</span>
    </span>
  </label>;
}
