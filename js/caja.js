/* =========================================================
   CAJA - Libro de dinero: entra, sale y cuánto queda
   Movimientos AUTOMÁTICOS (no se editan aquí):
     + Ventas de contado
     + Pagos y abonos de fiados
     - Compras de mercancía
   Movimientos MANUALES (colección "movimientos"):
     ingresos (saldo inicial, otros) y gastos
   Cada movimiento tiene su moneda ('BS' o 'USD'); el saldo
   se lleva por separado en Bs y en $.
   ========================================================= */

const Caja = {
  gastosBase: ['Transporte', 'Servicios', 'Alquiler', 'Comida', 'Personal', 'Otros'],
  ingresosBase: ['Saldo inicial', 'Aporte', 'Otros'],

  // Todos los movimientos juntos, del más nuevo al más viejo
  movimientos() {
    const m = [];
    const mon = x => (x === 'BS' ? 'BS' : 'USD');

    Store.all('movimientos').forEach(x => m.push({ ...x, auto: false }));

    Store.all('ventas').forEach(v => {
      const moneda = mon(v.moneda);
      if (!v.fiado) {
        m.push({
          id: 'v' + v.id, tipo: 'ingreso', auto: true, categoria: 'Ventas',
          concepto: `Venta: ${v.nombre} × ${Inventario.q(v.cantidad)}`,
          monto: moneda === 'BS' ? v.precioOrig * v.cantidad : v.total,
          moneda, fecha: v.fecha, creado: v.creado
        });
      }
      (v.abonos || []).forEach((a, i) => m.push({
        id: `a${v.id}-${i}`, tipo: 'ingreso', auto: true, categoria: 'Cobros de fiados',
        concepto: `Cobro: ${v.cliente} (${v.nombre})`,
        monto: a.monto, moneda: mon(a.moneda), fecha: a.fecha, creado: v.creado
      }));
    });

    Store.all('deudas').forEach(d => (d.abonos || []).forEach((a, i) => m.push({
      id: `d${d.id}-${i}`, tipo: 'ingreso', auto: true, categoria: 'Cobros de fiados',
      concepto: `Cobro: ${d.cliente}${d.concepto ? ' (' + d.concepto + ')' : ''}`,
      monto: a.monto, moneda: mon(a.moneda), fecha: a.fecha, creado: d.creado
    })));

    Store.all('productos').forEach(p => m.push({
      id: 'p' + p.id, tipo: 'gasto', auto: true, categoria: 'Mercancía',
      concepto: `Compra: ${p.nombre}`,
      monto: p.costoOriginal ?? p.costoTotal ?? p.cantidad * p.costo,
      moneda: mon(p.costoMoneda), fecha: p.fecha, creado: p.creado
    }));

    return m.sort((a, b) =>
      (b.fecha || '').localeCompare(a.fecha || '') || (b.creado || '').localeCompare(a.creado || ''));
  },

  saldo(movs) {
    const s = { BS: 0, USD: 0 };
    movs.forEach(m => { s[m.moneda] += m.tipo === 'ingreso' ? m.monto : -m.monto; });
    return s;
  },

  // Cualquier monto expresado en bolívares (con la tasa de hoy)
  eqBs(m) { return m.moneda === 'BS' ? m.monto : Tasa.toBs(m.monto); },

  fmt(monto, moneda) { return moneda === 'BS' ? Utils.bs(monto) : Utils.usd(monto); },

  desde(periodo) {
    const d = new Date();
    if (periodo === 'hoy') return Utils.toISODate(d);
    if (periodo === 'semana') { d.setDate(d.getDate() - 6); return Utils.toISODate(d); }
    if (periodo === 'mes') return Utils.toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
    return '0000-00-00';
  },

  /* ---------- Formulario de ingreso / gasto manual ---------- */
  form(tipo) {
    const esGasto = tipo === 'gasto';
    const usadas = Store.all('movimientos').filter(m => m.tipo === tipo).map(m => m.categoria);
    const cats = [...new Set([...(esGasto ? this.gastosBase : this.ingresosBase), ...usadas])];

    const html = `
      <form class="form" id="mov-form" autocomplete="off">
        <div class="field">
          <label>${esGasto ? '¿En qué se gastó?' : 'Concepto del ingreso'}</label>
          <input name="concepto" type="text" placeholder="${esGasto ? 'Ej: Pasaje, bolsas, hielo' : 'Ej: Saldo inicial'}">
        </div>
        <div class="field">
          <label>Categoría</label>
          <input name="categoria" type="text" list="lista-cat-mov" placeholder="Elige o escribe una nueva">
          <datalist id="lista-cat-mov">${cats.map(c => `<option value="${Utils.esc(c)}">`).join('')}</datalist>
        </div>
        <div class="field">
          <label>Monto</label>
          <div class="input-group">
            <input name="monto" type="text" inputmode="decimal" placeholder="0,00">
            <select name="moneda"><option value="BS">Bs</option><option value="USD">$</option></select>
          </div>
        </div>
        <div class="field">
          <label>Fecha</label>
          <input name="fecha" type="date" value="${Utils.today()}">
        </div>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="check"></i> Guardar</button>
      </form>`;

    UI.openModal(esGasto ? 'Registrar gasto' : 'Registrar ingreso', html, body => {
      const f = body.querySelector('#mov-form');
      f.addEventListener('submit', e => {
        e.preventDefault();
        const monto = Utils.num(f.monto.value);
        const concepto = f.concepto.value.trim();
        if (!concepto) return UI.toast('Escribe el concepto', 'error');
        if (monto <= 0) return UI.toast('Escribe el monto', 'error');
        Store.add('movimientos', {
          tipo, concepto,
          categoria: f.categoria.value.trim() || 'Otros',
          monto, moneda: f.moneda.value,
          fecha: f.fecha.value || Utils.today()
        });
        UI.closeModal();
        UI.toast(esGasto ? 'Gasto registrado' : 'Ingreso registrado');
      });
    });
  }
};

Modules.caja = {
  periodo: 'mes',

  render(container) {
    const todos = Caja.movimientos();
    const s = Caja.saldo(todos);
    const totalBs = s.BS + Tasa.toBs(s.USD);

    const desde = Caja.desde(this.periodo);
    const delPeriodo = todos.filter(m => (m.fecha || '') >= desde);
    const ing = delPeriodo.filter(m => m.tipo === 'ingreso');
    const gas = delPeriodo.filter(m => m.tipo === 'gasto');
    const sumaBs = arr => arr.reduce((a, m) => a + Caja.eqBs(m), 0);
    const desglose = arr => {
      const t = Caja.saldo(arr.map(m => ({ ...m, tipo: 'ingreso' })));
      return [t.USD ? Utils.usd(t.USD) : '', t.BS ? Utils.bs(t.BS) : ''].filter(Boolean).join(' + ') || '—';
    };

    // Gastos por categoría
    const porCat = {};
    gas.forEach(m => { porCat[m.categoria || 'Otros'] = (porCat[m.categoria || 'Otros'] || 0) + Caja.eqBs(m); });
    const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
    const totalGas = sumaBs(gas);

    const etiqueta = { hoy: 'de hoy', semana: 'de los últimos 7 días', mes: 'de este mes', todo: 'en total' }[this.periodo];

    container.innerHTML = `
      <div class="grid grid-3">
        <div class="card stat">
          <div class="stat-icon"><i data-lucide="wallet"></i></div>
          <span class="stat-label">Saldo en bolívares</span>
          <span class="stat-value ${s.BS < 0 ? 'negative' : ''}">${Utils.bs(s.BS)}</span>
        </div>
        <div class="card stat">
          <div class="stat-icon"><i data-lucide="dollar-sign"></i></div>
          <span class="stat-label">Saldo en dólares</span>
          <span class="stat-value ${s.USD < 0 ? 'negative' : ''}">${Utils.usd(s.USD)}</span>
        </div>
        <div class="card stat">
          <div class="stat-icon"><i data-lucide="piggy-bank"></i></div>
          <span class="stat-label">Total en Bs (tasa de hoy)</span>
          <span class="stat-value ${totalBs < 0 ? 'negative' : 'positive'}">${Utils.bs(totalBs)}</span>
          <span class="stat-sub">≈ ${Utils.usd(Tasa.toUsd(totalBs))}</span>
        </div>
      </div>

      <div class="toolbar mt">
        <button class="btn btn-primary" data-action="ingreso"><i data-lucide="plus"></i> Ingreso</button>
        <button class="btn btn-danger" data-action="gasto"><i data-lucide="minus"></i> Gasto</button>
        <span class="spacer"></span>
        <select id="f-per">
          <option value="hoy" ${this.periodo === 'hoy' ? 'selected' : ''}>Hoy</option>
          <option value="semana" ${this.periodo === 'semana' ? 'selected' : ''}>Últimos 7 días</option>
          <option value="mes" ${this.periodo === 'mes' ? 'selected' : ''}>Este mes</option>
          <option value="todo" ${this.periodo === 'todo' ? 'selected' : ''}>Todo</option>
        </select>
      </div>

      <div class="grid grid-2">
        <div class="card stat">
          <span class="stat-label">Entró ${etiqueta}</span>
          <span class="stat-value positive">${Utils.bs(sumaBs(ing))}</span>
          <span class="stat-sub">${desglose(ing)}</span>
        </div>
        <div class="card stat">
          <span class="stat-label">Salió ${etiqueta}</span>
          <span class="stat-value negative">${Utils.bs(totalGas)}</span>
          <span class="stat-sub">${desglose(gas)}</span>
        </div>
      </div>

      <div class="card mt">
        <div class="card-title">¿En qué se gastó? <span class="muted" style="font-weight:500;font-size:.8rem">(${etiqueta}, en Bs)</span></div>
        ${cats.length ? cats.map(([c, v]) => `
          <div class="cat-row">
            <div class="row-between"><b>${Utils.esc(c)}</b><span>${Utils.bs(v)} · ${Utils.fmt(totalGas ? (v / totalGas) * 100 : 0, 0)}%</span></div>
            <div class="progress"><span style="width:${totalGas ? (v / totalGas) * 100 : 0}%"></span></div>
          </div>`).join('') : '<p class="muted">No hay gastos en este período.</p>'}
      </div>

      <div class="card mt">
        <div class="card-title">Movimientos</div>
        ${delPeriodo.length ? `<div>${delPeriodo.slice(0, 150).map(m => this.fila(m)).join('')}</div>`
          : '<p class="muted">No hay movimientos en este período.</p>'}
      </div>
    `;

    container.onclick = e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'ingreso' || a === 'gasto') Caja.form(a);
      if (a === 'borrar' && UI.confirm('¿Borrar este movimiento?')) {
        Store.remove('movimientos', btn.dataset.id);
        UI.toast('Movimiento borrado');
      }
    };

    container.onchange = e => {
      if (e.target.id === 'f-per') { this.periodo = e.target.value; this.render(container); UI.icons(); }
    };
  },

  fila(m) {
    const entra = m.tipo === 'ingreso';
    const otra = m.moneda === 'BS' ? Utils.usd(Tasa.toUsd(m.monto)) : Utils.bs(Tasa.toBs(m.monto));
    return `
      <div class="mov">
        <div class="mov-icon ${entra ? 'in' : 'out'}"><i data-lucide="${entra ? 'arrow-down-left' : 'arrow-up-right'}"></i></div>
        <div class="mov-info">
          <b>${Utils.esc(m.concepto)}</b>
          <span>${Utils.formatDate(m.fecha)} · ${Utils.esc(m.categoria || 'Otros')}${m.auto ? ' · automático' : ''}</span>
        </div>
        <div class="mov-amount ${entra ? 'in' : 'out'}">
          ${entra ? '+' : '−'} ${Caja.fmt(m.monto, m.moneda)}
          <small>≈ ${otra}</small>
        </div>
        ${m.auto ? '' : `<button class="icon-btn" data-action="borrar" data-id="${m.id}" aria-label="Borrar"><i data-lucide="trash-2"></i></button>`}
      </div>`;
  }
};