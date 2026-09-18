/** Server-side pagination (instruction §19). No page ever ships a full table. */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function parsePageRequest(
  params: { page?: string | string[]; pageSize?: string | string[] },
  defaultSize = DEFAULT_PAGE_SIZE,
): PageRequest {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const page = Math.max(1, Number.parseInt(first(params.page) ?? "1", 10) || 1);
  const requested = Number.parseInt(first(params.pageSize) ?? "", 10);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(5, Number.isFinite(requested) && requested > 0 ? requested : defaultSize),
  );

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
  from: number;
  to: number;
}

export function paginate<T>(items: T[], total: number, request: PageRequest): Paginated<T> {
  const totalPages = Math.max(1, Math.ceil(total / request.pageSize));
  const page = Math.min(request.page, totalPages);
  return {
    items,
    total,
    page,
    pageSize: request.pageSize,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
    from: total === 0 ? 0 : (page - 1) * request.pageSize + 1,
    to: Math.min(total, page * request.pageSize),
  };
}

/** Page numbers to render, with ellipses, for a long result set. */
export function pageWindow(current: number, totalPages: number, span = 2): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const pages = new Set<number>([1, totalPages]);
  for (let p = current - span; p <= current + span; p += 1) {
    if (p > 1 && p < totalPages) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push("…");
    out.push(p);
    previous = p;
  }
  return out;
}
