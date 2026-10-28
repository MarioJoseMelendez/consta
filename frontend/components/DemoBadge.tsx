interface DemoBadgeProps {
  className?: string;
  label?: string;
}

export default function DemoBadge({
  className,
  label = "DEMO",
}: DemoBadgeProps) {
  return (
    <span
      className={`demo-badge${className ? ` ${className}` : ""}`}
      title="Datos ficticios de demostración"
    >
      <span className="demo-badge-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
