/** @type {import('next').NextConfig} */
const api = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Custom domains (docs/WHITE_LABEL.md) reach the API through the web server.
  async rewrites() {
    return process.env.NEXT_PUBLIC_CUSTOM_DOMAINS === 'true' ? [{ source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` }] : [];
  },
};
export default nextConfig;
