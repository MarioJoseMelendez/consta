import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

const strokeDefaults = {
  viewBox: "0 0 24 24",
  width: 18,
  height: 18,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function LogoMark(props: IconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={30}
      height={30}
      fill="none"
      aria-hidden
      {...props}
    >
      <rect
        x="2.5"
        y="2.5"
        width="27"
        height="27"
        rx="1.5"
        stroke="currentColor"
        strokeOpacity=".35"
      />
      <path
        d="M8.5 22.5 16 8l7.5 10.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="8.5" cy="22.5" r="2.6" fill="currentColor" />
      <circle cx="16" cy="8" r="2.6" fill="#d8ff3e" />
      <circle cx="23.5" cy="18.5" r="2.6" fill="#ff6b3d" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function IconArrowUpRight(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

export function IconExternalLink(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="M14 4h6v6" />
      <path d="m20 4-8 8" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function IconGraph(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="5" cy="18" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="m10.8 7-4.5 8.8M13.2 7l4.5 8.8M7.2 18h9.6" />
    </svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="M12 3 5 6v5c0 4.4 2.9 8.3 7 10 4.1-1.7 7-5.6 7-10V6l-7-3Z" />
      <path d="m9 11.5 2 2 4-4" />
    </svg>
  );
}

export function IconFile(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

export function IconDatabase(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <ellipse cx="12" cy="5" rx="7" ry="2.6" />
      <path d="M5 5v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V5" />
      <path d="M5 11v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-6" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="m5 12.5 4.2 4.2L19 6.5" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.5l3.5 2" />
    </svg>
  );
}

export function IconFilter(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="M4 6h16l-6.3 7.2V20l-3.4-2v-4.8L4 6Z" />
    </svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function IconLink(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="M10 14a4.5 4.5 0 0 0 6.4.1l2.5-2.5a4.5 4.5 0 0 0-6.4-6.4L11 6.6" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4-.1l-2.5 2.5a4.5 4.5 0 0 0 6.4 6.4l1.5-1.4" />
    </svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </svg>
  );
}

export function IconScan(props: IconProps) {
  return (
    <svg {...strokeDefaults} {...props}>
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
      <path d="M8 12h8" />
    </svg>
  );
}
