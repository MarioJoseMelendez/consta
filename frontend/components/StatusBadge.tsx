import type {
  AnalysisRun,
  AnalysisStep,
  ChannelStatus,
  IdentityStatus,
} from "@consta/contracts";

type StatusValue =
  | IdentityStatus
  | ChannelStatus["status"]
  | AnalysisStep["status"]
  | AnalysisRun["status"];

const LABELS: Record<StatusValue, string> = {
  confirmed: "Confirmado",
  probable: "Probable",
  unresolved: "Sin resolver",
  no_match: "Sin coincidencia",
  online: "En línea",
  degraded: "Degradado",
  offline: "Fuera de línea",
  done: "Completado",
  running: "En curso",
  pending: "Pendiente",
  failed: "Fallido",
  complete: "Completo",
  partial: "Parcial",
};

interface StatusBadgeProps {
  status: StatusValue;
  label?: string;
  className?: string;
}

export default function StatusBadge({
  status,
  label,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={`status-badge${className ? ` ${className}` : ""}`}
      data-status={status}
    >
      <span className="status-dot" aria-hidden="true" />
      {label ?? LABELS[status]}
    </span>
  );
}
