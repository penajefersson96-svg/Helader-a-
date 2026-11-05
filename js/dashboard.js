/* =========================================================
   DASHBOARD - Pantalla de Inicio
   Resumen del día y del mes, avisos, gráfico de la semana
   y respaldo de los datos.
   ========================================================= */

Modules.dashboard = {

  render(container) {
    const hoy = Utils.today();
    const ventas = Store.all('ventas');
    const productos = Store.all('productos');
    const suma = (arr, fn) => arr.reduce((a, x) => a + fn(x), 0);
    const gan = v => v.total - v.cantidad * v.costoUnit;

    // Hoy
    const deHoy = ventas.filter(v => v.fecha === hoy);
    const totalHoy = suma(deHoy, v => v.total);
    const ganHoy = suma(deHoy, gan);

    // Este mes: ganancia de ventas menos gastos manuales y pérdidas (sin contar la compra de mercancía)
    const mesDesde = Caja.desde('mes');
    const ganMes = suma(ventas.filter(v => v.fecha >= mesDesde), gan);
    const gastosMes = suma(
      Store.all('movimientos').filter(m => m.tipo === 'gasto' && m.fecha >= mesDesde && m.categoria !== 'Ajuste de caja'),
      m => (m.moneda === 'BS' ? Tasa.toUsd(m.monto) : m.monto)
    );
    const perdidasMes = suma(Store.all('mermas').filter(m => m.fecha >= mesDesde), m => m.costo);
    const neta = ganMes - gastosMes - perdidasMes;
    const nombreMes = new Date().toLocaleDateString('es-VE', { month: 'long' });

    // Caja y fiados
    const saldo = Caja.saldo(Caja.movimientos());
    const saldoBs = saldo.BS + Tasa.toBs(saldo.USD);
    const deudas = Fiados.lista().filter(i => !i.pagado);
    const porCobrar = suma(deudas, i => Fiados.eqUsd(i.pendiente, i.moneda));
    const urgentes = deudas.filter(i => i.dias <= 3)
      .sort((a, b) => a.fechaPago.localeCompare(b.fechaPago)).slice(0, 5);

    // Poco stock (agrupado por nombre, por si hay varias compras del mismo producto)
    const grupos = {};
    productos.forEach(p => {
      const s = Inventario.stats(p, ventas);
      const k = Inventario.norm(p.nombre.trim());
      const g = grupos[k] || (grupos[k] = { nombre: p.nombre, restante: 0, maxLote: 0 });
      g.restante += Math.max(s.restante, 0);
      g.maxLote = Math.max(g.maxLote, p.cantidad);
    });
    const bajos = Object.values(grupos)
      .filter(g => g.restante > 0 && g.restante <= g.maxLote * 0.2)
      .sort((a, b) => a.restante - b.restante).slice(0, 5);

    // Últimos 7 días
    const dias = [];
    const nombresDia = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = Utils.toISODate(d);
      dias.push({
        iso, label: nombresDia[d.getDay()],
        total: suma(ventas.filter(v => v.fecha === iso), v => v.total),
        hoy: i === 0
      });
    }
    const maxDia = Math.max(...dias.map(d => d.total), 1);

    // Avisos de tasa y respaldo
    const tasa = Store.getTasa();
    const tasaVieja = !(tasa.valor > 0) || tasa.fecha !== hoy;
    const ultimo = Store.get('ultimoRespaldo', null);
    const diasSinRespaldo = ultimo ? -Utils.daysUntil(ultimo) : null;
    const respaldoPendiente = productos.length + ventas.length > 0 && (ultimo === null || diasSinRespaldo >= 7);

    container.innerHTML = `
      ${tasaVieja ? `
        <div class="card" style="background:var(--warning-soft);border-color:#fde68a;margin-bottom:16px">
          <div class="row-between">
            <b>${tasa.valor > 0 ? 'La tasa BCV no está actualizada hoy' : 'Aún no has guardado la tasa BCV'}</b>
            <button class="btn btn-primary btn-sm" data-go="calculadora"><i data-lucide="refresh-cw"></i> Actualizar</button>
          </div>
        </div>` : ''}

      <div class="row" style="margin-bottom:16px">
        <button class="btn btn-primary" data-action="venta"><i data-lucide="shopping-cart"></i> Nueva venta</button>
        <button class="btn btn-soft" data-action="gasto"><i data-lucide="minus-circle"></i> Registrar gasto</button>
        <button class="btn btn-soft" data-action="mercancia"><i data-lucide="package-plus"></i> Agregar mercancía</button>
        <button class="btn btn-soft" data-action="cierre"><i data-lucide="calendar-check"></i> Cerrar el día</button>
        <button class="btn btn-soft" data-action="reportes"><i data-lucide="bar-chart-3"></i> Reportes</button>
        <button class="btn btn-soft" data-action="ajustes"><i data-lucide="settings"></i> Mi negocio</button>
      </div>

      <div class="grid grid-4">
        ${this.stat('shopping-bag', 'Vendido hoy', Utils.usd(totalHoy), Utils.bs(Tasa.toBs(totalHoy)))}
        ${this.stat('trending-up', 'Ganancia de hoy', Utils.usd(ganHoy), Utils.bs(Tasa.toBs(ganHoy)), ganHoy >= 0 ? 'positive' : 'negative')}
        ${this.stat('piggy-bank', 'Dinero en caja', Utils.bs(saldoBs), '≈ ' + Utils.usd(Tasa.toUsd(saldoBs)), saldoBs >= 0 ? '' : 'negative')}
        ${this.stat('handshake', 'Te deben', Utils.usd(porCobrar), Utils.bs(Tasa.toBs(porCobrar)))}
      </div>

      <div class="grid grid-split mt">
        <div class="card">
          <div class="card-title">Ventas de los últimos 7 días</div>
          <div class="bars">
            ${dias.map(d => `
              <div class="bar-col ${d.hoy ? 'today' : ''}">
                <span class="bar-val">${d.total ? Utils.fmt(d.total, 0) : ''}</span>
                <div class="bar-track"><div class="bar" style="height:${(d.total / maxDia) * 100}%"></div></div>
                <span class="bar-day">${d.label}</span>
              </div>`).join('')}
          </div>
          <div class="muted" style="font-size:.76rem;margin-top:8px">Montos en dólares</div>
        </div>

        <div class="card">
          <div class="card-title">Ganancia de ${nombreMes}</div>
          <div class="stack" style="gap:10px">
            <div class="row-between"><span class="muted">Ganancia en ventas</span><b>${Utils.usd(ganMes)}</b></div>
            <div class="row-between"><span class="muted">Gastos (sin contar mercancía)</span><b>− ${Utils.usd(gastosMes)}</b></div>
            <div class="row-between"><span class="muted">Pérdidas (mermas)</span><b>− ${Utils.usd(perdidasMes)}</b></div>
            <div class="row-between" style="border-top:1px dashed var(--border);padding-top:10px">
              <b>Ganancia neta</b>
              <b class="profit ${neta >= 0 ? 'positive' : 'negative'}">${Utils.usd(neta)}</b>
            </div>
            <div class="muted" style="font-size:.78rem;text-align:right">${Utils.bs(Tasa.toBs(neta))}</div>
          </div>
        </div>
      </div>

      <div class="grid grid-split mt">
        <div class="card">
          <div class="row-between" style="margin-bottom:6px">
            <div class="card-title" style="margin:0">Cobros pendientes</div>
            <button class="btn btn-soft btn-sm" data-go="fiados">Ver todos</button>
          </div>
          ${urgentes.length ? urgentes.map(i => `
            <div class="mov">
              <div class="mov-info">
                <b>${Utils.esc(i.cliente)}</b>
                <span>${Utils.esc(i.concepto)}</span>
              </div>
              <div class="mov-amount">
                ${Fiados.fmt(i.pendiente, i.moneda)}
                <small>${Modules.fiados.estadoBadge(i)}</small>
              </div>
            </div>`).join('') : '<p class="muted">No hay cobros que venzan en los próximos 3 días.</p>'}
        </div>

        <div class="card">
          <div class="row-between" style="margin-bottom:6px">
            <div class="card-title" style="margin:0">Se está acabando</div>
            <button class="btn btn-soft btn-sm" data-go="inventario">Ver mercancía</button>
          </div>
          ${bajos.length ? bajos.map(g => `
            <div class="mov">
              <div class="mov-info"><b>${Utils.esc(g.nombre)}</b></div>
              <span class="badge badge-warning">Quedan ${Inventario.q(g.restante)}</span>
            </div>`).join('') : '<p class="muted">Nada se está acabando por ahora.</p>'}
        </div>
      </div>

      <div class="card mt" ${respaldoPendiente ? 'style="border-color:#fde68a"' : ''}>
        <div class="card-title">Respaldo de tus datos</div>
        <p class="muted" style="font-size:.88rem;margin-bottom:12px">
          Tus datos se guardan solo en este navegador. Si borras los datos del navegador o cambias de teléfono,
          se pierden. Descarga un respaldo cada semana.
          ${ultimo ? `<br>Último respaldo: <b>${Utils.formatDate(ultimo)}</b>` : '<br><b>Todavía no has hecho ningún respaldo.</b>'}
        </p>
        <div class="row">
          <button class="btn btn-primary" data-action="respaldar"><i data-lucide="download"></i> Descargar respaldo</button>
          <button class="btn btn-soft" data-action="compartir"><i data-lucide="share-2"></i> Compartir</button>
          <label class="btn btn-soft" style="cursor:pointer">
            <i data-lucide="upload"></i> Restaurar
<input type="file" id="imp-file" accept=".json,.txt,application/json,text/plain" hidden>
          </label>
        </div>
      </div>
    `;

    container.onclick = e => {
      const go = e.target.closest('[data-go]');
      if (go) return App.go(go.dataset.go);
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'venta') Ventas.openSale();
      if (a === 'gasto') Caja.form('gasto');
      if (a === 'mercancia') Modules.inventario.form('nuevo');
      if (a === 'cierre') Cierre.abrir();
      if (a === 'reportes') App.go('reportes');
      if (a === 'ajustes') Ajustes.abrir();
      if (a === 'respaldar') this.respaldo(false);
      if (a === 'compartir') this.respaldo(true);
    };

    container.onchange = e => {
      if (e.target.id === 'imp-file' && e.target.files[0]) {
        this.restaurar(e.target.files[0]);
        e.target.value = '';
      }
    };
  },

  stat(icon, label, value, sub, tone = '') {
    return `
      <div class="card stat">
        <div class="stat-icon"><i data-lucide="${icon}"></i></div>
        <span class="stat-label">${label}</span>
        <span class="stat-value ${tone}">${value}</span>
        <span class="stat-sub">${sub}</span>
      </div>`;
  },

  /* ---------- Respaldo ---------- */
    respaldo(compartir) {
    const json = Store.exportAll();
    const base = `respaldo-heladeria-${Utils.today()}`;
    const marcar = () => Store.set('ultimoRespaldo', Utils.today());
    
    const descargar = () => {
      const file = new File([json], base + '.json', { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      marcar();
      UI.toast('Respaldo descargado');
    };
    
    if (!compartir) return descargar();
    
    // Para compartir se usa .txt: los navegadores lo permiten, pero suelen bloquear .json
    const file = new File([json], base + '.txt', { type: 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Respaldo Mi Heladería' })
        .then(marcar)
        .catch(err => {
          if (err && err.name !== 'AbortError') {
            UI.toast('No se pudo compartir. Se descargará.', 'error');
            descargar();
          }
        });
    } else {
      UI.toast('Tu navegador no permite compartir. Se descargará.', 'error');
      descargar();
    }
  },

    restaurar(file) {
    if (!Seguridad.dueno()) return UI.toast('Solo el dueño puede restaurar', 'error');
    if (file.size > 8 * 1024 * 1024) return UI.toast('Ese archivo es demasiado grande para ser un respaldo', 'error');
    
    const lector = new FileReader();
    lector.onload = () => {
      const texto = String(lector.result);
      const r = Store.validarRespaldo(texto); // se revisa ANTES de tocar nada
      if (r.error) return UI.toast(r.error, 'error');
      
      if (!UI.confirm('Esto reemplaza los datos actuales por los del respaldo. Antes se descargará una copia de lo que tienes ahora. ¿Continuar?')) return;
      
      this.respaldo(false); // copia de lo actual, por si acaso
      const res = Store.importAll(texto);
      if (res && res.error) UI.toast(res.error, 'error');
      else UI.toast('Datos restaurados');
    };
    lector.readAsText(file);
  }
  };