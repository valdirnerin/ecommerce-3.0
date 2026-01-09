# Backend notes

## UTF-8 encoding enforcement

- The backend now sets UTF-8 `Content-Type` headers for HTML/CSS/JS/JSON responses served via `express.static`.
- To repair any mojibake text already stored in source files (e.g. `Ã³`, `Ã±`), run:

```bash
node scripts/fix-mojibake.js
```

## Browser verification (Chrome DevTools)

1. Open **Network** → select `register.html` (or any HTML route).
2. Confirm **Response Headers** show `Content-Type: text/html; charset=utf-8`.
3. Verify the UI displays “verificación”, “contraseña”, “teléfono” correctly.
4. Right click → **View Page Source** and ensure the HTML source does **not** contain `Ã³`/`Ã±`.
