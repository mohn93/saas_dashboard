/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@google-analytics/data"],
  },
};

export default nextConfig;
