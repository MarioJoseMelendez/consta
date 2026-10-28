"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconArrowUpRight, LogoMark } from "./Icons";

const NAV_ITEMS = [
  { href: "/workspace", label: "Workspace" },
  { href: "/channels", label: "Canales" },
  { href: "/#metodo", label: "Método" },
];

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href="/" aria-label="Consta, inicio">
          <LogoMark className="brand-mark" />
          <span className="brand-word">CONSTA</span>
          <sup className="brand-country">GT</sup>
        </Link>

        <nav className="site-nav" aria-label="Navegación principal">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href !== "/#metodo" &&
              (pathname === item.href ||
                pathname.startsWith(`${item.href}/`));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="header-actions">
          <span className="header-signal">
            <span className="signal-dot" aria-hidden="true" />
            GT · registros abiertos
          </span>
          <Link className="header-cta" href="/workspace?q=Nexo">
            <span>Abrir caso demo</span>
            <IconArrowUpRight width={14} height={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}
