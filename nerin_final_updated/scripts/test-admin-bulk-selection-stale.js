#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const adminSource = fs.readFileSync(path.join(rootDir, "frontend", "js", "admin.js"), "utf8");

function bodyOf(functionName) {
  let start = adminSource.indexOf(`function ${functionName}`);
  if (start < 0) start = adminSource.indexOf(`async function ${functionName}`);
  assert(start >= 0, `${functionName} debe existir`);
  const signatureEnd = adminSource.indexOf(") {", start);
  const brace = signatureEnd >= 0 ? signatureEnd + 2 : adminSource.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < adminSource.length; index += 1) {
    if (adminSource[index] === "{") depth += 1;
    if (adminSource[index] === "}") depth -= 1;
    if (depth === 0) return adminSource.slice(brace, index + 1);
  }
  throw new Error(`No se pudo leer ${functionName}`);
}

const loadProductsBody = bodyOf("loadProducts");
const updateFiltersBody = bodyOf("updateProductFilters");
const getSelectedBody = bodyOf("getSelectedProductIdentifiers");
const applyVisibilityBody = bodyOf("applyBulkVisibilityAction");

assert(adminSource.includes("const selectedProductMap = new Map()"), "debe existir selectedProductMap");
assert(adminSource.includes("function clearProductSelection"), "debe existir clearProductSelection");
assert(loadProductsBody.includes('clearProductSelection("loadProducts")'), "loadProducts debe limpiar seleccion stale");
assert(updateFiltersBody.includes('clearProductSelection("filters_changed")'), "cambios de filtro deben limpiar seleccion");
assert(adminSource.includes('clearProductSelection("page_changed")'), "cambios de pagina deben limpiar seleccion");
assert(adminSource.includes('clearProductSelection("page_size_changed")'), "cambios de pageSize deben limpiar seleccion");
assert(adminSource.includes('clearProductSelection("filters_cleared")'), "limpiar filtros debe limpiar seleccion");

assert(getSelectedBody.includes('document.querySelectorAll(".select-product:checked")'), "payload debe salir de checkboxes visibles actuales");
assert(getSelectedBody.includes("getRowSelectionMeta"), "seleccion debe usar metadata de la fila visible");
assert(getSelectedBody.includes("selectedProductMap.delete"), "seleccion stale debe eliminarse del map");
assert(adminSource.includes("[admin-bulk-action:selection]"), "debe loguear muestra de seleccion");
assert(adminSource.includes("selectedSample: selectedEntries.slice(0, 10)"), "log debe incluir sample con metadata");
assert(adminSource.includes("selectedEntries.every"), "debe detectar seleccion ya publica antes de publicar");

assert(applyVisibilityBody.includes("/api/admin/products/bulk-visibility"), "visibilidad debe usar endpoint batch");
assert(applyVisibilityBody.includes("identifiers.slice(index, index + 200)"), "mas de 200 seleccionados debe enviarse en chunks");
assert(!/apiFetch\(`\/api\/products\/\$\{[^`]+`[\s\S]{0,220}visibility/.test(adminSource), "hacer publico no debe hacer PATCH producto por producto");

console.log("admin bulk stale selection source tests passed");
