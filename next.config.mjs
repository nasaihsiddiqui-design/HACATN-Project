/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverComponentsExternalPackages: ['mongodb', 'bcryptjs', 'jsonwebtoken'] },
};
export default nextConfig;
