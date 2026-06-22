/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bundle the shared workspace engine from its TS source — no separate build
  // step needed, which keeps Vercel deploys simple (plain `next build`).
  transpilePackages: ['@gto/engine'],
  webpack: (config) => {
    // The engine uses NodeNext-style ".js" import specifiers that point at
    // ".ts" source files; let webpack resolve them.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;

