const STATUS_CODE_TO_ES = {
  approved: 'pagado',
  pending: 'pendiente',
  rejected: 'rechazado',
  refunded: 'rechazado',
  charged_back: 'rechazado',
  cancelled: 'rechazado',
  canceled: 'rechazado',
};

const STATUS_ES_TO_CODE = {
  pagado: 'approved',
  pendiente: 'pending',
  rechazado: 'rejected',
  aprobado: 'approved',
  paid: 'approved',
  approved: 'approved',
  pending: 'pending',
  rejected: 'rejected',
  in_process: 'pending',
  inprocess: 'pending',
  refunded: 'refunded',
  refund: 'refunded',
  charged_back: 'charged_back',
  'charged-back': 'charged_back',
  chargeback: 'charged_back',
  cancelled: 'rejected',
  canceled: 'rejected',
};

function mapPaymentStatusCode(status) {
  if (!status) return 'pending';
  const key = String(status).toLowerCase();
  if (STATUS_ES_TO_CODE[key]) return STATUS_ES_TO_CODE[key];
  if (
    key === 'approved' ||
    key === 'pending' ||
    key === 'rejected' ||
    key === 'refunded' ||
    key === 'charged_back'
  ) {
    return key;
  }
  if (key === 'cancelled' || key === 'canceled') return 'rejected';
  if (key === 'in process') return 'pending';
  return 'pending';
}

function localizePaymentStatus(esOrCode) {
  const code = mapPaymentStatusCode(esOrCode);
  return STATUS_CODE_TO_ES[code] || 'pendiente';
}

module.exports = {
  STATUS_CODE_TO_ES,
  STATUS_ES_TO_CODE,
  mapPaymentStatusCode,
  localizePaymentStatus,
};
