const FUTURE_ENV_VARS = [
  "ANDREANI_API_BASE_URL",
  "ANDREANI_CLIENT_ID",
  "ANDREANI_CLIENT_SECRET",
  "ANDREANI_CONTRACT_ID",
  "ANDREANI_SUCURSAL_ORIGEN",
  "ANDREANI_ENVIRONMENT",
];

function buildMockAndreaniQuote(payload = {}) {
  return {
    carrier: "Andreani",
    service: "mock",
    isMock: true,
    price: null,
    estimatedDays: null,
    postalCode: payload.postalCode || payload.cp || payload.zip || null,
    options: [
      { type: "home", label: "Andreani a domicilio", isMock: true },
      { type: "branch", label: "Andreani a sucursal", isMock: true },
    ],
    message: "Cotizacion Andreani pendiente de integracion real",
    futureEnvVars: FUTURE_ENV_VARS,
  };
}

module.exports = {
  FUTURE_ENV_VARS,
  buildMockAndreaniQuote,
};
