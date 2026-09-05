/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Type errors and lint errors must fail the build, never be ignored.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true }, // linting runs as its own step (`pnpm lint`)
  webpack: (config) => {
    // data/loader.ts computes a default root with `new URL(".", import.meta.url)`.
    // Webpack's asset-URL parser tries to statically resolve that as a module
    // request and fails on ".". The API routes never rely on that default (they
    // always pass an explicit `root`), so this only disables an asset feature
    // the server bundle doesn't use — it does not change what the app reads.
    config.module.parser = {
      ...config.module.parser,
      javascript: {
        ...config.module.parser?.javascript,
        url: false
      }
    };
    return config;
  }
};
export default nextConfig;
