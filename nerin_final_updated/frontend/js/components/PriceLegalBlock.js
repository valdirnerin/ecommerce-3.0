import {
  calculateNetNoNationalTaxes,
  formatArs,
} from "../utils/pricing.js";

export function createPriceLegalBlock({
  priceFinal,
  priceNetNoNationalTaxes,
  showFinancing = false,
  financingData = null,
  compact = false,
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "price-legal-block";
  if (compact) wrapper.classList.add("price-legal-block--compact");

  const finalValue = Number(priceFinal);
  const main = document.createElement("div");
  main.className = "price-legal-block__main";

  const amount = document.createElement("strong");
  amount.className = "price-legal-block__amount";
  amount.textContent = formatArs(finalValue);
  main.appendChild(amount);

  const tag = document.createElement("span");
  tag.className = "price-legal-block__tag";
  tag.textContent = "Precio final";
  main.appendChild(tag);
  wrapper.appendChild(main);

  const netValue = Number.isFinite(Number(priceNetNoNationalTaxes))
    ? Number(priceNetNoNationalTaxes)
    : calculateNetNoNationalTaxes(finalValue);

  const net = document.createElement("p");
  net.className = "price-legal-block__net";
  net.textContent = `PRECIO SIN IMPUESTOS NACIONALES: ${formatArs(netValue)}`;
  wrapper.appendChild(net);

  if (showFinancing && financingData) {
    const cashPrice = formatArs(financingData.cashPrice);
    const installmentsCount = Number(financingData.installmentsCount || 0);
    const installmentAmount = formatArs(financingData.installmentAmount || 0);
    const cftAnnual = Number(financingData.cftAnnual || 0);
    const financing = document.createElement("p");
    financing.className = "price-legal-block__financing";
    financing.textContent = `Contado: ${cashPrice} — ${installmentsCount} cuotas de ${installmentAmount} — CFT EA: ${cftAnnual.toFixed(2)}%`;
    wrapper.appendChild(financing);
  }

  return wrapper;
}
