import type { Metadata } from "next";
import Link from "next/link";
import { demoChannels } from "@consta/contracts";

import ChannelsRegistry from "@/components/ChannelsRegistry";
import DemoBadge from "@/components/DemoBadge";
import {
  IconArrowRight,
  IconClock,
  IconLayers,
  IconShield,
} from "@/components/Icons";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = {
  title: "Canales",
  description:
    "Registro de canales de Consta: licencias, commercial_ok, estado, última sincronización, filas y capacidades.",
};

export default function ChannelsPage() {
  const totalRows = demoChannels.reduce(
    (total, channel) => total + (channel.rows ?? 0),
    0,
  );
  const commercialCount = demoChannels.filter(
    (channel) => channel.commercialOk,
  ).length;
  const licenseCount = new Set(
    demoChannels.map((channel) => channel.license),
  ).size;

  return (
    <div className="channels-page">
      <section className="shell page-hero">
        <div className="page-hero-copy">
          <p className="eyebrow">Registro de canales · GT-first</p>
          <h1 className="page-title">
            Cada fuente,
            <br />{" "}
            <em>con su licencia.</em>
          </h1>
          <p className="page-lede">
            Consta no es un scrape sin memoria. Cada canal declara su licencia,
            sus capacidades y su estado de sincronización. Si una fuente no
            permite uso comercial, se ve antes de investigar.
          </p>

          <div className="page-hero-actions">
            <Link className="btn btn--lime" href="#registro">
              Ver el registro
              <IconArrowRight width={15} height={15} />
            </Link>
            <span className="page-hero-note">
              <DemoBadge />
              Instantánea ficticia · 26 oct 2026
            </span>
          </div>
        </div>

        <aside className="coverage-card surface-paper">
          <div className="coverage-head">
            <span className="mono-label">Cobertura inicial</span>
            <DemoBadge />
          </div>

          <p className="coverage-title">
            Cuatro canales.
            <br />
            Una cadena de evidencia.
          </p>

          <dl className="coverage-grid">
            <div>
              <dt>Canales</dt>
              <dd>{demoChannels.length}</dd>
            </div>
            <div>
              <dt>Filas demo</dt>
              <dd>{formatNumber(totalRows)}</dd>
            </div>
            <div>
              <dt>commercial_ok</dt>
              <dd>
                {commercialCount}/{demoChannels.length}
              </dd>
            </div>
            <div>
              <dt>Licencias</dt>
              <dd>{String(licenseCount).padStart(2, "0")}</dd>
            </div>
          </dl>

          <div className="coverage-sources">
            <span>RGAE</span>
            <span>Guatecompras OCDS</span>
            <span>Wikidata</span>
          </div>

          <p className="coverage-foot">
            Cifras de demostración. La cobertura real dependerá de los
            contratos de canal activos.
          </p>
        </aside>
      </section>

      <ChannelsRegistry />

      <section className="shell rules-section" aria-labelledby="rules-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">Admisión</p>
            <h2 id="rules-title">Qué debe declarar un canal.</h2>
          </div>
          <p>
            El registro no es un catálogo de links. Es el contrato mínimo para
            que un dato pueda entrar a un expediente y resistir una revisión.
          </p>
        </div>

        <div className="rules-grid">
          <article className="rule-card">
            <div className="rule-top">
              <span className="rule-number">01</span>
              <IconShield width={22} height={22} />
            </div>
            <h3>Licencia verificable.</h3>
            <p>
              Ningún canal entra si su licencia no puede citarse.{" "}
              <strong>commercial_ok</strong> se registra explícitamente y una
              nota de licencia explica las obligaciones de atribución.
            </p>
            <span className="rule-meta">CC BY-SA · CC BY · CC0</span>
          </article>

          <article className="rule-card rule-card--paper surface-paper">
            <div className="rule-top">
              <span className="rule-number">02</span>
              <IconLayers width={22} height={22} />
            </div>
            <h3>Capacidades declaradas.</h3>
            <p>
              <strong>search</strong>, <strong>entity</strong>,{" "}
              <strong>relationships</strong>, <strong>evidence</strong> y{" "}
              <strong>document</strong> describen qué puede entregar el canal.
              No son promesas de cobertura.
            </p>
            <span className="rule-meta">channel/v1</span>
          </article>

          <article className="rule-card">
            <div className="rule-top">
              <span className="rule-number">03</span>
              <IconClock width={22} height={22} />
            </div>
            <h3>Estado observable.</h3>
            <p>
              <strong>online</strong>, <strong>degraded</strong> y{" "}
              <strong>offline</strong> se publican con fecha de última
              sincronización y volumen de filas. Un fallo no se esconde.
            </p>
            <span className="rule-meta">Última sync · 06 oct 2026</span>
          </article>
        </div>
      </section>

      <section className="shell channels-cta">
        <div>
          <span className="mono-label">De la fuente al expediente</span>
          <h2>Un canal solo importa si puedes volver a él.</h2>
        </div>
        <Link className="btn btn--lime" href="/workspace?q=Nexo">
          Abrir un expediente demo
          <IconArrowRight width={15} height={15} />
        </Link>
      </section>
    </div>
  );
}
