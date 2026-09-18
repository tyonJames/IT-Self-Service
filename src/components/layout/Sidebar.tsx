"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Left navigation (spec §1).
 *
 * A Client Component because it needs the current pathname to mark the active
 * link and it owns the mobile open/closed state. It receives its badge counts
 * as props from the server layout — it never fetches.
 */

export interface SidebarCounts {
  openTickets: number;
  overdueTickets: number;
  openEquipment: number;
  recycleBin: number;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: number;
  badgeVariant?: string;
  badgeTitle?: string;
}

export function Sidebar({
  counts,
  isAdmin,
  isOpen,
  onClose,
}: {
  counts: SidebarCounts;
  isAdmin: boolean;
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Close the drawer whenever navigation happens on a small screen.
  useEffect(() => {
    if (mounted) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const main: NavItem[] = [
    { href: "/tickets/reports/", label: "Dashboard", icon: "bi-speedometer2" },
    {
      href: "/tickets/",
      label: "Tickets",
      icon: "bi-ticket-detailed",
      badge: counts.openTickets,
      badgeVariant: counts.overdueTickets > 0 ? "danger" : "secondary",
      badgeTitle:
        counts.overdueTickets > 0
          ? `${counts.openTickets} open, ${counts.overdueTickets} overdue`
          : `${counts.openTickets} open`,
    },
    { href: "/assets/", label: "Assets", icon: "bi-hdd-stack" },
    { href: "/employees/", label: "Employees", icon: "bi-people" },
    {
      href: "/equipment/",
      label: "Equipment Requests",
      icon: "bi-box-seam",
      badge: counts.openEquipment,
      badgeVariant: "secondary",
      badgeTitle: `${counts.openEquipment} open`,
    },
  ];

  const manage: NavItem[] = [
    { href: "/manage/sites/", label: "Sites", icon: "bi-geo-alt" },
    { href: "/manage/categories/", label: "Categories", icon: "bi-tags" },
    { href: "/manage/equipment-types/", label: "Equipment Types", icon: "bi-list-check" },
    { href: "/manage/countries/", label: "Countries", icon: "bi-globe-europe-africa" },
    {
      href: "/manage/recycle-bin/",
      label: "Recycle Bin",
      icon: "bi-trash3",
      badge: counts.recycleBin,
      badgeVariant: "secondary",
      badgeTitle: `${counts.recycleBin} deleted record(s)`,
    },
  ];

  const isActive = (href: string): boolean => {
    if (href === "/tickets/reports/") return pathname.startsWith("/tickets/reports");
    if (href === "/tickets/") return pathname.startsWith("/tickets") && !pathname.startsWith("/tickets/reports");
    return pathname.startsWith(href.replace(/\/$/, ""));
  };

  const renderLink = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      className={`sidebar-link${isActive(item.href) ? " is-active" : ""}`}
      aria-current={isActive(item.href) ? "page" : undefined}
    >
      <i className={`bi ${item.icon}`} aria-hidden="true" />
      <span>{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <span className={`badge bg-${item.badgeVariant ?? "secondary"}`} title={item.badgeTitle}>
          {item.badge > 99 ? "99+" : item.badge}
          <span className="visually-hidden">{item.badgeTitle}</span>
        </span>
      )}
    </Link>
  );

  return (
    <>
      {isOpen && (
        <button
          type="button"
          className="sidebar-backdrop d-lg-none"
          aria-label="Close navigation"
          onClick={onClose}
        />
      )}
      <nav
        className={`app-sidebar${isOpen ? " is-open" : ""}`}
        aria-label="Main navigation"
        id="app-sidebar"
      >
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden="true">
            RX
          </span>
          <span className="sidebar-brand-text">
            Radx IT
            <small>Help Desk</small>
          </span>
          <button
            type="button"
            className="btn btn-sm btn-link text-white ms-auto d-lg-none p-0"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        <div className="pb-2">{main.map(renderLink)}</div>

        {isAdmin && (
          <>
            <div className="sidebar-section">Manage</div>
            <div className="pb-4">{manage.map(renderLink)}</div>
          </>
        )}
      </nav>
    </>
  );
}
