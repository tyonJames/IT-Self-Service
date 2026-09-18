import type { Metadata } from "next";
import { requireAgent } from "@/lib/permissions";
import { lookupRepository } from "@/repositories/lookup.repository";
import { prisma } from "@/lib/db/prisma";
import { currentCsrfToken } from "@/lib/security/csrf";
import { Alert, PageHeader } from "@/components/ui";
import { LookupManager, type LookupRow } from "@/components/manage/LookupManager";
import { deleteEquipmentType, saveEquipmentType } from "../actions";

export const metadata: Metadata = { title: "Equipment types" };
export const dynamic = "force-dynamic";

/** `/manage/equipment-types/` (spec §5.14). */
export default async function ManageEquipmentTypesPage() {
  await requireAgent("/manage/equipment-types/");

  const [types, usage, csrfToken] = await Promise.all([
    lookupRepository.listEquipmentItemTypes({}),
    prisma.requestedItem.groupBy({ by: ["item"], _count: { _all: true } }),
    currentCsrfToken(),
  ]);

  const usageBySlug = new Map(usage.map((u) => [u.item, u._count._all]));

  const rows: LookupRow[] = types.map((type) => {
    const used = usageBySlug.get(type.slug) ?? 0;
    return {
      id: type.id,
      isActive: type.isActive,
      cells: [type.name, type.slug, type.sortOrder, used, type.isActive ? "Active" : "Inactive"],
      values: { name: type.name, slug: type.slug, sortOrder: String(type.sortOrder) },
      deleteBlockedReason: used > 0 ? `${used} request line(s) use this` : undefined,
    };
  });

  return (
    <>
      <PageHeader
        title="Equipment types"
        icon="bi-list-check"
        subtitle="The tick-boxes people see on the equipment request form"
      />

      <Alert variant="info" title="Slugs are permanent">
        Request lines store the slug, so a type can be renamed or reordered but its slug never
        changes. Deactivate a type to stop offering it without disturbing past requests.
      </Alert>

      <LookupManager
        title="All equipment types"
        columns={["Name", "Slug", "Order", "Requested", "Status"]}
        rows={rows}
        addLabel="Add an equipment type"
        fields={[
          { name: "name", label: "Display name", type: "text", required: true, maxLength: 120 },
          {
            name: "slug",
            label: "Slug",
            type: "text",
            required: true,
            createOnly: true,
            maxLength: 60,
            colClass: "col-7",
            hint: "Lowercase, letters, numbers and underscores. Cannot be changed later.",
          },
          { name: "sortOrder", label: "Sort order", type: "number", colClass: "col-5" },
        ]}
        saveAction={saveEquipmentType}
        deleteAction={deleteEquipmentType}
        csrfToken={csrfToken}
      />
    </>
  );
}
