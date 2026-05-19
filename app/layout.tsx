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
    images: [`https://dogimg.vercel.app/api/og?url=${SITE_URL}`],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cimulity",
    description: DESCRIPTION,
    images: [`https://dogimg.vercel.app/api/og?url=${SITE_URL}`],
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
        {children}
      </body>
    </html>
  );
}
