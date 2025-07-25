/*
 * Página de factura de NERIN.
 *
 * Este script obtiene el parámetro orderId desde la URL, solicita la
 * factura correspondiente al backend y la muestra en pantalla. Si no
 * existe, informa al usuario. También ofrece un botón para imprimir
 * (descargar como PDF utilizando la funcionalidad de impresión del
 * navegador).
 */

async function loadInvoice() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId');
  const container = document.getElementById('invoiceContainer');
  const printBtn = document.getElementById('printBtn');
  if (!orderId) {
    container.innerHTML = '<p>No se proporcionó un ID de pedido.</p>';
    return;
  }
  try {
    const res = await fetch(`/api/invoices/${encodeURIComponent(orderId)}`);
    if (!res.ok) {
      const dataErr = await res.json().catch(() => ({}));
      container.innerHTML = `<p>${dataErr.error || 'Factura no encontrada'}</p>`;
      return;
    }
    const data = await res.json();
    const invoice = data.invoice;
    // Construir HTML de la factura
    let html = '<div class="invoice-box">';
    html += `<h3>Factura ${invoice.type} Nº ${invoice.id}</h3>`;
    html += `<p><strong>Fecha:</strong> ${new Date(invoice.date).toLocaleString('es-AR')}</p>`;
    if (invoice.client) {
      html += `<p><strong>Cliente:</strong> ${invoice.client.name || ''} (${invoice.client.email})</p>`;
      if (invoice.client.cuit) {
        html += `<p><strong>CUIT:</strong> ${invoice.client.cuit}</p>`;
      }
      if (invoice.client.condicion_iva) {
        html += `<p><strong>Condición IVA:</strong> ${invoice.client.condicion_iva}</p>`;
      }
    }
    // Tabla de ítems
    html += '<table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th></tr></thead><tbody>';
    invoice.items.forEach((item) => {
      const total = item.price * item.quantity;
      html += `<tr><td>${item.name}</td><td>${item.quantity}</td><td>$${item.price.toLocaleString('es-AR')}</td><td>$${total.toLocaleString('es-AR')}</td></tr>`;
    });
    html += `<tr><td colspan="3" class="total">TOTAL</td><td class="total">$${invoice.total.toLocaleString('es-AR')}</td></tr>`;
    html += '</tbody></table>';
    html += '</div>';
    container.innerHTML = html;
    printBtn.style.display = 'inline-block';
    printBtn.addEventListener('click', () => {
      window.print();
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p>Error al cargar la factura.</p>';
  }
}

document.addEventListener('DOMContentLoaded', loadInvoice);