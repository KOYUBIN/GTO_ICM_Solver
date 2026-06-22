/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the shared workspace engine so its ESM source is bundled.
  transpilePackages: ['@gto/engine'],
};

export default nextConfig;
