import type { NextConfig } from 'next';

// Static export: the app is plain files on Amplify Hosting (no server compute).
// All data comes from the API at api.rmgdesk.com, after sign-in.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
