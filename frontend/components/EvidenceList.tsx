import type { Evidence } from "@consta/contracts";

import { formatDate, shortChannelName } from "@/lib/format";

import { IconArrowUpRight, IconExternalLink, IconFile } from "./Icons";

const KIND_LABELS: Record<Evidence["kind"], string> = {
  record: "Fila de registro",
  document: "Documento",
  dataset: "Conjunto de datos",
};

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface EvidenceListProps {
  evidence: Evidence[];
  channelNames: Record<string, string>;
}

export default function EvidenceList({
  evidence,
  channelNames,
}: EvidenceListProps) {
  if (evidence.length === 0) {
    return (
      <div className="evidence-empty">
        <IconFile width={20} height={20} />
        <p>
          Este claim no tiene evidencia adjunta. En Consta, esa ausencia queda
          declarada y no se presenta como un hecho.
        </p>
      </div>
    );
  }

  return (
    <div className="evidence-list">
      {evidence.map((item) => {
        const channelName = shortChannelName(
          item.channelId,
          channelNames[item.channelId],
        );

        return (
          <article className="evidence-card" key={item.id} id={`evidence-${item.id}`}>
            <div className="evidence-top">
              <span>{KIND_LABELS[item.kind] ?? item.kind}</span>
              <span>{formatDate(item.date)}</span>
            </div>

            <h4 className="evidence-title">{item.title}</h4>

            {item.excerpt ? (
              <p className="evidence-excerpt">{item.excerpt}</p>
            ) : null}

            <div className="evidence-meta">
              <span className="evidence-channel">{channelName}</span>
              {item.license ? (
                <span className="evidence-license">{item.license}</span>
              ) : null}
              <span>Consultado {formatDate(item.retrievedAt)}</span>
            </div>

            <div className="evidence-actions">
              <a
                className="evidence-source"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                Abrir fuente
                <IconExternalLink width={12} height={12} />
              </a>
              <span className="evidence-url" title={item.url}>
                {hostname(item.url)}
              </span>
              <IconArrowUpRight width={13} height={13} aria-hidden />
            </div>
          </article>
        );
      })}
    </div>
  );
}
