// ============================================================
// Dropdown Option De-duplication Utilities
// Authoritative deduplication by stable item/customer/vendor ID
// ============================================================

export function deduplicateFilterOptions<T extends { id: string; name: string; sku?: string }>(
  list: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of list) {
    if (!item || !item.id) continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, { ...item });
    } else {
      const name = item.name && item.name.length > (existing.name?.length ?? 0) ? item.name : existing.name;
      const sku = item.sku || existing.sku;
      map.set(item.id, { ...existing, name, sku });
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
