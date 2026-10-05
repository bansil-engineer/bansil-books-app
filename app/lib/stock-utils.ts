/**
 * Bansil Books Analytics — Stock Utilities (Client & Server Safe)
 *
 * Check whether a stock item is eligible for exclusion.
 * Allowed for all active stock statuses (IN_STOCK, NEGATIVE, PURCHASE_ONLY, SALES_ONLY, COMPOSITE, etc.)
 * EXCEPT: ZERO STOCK (stockQty === 0 && status === 'ZERO_STOCK').
 */
export function isStockItemExcludable(item: { stockQty?: number | null; status?: string | null }): boolean {
  if (!item) return false;
  const status = item.status?.toUpperCase() || "";
  const qty = Number(item.stockQty ?? 0);
  if (status === "ZERO_STOCK" || (qty === 0 && (status === "ZERO_STOCK" || status === "NO_MOVEMENT"))) {
    return false;
  }
  return true;
}
