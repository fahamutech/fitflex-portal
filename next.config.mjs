/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'export',
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || 'https://fitflex-faas.bfast.smartstock.co.tz'
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      // Prevent Next.js server-only async-local-storage tracking modules from
      // being bundled into the browser (static export) build. These modules
      // call createAsyncLocalStorage() at module init time, which throws in
      // a browser environment because AsyncLocalStorage does not exist there.
      config.resolve.alias = {
        ...config.resolve.alias,
        'next/dist/server/app-render/work-async-storage.external': false,
        'next/dist/server/app-render/work-unit-async-storage.external': false,
      };
    }
    return config;
  },
};
export default nextConfig;
