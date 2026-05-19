import type { NextConfig } from "next";

// GitHub Pages serves this project page under /cimulity. basePath is applied
// only for production builds so `npm run dev` stays at localhost:3000/.
const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isProd ? "/cimulity" : "",
  images: { unoptimized: true },
};

export default nextConfig;
