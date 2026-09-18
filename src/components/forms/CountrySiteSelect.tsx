"use client";

import { useEffect, useId, useState } from "react";

/**
 * Cascading Country → Site selector (spec §5.3).
 *
 * Changing the country fetches `/api/sites/?country=XX` and repopulates the
 * site list, with a visible loading state and a graceful failure mode: if the
 * lookup fails the site field falls back to a free-text input so a public
 * submission is never blocked by a flaky network.
 */

interface SiteOption {
  id: number;
  name: string;
  code: string;
}

export function CountrySiteSelect({
  countries,
  countryName: countryField = "country",
  siteName: siteField = "siteName",
  siteIdName: siteIdField,
  defaultCountry = "",
  defaultSite = "",
  required = false,
  allowOther = false,
}: {
  countries: { value: string; label: string }[];
  countryName?: string;
  siteName?: string;
  siteIdName?: string;
  defaultCountry?: string;
  defaultSite?: string;
  required?: boolean;
  allowOther?: boolean;
}) {
  const uid = useId();
  const countryId = `${uid}-country`;
  const siteId = `${uid}-site`;

  const [country, setCountry] = useState(defaultCountry);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selectedSite, setSelectedSite] = useState(defaultSite);

  useEffect(() => {
    if (!country || country === "OTHER") {
      setSites([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");

    fetch(`/api/sites/?country=${encodeURIComponent(country)}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Site lookup failed (${response.status})`);
        return response.json() as Promise<{ sites: SiteOption[] }>;
      })
      .then((data) => {
        setSites(data.sites ?? []);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        setSites([]);
        setStatus("error");
      });

    return () => controller.abort();
  }, [country]);

  const selectedSiteId = sites.find((s) => s.name === selectedSite)?.id ?? "";

  return (
    <div className="row g-3">
      <div className="col-md-6">
        <label className="form-label" htmlFor={countryId}>
          Country
          {required && (
            <span className="text-danger ms-1" aria-hidden="true">
              *
            </span>
          )}
        </label>
        <select
          className="form-select"
          id={countryId}
          name={countryField}
          value={country}
          required={required}
          onChange={(event) => {
            setCountry(event.target.value);
            setSelectedSite("");
          }}
        >
          <option value="">Choose a country…</option>
          {countries.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
          {allowOther && <option value="OTHER">Other</option>}
        </select>
      </div>

      <div className="col-md-6">
        <label className="form-label" htmlFor={siteId}>
          Site
          {status === "loading" && (
            <span className="ms-2 text-secondary small">
              <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
              Loading sites…
            </span>
          )}
        </label>

        {status === "ready" && sites.length > 0 ? (
          <>
            <select
              className="form-select"
              id={siteId}
              name={siteField}
              value={selectedSite}
              onChange={(event) => setSelectedSite(event.target.value)}
              aria-describedby={`${siteId}-hint`}
            >
              <option value="">Choose a site…</option>
              {sites.map((site) => (
                <option key={site.id} value={site.name}>
                  {site.code ? `${site.name} (${site.code})` : site.name}
                </option>
              ))}
            </select>
            {siteIdField && <input type="hidden" name={siteIdField} value={selectedSiteId} />}
            <div className="form-text" id={`${siteId}-hint`}>
              Which office or site are you at?
            </div>
          </>
        ) : (
          <>
            <input
              className="form-control"
              type="text"
              id={siteId}
              name={siteField}
              value={selectedSite}
              placeholder={country ? "Type your site name" : "Choose a country first"}
              disabled={!country}
              maxLength={150}
              onChange={(event) => setSelectedSite(event.target.value)}
              aria-describedby={`${siteId}-hint`}
            />
            <div className="form-text" id={`${siteId}-hint`}>
              {status === "error"
                ? "We could not load the site list — type your site name instead."
                : status === "ready"
                  ? "No sites are listed for that country yet — type yours."
                  : "Choose a country to see its sites."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
