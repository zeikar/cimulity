import type { MetadataRoute } from "next";

// Next does not apply basePath to manifest contents (start_url / icon src),
// so absolute URLs are used to keep it correct under /cimulity.
// Required so the manifest route is emitted as a static file under output:export.
export const dynamic = "force-static";

const BASE = "https://zeikar.dev/cimulity/";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cimulity",
    short_name: "Cimulity",
    description: "Open-source minimal city simulation game in the browser.",
    start_url: BASE,
    scope: BASE,
    display: "standalone",
    background_color: "#1b2027",
    theme_color: "#1b2027",
    icons: [
      { src: `${BASE}icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${BASE}icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${BASE}icons/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
