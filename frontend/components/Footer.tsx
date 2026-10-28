import Link from "next/link";

import DemoBadge from "./DemoBadge";
import { LogoMark } from "./Icons";

const SOURCES = [
  {
    label: "RGAE — Proveedores",
    href: "https://datos.minfin.gob.gt/dataset/registro-de-proveedores",
  },
  {
    label: "RGAE — Representantes legales",
    href: "https://datos.minfin.gob.gt/dataset/registro-de-representantes-legales",
  },
  {
    label: "Guatecompras OCDS",
    href: "https://ocds.guatecompras.gt/",
  },
  {
    label: "Wikidata",
    href: "https://www.wikidata.org/",
  },
];

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link className="footer-wordmark" href="/" aria-label="Consta, inicio">
              <LogoMark width={26} height={26} />
              <span>CONSTA</span>
            </Link>
            <p className="footer-tagline">Del registro a la conexión.</p>
            <p className="footer-copy">
              Investigación de registros públicos con evidencia visible.
              Guatemala primero.
            </p>
            <DemoBadge />
          </div>

          <div className="footer-col">
            <h2>Herramienta</h2>
            <Link href="/workspace">Workspace</Link>
            <Link href="/channels">Registro de canales</Link>
            <Link href="/#metodo">Método</Link>
            <Link href="/workspace?q=Nexo">Caso demo</Link>
          </div>

          <div className="footer-col">
            <h2>Fuentes demo</h2>
            {SOURCES.map((source) => (
              <a
                key={source.href}
                href={source.href}
                target="_blank"
                rel="noreferrer"
              >
                {source.label}
              </a>
            ))}
          </div>

          <div className="footer-col footer-col--license">
            <h2>Licencias</h2>
            <p>
              Datos demo ficticios. Las licencias de las fuentes se muestran por
              canal: CC BY-SA 4.0, CC BY 4.0 y CC0.
            </p>
            <p>
              Consta no es una fuente oficial. Verifica siempre en el registro
              original antes de publicar una conclusión.
            </p>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 Consta · Herramienta de investigación</p>
          <p>Hecho en Guatemala · GT-first</p>
          <p>Datos de demostración, no hechos reales.</p>
        </div>
      </div>
    </footer>
  );
}
