import type { Metadata, Viewport } from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./globals.css";
import { countryPaletteCss } from "@/lib/config/countries";
import { BootstrapClient } from "@/components/layout/BootstrapClient";

export const metadata: Metadata = {
  title: {
    default: "Radx IT Help Desk",
    template: "%s · Radx IT Help Desk",
  },
  description: "IT help desk and asset management for Radx Construction.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        {/*
          The Next.js equivalent of the `country_palette` context processor:
          the palette is emitted once as CSS custom properties so components
          reference var(--country-ZW) rather than inlining hex values.
        */}
        <style
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: countryPaletteCss() }}
        />
      </head>
      <body>
        <a href="#main-content" className="visually-hidden visually-hidden-focusable">
          Skip to main content
        </a>
        {children}
        <BootstrapClient />
      </body>
    </html>
  );
}
