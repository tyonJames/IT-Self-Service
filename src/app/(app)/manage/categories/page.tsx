import type { Metadata } from "next";
import { requireAgent } from "@/lib/permissions";
import { lookupRepository } from "@/repositories/lookup.repository";
import { prisma } from "@/lib/db/prisma";
import { currentCsrfToken } from "@/lib/security/csrf";
import { Alert, PageHeader } from "@/components/ui";
import { LookupManager, type LookupRow } from "@/components/manage/LookupManager";
import { deleteTicketCategory, saveTicketCategory } from "../actions";

export const metadata: Metadata = { title: "Ticket categories" };
export const dynamic = "force-dynamic";

/** `/manage/categories/` (spec §5.14). */
export default async function ManageCategoriesPage() {
  await requireAgent("/manage/categories/");

  const [categories, usage, csrfToken] = await Promise.all([
    lookupRepository.listTicketCategories({}),
    prisma.ticket.groupBy({
      by: ["category"],
      where: { isDeleted: false },
      _count: { _all: true },
    }),
    currentCsrfToken(),
  ]);

  const usageBySlug = new Map(usage.map((u) => [u.category, u._count._all]));

  const rows: LookupRow[] = categories.map((category) => {
    const used = usageBySlug.get(category.slug) ?? 0;
    return {
      id: category.id,
      isActive: category.isActive,
      cells: [
        category.name,
        category.slug,
        category.sortOrder,
        used,
        category.isActive ? "Active" : "Inactive",
      ],
      values: {
        name: category.name,
        slug: category.slug,
        sortOrder: String(category.sortOrder),
      },
      deleteBlockedReason: used > 0 ? `${used} ticket(s) use this category` : undefined,
    };
  });

  return (
    <>
      <PageHeader
        title="Ticket categories"
        icon="bi-tags"
        subtitle="What people choose from when reporting a problem"
      />

      <Alert variant="info" title="Slugs are permanent">
        Tickets store the slug, not the id, so a category can be renamed or reordered freely but its
        slug never changes. To retire one, deactivate it — historic tickets keep their label.
      </Alert>

      <LookupManager
        title="All categories"
        columns={["Name", "Slug", "Order", "Tickets", "Status"]}
        rows={rows}
        addLabel="Add a category"
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
        saveAction={saveTicketCategory}
        deleteAction={deleteTicketCategory}
        csrfToken={csrfToken}
      />
    </>
  );
}
