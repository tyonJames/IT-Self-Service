"use client";

import { useState } from "react";
import { Navbar } from "./Navbar";
import { Sidebar, type SidebarCounts } from "./Sidebar";

/**
 * The authenticated shell: sidebar + navbar + main content.
 *
 * Only the shell is a Client Component — it owns one piece of state, the
 * mobile drawer. Every page rendered inside `children` stays a Server
 * Component (instruction §30).
 */
export function AppShell({
  name,
  role,
  csrfToken,
  counts,
  children,
}: {
  name: string;
  role: string;
  csrfToken: string;
  counts: SidebarCounts;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar
        counts={counts}
        isAdmin={role === "admin" || role === "agent"}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="app-main">
        <Navbar
          name={name}
          role={role}
          csrfToken={csrfToken}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
        <main className="app-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
