"use strict";

const ORGANIC_SEO_PAGE_CONFIG = Object.freeze({
  "/stock-real": Object.freeze({
    key: "stock-real",
    title: "Repuestos en stock real | NERIN Parts",
    h1: "Repuestos para celulares en stock real",
    description: "Repuestos listos para enviar desde CABA. Factura A/B, garantia tecnica y soporte para verificar compatibilidad antes de comprar.",
    intro: "Repuestos listos para enviar desde CABA. Factura A/B, garantia tecnica y soporte para verificar compatibilidad antes de comprar.",
    canonicalPath: "/stock-real",
    priority: "0.9",
  }),
  "/pantallas-en-stock": Object.freeze({
    key: "pantallas-en-stock",
    title: "Pantallas para celulares en stock | NERIN Parts",
    h1: "Pantallas para celulares en stock",
    description: "Pantallas y modulos de display con stock real en CABA. Verificamos compatibilidad, factura A/B y garantia tecnica.",
    intro: "Pantallas, displays y modulos listos para enviar, con soporte para confirmar modelo y version antes de comprar.",
    canonicalPath: "/pantallas-en-stock",
    priority: "0.85",
  }),
  "/baterias-en-stock": Object.freeze({
    key: "baterias-en-stock",
    title: "Baterias para celulares en stock | NERIN Parts",
    h1: "Baterias para celulares en stock",
    description: "Baterias para celulares con stock real, factura A/B y soporte tecnico para verificar compatibilidad.",
    intro: "Baterias disponibles para despacho desde CABA, con asesoria tecnica para validar compatibilidad.",
    canonicalPath: "/baterias-en-stock",
    priority: "0.82",
  }),
  "/repuestos-samsung": Object.freeze({
    key: "repuestos-samsung",
    title: "Repuestos Samsung en Argentina | NERIN Parts",
    h1: "Repuestos Samsung en Argentina",
    description: "Repuestos Samsung con stock real en Argentina. Pantallas, baterias, tapas, pines de carga y soporte especializado.",
    intro: "Catalogo Samsung priorizado por stock real, precio valido, imagen y compatibilidad clara.",
    canonicalPath: "/repuestos-samsung",
    priority: "0.82",
  }),
  "/repuestos-iphone": Object.freeze({
    key: "repuestos-iphone",
    title: "Repuestos iPhone en Argentina | NERIN Parts",
    h1: "Repuestos iPhone en Argentina",
    description: "Repuestos iPhone con stock real en Argentina. Displays, baterias, tapas y soporte para validar compatibilidad.",
    intro: "Repuestos para iPhone priorizados por stock real, compatibilidad clara, factura y garantia tecnica.",
    canonicalPath: "/repuestos-iphone",
    priority: "0.82",
  }),
});

function normalizePathname(pathname) {
  const raw = String(pathname || "").split("?")[0].trim();
  if (!raw) return "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

function getOrganicSeoPageConfig(pathname) {
  return ORGANIC_SEO_PAGE_CONFIG[normalizePathname(pathname)] || null;
}

function listOrganicSeoPages() {
  return Object.values(ORGANIC_SEO_PAGE_CONFIG);
}

module.exports = {
  ORGANIC_SEO_PAGE_CONFIG,
  getOrganicSeoPageConfig,
  listOrganicSeoPages,
};
