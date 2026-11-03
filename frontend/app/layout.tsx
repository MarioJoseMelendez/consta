import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import Header from "@/components/Header";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Consta",
    template: "%s · Consta",
  },
  description: "Public-record identity investigation. Named people, companies, and cited sources.",
  applicationName: "Consta",
  keywords: [
    "public records",
    "identity",
    "investigation",
    "open data",
  ],
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "Consta",
    description:
      "Investigate a public identity, then map the connections the sources can support.",
    locale: "en_US",
    type: "website",
    siteName: "Consta",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#eef3ea",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <a className="skip-link" href="#contenido">
          Skip to content
        </a>
        <Header />
        <main id="contenido" className="site-main">
          {children}
        </main>
      </body>
    </html>
  );
}
