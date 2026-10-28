import type { EntityRecord } from "@consta/contracts";

function uniqueStrings(...groups: Array<readonly string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []).filter(Boolean))];
}

/**
 * Fusiona entidades que representan el mismo ID canónico.
 * Conserva el primer displayName; completa atributos e identificadores faltantes.
 */
export function mergeEntity(
  target: Map<string, EntityRecord>,
  incoming: EntityRecord,
): void {
  const existing = target.get(incoming.id);
  if (!existing) {
    target.set(incoming.id, incoming);
    return;
  }

  const identifiers = [...existing.identifiers];
  for (const identifier of incoming.identifiers) {
    const duplicate = identifiers.some(
      (item) => item.scheme === identifier.scheme && item.value === identifier.value,
    );
    if (!duplicate) identifiers.push(identifier);
  }

  const channels = [...existing.channels];
  for (const channel of incoming.channels) {
    if (!channels.some((item) => item.id === channel.id)) channels.push(channel);
  }

  target.set(incoming.id, {
    ...existing,
    legalName: existing.legalName ?? incoming.legalName,
    identifiers,
    aliases: uniqueStrings(existing.aliases, incoming.aliases),
    channels,
    attributes: { ...incoming.attributes, ...existing.attributes },
    updatedAt:
      incoming.updatedAt > existing.updatedAt ? incoming.updatedAt : existing.updatedAt,
  });
}

export function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}
