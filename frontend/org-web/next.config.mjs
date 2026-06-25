import path from "node:path";

// `next` is hoisted to the repo-root node_modules in this npm-workspaces monorepo,
// so Turbopack's root must be the repo root (mirrors admin-web).
const repoRoot = path.join(import.meta.dirname, "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // Backend ESLint flat config isn't appropriate for this React app; types still checked.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
