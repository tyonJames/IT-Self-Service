"use client";

import { useActionState, useState } from "react";
import type { EquipmentStatus } from "@prisma/client";
import { decideEquipmentRequest } from "@/app/(app)/equipment/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import { FormMessage } from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import {
  EQUIPMENT_STATUS_ICONS,
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_STATUS_VARIANTS,
  EQUIPMENT_TRANSITION_VERBS,
} from "@/lib/domain/equipment-status";

/**
 * Agent decision panel (spec §5.13).
 *
 * The buttons are rendered from the *same* transition map the server validates
 * against, so the UI can never offer a move the server would reject. The
 * server still checks — this is convenience, not security (instruction §7).
 */
export function DecisionPanel({
  requestId,
  currentStatus,
  allowed,
  availableAssets,
  issuedAssetIds,
  csrfToken,
}: {
  requestId: number;
  currentStatus: EquipmentStatus;
  allowed: EquipmentStatus[];
  availableAssets: { id: number; label: string }[];
  issuedAssetIds: number[];
  csrfToken: string;
}) {
  const [state, action] = useActionState(decideEquipmentRequest, IDLE_STATE);
  const [selected, setSelected] = useState<EquipmentStatus | "">(allowed[0] ?? "");

  if (allowed.length === 0) {
    return (
      <p className="text-secondary small mb-0">
        <i className="bi bi-lock me-1" aria-hidden="true" />
        This request is <strong>{EQUIPMENT_STATUS_LABELS[currentStatus]}</strong>, which is the end of
        the road — there is nothing further to decide.
      </p>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="requestId" value={requestId} />

      <FormMessage state={state} />

      <fieldset className="mb-3">
        <legend className="form-label">Move this request to</legend>
        <div className="d-flex flex-column gap-1">
          {allowed.map((status) => (
            <div className="form-check" key={status}>
              <input
                className="form-check-input"
                type="radio"
                name="status"
                id={`status-${status}`}
                value={status}
                checked={selected === status}
                onChange={() => setSelected(status)}
              />
              <label className="form-check-label" htmlFor={`status-${status}`}>
                <span className={`badge bg-${EQUIPMENT_STATUS_VARIANTS[status]} me-2`}>
                  <i className={`bi ${EQUIPMENT_STATUS_ICONS[status]} me-1`} aria-hidden="true" />
                  {EQUIPMENT_STATUS_LABELS[status]}
                </span>
                <span className="small text-secondary">{EQUIPMENT_TRANSITION_VERBS[status]}</span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      {selected === "issued" && (
        <div className="mb-3">
          <label className="form-label" htmlFor="issuedAssetIds">
            Devices being issued
          </label>
          <select
            className="form-select"
            id="issuedAssetIds"
            name="issuedAssetIds"
            multiple
            size={Math.min(8, Math.max(3, availableAssets.length))}
            defaultValue={issuedAssetIds.map(String)}
            aria-describedby="issuedAssetIds-hint"
          >
            {availableAssets.map((asset) => (
              <option key={asset.id} value={String(asset.id)}>
                {asset.label}
              </option>
            ))}
          </select>
          <div className="form-text" id="issuedAssetIds-hint">
            Link the actual devices handed over, so the request and the register agree. Hold Ctrl
            (or Cmd) to pick more than one.
          </div>
        </div>
      )}

      <div className="mb-3">
        <label className="form-label" htmlFor="note">
          Note for the requester
        </label>
        <textarea
          className="form-control"
          id="note"
          name="note"
          rows={3}
          maxLength={4000}
          placeholder="Included in the email they receive. If you are declining, say why."
        />
      </div>

      <SubmitButton icon="bi-check2-circle" pendingLabel="Saving…">
        {selected ? EQUIPMENT_TRANSITION_VERBS[selected] : "Apply"}
      </SubmitButton>
    </form>
  );
}
