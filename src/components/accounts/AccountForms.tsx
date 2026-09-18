"use client";

import { useActionState } from "react";
import {
  changeOwnPassword,
  changeUserRole,
  createUser,
  updateOwnProfile,
} from "@/app/(app)/accounts/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import { FormMessage, SelectField, TextField } from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";

export function ProfileForm({
  values,
  countries,
  csrfToken,
}: {
  values: { firstName: string; lastName: string; department: string; phone: string; site: string };
  countries: { value: string; label: string }[];
  csrfToken: string;
}) {
  const [state, action] = useActionState(updateOwnProfile, IDLE_STATE);

  return (
    <form action={action} noValidate>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <FormMessage state={state} />

      <div className="row">
        <div className="col-md-6">
          <TextField
            name="firstName"
            label="First name"
            defaultValue={values.firstName}
            maxLength={80}
            autoComplete="given-name"
            state={state}
          />
        </div>
        <div className="col-md-6">
          <TextField
            name="lastName"
            label="Surname"
            defaultValue={values.lastName}
            maxLength={80}
            autoComplete="family-name"
            state={state}
          />
        </div>
      </div>

      <div className="row">
        <div className="col-md-6">
          <TextField
            name="department"
            label="Department"
            defaultValue={values.department}
            maxLength={120}
            state={state}
          />
        </div>
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
      </div>

      <SelectField
        name="site"
        label="Country"
        options={[...countries, { value: "ALL", label: "All countries" }]}
        defaultValue={values.site}
        placeholder="Choose…"
        state={state}
      />

      <SubmitButton icon="bi-check2" pendingLabel="Saving…">
        Save profile
      </SubmitButton>
    </form>
  );
}

export function ChangePasswordForm({
  csrfToken,
  minLength,
}: {
  csrfToken: string;
  minLength: number;
}) {
  const [state, action] = useActionState(changeOwnPassword, IDLE_STATE);

  return (
    <form action={action} noValidate>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <FormMessage state={state} />

      <TextField
        name="currentPassword"
        label="Current password"
        type="password"
        required
        autoComplete="current-password"
        state={state}
      />
      <TextField
        name="newPassword"
        label="New password"
        type="password"
        required
        autoComplete="new-password"
        hint={`At least ${minLength} characters, and not one of the obvious ones.`}
        state={state}
      />
      <TextField
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        required
        autoComplete="new-password"
        state={state}
      />

      <SubmitButton icon="bi-shield-lock" variant="outline-primary" pendingLabel="Saving…">
        Change password
      </SubmitButton>
    </form>
  );
}

export function CreateUserForm({
  countries,
  csrfToken,
  minLength,
}: {
  countries: { value: string; label: string }[];
  csrfToken: string;
  minLength: number;
}) {
  const [state, action] = useActionState(createUser, IDLE_STATE);

  return (
    <form action={action} noValidate>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <FormMessage state={state} />

      <div className="row">
        <div className="col-md-6">
          <TextField
            name="username"
            label="Username"
            required
            maxLength={60}
            autoComplete="off"
            hint="Letters, numbers, dots, dashes and underscores."
            state={state}
          />
        </div>
        <div className="col-md-6">
          <TextField
            name="email"
            label="Email address"
            type="email"
            inputMode="email"
            required
            autoComplete="off"
            hint="They can sign in with either this or their username."
            state={state}
          />
        </div>
      </div>

      <div className="row">
        <div className="col-md-6">
          <TextField name="firstName" label="First name" maxLength={80} state={state} />
        </div>
        <div className="col-md-6">
          <TextField name="lastName" label="Surname" maxLength={80} state={state} />
        </div>
      </div>

      <div className="row">
        <div className="col-md-6">
          <SelectField
            name="role"
            label="Role"
            options={[
              { value: "staff", label: "Staff — sees only their own tickets" },
              { value: "agent", label: "IT Agent — manages the help desk" },
              { value: "admin", label: "Admin — manages the help desk and user accounts" },
            ]}
            defaultValue="agent"
            required
            placeholder="Choose a role…"
            state={state}
          />
        </div>
        <div className="col-md-6">
          <SelectField
            name="site"
            label="Country"
            options={[...countries, { value: "ALL", label: "All countries" }]}
            defaultValue="ZW"
            placeholder="Choose…"
            state={state}
          />
        </div>
      </div>

      <div className="row">
        <div className="col-md-6">
          <TextField name="department" label="Department" maxLength={120} state={state} />
        </div>
        <div className="col-md-6">
          <TextField name="phone" label="Phone" type="tel" maxLength={40} state={state} />
        </div>
      </div>

      <TextField
        name="password"
        label="Initial password"
        type="password"
        required
        autoComplete="new-password"
        hint={`At least ${minLength} characters. Tell them to change it once they are in.`}
        state={state}
      />

      <SubmitButton icon="bi-person-plus" pendingLabel="Creating…">
        Create account
      </SubmitButton>
    </form>
  );
}

export function RoleForm({
  userId,
  currentRole,
  disabled,
  csrfToken,
}: {
  userId: number;
  currentRole: string;
  disabled: boolean;
  csrfToken: string;
}) {
  const [state, action] = useActionState(changeUserRole, IDLE_STATE);

  return (
    <form action={action} className="d-flex align-items-center gap-1">
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="userId" value={userId} />

      <label className="visually-hidden" htmlFor={`role-${userId}`}>
        Role
      </label>
      <select
        className="form-select form-select-sm"
        id={`role-${userId}`}
        name="role"
        defaultValue={currentRole}
        disabled={disabled}
        style={{ width: "auto" }}
      >
        <option value="staff">Staff</option>
        <option value="agent">IT Agent</option>
        <option value="admin">Admin</option>
      </select>

      {!disabled && (
        <SubmitButton size="sm" variant="outline-secondary" pendingLabel="…">
          Save
        </SubmitButton>
      )}

      {state.status === "error" && (
        <span className="text-danger small ms-1" role="alert">
          {state.message}
        </span>
      )}
    </form>
  );
}
