import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://zeikar.dev/cimulity/";
const DESCRIPTION =
  "Open-source minimal city simulation game in the browser.";
const OG_IMAGE = `https://dogimg.vercel.app/api/og?url=${SITE_URL}`;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "Cimulity",
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: "GameApplication",
  operatingSystem: "Web browser",
  gamePlatform: "Web browser",
  genre: "City-building simulation",
  inLanguage: "en",
  author: { "@type": "Person", name: "zeikar", url: "https://zeikar.dev" },
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  sameAs: ["https://github.com/zeikar/cimulity"],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://zeikar.dev"),
  title: "Cimulity",
  description: DESCRIPTION,
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Cimulity",
    title: "Cimulity",
    description: DESCRIPTION,
    images: [
      { url: OG_IMAGE, width: 1200, height: 630, alt: "Cimulity" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cimulity",
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, alt: "Cimulity" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
