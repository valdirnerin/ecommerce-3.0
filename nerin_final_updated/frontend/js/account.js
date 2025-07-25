/*
 * Página de cuenta de cliente de NERIN.
 *
 * Muestra el estado de la cuenta corriente (saldo y límite) y
 * la lista de pedidos del usuario logueado. Permite visualizar
 * las facturas asociadas a cada pedido.
 */

async function initAccount() {
  const role = localStorage.getItem('nerinUserRole');
  const email = localStorage.getItem('nerinUserEmail');
  const name = localStorage.getItem('nerinUserName');
  if (!email) {
    // Si no hay correo guardado, redirigir a login
    window.location.href = '/login.html';
    return;
  }
  const accountInfoDiv = document.getElementById('accountInfo');
  const tbody = document.querySelector('#userOrdersTable tbody');
  // Mostrar saludo y datos de saldo
  try {
    const clientsRes = await fetch('/api/clients');
    let clientData = null;
    if (clientsRes.ok) {
      const { clients } = await clientsRes.json();
      clientData = clients.find((c) => c.email === email);
    }
    let infoHtml = `<p><strong>Usuario:</strong> ${name || email}</p>`;
    if (clientData) {
      infoHtml += `<p><strong>Saldo actual:</strong> $${clientData.balance.toLocaleString('es-AR')} / Límite $${clientData.limit.toLocaleString('es-AR')}</p>`;
    } else {
      infoHtml += '<p>No hay saldo registrado.</p>';
    }
    accountInfoDiv.innerHTML = infoHtml;
  } catch (err) {
    accountInfoDiv.textContent = 'No se pudo cargar la información de la cuenta.';
  }
  // Cargar pedidos del usuario
  try {
    const res = await fetch('/api/orders');
    if (!res.ok) throw new Error('No se pudieron obtener los pedidos');
    const data = await res.json();
    const orders = data.orders.filter((o) => o.customer && o.customer.email === email);
    tbody.innerHTML = '';
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8">No tienes pedidos registrados.</td></tr>';
      return;
    }
    orders.forEach(async (order) => {
      const tr = document.createElement('tr');
      const idTd = document.createElement('td');
      idTd.textContent = order.id;
      const dateTd = document.createElement('td');
      dateTd.textContent = new Date(order.date).toLocaleString('es-AR');
      const itemsTd = document.createElement('td');
      itemsTd.textContent = order.items.map((it) => `${it.name} x${it.quantity}`).join(', ');
      const statusTd = document.createElement('td');
      statusTd.textContent = order.status;
      const trackTd = document.createElement('td');
      trackTd.textContent = order.tracking || '';
      const carrierTd = document.createElement('td');
      carrierTd.textContent = order.carrier || '';
      const totalTd = document.createElement('td');
      totalTd.textContent = `$${order.total.toLocaleString('es-AR')}`;
      const invoiceTd = document.createElement('td');
      const invoiceBtn = document.createElement('button');
      invoiceBtn.textContent = 'Factura';
      invoiceBtn.addEventListener('click', async () => {
        try {
          const resp = await fetch(`/api/invoices/${order.id}`, { method: 'POST' });
          if (resp.ok) {
            window.open(`/invoice.html?orderId=${order.id}`, '_blank');
          } else {
            const errData = await resp.json().catch(() => ({}));
            alert(errData.error || 'Error al obtener factura');
          }
        } catch (err) {
          alert('Error al abrir factura');
        }
      });
      // Cambiar texto según existencia
      try {
        const resp = await fetch(`/api/invoices/${order.id}`);
        if (resp.ok) {
          invoiceBtn.textContent = 'Ver factura';
        } else {
          invoiceBtn.textContent = 'Generar factura';
        }
      } catch (e) {
        invoiceBtn.textContent = 'Factura';
      }
      invoiceTd.appendChild(invoiceBtn);
      // Si el pedido está entregado, permitir solicitar devolución
      if (order.status === 'entregado') {
        const returnBtn = document.createElement('button');
        returnBtn.textContent = 'Devolver';
        returnBtn.style.marginLeft = '0.25rem';
        returnBtn.addEventListener('click', async () => {
          // Verificar si el cliente está bloqueado para devoluciones
          try {
            const clientsRes = await fetch('/api/clients');
            let blocked = false;
            if (clientsRes.ok) {
              const { clients } = await clientsRes.json();
              const cli = clients.find((c) => c.email === email);
              if (cli && cli.blockedReturns) blocked = true;
            }
            if (blocked) {
              alert('No puedes solicitar nuevas devoluciones. Por favor contacta con el soporte.');
              return;
            }
          } catch (e) {
            // Si no se pudo verificar, continuamos pero avisamos
            console.warn('No se pudo verificar estado de devoluciones');
          }
          const reason = prompt('Motivo de la devolución');
          if (reason === null || reason.trim() === '') return;
          try {
            const resp = await fetch('/api/returns', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: order.id, reason, items: order.items, customerEmail: email })
            });
            const data = await resp.json().catch(() => ({}));
            if (resp.ok) {
              alert('Solicitud de devolución enviada');
              // recargar lista de devoluciones
              loadUserReturns(email);
            } else {
              alert(data.error || 'No se pudo crear la solicitud');
            }
          } catch (err) {
            alert('Error al enviar la solicitud de devolución');
          }
        });
        invoiceTd.appendChild(returnBtn);
      }
      tr.appendChild(idTd);
      tr.appendChild(dateTd);
      tr.appendChild(itemsTd);
      tr.appendChild(statusTd);
      tr.appendChild(trackTd);
      tr.appendChild(carrierTd);
      tr.appendChild(totalTd);
      tr.appendChild(invoiceTd);
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8">No se pudieron cargar tus pedidos.</td></tr>';
  }

  // Cargar devoluciones del usuario
  loadUserReturns(email);
}

// Carga las solicitudes de devolución del usuario logueado y las muestra en la tabla
async function loadUserReturns(email) {
  const returnsTbody = document.querySelector('#userReturnsTable tbody');
  try {
    const res = await fetch(`/api/returns?email=${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error('No se pudieron obtener las devoluciones');
    const data = await res.json();
    const returns = data.returns || [];
    returnsTbody.innerHTML = '';
    if (returns.length === 0) {
      returnsTbody.innerHTML = '<tr><td colspan="5">No tienes devoluciones.</td></tr>';
      return;
    }
    returns.forEach((ret) => {
      const tr = document.createElement('tr');
      const idTd = document.createElement('td');
      idTd.textContent = ret.id;
      const orderTd = document.createElement('td');
      orderTd.textContent = ret.orderId;
      const dateTd = document.createElement('td');
      dateTd.textContent = new Date(ret.date).toLocaleString('es-AR');
      const reasonTd = document.createElement('td');
      reasonTd.textContent = ret.reason;
      const statusTd = document.createElement('td');
      statusTd.textContent = ret.status;
      tr.appendChild(idTd);
      tr.appendChild(orderTd);
      tr.appendChild(dateTd);
      tr.appendChild(reasonTd);
      tr.appendChild(statusTd);
      returnsTbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    returnsTbody.innerHTML = '<tr><td colspan="5">No se pudieron cargar tus devoluciones.</td></tr>';
  }
}

document.addEventListener('DOMContentLoaded', initAccount);