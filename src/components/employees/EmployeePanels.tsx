"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  createEmployee,
  revealTemporaryPassword,
  setTemporaryPassword,
  updateEmployee,
} from "@/app/(app)/employees/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import {
  CheckboxField,
  FormMessage,
  SelectField,
  TextArea,
  TextField,
} from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";

export interface EmployeeFormValues {
  id?: number;
  fullName: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;
  site: string;
  employeeNumber: string;
  staffGroup: string;
  altEmail: string;
  isActive: boolean;
  notes: string;
  userId: string;
}

export function EmployeeForm({
  mode,
  values,
  countries,
  users,
  csrfToken,
}: {
  mode: "create" | "edit";
  values: EmployeeFormValues;
  countries: { value: string; label: string }[];
  users: { id: number; label: string }[];
  csrfToken: string;
}) {
  const [state, action] = useActionState(
    mode === "create" ? createEmployee : updateEmployee,
    IDLE_STATE,
  );

  return (
    <form action={action} noValidate>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      {values.id && <input type="hidden" name="employeeId" value={values.id} />}

      <FormMessage state={state} />

      <div className="row g-3">
        <div className="col-lg-7">
          <div className="card mb-3">
            <div className="card-header">Person</div>
            <div className="card-body">
              <div className="row">
                <div className="col-md-7">
                  <TextField
                    name="fullName"
                    label="Full name"
                    required
                    defaultValue={values.fullName}
                    maxLength={150}
                    autoComplete="name"
                    state={state}
                  />
                </div>
                <div className="col-md-5">
                  <TextField
                    name="employeeNumber"
                    label="Employee number"
                    defaultValue={values.employeeNumber}
                    maxLength={40}
                    hint="Leave blank if they do not have one."
                    state={state}
                  />
                </div>
              </div>

              <div className="row">
                <div className="col-md-6">
                  <TextField
                    name="email"
                    label="Work email"
                    type="email"
                    inputMode="email"
                    required
                    defaultValue={values.email}
                    hint="This is what matches their tickets and equipment requests to them."
                    state={state}
                  />
                </div>
                <div className="col-md-6">
                  <TextField
                    name="altEmail"
                    label="Other email"
                    type="email"
                    inputMode="email"
                    defaultValue={values.altEmail}
                    state={state}
                  />
                </div>
              </div>

              <div className="row">
                <div className="col-md-6">
                  <TextField
                    name="phone"
                    label="Phone"
                    type="tel"
                    inputMode="tel"
                    defaultValue={values.phone}
                    maxLength={40}
                    state={state}
                  />
                </div>
                <div className="col-md-6">
                  <TextField
                    name="jobTitle"
                    label="Job title"
                    defaultValue={values.jobTitle}
                    maxLength={120}
                    state={state}
                  />
                </div>
              </div>

              <TextArea
                name="notes"
                label="Notes"
                defaultValue={values.notes}
                rows={3}
                maxLength={4000}
                state={state}
              />
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card mb-3">
            <div className="card-header">Where they sit</div>
            <div className="card-body">
              <SelectField
                name="site"
                label="Country"
                options={countries}
                defaultValue={values.site}
                required
                placeholder="Choose a country…"
                state={state}
              />

              <TextField
                name="department"
                label="Department"
                defaultValue={values.department}
                maxLength={120}
                state={state}
              />

              <SelectField
                name="staffGroup"
                label="Staff group"
                options={[
                  { value: "staff", label: "Staff" },
                  { value: "management", label: "Management" },
                  { value: "consultant", label: "Consultant" },
                ]}
                defaultValue={values.staffGroup}
                placeholder="Choose…"
                hint="Drives the grouping on the printed email register."
                state={state}
              />

              <SelectField
                name="userId"
                label="Linked login account"
                options={users.map((u) => ({ value: String(u.id), label: u.label }))}
                defaultValue={values.userId}
                placeholder="No login account"
                hint="Only IT staff need one. Linking lets them see their own tickets when signed in."
                state={state}
              />

              <CheckboxField
                name="isActive"
                label="Currently employed"
                defaultChecked={values.isActive}
                hint="Unticking this suspends them. To also mark their devices for return, use Offboard instead."
              />
            </div>
          </div>

          <div className="d-flex gap-2">
            <SubmitButton icon="bi-check2" pendingLabel="Saving…">
              {mode === "create" ? "Create employee" : "Save changes"}
            </SubmitButton>
            <Link
              className="btn btn-outline-secondary"
              href={values.id ? `/employees/${values.id}/` : "/employees/"}
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>
    </form>
  );
}

/**
 * Temporary mailbox password panel (spec §3.7, §5.9).
 *
 * Masked by default. Revealing it is an audited server call — the plaintext is
 * never rendered into the page on load, so it cannot be scraped from the HTML
 * or read over a shoulder by accident.
 */
export function TemporaryPasswordPanel({
  employeeId,
  hasPassword,
  isStale,
  setAtLabel,
  csrfToken,
}: {
  employeeId: number;
  hasPassword: boolean;
  isStale: boolean;
  setAtLabel: string;
  csrfToken: string;
}) {
  const [revealState, revealAction] = useActionState(revealTemporaryPassword, IDLE_STATE);
  const [setState, setAction] = useActionState(setTemporaryPassword, IDLE_STATE);
  const [copied, setCopied] = useState(false);
  const [showSetForm, setShowSetForm] = useState(!hasPassword);

  const password = typeof revealState.data?.password === "string" ? revealState.data.password : null;

  return (
    <>
      {hasPassword ? (
        <>
          <p className="small text-secondary mb-2">
            Stored encrypted, set {setAtLabel}.
            {isStale && (
              <span className="badge bg-warning text-dark ms-2">
                <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
                Over 30 days old
              </span>
            )}
          </p>

          <FormMessage state={revealState} />

          {password ? (
            <div className="d-flex align-items-center gap-2 mb-2">
              <code className="password-mask flex-grow-1 border rounded px-2 py-1 bg-light">
                {password}
              </code>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(password);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                <i className={`bi ${copied ? "bi-check2" : "bi-clipboard"}`} aria-hidden="true" />
                <span className="visually-hidden">Copy password</span>
              </button>
            </div>
          ) : (
            <div className="d-flex align-items-center gap-2 mb-2">
              <span className="password-mask flex-grow-1 border rounded px-2 py-1 bg-light text-secondary">
                ••••••••••••
              </span>
              <form action={revealAction}>
                <input type="hidden" name="csrf_token" value={csrfToken} />
                <input type="hidden" name="employeeId" value={employeeId} />
                <SubmitButton size="sm" variant="outline-secondary" pendingLabel="…">
                  <i className="bi bi-eye me-1" aria-hidden="true" />
                  Reveal
                </SubmitButton>
              </form>
            </div>
          )}

          <p className="small text-secondary">
            Revealing this is recorded in the audit log with your name, the time and your IP address.
          </p>
        </>
      ) : (
        <p className="small text-secondary">No temporary mailbox password is stored for this person.</p>
      )}

      {showSetForm ? (
        <form action={setAction} className="mt-2">
          <input type="hidden" name="csrf_token" value={csrfToken} />
          <input type="hidden" name="employeeId" value={employeeId} />

          <FormMessage state={setState} />

          <TextField
            name="password"
            label={hasPassword ? "Replace with" : "Temporary mailbox password"}
            type="text"
            required
            autoComplete="off"
            hint="The password IT set on their Microsoft 365 mailbox. Encrypted before it is stored."
            state={setState}
          />

          <div className="d-flex gap-2">
            <SubmitButton size="sm" icon="bi-shield-lock" pendingLabel="Saving…">
              Store it
            </SubmitButton>
            {hasPassword && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setShowSetForm(false)}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => setShowSetForm(true)}
        >
          <i className="bi bi-pencil me-1" aria-hidden="true" />
          Replace it
        </button>
      )}
    </>
  );
}
