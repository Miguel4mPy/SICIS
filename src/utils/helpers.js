const moment = require('moment');

function generarNumeroMovimiento() {
  const fecha = moment().format('YYYYMMDD');
  const rand = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
  return `MOV-${fecha}-${rand}`;
}

function calcularSemanaEpidemiologica(fecha) {
  const m = moment(fecha);
  return {
    semana: m.isoWeek(),
    anio: m.isoWeekYear()
  };
}

function formatearFecha(fecha) {
  if (!fecha) return '-';
  return moment(fecha).format('DD/MM/YYYY');
}

function formatearCantidad(cantidad, unidad) {
  const n = parseFloat(cantidad || 0);
  return `${n.toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} ${unidad || ''}`;
}

function diasHastaVencimiento(fechaVenc) {
  return moment(fechaVenc).diff(moment(), 'days');
}

function estadoVencimiento(fechaVenc) {
  const dias = diasHastaVencimiento(fechaVenc);
  if (dias < 0) return { clase: 'danger', texto: 'Vencido', dias };
  if (dias <= 30) return { clase: 'danger', texto: `Vence en ${dias}d`, dias };
  if (dias <= 90) return { clase: 'warning', texto: `Vence en ${dias}d`, dias };
  return { clase: 'success', texto: `Valido (${dias}d)`, dias };
}

function generarOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSemanas() {
  const semanas = [];
  for (let i = 1; i <= 52; i++) semanas.push(i);
  return semanas;
}

function getAnios() {
  const actual = new Date().getFullYear();
  return [actual - 2, actual - 1, actual, actual + 1];
}

function tipoMovimientoLabel(tipo) {
  const map = {
    interno: 'Interno',
    espacial: 'Espacial',
    focal: 'Focal',
    residual: 'Residual',
    larvicida: 'Larvicida'
  };
  return map[tipo] || tipo;
}

function categoriaLabel(cat) {
  const map = {
    entrada: 'Entrada',
    salida: 'Salida',
    transferencia: 'Transferencia',
    ajuste: 'Ajuste de Inventario'
  };
  return map[cat] || cat;
}

function tipoDepositoLabel(tipo) {
  const map = {
    oficina_central: 'Suministro Oficina Central',
    zona: 'Deposito Zona',
    sector: 'Deposito Sector'
  };
  return map[tipo] || tipo;
}

module.exports = {
  generarNumeroMovimiento,
  calcularSemanaEpidemiologica,
  formatearFecha,
  formatearCantidad,
  diasHastaVencimiento,
  estadoVencimiento,
  generarOTP,
  getSemanas,
  getAnios,
  tipoMovimientoLabel,
  categoriaLabel,
  tipoDepositoLabel
};
