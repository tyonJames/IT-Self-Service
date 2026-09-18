"use client";

import { useId, useRef, useState } from "react";

/**
 * Multi-file drag-and-drop input (spec §5.1).
 *
 * Client-side checks here are a courtesy so people are not left waiting for an
 * upload that the server was always going to reject. The authoritative checks
 * — extension, declared type, magic bytes, size — live in
 * `lib/security/uploads.ts` and run on every submission regardless.
 */
export function FileDropzone({
  name = "attachments",
  label = "Attachments",
  accept,
  maxFiles = 5,
  maxBytes = 10 * 1024 * 1024,
  hint,
}: {
  name?: string;
  label?: string;
  accept: string;
  maxFiles?: number;
  maxBytes?: number;
  hint?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [warning, setWarning] = useState("");

  const applyFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const list = Array.from(incoming);
    const problems: string[] = [];

    const accepted = list.filter((file) => {
      if (file.size > maxBytes) {
        problems.push(`“${file.name}” is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
        return false;
      }
      const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
      if (!accept.split(",").map((a) => a.trim().toLowerCase()).includes(extension)) {
        problems.push(`“${file.name}” is not an accepted file type.`);
        return false;
      }
      return true;
    });

    if (accepted.length > maxFiles) {
      problems.push(`Only the first ${maxFiles} files were kept.`);
    }

    const kept = accepted.slice(0, maxFiles);
    setFiles(kept);
    setWarning(problems.join(" "));

    // Keep the real <input> in sync so the form submits what is displayed.
    if (inputRef.current) {
      const transfer = new DataTransfer();
      for (const file of kept) transfer.items.add(file);
      inputRef.current.files = transfer.files;
    }
  };

  const removeAt = (index: number) => {
    const kept = files.filter((_, i) => i !== index);
    setFiles(kept);
    if (inputRef.current) {
      const transfer = new DataTransfer();
      for (const file of kept) transfer.items.add(file);
      inputRef.current.files = transfer.files;
    }
  };

  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={inputId}>
        {label}
      </label>

      <div
        className={`dropzone${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          applyFiles(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-describedby={`${inputId}-hint`}
      >
        <i className="bi bi-cloud-arrow-up fs-3 text-secondary d-block mb-1" aria-hidden="true" />
        <span className="fw-medium">Drop files here</span>
        <span className="text-secondary"> or click to browse</span>
      </div>

      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        id={inputId}
        name={name}
        multiple
        accept={accept}
        onChange={(event) => applyFiles(event.target.files)}
      />

      <div className="form-text" id={`${inputId}-hint`}>
        {hint ?? `Up to ${maxFiles} files, ${Math.round(maxBytes / 1024 / 1024)} MB each. Accepted: ${accept}`}
      </div>

      {warning && (
        <div className="alert alert-warning py-2 px-3 mt-2 small mb-0" role="alert">
          {warning}
        </div>
      )}

      {files.length > 0 && (
        <ul className="list-group list-group-flush mt-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="list-group-item d-flex align-items-center justify-content-between px-0 py-1"
            >
              <span className="text-truncate">
                <i className="bi bi-paperclip me-2 text-secondary" aria-hidden="true" />
                {file.name}
                <span className="text-secondary small ms-2">{(file.size / 1024).toFixed(0)} KB</span>
              </span>
              <button
                type="button"
                className="btn btn-sm btn-link text-danger"
                onClick={() => removeAt(index)}
                aria-label={`Remove ${file.name}`}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
