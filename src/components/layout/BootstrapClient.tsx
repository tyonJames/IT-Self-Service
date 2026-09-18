"use client";

import { useEffect } from "react";

/**
 * Loads Bootstrap's JavaScript bundle once, on the client.
 *
 * It is a side-effect-only import so that dropdowns, modals, tooltips and
 * collapses work, without pulling Bootstrap's JS into the server bundle or
 * turning any page into a Client Component to get it.
 */
export function BootstrapClient() {
  useEffect(() => {
    void import("bootstrap/dist/js/bootstrap.bundle.min.js");
  }, []);

  return null;
}
