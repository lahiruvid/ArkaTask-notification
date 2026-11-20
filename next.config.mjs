/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: `out/` is deployed to Cloudflare Pages.
  // Redirects and response headers do not apply to a static export; public/_headers sets them.
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
