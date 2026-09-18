"use client";

import { useActionState, useState } from "react";
import {
  recordManualLocation,
  rotateDeviceKey,
  uploadAssetDocument,
} from "@/app/(app)/assets/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import { FormMessage, SelectField, TextField } from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { ASSET_DOCUMENT_EXTENSIONS } from "@/lib/security/uploads-constants";

/**
 * Device key rotation (spec §5.16).
 *
 * The new key is shown exactly once, here, immediately after rotation — it is
 * stored only as a digest, so there is no later opportunity to display it
 * (CC-004). The copy button exists because a 64-character hex string typed by
 * hand is a support ticket waiting to happen.
 */
export function RotateKeyPanel({
  assetId,
  hasKey,
  csrfToken,
}: {
  assetId: number;
  hasKey: boolean;
  csrfToken: string;
}) {
  const [state, action] = useActionState(rotateDeviceKey, IDLE_STATE);
  const [copied, setCopied] = useState(false);

  const deviceKey = typeof state.data?.deviceKey === "string" ? state.data.deviceKey : null;

  return (
    <>
      <FormMessage state={state} />

      {deviceKey && (
        <div className="alert alert-warning">
          <p className="fw-semibold mb-1">
            <i className="bi bi-key me-1" aria-hidden="true" />
            New device key
          </p>
          <code className="d-block text-break small mb-2">{deviceKey}</code>
          <button
            type="button"
            className="btn btn-sm btn-outline-dark"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(deviceKey);
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              } catch {
                setCopied(false);
              }
            }}
          >
            <i className={`bi ${copied ? "bi-check2" : "bi-clipboard"} me-1`} aria-hidden="true" />
            {copied ? "Copied" : "Copy key"}
          </button>
          <p className="small mb-0 mt-2">
            Paste this into the agent’s configuration on the device. It will not be shown again.
          </p>
        </div>
      )}

      <form action={action}>
        <input type="hidden" name="csrf_token" value={csrfToken} />
        <input type="hidden" name="assetId" value={assetId} />
        <SubmitButton
          size="sm"
          variant={hasKey ? "outline-warning" : "outline-primary"}
          icon="bi-arrow-repeat"
          pendingLabel="Rotating…"
          confirm={
            hasKey
              ? "Rotating the key stops the current agent from reporting until it is reconfigured. Continue?"
              : undefined
          }
        >
          {hasKey ? "Rotate device key" : "Issue a device key"}
        </SubmitButton>
      </form>
    </>
  );
}

/** Manual location entry — `/assets/{id}/location/` from spec §4. */
export function ManualLocationPanel({
  assetId,
  csrfToken,
}: {
  assetId: number;
  csrfToken: string;
}) {
  const [state, action] = useActionState(recordManualLocation, IDLE_STATE);

  return (
    <form action={action}>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="assetId" value={assetId} />

      <FormMessage state={state} />

      <div className="row g-2">
        <div className="col-md-4">
          <TextField name="city" label="City" maxLength={120} state={state} />
        </div>
        <div className="col-md-4">
          <TextField name="region" label="Region" maxLength={120} state={state} />
        </div>
        <div className="col-md-4">
          <TextField name="country" label="Country" maxLength={120} state={state} />
        </div>
      </div>

      <TextField
        name="notes"
        label="Note"
        maxLength={500}
        placeholder="e.g. Handed to the Beitbridge site manager on 12 Sept"
        state={state}
      />

      <SubmitButton size="sm" variant="outline-primary" icon="bi-geo-alt" pendingLabel="Saving…">
        Record location
      </SubmitButton>
    </form>
  );
}

/** Asset document upload (spec §3.6). */
export function DocumentUploadPanel({
  assetId,
  csrfToken,
}: {
  assetId: number;
  csrfToken: string;
}) {
  const [state, action] = useActionState(uploadAssetDocument, IDLE_STATE);

  return (
    <form action={action}>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="assetId" value={assetId} />

      <FormMessage state={state} />

      <div className="row g-2">
        <div className="col-md-5">
          <SelectField
            name="documentType"
            label="Type"
            options={[
              { value: "allocation", label: "Allocation form" },
              { value: "policy", label: "Signed IT policy" },
              { value: "other", label: "Other" },
            ]}
            defaultValue="allocation"
            placeholder="Choose…"
            state={state}
          />
        </div>
        <div className="col-md-7">
          <div className="mb-3">
            <label className="form-label" htmlFor="document">
              File
            </label>
            <input
              className="form-control"
              type="file"
              id="document"
              name="document"
              accept={ASSET_DOCUMENT_EXTENSIONS.join(",")}
              required
              aria-describedby="document-hint"
            />
            <div className="form-text" id="document-hint">
              PDF or image, up to 10 MB. Downloads are authenticated — never a public link.
            </div>
          </div>
        </div>
      </div>

      <TextField name="notes" label="Note" maxLength={500} state={state} />

      <SubmitButton size="sm" variant="outline-primary" icon="bi-upload" pendingLabel="Uploading…">
        Upload document
      </SubmitButton>
    </form>
  );
}
