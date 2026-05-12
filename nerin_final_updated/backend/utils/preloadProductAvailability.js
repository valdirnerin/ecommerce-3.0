const { resolveProductAvailability } = require("./productAvailability");

globalThis.resolveProductAvailability = resolveProductAvailability;

module.exports = { resolveProductAvailability };
