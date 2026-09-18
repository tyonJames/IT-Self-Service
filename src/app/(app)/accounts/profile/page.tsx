import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/permissions";
import { lookupRepository } from "@/repositories/lookup.repository";
import { currentCsrfToken } from "@/lib/security/csrf";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils/format";
import { countryName } from "@/lib/config/countries";
import { DefinitionRow, PageHeader, Section } from "@/components/ui";
import { ChangePasswordForm, ProfileForm } from "@/components/accounts/AccountForms";

export const metadata: Metadata = { title: "My profile" };
export const dynamic = "force-dynamic";

/** `/accounts/profile/` — edit your own details (spec §4). */
export default async function ProfilePage() {
  const session = await requireAuthenticatedUser("/accounts/profile/");

  const [countries, csrfToken, user, activeSessions] = await Promise.all([
    lookupRepository.countryChoices(),
    currentCsrfToken(),
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { username: true, email: true, lastLoginAt: true, createdAt: true },
    }),
    prisma.session.count({ where: { userId: session.user.id } }),
  ]);

  const roleLabel =
    session.user.role === "admin" ? "Admin" : session.user.role === "agent" ? "IT Agent" : "Staff";

  return (
    <>
      <PageHeader title="My profile" icon="bi-person-gear" subtitle="Your details and your password" />

      <div className="row g-3">
        <div className="col-lg-7">
          <Section title="Your details" icon="bi-person">
            <ProfileForm
              values={{
                firstName: session.user.firstName,
                lastName: session.user.lastName,
                department: session.user.department,
                phone: session.user.phone,
                site: session.user.site,
              }}
              countries={countries}
              csrfToken={csrfToken}
            />
          </Section>

          <Section title="Change your password" icon="bi-shield-lock">
            <p className="small text-secondary">
              Changing it here does not sign you out. If you think someone else knows it, change it
              and tell IT.
            </p>
            <ChangePasswordForm csrfToken={csrfToken} minLength={env().PASSWORD_MIN_LENGTH} />
          </Section>
        </div>

        <div className="col-lg-5">
          <Section title="Account" icon="bi-info-circle">
            <dl className="mb-0">
              <DefinitionRow label="Username">
                <code>{user.username}</code>
              </DefinitionRow>
              <DefinitionRow label="Email">{user.email}</DefinitionRow>
              <DefinitionRow label="Role">
                <span
                  className={`badge bg-${session.user.role === "admin" ? "danger" : session.user.role === "agent" ? "success" : "secondary"}`}
                >
                  {roleLabel}
                </span>
              </DefinitionRow>
              <DefinitionRow label="Country">{countryName(session.user.site)}</DefinitionRow>
              <DefinitionRow label="Last signed in">{formatDateTime(user.lastLoginAt)}</DefinitionRow>
              <DefinitionRow label="Account created">{formatDateTime(user.createdAt)}</DefinitionRow>
              <DefinitionRow label="Active sessions">{activeSessions}</DefinitionRow>
            </dl>
            <p className="small text-secondary mt-3 mb-0">
              Only an administrator can change your role. Signing in anywhere else ends this session
              — there is one session per account at a time.
            </p>
          </Section>
        </div>
      </div>
    </>
  );
}
