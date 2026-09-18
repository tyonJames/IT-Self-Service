"use client";

import { useActionState } from "react";
import { submitPublicTicket } from "@/app/(public)/report/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import { CountrySiteSelect } from "@/components/forms/CountrySiteSelect";
import { FileDropzone } from "@/components/forms/FileDropzone";
import {
  CheckboxField,
  FormMessage,
  HoneypotField,
  SelectField,
  TextArea,
  TextField,
} from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { TICKET_ATTACHMENT_EXTENSIONS } from "@/lib/security/uploads-constants";
import { TICKET_DEVICE_TYPES } from "@/lib/domain/tickets";

/**
 * The public "report a problem" form (spec §5.1).
 *
 * A Client Component because it needs the action's pending/error state and the
 * cascading site selector. Everything it renders comes from props resolved on
 * the server — it performs no data access of its own.
 */
export function PublicTicketForm({
  countries,
  categories,
  csrfToken,
}: {
  countries: { value: string; label: string }[];
  categories: { value: string; label: string }[];
  csrfToken: string;
}) {
  const [state, action] = useActionState(submitPublicTicket, IDLE_STATE);

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
              name="submitterName"
              label="Your full name"
              required
              maxLength={120}
              autoComplete="name"
              state={state}
            />
          </div>
          <div className="col-md-6">
            <TextField
              name="submitterEmail"
              label="Your email address"
              type="email"
              inputMode="email"
              required
              autoComplete="email"
              hint="We send your reference number and updates here."
              state={state}
            />
          </div>
        </div>

        <CountrySiteSelect countries={countries} required allowOther />
      </fieldset>

      <fieldset className="mb-4">
        <legend className="h6 text-radx">What is the problem?</legend>

        <div className="row">
          <div className="col-md-6">
            <SelectField
              name="category"
              label="Issue category"
              options={categories}
              required
              placeholder="Choose a category…"
              state={state}
            />
          </div>
          <div className="col-md-6">
            <SelectField
              name="deviceType"
              label="Device type"
              options={TICKET_DEVICE_TYPES.map((d) => ({ value: d.value, label: d.label }))}
              placeholder="Not device-specific"
              state={state}
            />
          </div>
        </div>

        <TextField
          name="title"
          label="One-line summary"
          required
          maxLength={200}
          placeholder="e.g. Laptop will not connect to the office Wi-Fi"
          state={state}
        />

        <TextArea
          name="description"
          label="What is happening?"
          required
          rows={6}
          placeholder="What were you doing, what happened, and any error message you saw. The more detail, the faster we can fix it."
          state={state}
        />

        <div className="row">
          <div className="col-md-6">
            <TextField
              name="assetNumber"
              label="Asset number"
              maxLength={60}
              placeholder="e.g. RDX-ZL014"
              hint="On the sticker on your device, if it has one."
              state={state}
            />
          </div>
          <div className="col-md-6">
            <TextField
              name="anydeskId"
              label="AnyDesk ID"
              maxLength={60}
              hint="Only if IT has asked you for it — it lets us connect remotely."
              state={state}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="mb-4">
        <legend className="h6 text-radx">Anything to show us?</legend>
        <FileDropzone
          name="attachments"
          label="Screenshots or documents"
          accept={TICKET_ATTACHMENT_EXTENSIONS.join(",")}
          maxFiles={5}
          hint="Up to 5 files, 10 MB each. A screenshot of the error message helps enormously."
        />
      </fieldset>

      <CheckboxField
        name="sendCopy"
        label="Email me a copy of this request"
        defaultChecked
        hint="You will get your reference number by email."
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
