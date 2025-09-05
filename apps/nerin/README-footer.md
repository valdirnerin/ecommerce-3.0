# Configuración de footer

Los datos mostrados en el footer público y en el panel de administración se leen desde `data/footer.json`.

## Edición desde Admin
1. Ingresar a `/admin.html` y seleccionar la sección **Footer**.
2. Completar los campos agrupados por Identidad, Navegación, Contacto, CTA, Legales y Apariencia.
   - Las columnas de navegación aceptan líneas en el formato `texto|URL`.
   - El número de WhatsApp debe estar en formato E.164 (`+549...`).
   - Los enlaces deben ser URLs válidas.
3. Guardar los cambios. El archivo `data/footer.json` se actualizará y el sitio reflejará el nuevo contenido.

## Estructura del archivo
```jsonc
{
  "version": 1,
  "identity": { "brand_name": "", "logo_variant": "light", "tagline": "" },
  "navigation": [ [ {"text": "", "url": ""} ] ],
  "contact": { "whatsapp_number": "", "email": "", "address": "", "opening_hours": "" },
  "cta": { "enabled": true, "prompt": "", "button_text": "", "cta_link": "" },
  "legal": { "company_name": "", "cuit": "", "terms": "", "privacy": "" },
  "appearance": { "theme": "light", "accent": "" }
}
```

El campo `version` permite futuras migraciones automáticas.
