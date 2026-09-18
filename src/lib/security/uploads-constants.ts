/**
 * Client-safe upload constants.
 *
 * `lib/security/uploads.ts` depends on `node:path` and `node:crypto`, so it
 * can only run on the server. This module holds the plain data — the allowed
 * extension lists — so Client Components that hint at file pickers can
 * reference the same authoritative source without dragging the server code
 * into the browser bundle.
 */

export const TICKET_ATTACHMENT_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".txt",
  ".zip",
] as const;

export const ASSET_DOCUMENT_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"] as const;

export const CSV_EXTENSIONS = [".csv", ".txt"] as const;
