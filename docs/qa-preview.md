# QA reference for preview and contact fixes

## Development preview route
- `/dev/product-preview` serves `frontend/product.html` only when `NODE_ENV` is not `production`.
- `/api/dev/preview-product` returns the in-memory mock from `backend/config/previewProductMock.js`.

## Product detail UX
- Buy panel, wholesale messaging, and sticky CTA are generated in `nerin_final_updated/frontend/js/product.js` and styled in `nerin_final_updated/frontend/style.css`.

## Contact page light mode enforcement
- `nerin_final_updated/frontend/contact.html` uses `<body class="contact-page">`.
- Light-mode overrides are defined near the top of `nerin_final_updated/frontend/style.css` for `.contact-page`, with dark-mode media query overrides to keep the page bright.
