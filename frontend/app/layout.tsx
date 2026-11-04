import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import Header from "@/components/Header";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: {
    default: "Consta",
    template: "%s · Consta",
  },
  description: "Public-record identity investigation with cited sources.",
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
    description: "Confirm a public identity, then follow sourced connections.",
    locale: "en_US",
    type: "website",
    siteName: "Consta",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6eee4",
  colorScheme: "light",
};

const WARM_BANDS = [
  "#5a1008",
  "#681408",
  "#761808",
  "#841c0a",
  "#93220c",
  "#a32810",
  "#b43012",
  "#c43a14",
  "#d24618",
  "#de541c",
  "#e86420",
  "#ee7426",
  "#f28430",
  "#f4943c",
  "#f4a44c",
  "#f4b45e",
  "#f4c472",
  "#f4d086",
  "#f6da9a",
  "#f6e4ae",
  "#f6ecc0",
];

const COOL_BANDS = [
  "#6a7e78",
  "#7e9086",
  "#98a898",
  "#b8c0a8",
  "#d4d4b8",
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={inter.className}>
        <a className="skip-link" href="#contenido">
          Skip to content
        </a>
        <div className="stage-shapes" aria-hidden="true">
          <svg
            className="stage-topo"
            viewBox="0 0 1600 1000"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <filter
                id="consta-topo-warp"
                x="-35%"
                y="-35%"
                width="170%"
                height="170%"
                colorInterpolationFilters="sRGB"
              >
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.0022 0.0058"
                  numOctaves="4"
                  seed="11"
                  stitchTiles="stitch"
                  result="noise"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="noise"
                  scale="240"
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
              <filter
                id="consta-topo-cool"
                x="-40%"
                y="-40%"
                width="180%"
                height="180%"
                colorInterpolationFilters="sRGB"
              >
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.0034 0.008"
                  numOctaves="3"
                  seed="3"
                  stitchTiles="stitch"
                  result="noise"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="noise"
                  scale="90"
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            </defs>
            <rect width="1600" height="1000" fill="#c43c12" />
            <g
              filter="url(#consta-topo-warp)"
              transform="translate(800 520) rotate(-22) translate(-800 -520)"
            >
              {WARM_BANDS.map((fill, index) => {
                const t = index / (WARM_BANDS.length - 1);
                return (
                  <ellipse
                    key={fill}
                    cx={1020 - t * 500}
                    cy={670 - t * 280}
                    rx={1240 - t * 1020}
                    ry={960 - t * 800}
                    fill={fill}
                  />
                );
              })}
              {WARM_BANDS.filter((_, index) => index % 2 === 0).map(
                (fill, index) => {
                  const step = index * 2;
                  const t = step / (WARM_BANDS.length - 1);
                  return (
                    <ellipse
                      key={`line-${fill}`}
                      cx={1020 - t * 500}
                      cy={670 - t * 280}
                      rx={1240 - t * 1020}
                      ry={960 - t * 800}
                      fill="none"
                      stroke="#4a1008"
                      strokeWidth="1.1"
                      opacity={0.22}
                    />
                  );
                },
              )}
            </g>
            <g
              filter="url(#consta-topo-cool)"
              opacity="0.28"
              style={{ mixBlendMode: "multiply" }}
            >
              {COOL_BANDS.map((fill, index) => {
                const t = index / (COOL_BANDS.length - 1);
                return (
                  <ellipse
                    key={fill}
                    cx={210 - t * 36}
                    cy={130 - t * 28}
                    rx={220 - t * 140}
                    ry={160 - t * 100}
                    fill={fill}
                  />
                );
              })}
            </g>
          </svg>
          <span className="stage-blob stage-blob--a" />
          <span className="stage-blob stage-blob--b" />
          <span className="stage-blob stage-blob--c" />
        </div>
        <Header />
        <main id="contenido" className="site-main">
          {children}
        </main>
      </body>
    </html>
  );
}
