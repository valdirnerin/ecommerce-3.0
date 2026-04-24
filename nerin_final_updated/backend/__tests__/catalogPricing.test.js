const {
  computePricingForRow,
  createPricingSummaryAccumulator,
} = require("../services/catalogPricing");

describe("catalogPricing", () => {
  test("calcula precio final con redondeo a 100 ARS", () => {
    const row = {
      PartId: "1",
      PartNumber: "SKU-1",
      Description: "Repuesto",
      UnitPrice: "10,17",
    };

    const result = computePricingForRow(row, undefined, {
      costColumn: "UnitPrice",
      currencyHeuristics: { assumeEuropeanSupplier: true },
    });

    expect(result.pricing.estado_calculo).toBe("ok");
    expect(result.pricing.moneda_origen).toBe("EUR");
    expect(result.pricing.precio_final_ars % 100).toBe(0);
    expect(result.pricing.precio_final_ars).toBeGreaterThanOrEqual(1000);
    expect(result.pricing.ganancia_estimada_ars).toBeGreaterThan(0);
    expect(result.pricing.tiempo_demora_dias).toBe(20);
  });

  test("marca revisión si no hay costo válido", () => {
    const row = {
      PartId: "1",
      PartNumber: "SKU-1",
      Description: "Repuesto",
      UnitPrice: "",
    };
    const result = computePricingForRow(row, undefined, {
      costColumn: "UnitPrice",
      currencyHeuristics: { assumeEuropeanSupplier: true },
    });

    expect(result.pricing.estado_calculo).toBe("revisión");
  });

  test("acumulador genera resumen con top y promedio", () => {
    const acc = createPricingSummaryAccumulator();

    acc.add({ PartNumber: "A", Description: "Prod A" }, {
      estado_calculo: "ok",
      margen_neto_sobre_venta: 0.2,
      margen_sobre_costo_caja: 0.25,
      ganancia_estimada_ars: 1000,
    });

    acc.add({ PartNumber: "B", Description: "Prod B" }, {
      estado_calculo: "revisión",
      margen_neto_sobre_venta: null,
      margen_sobre_costo_caja: null,
      ganancia_estimada_ars: -50,
    });

    const report = acc.finalize();
    expect(report.processedRows).toBe(2);
    expect(report.okRows).toBe(1);
    expect(report.revisionRows).toBe(1);
    expect(report.averageNetMargin).toBe(0.2);
    expect(report.top10ByEstimatedProfit[0].sku).toBe("A");
  });
});
