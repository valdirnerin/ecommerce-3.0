NERIN ERP + E‑COMMERCE – MANUAL DE USUARIO
==========================================

Introducción
------------

Este proyecto es un punto de partida para el sistema ERP con tienda en línea
solicitado por NERIN Repuestos. Incluye un backend sencillo implementado con
Node.js (sin frameworks externos), un frontend estático pensado para móviles
y un archivo de datos editable con productos de ejemplo. El objetivo es que
puedas probar la aplicación sin necesidad de saber programar y que cuentes con
las bases necesarias para ampliar las funcionalidades (facturación, cuentas
corrientes, devoluciones, etc.) en el futuro.

La versión actual incorpora además un **panel de administración** accesible
únicamente con las credenciales de administrador (`admin@nerin.com`/`admin123`).
Desde este panel es posible:

* **Gestionar productos**: añadir nuevos artículos, editar los existentes y
  eliminarlos del catálogo. Los cambios se guardan en `data/products.json`.
* **Gestionar pedidos**: ver todos los pedidos registrados, cambiar su
  estado (pendiente, pagado, en preparación, enviado o entregado) y
  registrar datos de envío (número de seguimiento y transportista). Desde
  esta sección también se puede generar la factura de cada pedido.
* **Gestionar clientes**: listar todos los clientes mayoristas con su
  saldo y límite de crédito. El administrador puede registrar pagos
  parciales para reducir la deuda de cada cliente. Los clientes se
  almacenan en `data/clients.json` y se actualizan automáticamente cuando
  un pedido incrementa su saldo.
* **Ver métricas**: estadísticas básicas como el total de pedidos, ventas
  por mes y los productos más vendidos, calculadas a partir de los datos de
  `data/orders.json`【52022513669066†L92-L97】.

* **Gestionar devoluciones**: se incluye un apartado de devoluciones donde
  se listan todas las solicitudes de devolución realizadas por los clientes.
  El administrador puede **aprobar** o **rechazar** cada solicitud. Cuando
  una solicitud es aprobada o rechazada, el estado se actualiza
  automáticamente. El sistema también incorpora medidas anti‑fraude: si
  un mismo cliente realiza más de tres devoluciones, su cuenta queda
  marcada con la propiedad `blockedReturns` y no podrá solicitar nuevas
  devoluciones hasta que el administrador lo desbloquee en
  `data/clients.json`. Estas reglas se basan en las recomendaciones de
  implementar listas negras y políticas claras para prevenir abusos【546289989438419†L362-L376】【546289989438419†L414-L446】.

* **Control de stock con alertas**: cada producto dispone ahora de un
  campo `min_stock` que define el umbral mínimo de seguridad. En la tabla
  de productos se muestra esta columna y se resaltan en rojo las filas
  cuyo stock se encuentra por debajo del mínimo. Puedes ajustar el valor
  del umbral al añadir o editar un producto desde el panel. Un nivel de
  stock de seguridad (safety stock) permite evitar quiebres y se basa en
  las prácticas recomendadas de inventarios【635572867872744†L327-L344】.

Adicionalmente, se añadió una sección **Mi cuenta** en `/account.html` donde
cada cliente mayorista puede consultar su saldo actual, límite de crédito
y el historial de pedidos con la opción de descargar las facturas
correspondientes.

Estructura de carpetas
----------------------

```
nerin/
│  package.json        – dependencias y script de inicio
│
├─backend/             – servidor HTTP sin dependencias
│    server.js
│
├─frontend/            – archivos visibles para el usuario
│    index.html        – página de inicio
│    shop.html         – lista de productos
│    login.html        – formulario de acceso mayorista
│    cart.html         – resumen del carrito y checkout
│    account.html      – página "Mi cuenta" para clientes mayoristas
│    invoice.html      – vista imprimible de facturas
│    style.css         – estilos compartidos
│    js/               – código JavaScript modular
│        api.js        – funciones para comunicarse con el backend
│        shop.js       – lógica de la tienda
│        login.js      – lógica de autenticación
│        cart.js       – lógica del carrito y pedido
│        account.js    – lógica de la página “Mi cuenta”
│        invoice.js    – lógica para mostrar facturas

├─data/                – datos persistentes
│    products.json       – listado de productos
│    orders.json         – pedidos realizados
│    clients.json        – clientes mayoristas y sus saldos
│    invoices.json       – facturas generadas
│    invoice_counter.txt – contador para numerar facturas
│
├─assets/              – imágenes utilizadas en la interfaz
│    hero.png          – imagen de la portada
│    productX.png      – imágenes de productos de ejemplo
```

Cómo ejecutar el proyecto localmente
------------------------------------

1. **Instalar Node.js**. Se recomienda la versión LTS más reciente (≥ 16).

2. No necesitas instalar dependencias adicionales, ya que el servidor está
   construido sólo con módulos nativos de Node. Simplemente abre una terminal
   en la carpeta `nerin` y ejecuta:

   ```sh
   npm start
   ```

   Esto arrancará el servidor en `http://localhost:3000`. Al visitar esa URL
   en tu navegador deberías ver la página de inicio con el héroe y el menú.

3. Para detener el servidor presiona `Ctrl + C` en la terminal.

Cargar y editar productos
-------------------------

Los productos se almacenan en el archivo `data/products.json`. Cada
producto tiene los siguientes campos:

* **id**: identificador único (cadena)
* **sku**: código interno
* **name**: nombre visible del producto
* **brand**: marca (para filtros)
* **model**: modelo (para filtros)
* **description**: descripción breve
* **stock**: cantidad disponible
* **price_minorista**: precio para clientes minoristas
* **price_mayorista**: precio base para mayoristas (los descuentos se aplican
  automáticamente en el frontend)
* **image**: ruta a la imagen (debe existir en la carpeta `assets/`)

Para añadir nuevos productos, copia uno de los objetos existentes, ajusta
los valores y guarda el archivo. No olvides poner una imagen en
`assets/` y actualizar el nombre de archivo en el campo `image`.

El proyecto incluye cinco productos de ejemplo ya cargados. Puedes
reemplazarlos o añadir más para probar el funcionamiento de la tienda.

Cambiar textos e imágenes
-------------------------

La mayor parte de los textos que ve el usuario se encuentran en los archivos
`frontend/index.html`, `frontend/shop.html` y `frontend/login.html`. Puedes
abrirlos con cualquier editor de texto y modificar titulares, descripciones
y enlaces según tus necesidades.

Las imágenes se guardan en la carpeta `assets/`. Para sustituir la imagen
principal de la portada (hero), reemplaza `hero.png` por otra imagen con
el mismo nombre. Las imágenes de productos se definen en `data/products.json`.

Cómo activar o desactivar Mercado Pago
--------------------------------------

Este prototipo no incluye integración con pasarelas de pago. Para añadir
Mercado Pago u otra plataforma deberás crear un botón en el proceso de
checkout (no implementado en esta versión) que redirija al usuario a la
pasarela con el monto correspondiente. Las credenciales de Mercado Pago
deben obtenerse desde tu cuenta y configurarse en el backend. Consulta la
documentación oficial de Mercado Pago para detalles de integración.

El archivo `frontend/cart.html` incluye dos botones: **Enviar por
WhatsApp** y **Confirmar pedido**. El primero genera un enlace a la API
de WhatsApp con el resumen de la compra. Por defecto envía el mensaje al
número `541112345678`. Puedes cambiar este teléfono editando el valor
`phone` en `frontend/js/cart.js` (variable dentro del método
`whatsappBtn.onclick`). El botón **Confirmar pedido** realiza una
petición POST a `/api/checkout` que actualmente sólo registra la orden en
la consola del servidor. Si deseas implementar Mercado Pago, este sería
el lugar para generar la preferencia de pago y devolver el enlace de
pago al cliente.

Despliegue en Vercel, Netlify o Render
--------------------------------------

1. **Render**: Puedes crear una aplicación de Node en Render y subir el
   repositorio. Render instalará las dependencias automáticamente y
   levantará el servidor usando el comando `npm start` que ya está
   configurado. Asegúrate de establecer el puerto de escucha según las
   variables que provee Render.

2. **Vercel/Netlify**: Estos servicios están orientados a sitios
   estáticos, por lo que el backend de Node debe desplegarse en otro
   servicio (por ejemplo Render) o utilizar funciones serverless. Una
   alternativa es subir sólo la carpeta `frontend` a Vercel/Netlify para
   servirla como sitio estático y utilizar un backend remoto para las API.

Gestión de cuentas corrientes y otras funciones avanzadas
---------------------------------------------------------

Esta versión ya implementa las bases de las **cuentas corrientes** y la
**facturación**. Cada vez que un mayorista confirma un pedido se suma el
importe a su saldo en `clients.json` y el administrador puede generar la
factura correspondiente y registrar pagos parciales para reducir dicho
saldo. No obstante, hay funcionalidades avanzadas que todavía no se han
implementado. Puedes añadirlas de manera modular:

 * **Devoluciones / garantías**: esta versión ya incluye un sistema de
  devoluciones. Desde la página “Mi cuenta” el cliente puede solicitar
  una devolución indicando el motivo cuando un pedido se encuentre
  en estado **entregado**. En el panel de administración se muestran
  todas las solicitudes junto con su estado y el administrador puede
  aprobarlas o rechazarlas. Se ha incluido un mecanismo anti‑fraude:
  si un cliente excede las 3 devoluciones se marca automáticamente en
  `clients.json` con la propiedad `blockedReturns`, impidiendo nuevas
  solicitudes【546289989438419†L414-L446】. El administrador puede editar
  este valor manualmente para desbloquear al cliente.

 * **Control de stock con alertas**: cada producto dispone del campo
  `min_stock` que define el stock mínimo deseado. La tabla de productos
  del panel destaca en rojo los artículos cuyo inventario se encuentra
  por debajo de este umbral. Ajusta el valor de `min_stock` al crear
  o editar productos para recibir alertas visuales cuando sea necesario
  reponer【635572867872744†L327-L344】.

* **Integración con pasarelas de pago**: conecta el botón de confirmación
  del carrito con Mercado Pago, Stripe u otra plataforma. Esto te
  permitirá cobrar automáticamente y actualizar el estado del pedido cuando
  el pago sea aprobado.

* **Exportación de datos**: si necesitas exportar ventas o clientes a
  formatos como CSV o Excel, puedes usar bibliotecas del lado del servidor
  (por ejemplo `json2csv`) y exponer una ruta de descarga.

* **Chat interno y devoluciones**: para una comunicación directa con el
  cliente, implementa un módulo de mensajería en tiempo real donde puedan
  resolver dudas y compartir información de pedidos.

Los rangos de **descuentos automáticos** aplicados a los mayoristas están
definidos en la función `calculateDiscountedPrice()` dentro de
`frontend/js/shop.js`. Ajusta los valores y las cantidades mínimas según
tus políticas comerciales.

Recuerda que este proyecto es modular y puede escalarse. Añade nuevas
carpetas o archivos conforme crezca tu aplicación.

Nuevos módulos y mejoras en esta versión
---------------------------------------

Además de las funcionalidades anteriores, esta actualización añade una serie
de módulos avanzados que convierten la plataforma en un ERP más completo y
profesional. Estos componentes se inspiran en las mejores prácticas de los
ERPs modernos para distribuidores: finanzas, inventario, ventas, compras,
CRM y recursos humanos【325860026011719†L261-L286】【325860026011719†L288-L320】. A continuación se describen
las novedades:

### Gestión de proveedores

En la sección **Proveedores** del panel podrás registrar y administrar
tus socios comerciales (fabricantes, importadores, etc.). Cada proveedor
incluye datos como nombre, persona de contacto, teléfono, dirección,
condiciones de pago y valoración. Estos registros se almacenan en
`data/suppliers.json` y pueden editarse o eliminarse fácilmente desde la
interfaz.

### Órdenes de compra

El módulo **Órdenes de compra** (PO) te permite generar solicitudes a los
proveedores cuando necesites reponer stock. Una orden de compra contiene el
proveedor elegido, una lista de ítems con SKU, cantidad y coste unitario,
fecha de creación, estado (`pendiente`, `aprobada`, `recibido`) y fecha
estimada de llegada. Cuando una orden cambia su estado a `recibido`, el
inventario se actualiza automáticamente sumando las cantidades a las
bodegas correspondientes y al stock total. Esta funcionalidad se alinea con
la descripción de los módulos de adquisición (procurement) de un ERP
completo【325860026011719†L409-L437】.

### Almacenes múltiples y atributos ampliados

Cada producto ahora puede tener un campo `warehouseStock` que almacena el
inventario distribuido en varios depósitos (por ejemplo `central` y
`buenos_aires`), además de otras propiedades como `category`,
`weight`, `dimensions`, `color` y `vip_only`. Esto facilita la gestión
avanzada de inventario y logística, permitiendo realizar análisis por
categoría o programar reabastecimientos desde distintos orígenes. La
integración de un módulo de inventario junto con un sistema de gestión
de almacenes se recomienda para tener visibilidad en tiempo real sobre
existencias, movimientos y series【325860026011719†L288-L320】.

### Analíticas detalladas

Además de las métricas básicas, se incorporó el endpoint
`/api/analytics/detailed` que genera estadísticas completas: ventas por
categoría, unidades vendidas por producto, devoluciones por producto y
clientes con mayor facturación. Estas analíticas se inspiran en los módulos
de CRM y ventas de los ERPs modernos que permiten tomar decisiones basadas
en datos y conocer mejor el comportamiento de los clientes【325860026011719†L352-L380】.
Puedes visualizar estas métricas en la nueva página *Analíticas* del
panel de administración, que incluye gráficos y tablas dinámicas.

### Traducciones e internacionalización

El frontend incorpora un sistema básico de internacionalización que permite
mostrar la interfaz en español e inglés. Puedes elegir el idioma mediante
un selector en la parte superior del panel. Los textos están definidos en
`frontend/js/lang.js` y se cargan dinámicamente. Esta característica
facilita que el sistema pueda utilizarse en distintos países y optimiza la
experiencia de usuarios no hispanohablantes.

### Roles adicionales

Además de los roles *admin*, *mayorista*, *vendedor* y *vip*, se añadieron
perfiles de **Gerente** (`manager`), **Contador** (`accountant`) y **Soporte**
(`support`). Cada rol tiene permisos específicos: los gerentes pueden ver
todas las secciones pero no eliminar registros, los contadores tienen
acceso a las facturas y finanzas, y el equipo de soporte gestiona
devoluciones y mensajes de clientes. Puedes configurar nuevos usuarios
editando la lista `USERS` en `backend/server.js`.

### Políticas claras de devolución y prevención de fraudes

Se ampliaron las reglas anti‑fraude en las devoluciones. Ahora cada
cliente registra su cantidad de devoluciones mensuales (`returnCount`)
y se bloquea automáticamente cuando excede los límites establecidos. Esta
funcionalidad se inspira en las mejores prácticas para combatir fraudes de
devolución, que recomiendan establecer políticas claras y un sistema de
detección basado en análisis de patrones y listas negras【546289989438419†L362-L376】【546289989438419†L414-L446】.

### Consejos para seguir escalando

* **Módulo de proyectos y servicios**: si tu empresa comienza a ofrecer
  reparaciones, instalaciones u otros servicios, puedes integrar un
  módulo de proyectos como el descrito para los ERPs modernos【325860026011719†L500-L526】,
  que permita planificar tareas, asignar técnicos y controlar costes.
* **Recursos humanos**: considera añadir un módulo de RR.HH. con gestión
  de empleados, nóminas y desempeño. Esto evitará usar herramientas
  separadas y mantendrá la información centralizada【325860026011719†L386-L406】.
* **Fabricación / Kits**: si NERIN decide fabricar o ensamblar kits de
  reparación, será útil un módulo de producción que controle materias
  primas, órdenes de trabajo y listas de materiales【325860026011719†L438-L465】.
* **Gestión de la cadena de suministro**: para escalar tu negocio a nivel
  nacional o regional, considera implementar un módulo de SCM que ayude
  a coordinar proveedores, transporte y centros de distribución para
  minimizar tiempos de entrega【325860026011719†L471-L499】.

Estas funcionalidades no están totalmente implementadas en este MVP,
pero la estructura de carpetas `/frontend`, `/backend`, `/data` y `/admin`
ha sido diseñada para permitir su incorporación de manera modular y
gradual. Revise los archivos y siga las pautas para agregar nuevas
carpetas y scripts según crezcan las necesidades de NERIN.