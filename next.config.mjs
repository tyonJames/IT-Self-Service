/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The spec's URLs all end in a slash (/tickets/, /assets/new/). Keeping that
  // shape means existing bookmarks, the PowerShell device agent and printed
  // QR codes continue to resolve.
  trailingSlash: true,
  // Standalone output produces a self-contained server bundle, which is what
  // the Azure App Service deployment package and the Dockerfile both ship.
  output: "standalone",
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  serverExternalPackages: [
    "@prisma/client",
    "@node-rs/argon2",
    "pdfkit",
    "exceljs",
    "nodemailer",
    "ioredis",
    "pg",
    "applicationinsights",
  ],
  eslint: {
    dirs: ["src", "scripts"],
  },
  typescript: {
    // tests/**/*.ts are checked by `npm run typecheck` and `vitest`, not by
    // `next build`, whose tsconfig-based check pulls the whole tests tree in
    // and errors on Node type narrowing that vitest handles itself.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
