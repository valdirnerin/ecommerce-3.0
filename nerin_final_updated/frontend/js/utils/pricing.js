const DEFAULT_NATIONAL_TAX_RATE = 0.21;

export function resolveNationalTaxRate() {
  const fromConfig =
    Number(window?.NERIN_CONFIG?.ivaRate ?? window?.NERIN_CONFIG?.nationalTaxRate);
  if (Number.isFinite(fromConfig) && fromConfig > 0 && fromConfig < 1) {
    return fromConfig;
  }
  return DEFAULT_NATIONAL_TAX_RATE;
}

export function calculateNetNoNationalTaxes(priceFinal, taxRate = resolveNationalTaxRate()) {
  const finalPrice = Number(priceFinal);
  if (!Number.isFinite(finalPrice) || finalPrice <= 0) return 0;
  const divisor = 1 + Number(taxRate || 0);
  if (!Number.isFinite(divisor) || divisor <= 0) return Math.round(finalPrice);
  return Math.round(finalPrice / divisor);
}

export function formatArs(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}
