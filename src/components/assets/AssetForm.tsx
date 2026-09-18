"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createAsset, updateAsset } from "@/app/(app)/assets/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import {
  FormMessage,
  SelectField,
  TextArea,
  TextField,
} from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import {
  ASSET_SPEC_FIELD_LABELS,
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  CATEGORY_FIELDS,
  isSiteCategory,
  SELECTABLE_ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
} from "@/lib/domain/assets";
import { expectedTagPrefix } from "@/lib/domain/asset-tag";
import type { AssetCategory } from "@prisma/client";

/**
 * Create/edit asset form (spec §3.4, §5.8).
 *
 * Two behaviours the spec calls for:
 *  - `CATEGORY_FIELDS` drives which specification fields are shown, so a
 *    printer form does not ask for an IMEI;
 *  - `SITE_CATEGORIES` decides whether the assignment control offers a person
 *    or a site, because a clocking device is not issued to an individual.
 *
 * Hidden fields are removed from the DOM rather than merely hidden, so the
 * browser cannot submit stale values for a category that no longer applies.
 */

export interface AssetFormValues {
  id?: number;
  assetTag: string;
  category: AssetCategory;
  brand: string;
  model: string;
  serialNumber: string;
  status: string;
  assignedEmployeeId: string;
  assignedSiteId: string;
  department: string;
  site: string;
  location: string;
  macAddress: string;
  osVersion: string;
  officeVersion: string;
  laptopOrDesktop: string;
  imei1: string;
  imei2: string;
  cellNumber: string;
  package: string;
  printerType: string;
  tonerType: string;
  ipAddress: string;
  areaCode: string;
  acquisitionDate: string;
  notes: string;
}

export function AssetForm({
  mode,
  values,
  countries,
  employees,
  sites,
  csrfToken,
}: {
  mode: "create" | "edit";
  values: AssetFormValues;
  countries: { value: string; label: string }[];
  employees: { id: number; label: string }[];
  sites: { id: number; label: string; country: string }[];
  csrfToken: string;
}) {
  const [state, action] = useActionState(
    mode === "create" ? createAsset : updateAsset,
    IDLE_STATE,
  );

  const [category, setCategory] = useState<AssetCategory>(values.category);
  const [country, setCountry] = useState(values.site);
  const [assignTo, setAssignTo] = useState<"person" | "site" | "none">(
    values.assignedEmployeeId ? "person" : values.assignedSiteId ? "site" : isSiteCategory(values.category) ? "site" : "none",
  );

  const specFields = CATEGORY_FIELDS[category] ?? [];
  const tagHint = expectedTagPrefix({ site: country, category });
  const sitesForCountry = sites.filter((s) => !country || s.country === country);

  return (
    <form action={action} noValidate>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      {values.id && <input type="hidden" name="assetId" value={values.id} />}

      <FormMessage state={state} />

      <div className="row g-3">
        <div className="col-lg-7">
          <div className="card mb-3">
            <div className="card-header">Identity</div>
            <div className="card-body">
              <div className="row">
                <div className="col-md-6">
                  <TextField
                    name="assetTag"
                    label="Asset tag"
                    defaultValue={values.assetTag}
                    maxLength={40}
                    hint={
                      tagHint
                        ? `Leave blank if this device has no sticker. Tags for this country and type look like ${tagHint}001.`
                        : "Leave blank if this device has no sticker."
                    }
                    state={state}
                  />
                </div>
                <div className="col-md-6">
                  <div className="mb-3">
                    <label className="form-label" htmlFor="category">
                      Type <span className="text-danger" aria-hidden="true">*</span>
                    </label>
                    <select
                      className="form-select"
                      id="category"
                      name="category"
                      value={category}
                      required
                      onChange={(event) => {
                        const next = event.target.value as AssetCategory;
                        setCategory(next);
                        // Follow the spec's assignment convention for the new type.
                        setAssignTo(isSiteCategory(next) ? "site" : "person");
                      }}
                    >
                      {SELECTABLE_ASSET_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {ASSET_CATEGORY_LABELS[c]}
                        </option>
                      ))}
                      {values.category === "computer" && (
                        <option value="computer">{ASSET_CATEGORY_LABELS.computer}</option>
                      )}
                    </select>
                    <div className="form-text">
                      {isSiteCategory(category)
                        ? "This type is normally assigned to a site."
                        : "This type is normally assigned to a person."}
                    </div>
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-md-6">
                  <TextField name="brand" label="Make" defaultValue={values.brand} maxLength={80} state={state} />
                </div>
                <div className="col-md-6">
                  <TextField name="model" label="Model" defaultValue={values.model} maxLength={80} state={state} />
                </div>
              </div>

              <div className="row">
                <div className="col-md-6">
                  <TextField
                    name="serialNumber"
                    label="Serial number"
                    defaultValue={values.serialNumber}
                    maxLength={120}
                    hint="Used to match the device when the tracking agent enrols."
                    state={state}
                  />
                </div>
                <div className="col-md-6">
                  <SelectField
                    name="status"
                    label="Status"
                    options={ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] }))}
                    defaultValue={values.status}
                    required
                    placeholder="Choose a status…"
                    state={state}
                  />
                </div>
              </div>
            </div>
          </div>

          {specFields.length > 0 && (
            <div className="card mb-3">
              <div className="card-header">{ASSET_CATEGORY_LABELS[category]} details</div>
              <div className="card-body">
                <div className="row">
                  {specFields.map((field) => (
                    <div className="col-md-6" key={field}>
                      <TextField
                        name={field}
                        label={ASSET_SPEC_FIELD_LABELS[field] ?? field}
                        defaultValue={(values as unknown as Record<string, string>)[field] ?? ""}
                        maxLength={80}
                        state={state}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="card mb-3">
            <div className="card-header">Notes</div>
            <div className="card-body">
              <TextArea
                name="notes"
                label="Anything worth knowing"
                defaultValue={values.notes}
                rows={4}
                maxLength={4000}
                placeholder="Warranty end date, known faults, who authorised the purchase…"
                state={state}
              />
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card mb-3">
            <div className="card-header">Where it is</div>
            <div className="card-body">
              <div className="mb-3">
                <label className="form-label" htmlFor="site">
                  Country
                </label>
                <select
                  className="form-select"
                  id="site"
                  name="site"
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                >
                  {countries.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <TextField
                name="location"
                label="Site"
                defaultValue={values.location}
                maxLength={150}
                hint="The physical office or site this device lives at."
                state={state}
              />

              <TextField
                name="department"
                label="Department"
                defaultValue={values.department}
                maxLength={120}
                state={state}
              />

              <TextField
                name="acquisitionDate"
                label="Acquired on"
                type="date"
                defaultValue={values.acquisitionDate}
                state={state}
              />
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-header">Assigned to</div>
            <div className="card-body">
              <fieldset className="mb-3">
                <legend className="visually-hidden">Assign this asset to</legend>
                <div className="btn-group w-100" role="group">
                  {(["person", "site", "none"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`btn btn-sm btn-outline-secondary${assignTo === option ? " active" : ""}`}
                      aria-pressed={assignTo === option}
                      onClick={() => setAssignTo(option)}
                    >
                      {option === "person" ? "A person" : option === "site" ? "A site" : "Nobody"}
                    </button>
                  ))}
                </div>
                <div className="form-text">
                  An asset belongs to a person or to a site — never both.
                </div>
              </fieldset>

              {/* Only the active control is rendered, so the inactive one
                  cannot submit a stale id and violate exclusivity. */}
              {assignTo === "person" && (
                <SelectField
                  name="assignedEmployeeId"
                  label="Employee"
                  options={employees.map((e) => ({ value: String(e.id), label: e.label }))}
                  defaultValue={values.assignedEmployeeId}
                  placeholder="Choose an employee…"
                  state={state}
                />
              )}

              {assignTo === "site" && (
                <SelectField
                  name="assignedSiteId"
                  label="Site"
                  options={sitesForCountry.map((s) => ({ value: String(s.id), label: s.label }))}
                  defaultValue={values.assignedSiteId}
                  placeholder="Choose a site…"
                  hint={
                    sitesForCountry.length === 0
                      ? "No sites are set up for this country yet — add one under Manage → Sites."
                      : undefined
                  }
                  state={state}
                />
              )}
            </div>
          </div>

          <div className="d-flex gap-2">
            <SubmitButton icon="bi-check2" pendingLabel="Saving…">
              {mode === "create" ? "Create asset" : "Save changes"}
            </SubmitButton>
            <Link
              className="btn btn-outline-secondary"
              href={values.id ? `/assets/${values.id}/` : "/assets/"}
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>
    </form>
  );
}
