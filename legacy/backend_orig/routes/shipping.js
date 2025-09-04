const express = require('express');
const router = express.Router();
const { getShippingCost } = require('../utils/shippingCosts');

router.get('/shipping-cost', (req, res) => {
  const provincia = req.query.provincia || '';
  const costo = getShippingCost(provincia);
  res.json({ costo });
});

module.exports = router;
