import { apiFetch } from "./api.js";

export async function renderAnalyticsDashboard(containerId = 'analytics-dashboard') {
  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return;
  container.innerHTML = '<p>Cargando...</p>';
  try {
    const res = await apiFetch('/api/analytics/detailed');
    const { analytics } = await res.json();
    container.innerHTML = '';

    const palette = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6', '#f43f5e', '#ec4899', '#a3e635'];

    function createChart(title, type, labels, data, { valueType = 'currency', ...opts } = {}) {
      const wrapper = document.createElement('div');
      wrapper.className = 'chart-wrapper';
      const h4 = document.createElement('h4');
      h4.textContent = title;
      wrapper.appendChild(h4);
      const canvas = document.createElement('canvas');
      wrapper.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      const colors = labels.map((_, i) => palette[i % palette.length]);
      const chart = new Chart(ctx, {
        type,
        data: {
          labels,
          datasets: [
            {
              label: title,
              data,
              backgroundColor: type === 'line' ? palette[0] : colors,
              borderColor: type === 'line' ? palette[0] : colors,
              fill: type !== 'line',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: opts.indexAxis || 'x',
          plugins: {
            legend: { display: type === 'pie' },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const val = type === 'pie' ? ctx.parsed : ctx.parsed.y;
                  return valueType === 'units'
                    ? `${val} u.`
                    : `$${val.toLocaleString('es-AR')}`;
                },
              },
            },
          },
          scales: type === 'pie' ? {} : { y: { beginAtZero: true } },
        },
      });

      const btnContainer = document.createElement('div');
      btnContainer.className = 'chart-buttons';
      const imgBtn = document.createElement('button');
      imgBtn.className = 'button secondary';
      imgBtn.textContent = 'Descargar PNG';
      imgBtn.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = chart.toBase64Image();
        a.download = `${title}.png`;
        a.click();
      });
      const csvBtn = document.createElement('button');
      csvBtn.className = 'button secondary';
      csvBtn.textContent = 'Exportar datos';
      csvBtn.addEventListener('click', () => {
        let csv = 'Etiqueta,Valor\n';
        labels.forEach((lab, i) => {
          csv += `${lab},${data[i]}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${title}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      });
      btnContainer.appendChild(imgBtn);
      btnContainer.appendChild(csvBtn);
      wrapper.appendChild(btnContainer);
      container.appendChild(wrapper);
    }

    createChart(
      'Ventas por categoría',
      'pie',
      Object.keys(analytics.salesByCategory),
      Object.values(analytics.salesByCategory),
    );

    createChart(
      'Unidades vendidas por producto',
      'bar',
      Object.keys(analytics.salesByProduct),
      Object.values(analytics.salesByProduct),
      { valueType: 'units' },
    );

    createChart(
      'Devoluciones por producto',
      'bar',
      Object.keys(analytics.returnsByProduct),
      Object.values(analytics.returnsByProduct),
      { valueType: 'units' },
    );

    const clientLabels = analytics.topCustomers.map((c) => c.email);
    const clientData = analytics.topCustomers.map((c) => c.total);
    createChart(
      'Clientes con mayor facturación',
      'bar',
      clientLabels,
      clientData,
      { indexAxis: 'y' },
    );

    createChart(
      'Ventas por mes',
      'line',
      Object.keys(analytics.monthlySales),
      Object.values(analytics.monthlySales),
    );

    const stats = document.createElement('div');
    stats.className = 'analytics-stats';
    stats.innerHTML = `
      <p>Valor medio de pedido: $${analytics.averageOrderValue.toFixed(2)}</p>
      <p>Tasa de devoluciones: ${(analytics.returnRate * 100).toFixed(2)}%</p>
      <p>Producto más devuelto: ${analytics.mostReturnedProduct || 'N/A'}</p>
    `;
    container.appendChild(stats);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p>No se pudieron cargar las analíticas</p>';
  }
}
