const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const depositosCtrl = require('../controllers/depositosController');
const movimientosCtrl = require('../controllers/movimientosController');
const reportesCtrl = require('../controllers/reportesController');
const usuariosCtrl = require('../controllers/usuariosController');
const insecticidasCtrl = require('../controllers/insecticidasController');
const logsCtrl = require('../controllers/logsController');

// Dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const [statsMovs, statsStock, statsDepositos, movRecientes, lotesPorVencer] = await Promise.all([
      pool.query(`SELECT tipo_movimiento, COUNT(*) as total, SUM(cantidad) as total_cant
        FROM movimientos WHERE estado != 'anulado' AND fecha_movimiento >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY tipo_movimiento`),
      pool.query(`SELECT i.id, i.codigo, i.nombre, i.unidad_medida, i.tipo_uso,
          COALESCE(i.tipo_usos, ARRAY[i.tipo_uso::TEXT]) as tipo_usos,
          SUM(s.cantidad) as total
        FROM stock s JOIN lotes l ON s.lote_id = l.id JOIN insecticidas i ON l.insecticida_id = i.id
        WHERE s.cantidad > 0
        GROUP BY i.id, i.codigo, i.nombre, i.unidad_medida, i.tipo_uso, i.tipo_usos
        ORDER BY i.nombre`),
      pool.query("SELECT tipo, COUNT(*) as total FROM depositos WHERE activo = true GROUP BY tipo"),
      pool.query(`SELECT m.id, m.numero_mov, m.tipo_movimiento, m.cantidad, m.fecha_movimiento, i.nombre as ins_nombre, i.unidad_medida,
        dor.nombre as origen, dde.nombre as destino, u.nombre || ' ' || u.apellido as usuario
        FROM movimientos m JOIN insecticidas i ON m.insecticida_id = i.id
        LEFT JOIN depositos dor ON m.deposito_origen_id = dor.id
        LEFT JOIN depositos dde ON m.deposito_destino_id = dde.id
        JOIN usuarios u ON m.usuario_id = u.id
        WHERE m.estado != 'anulado' ORDER BY m.created_at DESC LIMIT 8`),
      pool.query(`SELECT l.codigo_lote, l.fecha_vencimiento, i.nombre as ins_nombre, COALESCE(SUM(s.cantidad), 0) as stock
        FROM lotes l JOIN insecticidas i ON l.insecticida_id = i.id
        LEFT JOIN stock s ON s.lote_id = l.id
        WHERE l.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days' AND l.activo = true
        GROUP BY l.id, i.nombre ORDER BY l.fecha_vencimiento LIMIT 5`)
    ]);

    res.render('dashboard', {
      title: 'Dashboard',
      statsMovs: statsMovs.rows,
      statsStock: statsStock.rows,
      statsDepositos: statsDepositos.rows,
      movRecientes: movRecientes.rows,
      lotesPorVencer: lotesPorVencer.rows
    });
  } catch (err) {
    console.error(err);
    res.render('dashboard', { title: 'Dashboard', statsMovs: [], statsStock: [], statsDepositos: [], movRecientes: [], lotesPorVencer: [] });
  }
});

// Perfil del usuario autenticado
router.get('/perfil', requireAuth, usuariosCtrl.getPerfil);
router.post('/perfil', requireAuth, usuariosCtrl.updatePerfil);
router.post('/perfil/password', requireAuth, usuariosCtrl.updatePerfilPassword);

// Depósitos
router.get('/depositos', requireAuth, depositosCtrl.index);
router.get('/depositos/arbol', requireAuth, depositosCtrl.getArbol);
router.get('/depositos/nuevo', requireAuth, requireRole('admin'), depositosCtrl.new);
router.post('/depositos', requireAuth, requireRole('admin'), depositosCtrl.create);
router.get('/depositos/:id', requireAuth, depositosCtrl.show);
router.get('/depositos/:id/editar', requireAuth, requireRole('admin'), depositosCtrl.edit);
router.post('/depositos/:id', requireAuth, requireRole('admin'), depositosCtrl.update);
router.post('/depositos/:id/eliminar', requireAuth, requireRole('admin'), depositosCtrl.delete);

// Insecticidas
router.get('/tipos-uso', requireAuth, requireRole('admin'), insecticidasCtrl.tiposUsoIndex);
router.post('/tipos-uso', requireAuth, requireRole('admin'), insecticidasCtrl.tiposUsoUpdate);
router.get('/unidades-medida', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.unidadesIndex);
router.post('/unidades-medida', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.unidadesCreate);
router.post('/unidades-medida/:codigo', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.unidadesUpdate);
router.post('/unidades-medida/:codigo/eliminar', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.unidadesDelete);
router.get('/insecticidas', requireAuth, insecticidasCtrl.index);
router.get('/insecticidas/nuevo', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.new);
router.post('/insecticidas', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.create);
router.get('/insecticidas/:id', requireAuth, insecticidasCtrl.show);
router.get('/insecticidas/:id/editar', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.edit);
router.post('/insecticidas/:id', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.update);
router.post('/insecticidas/:id/eliminar', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.delete);

// Lotes
router.get('/lotes', requireAuth, insecticidasCtrl.lotesIndex);
router.get('/lotes/nuevo', requireAuth, requireRole('admin', 'operador', 'encargado_principal'), insecticidasCtrl.loteNew);
router.post('/lotes', requireAuth, requireRole('admin', 'operador', 'encargado_principal'), insecticidasCtrl.loteCreate);
router.get('/lotes/:id/editar', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.loteEdit);
router.post('/lotes/:id', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.loteUpdate);
router.post('/lotes/:id/eliminar', requireAuth, requireRole('admin', 'encargado_principal'), insecticidasCtrl.loteDelete);

// Movimientos
router.get('/movimientos', requireAuth, movimientosCtrl.index);
router.get('/movimientos/nuevo', requireAuth, movimientosCtrl.new);
router.post('/movimientos', requireAuth, movimientosCtrl.create);
router.get('/movimientos/confirmaciones', requireAuth, movimientosCtrl.confirmaciones);
router.post('/movimientos/:id/confirmar', requireAuth, movimientosCtrl.confirmar);
router.get('/movimientos/:id', requireAuth, movimientosCtrl.show);
router.post('/movimientos/:id/anular', requireAuth, requireRole('admin', 'gerente'), movimientosCtrl.anular);
router.get('/api/stock/:deposito_id', requireAuth, movimientosCtrl.getStockPorDeposito);

// Reportes
router.get('/reportes', requireAuth, reportesCtrl.index);
router.get('/reportes/movimientos', requireAuth, reportesCtrl.movimientos);
router.get('/reportes/stock', requireAuth, reportesCtrl.stock);
router.get('/reportes/grafico', requireAuth, requireRole('admin', 'gerente'), reportesCtrl.grafico);

// Usuarios (solo admin)
router.get('/usuarios', requireAuth, requireRole('admin'), usuariosCtrl.index);
router.get('/usuarios/nuevo', requireAuth, requireRole('admin'), usuariosCtrl.new);
router.post('/usuarios', requireAuth, requireRole('admin'), usuariosCtrl.create);
router.get('/usuarios/:id/editar', requireAuth, requireRole('admin'), usuariosCtrl.edit);
router.post('/usuarios/:id', requireAuth, requireRole('admin'), usuariosCtrl.update);
router.post('/usuarios/:id/reset-password', requireAuth, requireRole('admin'), usuariosCtrl.resetPassword);
router.post('/usuarios/:id/toggle-bloqueo', requireAuth, requireRole('admin'), usuariosCtrl.toggleBloqueo);
router.post('/usuarios/:id/eliminar', requireAuth, requireRole('admin'), usuariosCtrl.delete);
router.get('/logs', requireAuth, requireRole('admin'), logsCtrl.index);

router.get('/', (req, res) => res.redirect('/dashboard'));

module.exports = router;
