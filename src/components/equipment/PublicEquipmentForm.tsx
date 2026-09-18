"use client";

import { useActionState, useState } from "react";
import { submitEquipmentRequest } from "@/app/(public)/request-equipment/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import { CountrySiteSelect } from "@/components/forms/CountrySiteSelect";
import {
  CheckboxField,
  FieldErrors,
  FormMessage,
  HoneypotField,
  TextArea,
  TextField,
} from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";

/**
 * Public equipment request form (spec §5.2).
 *
 * Each item is a checkbox with its own quantity stepper; the quantity input is
 * only enabled once the item is ticked, so a quantity can never be submitted
 * for something nobody asked for.
 */
export function PublicEquipmentForm({
  countries,
  itemTypes,
  csrfToken,
}: {
  countries: { value: string; label: string }[];
  itemTypes: { slug: string; name: string }[];
  csrfToken: string;
}) {
  const [state, action] = useActionState(submitEquipmentRequest, IDLE_STATE);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  const toggle = (slug: string, checked: boolean) =>
    setTicked((prev) => ({ ...prev, [slug]: checked }));

  return (
    <form action={action} noValidate>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <HoneypotField />

      <FormMessage state={state} />

      <fieldset className="mb-4">
        <legend className="h6 text-radx">About you</legend>
        <div className="row">
          <div className="col-md-6">
            <TextField
              name="requesterName"
              label="Your full name"
              required
              maxLength={120}
              autoComplete="name"
              state={state}
            />
          </div>
          <div className="col-md-6">
            <TextField
              name="requesterEmail"
              label="Your email address"
              type="email"
              inputMode="email"
              required
              autoComplete="email"
              state={state}
            />
          </div>
        </div>

        <div className="row">
          <div className="col-md-6">
            <TextField
              name="department"
              label="Department"
              maxLength={120}
              autoComplete="organization-title"
              state={state}
            />
          </div>
        </div>

        <CountrySiteSelect
          countries={countries}
          siteIdName="siteId"
          required
          allowOther
        />
      </fieldset>

      <fieldset className="mb-4">
        <legend className="h6 text-radx">What do you need?</legend>

        <div className="row g-2">
          {itemTypes.map((type) => {
            const checkboxId = `item-${type.slug}`;
            const isTicked = ticked[type.slug] ?? false;
            return (
              <div className="col-sm-6 col-lg-4" key={type.slug}>
                <div
                  className={`border rounded p-2 h-100 d-flex align-items-center gap-2${isTicked ? " border-success bg-radx-light" : ""}`}
                >
                  <div className="form-check mb-0 flex-grow-1">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={checkboxId}
                      name="items"
                      value={type.slug}
                      checked={isTicked}
                      onChange={(event) => toggle(type.slug, event.target.checked)}
                    />
                    <label className="form-check-label" htmlFor={checkboxId}>
                      {type.name}
                    </label>
                  </div>

                  <label className="visually-hidden" htmlFor={`quantity_${type.slug}`}>
                    Quantity of {type.name}
                  </label>
                  <input
                    className="form-control form-control-sm"
                    style={{ width: "4.5rem" }}
                    type="number"
                    id={`quantity_${type.slug}`}
                    name={`quantity_${type.slug}`}
                    min={1}
                    max={99}
                    defaultValue={1}
                    disabled={!isTicked}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <FieldErrors state={state} name="items" />

        <div className="mt-3">
          <TextField
            name="otherEquipment"
            label="Something else"
            maxLength={500}
            placeholder="Describe anything not in the list above"
            state={state}
          />
        </div>
      </fieldset>

      <fieldset className="mb-4">
        <legend className="h6 text-radx">Why do you need it?</legend>

        <div className="row">
          <div className="col-md-6">
            <TextField
              name="reason"
              label="Short reason"
              required
              maxLength={500}
              placeholder="e.g. New starter in Accounts from 1 October"
              state={state}
            />
          </div>
          <div className="col-md-6">
            <div className="mb-3">
              <label className="form-label" htmlFor="priority">
                Priority
              </label>
              <select className="form-select" id="priority" name="priority" defaultValue="normal">
                <option value="normal">Normal</option>
                <option value="urgent">Urgent — work is blocked</option>
              </select>
            </div>
          </div>
        </div>

        <TextArea
          name="justification"
          label="Justification"
          rows={4}
          placeholder="Anything that helps IT approve this quickly — who authorised it, what it replaces, when it is needed."
          state={state}
        />
      </fieldset>

      <CheckboxField
        name="sendCopy"
        label="Email me a copy of this request"
        defaultChecked
      />

      <div className="d-flex gap-2">
        <SubmitButton icon="bi-send" pendingLabel="Sending…">
          Submit request
        </SubmitButton>
        <a className="btn btn-outline-secondary" href="/help/">
          Cancel
        </a>
      </div>
    </form>
  );
}
