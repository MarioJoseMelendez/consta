import type { Metadata } from "next";
import Link from "next/link";
import {
  demoChannels,
  demoEntities,
  demoRelationships,
  demoRun,
} from "@consta/contracts";

import DemoBadge from "@/components/DemoBadge";
import Graph from "@/components/Graph";
import {
  IconArrowRight,
  IconArrowUpRight,
  IconFile,
  IconGraph,
  IconLink,
  IconShield,
} from "@/components/Icons";
import SearchForm from "@/components/SearchForm";
import StatusBadge from "@/components/StatusBadge";
import { formatNumber, formatPercent } from "@/lib/format";

export const metadata: Metadata = {
  title: "Consta — Del registro a la conexión",
  description:
    "Cruza registros de proveedores, representantes legales y compras públicas de Guatemala. Cada vínculo conserva su fuente, fecha y licencia.",
};

const NEXO_ID = "gt-nit:90000017";

export default function HomePage() {
  const totalRows = demoChannels.reduce(
    (total, channel) => total + (channel.rows ?? 0),
    0,
  );
  const commercialCount = demoChannels.filter(
    (channel) => channel.commercialOk,
  ).length;
  const sharedRelationship = demoRelationships.find(
    (relationship) => relationship.type === "SHARED_LEGAL_REP",
  );
  const nexo = demoEntities.find((entity) => entity.id === NEXO_ID);

  const landingNodeIds = new Set(
    demoRun.graph.nodes
      .filter((node) => node.id !== "gt-nit:90000033")
      .map((node) => node.id),
  );
  const landingNodes = demoRun.graph.nodes.filter((node) =>
    landingNodeIds.has(node.id),
  );
  const landingEdges = demoRun.graph.edges.filter(
    (edge) => landingNodeIds.has(edge.from) && landingNodeIds.has(edge.to),
  );

  const stats = [
    {
      value: String(demoChannels.length).padStart(2, "0"),
      label: "canales declarados",
      note: "GT-first + Wikidata",
    },
    {
      value: formatNumber(totalRows),
      label: "filas indexadas",
      note: "RGAE demo",
    },
    {
      value: String(demoRelationships.length).padStart(2, "0"),
      label: "vínculos con evidencia",
      note: "5 entidades demo",
    },
    {
      value: `${commercialCount}/${demoChannels.length}`,
      label: "licencias comerciales",
      note: "trazabilidad por canal",
    },
  ];

  return (
    <div className="landing">
      <section className="shell hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">
            Inteligencia de registros públicos · Guatemala
          </p>
          <h1 className="display" id="hero-title">
            <span>Del registro</span>{" "}
            <span>
              a la <em>conexión.</em>
            </span>
          </h1>
          <p className="hero-lede">
            Consta cruza registros de proveedores, representantes legales y
            compras públicas para mostrar quién está detrás de una empresa.
            Cada conexión conserva su fuente, su fecha y su licencia.
          </p>

          <SearchForm placeholder="Busca una empresa, una persona o un NIT…" />

          <div className="hero-examples">
            <span>Prueba con</span>
            <Link href="/workspace?q=Nexo">Nexo Servicios</Link>
            <Link href="/workspace?q=90000017">NIT 90000017</Link>
            <Link href="/workspace?q=A.%20M%C3%A9ndez">A. Méndez</Link>
          </div>

          <div className="hero-meta">
            <span>
              <IconShield width={14} height={14} />
              Identidad con estados
            </span>
            <span>
              <IconFile width={14} height={14} />
              Evidencia citada
            </span>
            <span>
              <IconLink width={14} height={14} />
              Licencias visibles
            </span>
          </div>
        </div>

        <aside className="case-card surface-paper" aria-label="Caso demo">
          <div className="case-top">
            <span className="case-label">Caso demo / 001</span>
            <DemoBadge />
          </div>

          <div className="case-heading">
            <h2>{nexo?.displayName ?? "Nexo Servicios, S.A."}</h2>
            <p>NIT 90000017 · Guatemala</p>
          </div>

          <Graph
            nodes={landingNodes}
            edges={landingEdges}
            selectedId={NEXO_ID}
            compact
            theme="paper"
            hint="Nodos = entidades · líneas = vínculos"
          />

          {sharedRelationship ? (
            <div className="case-claim">
              <div className="case-claim-top">
                <span className="mono-label">Claim destacado</span>
                <StatusBadge status={sharedRelationship.status} />
              </div>
              <p>
                Nexo Servicios y Grupo Aurora comparten representante legal.
              </p>
              <span className="case-claim-meta">
                2 filas de RGAE · confianza{" "}
                {formatPercent(sharedRelationship.confidence)}
              </span>
            </div>
          ) : null}

          <div className="case-footer">
            <span>2 empresas · 1 persona · 1 entidad</span>
            <Link href={`/workspace?id=${encodeURIComponent(NEXO_ID)}`}>
              Abrir expediente
              <IconArrowUpRight width={13} height={13} />
            </Link>
          </div>
        </aside>
      </section>

      <section className="shell stats-section" aria-labelledby="stats-title">
        <div className="stats-head">
          <div>
            <p className="eyebrow">Señal actual</p>
            <h2 id="stats-title">Cobertura, no promesas.</h2>
          </div>
          <div className="stats-meta">
            <DemoBadge />
            <span className="mono-label">Snapshot · 26 oct 2026</span>
          </div>
        </div>

        <dl className="stat-band">
          {stats.map((stat) => (
            <div className="stat" key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
              <p>{stat.note}</p>
            </div>
          ))}
        </dl>

        <p className="stats-footnote">
          <IconGraph width={13} height={13} />
          Cifras ficticias para demostrar el flujo. Los canales y licencias se
          modelan con el contrato <code>channel/v1</code>.
        </p>
      </section>

      <section className="shell features-section" id="producto">
        <div className="section-head">
          <div>
            <p className="eyebrow">Por qué Consta</p>
            <h2>
              Menos coincidencia.
              <br />
              <em>Más constancia.</em>
            </h2>
          </div>
          <p>
            Un buscador devuelve nombres. Consta devuelve relaciones, estados y
            la evidencia que las sostiene. La diferencia entre una pista y una
            afirmación está en el expediente.
          </p>
        </div>

        <div className="feature-grid">
          <article className="feature-card">
            <div className="feature-top">
              <span className="feature-number">01</span>
              <IconShield width={26} height={26} />
            </div>
            <h3>Identidad antes que coincidencia.</h3>
            <p>
              NIT, CUI, razón social y alias se resuelven en una entidad. Si la
              fuente no alcanza, el estado lo dice:{" "}
              <strong>confirmed</strong>, <strong>probable</strong> o{" "}
              <strong>unresolved</strong>.
            </p>
            <span className="feature-foot">NIT · CUI · alias</span>
          </article>

          <article className="feature-card feature-card--paper surface-paper">
            <div className="feature-top">
              <span className="feature-number">02</span>
              <IconFile width={26} height={26} />
            </div>
            <h3>Cada vínculo deja rastro.</h3>
            <p>
              Los claims citan filas concretas. Puedes abrir la adjudicación,
              leer el registro y comprobar la fecha de consulta antes de repetir
              una afirmación.
            </p>
            <span className="feature-foot">Evidencia obligatoria</span>
          </article>

          <article className="feature-card">
            <div className="feature-top">
              <span className="feature-number">03</span>
              <IconGraph width={26} height={26} />
            </div>
            <h3>Guatemala primero, sin atajos.</h3>
            <p>
              Empezamos por RGAE y Guatecompras. El contrato de canales permite
              sumar fuentes sin perder procedencia, licencia ni capacidad.
            </p>
            <span className="feature-foot">GT · RGAE · OCDS</span>
          </article>
        </div>
      </section>

      <section className="method-band" id="metodo">
        <div className="shell method-inner">
          <div className="method-copy">
            <p className="eyebrow">Método</p>
            <h2>
              El grafo no es
              <br />
              <em>la conclusión.</em>
            </h2>
            <p>
              Consta separa lo que la fuente declara de lo que el sistema
              infiere. Un vínculo probable se ve distinto de uno confirmado; una
              ausencia se registra como <code>unresolved</code>, nunca como
              prueba de nada.
            </p>
            <blockquote>
              “Una coincidencia no es un vínculo. Un vínculo sin fuente no entra
              al expediente.”
            </blockquote>
            <span className="method-states">
              confirmed · probable · unresolved
            </span>
          </div>

          <div className="method-steps">
            <article className="method-step">
              <span className="method-step-number">01</span>
              <div>
                <h3>Resolver identidad.</h3>
                <p>
                  El NIT manda. La razón social y los alias ayudan; el CUI evita
                  confundir personas homónimas. El resultado conserva el estado
                  de la resolución.
                </p>
                <span className="method-step-meta">NIT + CUI + alias</span>
              </div>
            </article>

            <article className="method-step">
              <span className="method-step-number">02</span>
              <div>
                <h3>Cruzar registros.</h3>
                <p>
                  Cada canal declara sus capacidades. El cruce produce
                  relaciones con confianza y fecha, no una lista de nombres
                  parecidos.
                </p>
                <span className="method-step-meta">RGAE · OCDS · Wikidata</span>
              </div>
            </article>

            <article className="method-step">
              <span className="method-step-number">03</span>
              <div>
                <h3>Documentar el expediente.</h3>
                <p>
                  Claims, pasos y evidencia se muestran juntos. Si algo no
                  consta, el expediente lo dice. La revisión humana sigue siendo
                  obligatoria.
                </p>
                <span className="method-step-meta">claims + evidencia</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="shell manifesto">
        <div className="manifesto-copy">
          <p className="eyebrow">Sin cajas negras</p>
          <h2>
            Investiga con la
            <br />
            <em>fuente a la vista.</em>
          </h2>
          <p>
            Abre un expediente demo y recorre el flujo completo: búsqueda,
            identidad, grafo, claims y evidencia. Todo lo que ves puede volver a
            su origen.
          </p>
        </div>

        <div className="manifesto-actions">
          <Link className="btn btn--lime" href="/workspace?q=Nexo">
            Abrir el workspace
            <IconArrowRight width={15} height={15} />
          </Link>
          <Link className="btn btn--ghost" href="/channels">
            Ver los canales
            <IconArrowUpRight width={14} height={14} />
          </Link>
          <span className="manifesto-note">
            <DemoBadge />
            Demo navegable. Datos ficticios, flujo real.
          </span>
        </div>
      </section>
    </div>
  );
}
