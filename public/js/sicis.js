/* ============================================================
   SICIS - JavaScript principal
   ============================================================ */

'use strict';

function setSidebarActive(path = window.location.pathname) {
  document.querySelectorAll('.sidebar-nav-item a, .sidebar-nav .nav-item, .sidebar-footer .nav-item').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href === '/auth/logout') return;

    const isActive = href === '/dashboard'
      ? path === '/dashboard'
      : href !== '/' && path.startsWith(href);

    link.classList.toggle('active', isActive);

    const group = link.closest('.nav-group');
    if (group && isActive) group.open = true;
  });
}

function initOtpInputs(root = document) {
  const otpInputs = root.querySelectorAll('.otp-input');
  if (!otpInputs.length || otpInputs[0].dataset.sicisOtpBound) return;

  otpInputs.forEach((input, idx) => {
    input.dataset.sicisOtpBound = 'true';

    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 1);
      if (input.value && idx < otpInputs.length - 1) otpInputs[idx + 1].focus();
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !input.value && idx > 0) otpInputs[idx - 1].focus();
    });
  });

  otpInputs[0]?.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasted = (event.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
    [...pasted].slice(0, otpInputs.length).forEach((char, index) => {
      otpInputs[index].value = char;
    });
    otpInputs[Math.min(pasted.length, otpInputs.length - 1)].focus();
  });

  const form = root.querySelector('#otpForm');
  const otpHidden = root.querySelector('#otpHidden');
  form?.addEventListener('submit', () => {
    if (otpHidden) otpHidden.value = [...otpInputs].map(input => input.value).join('');
  });
}

function initMovimientoStock(root = document) {
  const depSelect = root.querySelector('#deposito_destino_id');
  const insSelect = root.querySelector('#insecticida_id');
  const lotSelect = root.querySelector('#lote_id');
  const cantInput = root.querySelector('#cantidad');
  const stockInfo = root.querySelector('#stockInfo');

  if (!depSelect || !insSelect || insSelect.dataset.sicisStockBound) return;
  insSelect.dataset.sicisStockBound = 'true';

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
          opt.textContent = `${lote.codigo_lote} - Stock: ${parseFloat(lote.stock_actual).toFixed(2)} ${lote.unidad_medida} | Vence: ${new Date(lote.fecha_vencimiento).toLocaleDateString('es-PY')}`;
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

  lotSelect?.addEventListener('change', function () {
    const selectedOpt = this.options[this.selectedIndex];
    const maxStock = parseFloat(selectedOpt.dataset.stock || 0);

    if (cantInput && maxStock > 0) {
      cantInput.max = maxStock;
      const hint = root.querySelector('#stockHint');
      if (hint) hint.textContent = `Disponible: ${maxStock.toFixed(2)}`;
    }
  });

  const origenSelect = root.querySelector('#deposito_origen_id');
  origenSelect?.addEventListener('change', loadStock);
  insSelect.addEventListener('change', loadStock);
}

function initSicisContent(root = document) {
  root.querySelectorAll('.alert-dismissible.fade.show:not([data-sicis-alert-bound])').forEach(alert => {
    alert.dataset.sicisAlertBound = 'true';
    if (alert.classList.contains('alert-danger') || alert.classList.contains('alert-warning')) return;

    setTimeout(() => {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
      bsAlert?.close();
    }, 5000);
  });

  root.querySelectorAll('[data-confirm]:not([data-sicis-confirm-bound])').forEach(el => {
    el.dataset.sicisConfirmBound = 'true';
    el.addEventListener('click', function (event) {
      if (!confirm(this.dataset.confirm)) {
        event.preventDefault();
        return false;
      }
    });
  });

  root.querySelectorAll('[data-bs-toggle="tooltip"]:not([data-sicis-tooltip-bound])').forEach(el => {
    el.dataset.sicisTooltipBound = 'true';
    new bootstrap.Tooltip(el);
  });

  root.querySelectorAll('input[type="number"][step="0.001"]:not([data-sicis-number-bound])').forEach(input => {
    input.dataset.sicisNumberBound = 'true';
    input.addEventListener('blur', () => {
      if (input.value) input.value = parseFloat(input.value).toFixed(3);
    });
  });

  root.querySelectorAll('.btn-anular-movimiento:not([data-sicis-anular-bound])').forEach(btn => {
    btn.dataset.sicisAnularBound = 'true';
    btn.addEventListener('click', (event) => {
      const num = btn.dataset.numero || 'este movimiento';
      if (!confirm(`Confirmar la anulacion de ${num}? Esta accion revertira el stock y no puede deshacerse.`)) {
        event.preventDefault();
      }
    });
  });

  initOtpInputs(root);
  initMovimientoStock(root);
  setSidebarActive();
}

function initSidebarShell() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggleBtn = document.getElementById('sidebarToggle');
  const closeBtn = document.getElementById('sidebarClose');

  function openSidebar() {
    sidebar?.classList.add('open');
    overlay?.classList.add('open');
  }

  function closeSidebar() {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('open');
  }

  toggleBtn?.addEventListener('click', openSidebar);
  closeBtn?.addEventListener('click', closeSidebar);
  overlay?.addEventListener('click', closeSidebar);

  sidebar?.addEventListener('click', (event) => {
    if (event.target.closest('a') && window.innerWidth < 992) closeSidebar();
  });
}

function initTopbarClock() {
  const clockEl = document.getElementById('topbarClock');
  if (!clockEl) return;

  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('es-PY', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  updateClock();
  setInterval(updateClock, 1000);
}

function initPartialNavigation() {
  const parser = new DOMParser();

  function shouldHandleLink(link, event) {
    if (!link || event.defaultPrevented || event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.target && link.target !== '_self') return false;
    if (link.hasAttribute('download') || link.dataset.fullReload === 'true') return false;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;

    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return false;
    if (url.pathname.startsWith('/auth/')) return false;
    if (url.pathname.startsWith('/api/')) return false;
    if (url.searchParams.get('formato') === 'imprimir') return false;

    return true;
  }

  async function executeContentScripts(container) {
    const scripts = [...container.querySelectorAll('script')];
    for (const oldScript of scripts) {
      const newScript = document.createElement('script');
      [...oldScript.attributes].forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.async = false;
      newScript.textContent = oldScript.textContent;

      await new Promise(resolve => {
        if (newScript.src) {
          newScript.onload = resolve;
          newScript.onerror = resolve;
        } else {
          resolve();
        }
        oldScript.replaceWith(newScript);
      });
    }
  }

  async function loadPage(url, push = true) {
    const main = document.querySelector('.content-area');
    if (!main) {
      window.location.href = url.href;
      return;
    }

    document.body.classList.add('is-page-loading');

    try {
      const res = await fetch(url.href, {
        headers: { 'X-Requested-With': 'fetch', 'Accept': 'text/html' },
        credentials: 'same-origin'
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('text/html')) {
        window.location.href = url.href;
        return;
      }

      const html = await res.text();
      const doc = parser.parseFromString(html, 'text/html');
      const nextMain = doc.querySelector('.content-area');
      const nextTitle = doc.querySelector('.page-title');

      if (!nextMain) {
        window.location.href = url.href;
        return;
      }

      main.innerHTML = nextMain.innerHTML;

      const pageTitle = document.querySelector('.page-title');
      if (pageTitle && nextTitle) pageTitle.textContent = nextTitle.textContent;
      if (doc.title) document.title = doc.title;

      if (push) history.pushState({}, doc.title || '', url.href);

      setSidebarActive(url.pathname);
      initSicisContent(main);
      await executeContentScripts(main);
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (err) {
      console.error('Error cargando vista parcial:', err);
      window.location.href = url.href;
    } finally {
      document.body.classList.remove('is-page-loading');
    }
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!shouldHandleLink(link, event)) return;

    event.preventDefault();
    loadPage(new URL(link.href), true);
  });

  window.addEventListener('popstate', () => {
    loadPage(new URL(window.location.href), false);
  });

  window.sicisNavigate = (href) => loadPage(new URL(href, window.location.href), true);
}

window.imprimirReporte = function () {
  window.print();
};

initSidebarShell();
initTopbarClock();
initPartialNavigation();
initSicisContent(document);
