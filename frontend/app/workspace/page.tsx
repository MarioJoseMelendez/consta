import type { Metadata } from "next";
import { Suspense } from "react";

import Workspace from "@/components/workspace/Workspace";

export const metadata: Metadata = {
  title: "Workspace",
  description:
    "Investiga identidades, vínculos y evidencia en registros públicos. Workspace de demostración de Consta.",
};

function WorkspaceFallback() {
  return (
    <div className="shell workspace-loading">
      <div>
        <span className="mono-label">Workspace</span>
        <p>Cargando el expediente…</p>
        <div className="loading-bar" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<WorkspaceFallback />}>
      <Workspace />
    </Suspense>
  );
}
