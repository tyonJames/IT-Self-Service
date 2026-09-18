"use client";

import { useActionState, useState } from "react";
import { IDLE_STATE, type FormState } from "@/lib/utils/result";
import { FormMessage } from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";

/**
 * The shared "table plus inline form" pattern the management pages use
 * (spec §5.14). One component drives sites, categories, equipment types and
 * countries; each page supplies its own field definitions and Server Actions.
 */

export interface LookupRow {
  id: number;
  isActive: boolean;
  /** Cells rendered in the table, in column order. */
  cells: (string | number)[];
  /** Values to load into the form when "Edit" is clicked, keyed by field name. */
  values: Record<string, string>;
  /** Blocks deletion and explains why, e.g. "12 tickets use this". */
  deleteBlockedReason?: string;
}

export interface LookupField {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "textarea";
  required?: boolean;
  /** Set on fields that may only be supplied when creating (slug, code). */
  createOnly?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  maxLength?: number;
  colClass?: string;
}

export function LookupManager({
  title,
  columns,
  rows,
  fields,
  saveAction,
  deleteAction,
  csrfToken,
  addLabel = "Add",
  emptyHint,
}: {
  title: string;
  columns: string[];
  rows: LookupRow[];
  fields: LookupField[];
  saveAction: (previous: FormState, formData: FormData) => Promise<FormState>;
  deleteAction: (formData: FormData) => Promise<void>;
  csrfToken: string;
  addLabel?: string;
  emptyHint?: string;
}) {
  const [state, action] = useActionState(saveAction, IDLE_STATE);
  const [editing, setEditing] = useState<LookupRow | null>(null);

  // Remounting the form on edit/cancel is what makes defaultValue pick up the
  // newly selected row — a controlled form here would be more code for no gain.
  const formKey = editing ? `edit-${editing.id}` : "new";

  return (
    <div className="row g-3">
      <div className="col-lg-7">
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center">
            <span>{title}</span>
            <span className="badge bg-light text-dark border">{rows.length}</span>
          </div>

          {rows.length === 0 ? (
            <div className="card-body">
              <p className="text-secondary small mb-0">{emptyHint ?? "Nothing here yet."}</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle mb-0">
                <caption className="visually-hidden">{title}</caption>
                <thead className="table-light">
                  <tr>
                    {columns.map((column) => (
                      <th scope="col" key={column}>
                        {column}
                      </th>
                    ))}
                    <th scope="col" className="text-end">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className={row.isActive ? "" : "opacity-75"}>
                      {row.cells.map((cell, index) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <td key={index} className={index === 0 ? "fw-medium" : "small"}>
                          {cell}
                        </td>
                      ))}
                      <td className="text-end text-nowrap">
                        <button
                          type="button"
                          className="btn btn-sm btn-link"
                          onClick={() => {
                            setEditing(row);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          Edit
                        </button>
                        <form action={deleteAction} className="d-inline">
                          <input type="hidden" name="csrf_token" value={csrfToken} />
                          <input type="hidden" name="id" value={row.id} />
                          <button
                            type="submit"
                            className="btn btn-sm btn-link text-danger"
                            disabled={row.isActive || Boolean(row.deleteBlockedReason)}
                            title={
                              row.isActive
                                ? "Deactivate it before deleting"
                                : (row.deleteBlockedReason ?? "Delete permanently")
                            }
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="col-lg-5">
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center">
            <span>{editing ? `Edit: ${editing.cells[0]}` : addLabel}</span>
            {editing && (
              <button
                type="button"
                className="btn btn-sm btn-link"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            )}
          </div>
          <div className="card-body">
            <form action={action} key={formKey} noValidate>
              <input type="hidden" name="csrf_token" value={csrfToken} />
              {editing && <input type="hidden" name="id" value={editing.id} />}

              <FormMessage state={state} />

              <div className="row">
                {fields.map((field) => {
                  // Slugs and country codes are immutable once records reference
                  // them, so those inputs simply are not rendered when editing.
                  if (field.createOnly && editing) return null;

                  const value = editing?.values[field.name] ?? "";
                  const errors = state.fieldErrors?.[field.name] ?? [];
                  const invalid = errors.length > 0;

                  return (
                    <div className={field.colClass ?? "col-12"} key={field.name}>
                      <div className="mb-3">
                        <label className="form-label" htmlFor={field.name}>
                          {field.label}
                          {field.required && (
                            <span className="text-danger ms-1" aria-hidden="true">
                              *
                            </span>
                          )}
                        </label>

                        {field.type === "select" ? (
                          <select
                            className={`form-select${invalid ? " is-invalid" : ""}`}
                            id={field.name}
                            name={field.name}
                            defaultValue={value}
                            required={field.required}
                          >
                            {(field.options ?? []).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : field.type === "textarea" ? (
                          <textarea
                            className={`form-control${invalid ? " is-invalid" : ""}`}
                            id={field.name}
                            name={field.name}
                            rows={2}
                            defaultValue={value}
                            maxLength={field.maxLength}
                          />
                        ) : (
                          <input
                            className={`form-control${invalid ? " is-invalid" : ""}`}
                            type={field.type}
                            id={field.name}
                            name={field.name}
                            defaultValue={value}
                            required={field.required}
                            maxLength={field.maxLength}
                          />
                        )}

                        {field.hint && <div className="form-text">{field.hint}</div>}
                        {invalid && <div className="invalid-feedback d-block">{errors.join(" ")}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="form-check mb-3">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="isActive"
                  name="isActive"
                  defaultChecked={editing ? editing.isActive : true}
                />
                <label className="form-check-label" htmlFor="isActive">
                  Active — offered on new records
                </label>
              </div>

              <SubmitButton icon="bi-check2" pendingLabel="Saving…">
                {editing ? "Save changes" : addLabel}
              </SubmitButton>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
