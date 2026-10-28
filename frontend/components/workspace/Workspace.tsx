"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  demoRun,
  searchDemoEntities,
  type ChannelItem,
} from "@consta/contracts";

import { fetchWorkspace, searchPublic } from "@/lib/api";
import {
  assembleView,
  getDemoView,
  type WorkspaceView,
} from "@/lib/model";

import DemoBadge from "../DemoBadge";
import Dossier from "../Dossier";
import EntityHeader from "../EntityHeader";
import Graph from "../Graph";
import { IconArrowRight, IconInfo } from "../Icons";
import RelationshipList from "../RelationshipList";
import ResultsRail from "../ResultsRail";
import SearchForm from "../SearchForm";

function initialSelectedId(idParam: string, query: string): string {
  if (idParam) return idParam;
  const first = searchDemoEntities(query).items[0];
  if (first?.sourceId) return first.sourceId;
  return query ? "" : demoRun.entityId;
}

export default function Workspace() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = (searchParams.get("q") ?? "").trim();
  const idParam = searchParams.get("id") ?? "";

  const [selectedId, setSelectedId] = useState(() =>
    initialSelectedId(idParam, query),
  );
  const [view, setView] = useState<WorkspaceView | null>(
    () => getDemoView(initialSelectedId(idParam, query)) ?? null,
  );
  const [results, setResults] = useState<ChannelItem[]>(
    () => searchDemoEntities(query).items,
  );
  const [searchLoading, setSearchLoading] = useState(Boolean(query));
  const [searchLive, setSearchLive] = useState(false);
  const [source, setSource] = useState<"demo" | "live">("demo");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const localItems = searchDemoEntities(query).items;
    setResults(localItems);
    setSearchLive(false);

    if (!query) {
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);

    void searchPublic(query)
      .then((response) => {
        if (cancelled || !response) return;
        setResults(response.items);
        setSearchLive(true);

        if (!idParam && localItems.length === 0) {
          const first = response.items.find(
            (item) => item.kind === "entity" && item.sourceId,
          );
          if (first?.sourceId) setSelectedId(first.sourceId);
        }
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => {
    if (idParam) {
      setSelectedId(idParam);
      return;
    }

    setSelectedId(initialSelectedId("", query));
  }, [query, idParam]);

  useEffect(() => {
    if (!selectedId) {
      setView(null);
      setSource("demo");
      setLoading(false);
      setNotFound(false);
      return;
    }

    let cancelled = false;
    const demo = getDemoView(selectedId);

    setLoading(true);
    setNotFound(false);

    if (demo) {
      setView(demo);
      setSource("demo");
    } else {
      setView(null);
    }

    void fetchWorkspace(selectedId)
      .then((result) => {
        if (cancelled) return;

        if (result.bundle) {
          setView(assembleView(result.bundle, result.run));
          setSource("live");
          setNotFound(false);
        } else if (!demo) {
          setView(null);
          setSource("demo");
          setNotFound(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const nodeLabels = useMemo(
    () =>
      new Map(
        (view?.graph.nodes ?? []).map((node) => [node.id, node.label] as const),
      ),
    [view],
  );

  function selectEntity(id: string) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("id", id);
    router.replace(`/workspace?${params.toString()}`, { scroll: false });
  }

  const busy = loading || searchLoading;
  const modeLabel = busy
    ? "Consultando API local…"
    : source === "live"
      ? "Respuesta de API local"
      : "Fallback demo local";

  return (
    <div className="workspace-page">
      <section className="shell workspace-masthead">
        <nav className="workspace-breadcrumb" aria-label="Migas de pan">
          <Link href="/">Consta</Link>
          <span>/</span>
          <span>Workspace</span>
          <span>/</span>
          <span>Investigación</span>
        </nav>

        <div className="workspace-title-row">
          <div>
            <p className="eyebrow">Workspace de investigación</p>
            <h1 className="workspace-title">
              Investiga el <em>registro</em>.
            </h1>
            <p className="workspace-sub">
              Busca por nombre, NIT o alias. La lista conserva las fuentes; el
              expediente conserva la evidencia.
            </p>
          </div>

          <div className="workspace-mode">
            <span
              className={`mode-dot${source === "live" && !loading ? " is-live" : ""}`}
              aria-hidden="true"
            />
            <span>{modeLabel}</span>
            {source === "demo" ? (
              <>
                <DemoBadge />
                <span className="workspace-mode-copy">Datos ficticios</span>
              </>
            ) : (
              <span className="source-live">API</span>
            )}
          </div>
        </div>

        <div className="workspace-search-row">
          <SearchForm
            initialQuery={query}
            variant="workspace"
            submitLabel="Buscar"
            placeholder="Empresa, persona, NIT o alias…"
          />
          <span className="workspace-search-hint">
            <IconInfo width={13} height={13} />
            La API local es opcional. Sin respuesta, se usa el bundle demo.
          </span>
        </div>
      </section>

      {view ? <EntityHeader entity={view.entity} /> : null}

      <div
        className={`shell workspace-grid${
          view ? "" : " workspace-grid--empty"
        }`}
      >
        <ResultsRail
          results={results}
          query={query}
          selectedId={selectedId}
          loading={searchLoading}
          live={searchLive}
          onSelect={selectEntity}
        />

        {view ? (
          <>
            <div className="workspace-main">
              <section
                className="panel graph-panel"
                aria-labelledby="graph-title"
              >
                <header className="panel-head">
                  <div>
                    <span className="mono-label">Mapa de vínculos</span>
                    <h2 id="graph-title">Quién se conecta con quién</h2>
                  </div>
                  <div className="graph-stats">
                    <span>
                      <strong>{view.graph.nodes.length}</strong>
                      nodos
                    </span>
                    <span>
                      <strong>{view.graph.edges.length}</strong>
                      vínculos
                    </span>
                  </div>
                </header>

                <Graph
                  nodes={view.graph.nodes}
                  edges={view.graph.edges}
                  selectedId={view.entity.id}
                  onSelect={selectEntity}
                  theme="ink"
                  hint="Haz clic en un nodo para abrir su expediente."
                />
              </section>

              <section
                className="panel relationship-panel"
                aria-labelledby="relationships-title"
              >
                <header className="panel-head">
                  <div>
                    <span className="mono-label">Lectura directa</span>
                    <h2 id="relationships-title">Vínculos del expediente</h2>
                  </div>
                  <span className="panel-count">
                    {String(view.relationships.length).padStart(2, "0")}
                  </span>
                </header>

                <RelationshipList
                  relationships={view.relationships}
                  entityId={view.entity.id}
                  labels={nodeLabels}
                  onSelect={selectEntity}
                />
              </section>
            </div>

            <div className="workspace-dossier">
              <Dossier view={view} source={source} />
            </div>
          </>
        ) : (
          <div className="workspace-main">
            <div className="panel workspace-empty">
              {busy ? (
                <>
                  <span className="mono-label">Consultando fuentes</span>
                  <h2>Resolviendo identidad…</h2>
                  <p>
                    Buscando el bundle en la API local. Si no responde, se
                    conserva el conjunto demo y se declara la ausencia.
                  </p>
                  <div className="loading-bar" aria-hidden="true">
                    <span />
                  </div>
                </>
              ) : (
                <>
                  <span className="mono-label">
                    {query && !idParam ? "Sin coincidencias" : "Sin expediente"}
                  </span>
                  <h2>
                    {query && !idParam
                      ? "La consulta no está en el modo demo."
                      : "Este identificador no está en el modo demo."}
                  </h2>
                  <p>
                    {query && !idParam
                      ? "La API local no devolvió resultados y el conjunto ficticio no tiene coincidencias para esta búsqueda. Prueba con un caso sugerido o ajusta NEXT_PUBLIC_API_URL."
                      : notFound
                        ? "La API local no respondió y los datos ficticios no incluyen esta entidad. Puedes abrir un caso de demostración o ajustar NEXT_PUBLIC_API_URL."
                        : "Prueba con otro NIT, nombre o alias."}
                  </p>
                  <Link className="btn btn--lime" href="/workspace?q=Nexo">
                    Abrir caso Nexo
                    <IconArrowRight width={15} height={15} />
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
