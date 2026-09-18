/**
 * Soft-delete query scopes (spec §3.16, instruction §5).
 *
 * The rule the whole application depends on: **every** list, count and
 * lookup goes through `notDeleted()`. `withDeleted()` exists solely for the
 * recycle bin, and `recycleBinRepository` is the only module that imports it.
 *
 * Keeping the two scopes as named helpers rather than inlining
 * `{ isDeleted: false }` means a missing scope is visible in review: a query
 * with no scope helper is a query someone forgot.
 */

export interface SoftDeleteScope {
  isDeleted?: boolean;
}

export function notDeleted(): { isDeleted: false } {
  return { isDeleted: false };
}

export function onlyDeleted(): { isDeleted: true } {
  return { isDeleted: true };
}

export function withDeleted(): Record<string, never> {
  return {};
}

export interface SoftDeleteFields {
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedById: number | null;
}

export function softDeleteData(userId: number | null): SoftDeleteFields {
  return { isDeleted: true, deletedAt: new Date(), deletedById: userId };
}

export function restoreData(): SoftDeleteFields {
  return { isDeleted: false, deletedAt: null, deletedById: null };
}
