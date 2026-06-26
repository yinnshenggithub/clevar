/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // bcryptjs is pure JS; this keeps native/optional deps out of the edge bundle.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  eslint: {
    // Lint is enforced in CI; don't let it block production builds.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Type errors DO fail the build — correctness gate stays on.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
