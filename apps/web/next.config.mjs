import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const api = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The Docker image (apps/web/Dockerfile) sets NEXT_OUTPUT=standalone to get a small self-contained server.
  // `pnpm build` + `next start` (INSTALL.md) is unchanged.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone', outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '..', '..') }
    : {}),
  // Custom domains (docs/WHITE_LABEL.md) reach the API through the web server.
  async rewrites() {
    return process.env.NEXT_PUBLIC_CUSTOM_DOMAINS === 'true' ? [{ source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` }] : [];
  },
};
export default nextConfig;
