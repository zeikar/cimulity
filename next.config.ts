import type { NextConfig } from "next";

// GitHub Pages serves this project page under /cimulity. basePath is applied
// only for production builds so `npm run dev` stays at localhost:3000/.
const isProd = process.env.NODE_ENV === "production";
const basePath = isProd ? "/cimulity" : "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
  // Exposed to client code that builds raw asset URLs (e.g. PixiJS Assets.load),
  // which Next does not rewrite with basePath the way it does for <Image>/<Link>.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
