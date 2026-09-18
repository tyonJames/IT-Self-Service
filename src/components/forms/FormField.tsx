import type { FormState } from "@/lib/utils/result";

/**
 * Form field wrappers that render Bootstrap markup with correct labelling and
 * `aria-describedby` wiring (instruction §29), and surface the server-side
 * field errors carried on `FormState`.
 */

function errorsFor(state: FormState | undefined, name: string): string[] {
  return state?.fieldErrors?.[name] ?? [];
}

export function FieldErrors({ state, name }: { state?: FormState; name: string }) {
  const errors = errorsFor(state, name);
  if (errors.length === 0) return null;
  return (
    <div className="invalid-feedback d-block" id={`${name}-error`}>
      {errors.join(" ")}
    </div>
  );
}

export function TextField({
  name,
  label,
  state,
  type = "text",
  required = false,
  defaultValue = "",
  placeholder,
  hint,
  maxLength,
  autoComplete,
  disabled = false,
  inputMode,
}: {
  name: string;
  label: string;
  state?: FormState;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  autoComplete?: string;
  disabled?: boolean;
  inputMode?: "text" | "email" | "tel" | "numeric" | "url";
}) {
  const invalid = errorsFor(state, name).length > 0;
  const describedBy = [hint ? `${name}-hint` : null, invalid ? `${name}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={name}>
        {label}
        {required && (
          <span className="text-danger ms-1" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="visually-hidden"> (required)</span>}
      </label>
      <input
        className={`form-control${invalid ? " is-invalid" : ""}`}
        type={type}
        id={name}
        name={name}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete={autoComplete}
        disabled={disabled}
        inputMode={inputMode}
        aria-describedby={describedBy || undefined}
      />
      {hint && (
        <div className="form-text" id={`${name}-hint`}>
          {hint}
        </div>
      )}
      <FieldErrors state={state} name={name} />
    </div>
  );
}

export function TextArea({
  name,
  label,
  state,
  required = false,
  defaultValue = "",
  rows = 5,
  hint,
  maxLength,
  placeholder,
}: {
  name: string;
  label: string;
  state?: FormState;
  required?: boolean;
  defaultValue?: string;
  rows?: number;
  hint?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  const invalid = errorsFor(state, name).length > 0;
  const describedBy = [hint ? `${name}-hint` : null, invalid ? `${name}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={name}>
        {label}
        {required && (
          <span className="text-danger ms-1" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="visually-hidden"> (required)</span>}
      </label>
      <textarea
        className={`form-control${invalid ? " is-invalid" : ""}`}
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-describedby={describedBy || undefined}
      />
      {hint && (
        <div className="form-text" id={`${name}-hint`}>
          {hint}
        </div>
      )}
      <FieldErrors state={state} name={name} />
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  name,
  label,
  options,
  state,
  required = false,
  defaultValue = "",
  placeholder = "Choose…",
  hint,
  disabled = false,
}: {
  name: string;
  label: string;
  options: SelectOption[];
  state?: FormState;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const invalid = errorsFor(state, name).length > 0;
  const describedBy = [hint ? `${name}-hint` : null, invalid ? `${name}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={name}>
        {label}
        {required && (
          <span className="text-danger ms-1" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="visually-hidden"> (required)</span>}
      </label>
      <select
        className={`form-select${invalid ? " is-invalid" : ""}`}
        id={name}
        name={name}
        defaultValue={defaultValue}
        required={required}
        disabled={disabled}
        aria-describedby={describedBy || undefined}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <div className="form-text" id={`${name}-hint`}>
          {hint}
        </div>
      )}
      <FieldErrors state={state} name={name} />
    </div>
  );
}

export function CheckboxField({
  name,
  label,
  defaultChecked = false,
  hint,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <div className="form-check mb-3">
      <input
        className="form-check-input"
        type="checkbox"
        id={name}
        name={name}
        defaultChecked={defaultChecked}
        aria-describedby={hint ? `${name}-hint` : undefined}
      />
      <label className="form-check-label" htmlFor={name}>
        {label}
      </label>
      {hint && (
        <div className="form-text" id={`${name}-hint`}>
          {hint}
        </div>
      )}
    </div>
  );
}

/** Honeypot: visually hidden, never focusable, never announced. */
export function HoneypotField() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
      <label htmlFor="website">Leave this field empty</label>
      <input type="text" id="website" name="website" tabIndex={-1} autoComplete="off" />
    </div>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;
  const variant = state.status === "success" ? "success" : "danger";
  const icon = state.status === "success" ? "bi-check-circle" : "bi-exclamation-triangle";
  return (
    <div
      className={`alert alert-${variant} d-flex gap-2`}
      role={state.status === "error" ? "alert" : "status"}
    >
      <i className={`bi ${icon} flex-shrink-0`} aria-hidden="true" />
      <div>
        {state.message}
        {state.fieldErrors?._form && <div className="mt-1">{state.fieldErrors._form.join(" ")}</div>}
      </div>
    </div>
  );
}
