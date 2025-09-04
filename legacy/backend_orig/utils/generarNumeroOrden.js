function generarNumeroOrden() {
  const fecha = new Date();
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anio = fecha.getFullYear().toString().slice(-2);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `NRN-${dia}${mes}${anio}-${random}`;
}

module.exports = generarNumeroOrden;
