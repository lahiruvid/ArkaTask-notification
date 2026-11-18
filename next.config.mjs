/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export → zip `out/` and upload to Cloudflare Pages
  output: "export",
  images: { unoptimized: true },
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  trailingSlash: true,
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
};

export default nextConfig;
