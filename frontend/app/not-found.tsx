import type { Metadata } from "next";
import Link from "next/link";

import { IconArrowRight, IconArrowUpRight } from "@/components/Icons";

export const metadata: Metadata = {
  title: "Página no encontrada",
};

export default function NotFound() {
  return (
    <section className="shell not-found" aria-labelledby="not-found-title">
      <p className="eyebrow">Error 404 · Fuera del registro</p>
      <h1 id="not-found-title">
        Esta página no
        <br />{" "}
        <em>consta.</em>
      </h1>
      <p>
        La dirección no corresponde a un expediente, canal o sección de Consta.
        Vuelve al inicio o abre el workspace para empezar una búsqueda.
      </p>
      <div className="not-found-actions">
        <Link className="btn btn--lime" href="/">
          Volver al inicio
          <IconArrowRight width={15} height={15} />
        </Link>
        <Link className="btn btn--ghost" href="/workspace?q=Nexo">
          Abrir caso demo
          <IconArrowUpRight width={14} height={14} />
        </Link>
      </div>
    </section>
  );
}
