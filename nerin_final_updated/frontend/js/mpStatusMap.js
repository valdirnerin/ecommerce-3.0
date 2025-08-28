const MP_STATUS_MAP = {
  approved: 'aprobado',
  rejected: 'rechazado',
  cancelled: 'rechazado',
  refunded: 'rechazado',
  charged_back: 'rechazado',
  in_process: 'pendiente',
  pending: 'pendiente',
};

function mapMpStatus(status) {
  const key = String(status || '').toLowerCase();
  return MP_STATUS_MAP[key] || 'pendiente';
}

const MP_STATUS_VALUES = [...new Set(Object.values(MP_STATUS_MAP))];

if (typeof module !== 'undefined') {
  module.exports = { MP_STATUS_MAP, mapMpStatus, MP_STATUS_VALUES };
} else if (typeof window !== 'undefined') {
  window.MP_STATUS_MAP = MP_STATUS_MAP;
  window.mapMpStatus = mapMpStatus;
  window.MP_STATUS_VALUES = MP_STATUS_VALUES;
}
