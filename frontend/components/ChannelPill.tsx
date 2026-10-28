import type { ChannelRef } from "@consta/contracts";

import { IconExternalLink } from "./Icons";

interface ChannelPillProps {
  channel: Pick<ChannelRef, "title" | "url" | "license">;
  compact?: boolean;
}

export default function ChannelPill({
  channel,
  compact = false,
}: ChannelPillProps) {
  return (
    <a
      className={`channel-pill${compact ? " channel-pill--compact" : ""}`}
      href={channel.url}
      target="_blank"
      rel="noreferrer"
      title={`Abrir ${channel.title} en una pestaña nueva`}
    >
      <span className="channel-pill-dot" aria-hidden="true" />
      <span className="channel-pill-name">{channel.title}</span>
      {channel.license ? (
        <span className="channel-pill-license">{channel.license}</span>
      ) : null}
      <IconExternalLink
        className="channel-pill-icon"
        width={11}
        height={11}
      />
    </a>
  );
}
