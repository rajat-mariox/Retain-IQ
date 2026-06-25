import path from "node:path";

// In this npm-workspaces monorepo, `next` is hoisted to the repo-root
// node_modules. Turbopack resolves the Next package relative to the project
// root, so the root must be the monorepo root (not apps/admin-web) or it panics
// with "Next.js package not found". This also scopes output file tracing.
const repoRoot = path.join(import.meta.dirname, "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // The repo-root ESLint flat config targets the backend (NodeNext, strict
  // typescript-eslint rules like require-await) and isn't appropriate for this
  // React app. Type-checking still runs during build; a frontend-specific
  // eslint config is a follow-up.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
