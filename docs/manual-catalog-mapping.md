# Manual catalog mapping overview

This guide resumes the admin changes shipped with the latest storefront update so you can verify what to expect when editing productos desde el backoffice.

## Dónde encontrar los overrides
- En el listado de **Productos** ahora aparece la columna **Explorador** con el estado `Automático` o el camino manual (Marca › Modelo › Pieza).
- Las filas con overrides manuales quedan destacadas para que las ubiques rápido antes de editar.

## Cómo configurarlos
1. Abrí el modal **Agregar / Editar producto**.
2. Bajá a la sección **Catálogo y explorador**.
3. Completá, si hace falta, los campos:
   - **Marca en el explorador**
   - **Modelo agrupador**
   - **Pieza / parte**
4. Si dejás un campo vacío, el sistema vuelve a usar la clasificación automática.

Las listas de sugerencias (`datalist`) se alimentan con los valores existentes, así mantenés consistencia entre repuestos.

## Qué pasa al guardar
- El formulario limpia espacios y descarta campos vacíos antes de enviar al backend.
- La vista previa del producto muestra inmediatamente la ruta resultante del explorador.
- En el storefront, la búsqueda, los filtros y el explorador priorizan tus overrides manuales frente a los automáticos.

## Datos de ejemplo disponibles
- En el entorno local, los SKUs `LCD-IPH12` y `BAT-IPH12` del archivo [`nerin_final_updated/data/products.json`](../nerin_final_updated/data/products.json)
  ya incluyen rutas curadas (Marca › Modelo › Pieza). Apenas ingreses al panel podrás verlos en la columna **Explorador** y
  abrir su modal para revisar la sección **Catálogo y explorador** sin tener que cargar datos a mano.

> 💡 Tip: Podés usar las rutas manuales para reagrupar piezas ambiguas (por ejemplo, "Display Assembly") bajo la categoría que prefieras sin tocar la data original del importador.
