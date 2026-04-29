/* ============================================================
   SICIS — JavaScript principal
   ============================================================ */

'use strict';

// ── Sidebar toggle (mobile) ──────────────────────────────────
(function () {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebarOverlay');
  const toggleBtn = document.getElementById('sidebarToggle');

  function openSidebar() {
    sidebar?.classList.add('open');
    overlay?.classList.add('open');
  }

  function closeSidebar() {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('open');
  }

  toggleBtn?.addEventListener('click', openSidebar);
  overlay?.addEventListener('click', closeSidebar);

  // Close sidebar on nav link click (mobile)
  sidebar?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth < 992) closeSidebar();
    });
  });
})();

// ── Reloj en topbar ─────────────────────────────────────────
(function () {
  const clockEl = document.getElementById('topbarClock');
  if (!clockEl) return;

  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('es-PY', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  updateClock();
  setInterval(updateClock, 1000);
})();

// ── Auto-dismiss alerts ──────────────────────────────────────
(function () {
  document.querySelectorAll('.alert-dismissible.fade.show').forEach(alert => {
    if (alert.classList.contains('alert-danger') || alert.classList.contains('alert-warning')) return;
    setTimeout(() => {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
      bsAlert?.close();
    }, 5000);
  });
})();

// ── Confirmación de formularios destructivos ─────────────────
document.querySelectorAll('[data-confirm]').forEach(el => {
  el.addEventListener('click', function (e) {
    if (!confirm(this.dataset.confirm)) {
      e.preventDefault();
      return false;
    }
  });
});

// ── Marcar enlace activo en sidebar ─────────────────────────
(function () {
  const path = window.location.pathname;
  document.querySelectorAll('.sidebar-nav-item a, .sidebar-nav .nav-item').forEach(link => {
    const href = link.getAttribute('href');
    if (href && href !== '/' && path.startsWith(href)) {
      link.classList.add('active');
    } else if (href === '/' && path === '/') {
      link.classList.add('active');
    }
  });
})();

// ── OTP input: auto-avance y pegar ──────────────────────────
(function () {
  const otpInputs = document.querySelectorAll('.otp-input');
  if (!otpInputs.length) return;

  otpInputs.forEach((input, idx) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 1);
      if (input.value && idx < otpInputs.length - 1) {
        otpInputs[idx + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        otpInputs[idx - 1].focus();
      }
    });
  });

  // Pegar código completo
  otpInputs[0]?.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
    [...pasted].slice(0, otpInputs.length).forEach((char, i) => {
      otpInputs[i].value = char;
    });
    const next = Math.min(pasted.length, otpInputs.length - 1);
    otpInputs[next].focus();
  });

  // Al submit: juntar OTP en campo hidden
  const form = document.getElementById('otpForm');
  const otpHidden = document.getElementById('otpHidden');
  form?.addEventListener('submit', () => {
    if (otpHidden) {
      otpHidden.value = [...otpInputs].map(i => i.value).join('');
    }
  });
})();

// ── Tooltips Bootstrap ───────────────────────────────────────
(function () {
  const tooltipEls = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipEls.forEach(el => new bootstrap.Tooltip(el));
})();

// ── Filtro de depósitos en selector de movimientos ───────────
(function () {
  const depSelect = document.getElementById('deposito_destino_id');
  const insSelect = document.getElementById('insecticida_id');
  const lotSelect = document.getElementById('lote_id');
  const cantInput = document.getElementById('cantidad');
  const stockInfo = document.getElementById('stockInfo');

  if (!depSelect || !insSelect) return;

  async function loadStock() {
    const depId = depSelect.value;
    const insId = insSelect.value;

    if (!depId || !insId || !lotSelect) return;

    try {
      const res = await fetch(`/api/stock/${depId}?insecticida_id=${insId}`);
      const data = await res.json();

      lotSelect.innerHTML = '<option value="">Seleccionar lote...</option>';

      if (data.lotes && data.lotes.length) {
        data.lotes.forEach(lote => {
          const opt = document.createElement('option');
          opt.value = lote.id;
          opt.textContent = `${lote.codigo_lote} — Stock: ${parseFloat(lote.stock_actual).toFixed(2)} ${lote.unidad_medida} | Vence: ${new Date(lote.fecha_vencimiento).toLocaleDateString('es-PY')}`;
          opt.dataset.stock = lote.stock_actual;
          lotSelect.appendChild(opt);
        });
      }

      if (stockInfo) {
        stockInfo.innerHTML = data.lotes.length
          ? `<i class="bi bi-info-circle me-1"></i>${data.lotes.length} lote(s) disponible(s)`
          : '<i class="bi bi-exclamation-triangle me-1"></i>Sin stock disponible para este insecticida';
      }
    } catch (err) {
      console.error('Error cargando stock:', err);
    }
  }

  // Validar cantidad vs stock disponible
  lotSelect?.addEventListener('change', function () {
    const selectedOpt = this.options[this.selectedIndex];
    const maxStock = parseFloat(selectedOpt.dataset.stock || 0);

    if (cantInput && maxStock > 0) {
      cantInput.max = maxStock;
      const hint = document.getElementById('stockHint');
      if (hint) hint.textContent = `Disponible: ${maxStock.toFixed(2)}`;
    }
  });

  // Escuchar cambios
  const origenSelect = document.getElementById('deposito_origen_id');
  origenSelect?.addEventListener('change', loadStock);
  insSelect.addEventListener('change', loadStock);
})();

// ── Formateo de números en inputs ───────────────────────────
document.querySelectorAll('input[type="number"][step="0.001"]').forEach(input => {
  input.addEventListener('blur', () => {
    if (input.value) {
      input.value = parseFloat(input.value).toFixed(3);
    }
  });
});

// ── Confirmar anulación de movimiento ───────────────────────
document.querySelectorAll('.btn-anular-movimiento').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const num = btn.dataset.numero || 'este movimiento';
    if (!confirm(`¿Confirmar la anulación de ${num}? Esta acción revertirá el stock y no puede deshacerse.`)) {
      e.preventDefault();
    }
  });
});

// ── Imprimir zona específica ─────────────────────────────────
window.imprimirReporte = function () {
  window.print();
};
