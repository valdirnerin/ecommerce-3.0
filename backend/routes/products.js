const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const PRODUCTS_FILE = path.join(__dirname, '..', 'data', 'products.json');

router.get('/products', (_req, res) => {
  fs.readFile(PRODUCTS_FILE, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'No se pudieron cargar los productos' });
    }
    try {
      const json = JSON.parse(data);
      res.json({ products: json.products || [] });
    } catch (e) {
      res.status(500).json({ error: 'No se pudieron cargar los productos' });
    }
  });
});

module.exports = router;
