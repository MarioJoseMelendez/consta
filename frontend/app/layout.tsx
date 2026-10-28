import type { Metadata, Viewport } from "next";

import Footer from "@/components/Footer";
import Header from "@/components/Header";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Consta — Del registro a la conexión",
    template: "%s · Consta",
  },
  description:
    "Investigación de registros públicos para Guatemala. Identidades, vínculos y evidencia citada, con la fuente y la licencia a la vista.",
  applicationName: "Consta",
  keywords: [
    "registros públicos",
    "Guatemala",
    "RGAE",
    "Guatecompras",
    "investigación",
    "datos abiertos",
  ],
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "Consta — Del registro a la conexión",
    description:
      "Cruza registros de proveedores, representantes legales y compras públicas. Cada vínculo conserva su evidencia.",
    locale: "es_GT",
    type: "website",
    siteName: "Consta",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f0e",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-GT">
      <body>
        <a className="skip-link" href="#contenido">
          Saltar al contenido
        </a>
        <Header />
        <main id="contenido" className="site-main">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
