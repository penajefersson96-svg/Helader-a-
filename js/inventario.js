/* =========================================================
   INVENTARIO - Mercancía, categorías, compras y ganancia
   Cada "producto" es un lote comprado:
   {
     id, nombre, categoria, cantidad, fecha,
     costoTotal (USD, lo pagado por todo el lote), costo (USD por unidad),
     costoMoneda ('USD'|'BS'), costoOriginal, tasaCompra,
     precioMoneda ('USD'|'BS'), precioDetalOrig, precioMayorOrig
   }
   ========================================================= */

const Inventario = {
  categoriasBase: ['Helados', 'Bebidas', 'Snacks', 'Otros'],

  categorias() {
    const set = new Set(this.categoriasBase);
    Store.all('productos').forEach(p => p.categoria && set.add(p.categoria));
    return [...set].sort((a, b) => a.localeCompare(b));
  },

  // Cantidad: sin decimales si es entera, con decimales si no
  q(n) { return Utils.fmt(n, Number.isInteger(n) ? 0 : 2); },

  // Precio al detal en USD (si se puso en Bs, se calcula con la tasa de hoy)
  precioDetal(p) {
    const orig = p.precioDetalOrig ?? p.precio ?? 0;
    return p.precioMoneda === 'BS' ? Tasa.toUsd(orig) : orig;
  },

  // Precio al mayor en USD (si no se puso, usa el del detal)
  precioMayor(p) {
    const orig = p.precioMayorOrig;
    if (!(orig > 0)) return this.precioDetal(p);
    return p.precioMoneda === 'BS' ? Tasa.toUsd(orig) : orig;
  },

  tienePrecioMayor(p) { return p.precioMayorOrig > 0; },

  costoTotal(p) { return p.costoTotal ?? p.cantidad * p.costo; },

  // Números de un lote, calculados con las ventas registradas
  stats(p, ventas) {
    const mias = ventas.filter(v => v.productoId === p.id);
    const vendidos = mias.reduce((a, v) => a + v.cantidad, 0);
    const ingresos = mias.reduce((a, v) => a + v.total, 0);
    const restante = Math.round((p.cantidad - vendidos) * 1000) / 1000;
    const invertido = this.costoTotal(p);
    return {
      vendidos, ingresos, restante, invertido,
      gananciaActual: ingresos - vendidos * p.costo,
      gananciaFinal: ingresos - invertido,
      gananciaEsperada: p.cantidad * (this.precioDetal(p) - p.costo),
      terminado: restante <= 0
    };
  }
};

Modules.inventario = {
  filtroCat: 'todas',
  filtroEstado: 'activos',

  render(container) {
    const productos = Store.all('productos');
    const ventas = Store.all('ventas');
    const data = productos.map(p => ({ p, s: Inventario.stats(p, ventas) }));

    const invertido = data.reduce((a, d) => a + d.s.invertido, 0);
    const ingresos = data.reduce((a, d) => a + d.s.ingresos, 0);
    const ganancia = data.reduce((a, d) => a + d.s.gananciaActual, 0);
    const porVender = data.reduce((a, d) => a + Math.max(d.s.restante, 0) * Inventario.precioDetal(d.p), 0);

    const visibles = data.filter(({ p, s }) =>
      (this.filtroCat === 'todas' || p.categoria === this.filtroCat) &&
      (this.filtroEstado === 'todos' || (this.filtroEstado === 'activos' ? !s.terminado : s.terminado))
    ).reverse();

    container.innerHTML = `
      <div class="grid grid-4">
        ${this.stat('wallet', 'Invertido', Utils.usd(invertido), Utils.bs(Tasa.toBs(invertido)))}
        ${this.stat('banknote', 'Cobrado en ventas', Utils.usd(ingresos), Utils.bs(Tasa.toBs(ingresos)))}
        ${this.stat('trending-up', 'Ganancia de lo vendido', Utils.usd(ganancia), Utils.bs(Tasa.toBs(ganancia)), ganancia >= 0 ? 'positive' : 'negative')}
        ${this.stat('package', 'Mercancía por vender', Utils.usd(porVender), 'a precio al detal')}
      </div>

      <div class="toolbar mt">
        <button class="btn btn-primary" data-action="nuevo"><i data-lucide="plus"></i> Agregar mercancía</button>
        <span class="spacer"></span>
        <select id="f-cat">
          <option value="todas">Todas las categorías</option>
          ${Inventario.categorias().map(c =>
            `<option value="${Utils.esc(c)}" ${c === this.filtroCat ? 'selected' : ''}>${Utils.esc(c)}</option>`).join('')}
        </select>
        <select id="f-estado">
          <option value="activos" ${this.filtroEstado === 'activos' ? 'selected' : ''}>En venta</option>
          <option value="terminados" ${this.filtroEstado === 'terminados' ? 'selected' : ''}>Terminados</option>
          <option value="todos" ${this.filtroEstado === 'todos' ? 'selected' : ''}>Todos</option>
        </select>
      </div>

      ${visibles.length ? `<div class="list">${visibles.map(d => this.card(d)).join('')}</div>` : `
        <div class="card empty">
          <i data-lucide="package-open"></i>
          <p>${productos.length ? 'No hay mercancía con ese filtro.' : 'Aún no has agregado mercancía.'}</p>
        </div>`}
    `;

    container.onclick = e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const p = id ? Store.find('productos', id) : null;
      const accion = btn.dataset.action;
      if (accion === 'nuevo') this.form('nuevo');
      if (accion === 'editar' && p) this.form('editar', p);
      if (accion === 'recomprar' && p) this.form('recomprar', p);
      if (accion === 'vender' && p) Ventas.openSale(p.id);
      if (accion === 'borrar' && p) this.borrar(p);
    };

    container.onchange = e => {
      if (e.target.id === 'f-cat') { this.filtroCat = e.target.value; this.render(container); UI.icons(); }
      if (e.target.id === 'f-estado') { this.filtroEstado = e.target.value; this.render(container); UI.icons(); }
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

  card({ p, s }) {
    const pct = Math.min(100, (s.vendidos / p.cantidad) * 100 || 0);
    const detal = Inventario.precioDetal(p);
    const mayor = Inventario.precioMayor(p);
    const margen = detal - p.costo;
    const margenPct = p.costo > 0 ? (margen / p.costo) * 100 : 0;
    const gan = s.terminado ? s.gananciaFinal : s.gananciaActual;
    const precio = usd => `${Utils.usd(usd)} · ${Utils.bs(Tasa.toBs(usd))}`;

    return `
      <div class="card item">
        <div class="item-head">
          <div>
            <div class="item-name">${Utils.esc(p.nombre)}</div>
            <span class="badge">${Utils.esc(p.categoria || 'Sin categoría')}</span>
          </div>
          ${s.terminado
            ? '<span class="badge badge-success">Lote terminado</span>'
            : `<span class="badge ${s.restante <= p.cantidad * 0.2 ? 'badge-warning' : ''}">Quedan ${Inventario.q(s.restante)}</span>`}
        </div>

        <div>
          <div class="progress"><span style="width:${pct}%"></span></div>
          <div class="item-meta" style="margin-top:6px">
            Vendidos <b>${Inventario.q(s.vendidos)}</b> de <b>${Inventario.q(p.cantidad)}</b>
          </div>
        </div>

        <div class="item-meta" style="flex-direction:column">
          <span>Compra total: <b>${precio(s.invertido)}</b> <small>(${Utils.usd(p.costo)} c/u)</small></span>
          <span>Venta al detal: <b>${precio(detal)}</b></span>
          ${Inventario.tienePrecioMayor(p) ? `<span>Venta al mayor: <b>${precio(mayor)}</b></span>` : ''}
          <span>Ganancia por unidad (detal): <b>${Utils.usd(margen)}</b> · ${Utils.fmt(margenPct, 0)}%</span>
          <span>Comprado el <b>${Utils.formatDate(p.fecha)}</b></span>
        </div>

        <div class="item-foot">
          <div class="profit ${gan >= 0 ? 'positive' : 'negative'}">
            ${Utils.usd(gan)}
            <small>${s.terminado ? 'Ganancia final del lote' : 'Ganancia hasta ahora'}${!s.terminado ? ' · esperada ' + Utils.usd(s.gananciaEsperada) : ''}</small>
          </div>
          <div class="item-actions">
            ${!s.terminado ? `<button class="btn btn-primary btn-sm" data-action="vender" data-id="${p.id}"><i data-lucide="shopping-cart"></i> Vender</button>` : ''}
            <button class="btn btn-soft btn-sm" data-action="recomprar" data-id="${p.id}"><i data-lucide="repeat"></i> Recomprar</button>
            <button class="icon-btn" data-action="editar" data-id="${p.id}" aria-label="Editar"><i data-lucide="pencil"></i></button>
            <button class="icon-btn" data-action="borrar" data-id="${p.id}" aria-label="Borrar"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
      </div>`;
  },

  /* ---------- Formulario: nuevo / editar / recomprar ---------- */
  form(modo, p = {}) {
    const titulos = { nuevo: 'Agregar mercancía', editar: 'Editar mercancía', recomprar: 'Recomprar mercancía' };
    const limpio = n => (n === undefined || n === null || n === '') ? '' : Utils.esc(+Number(n).toFixed(4));
    const txt = k => (p[k] !== undefined && p[k] !== null ? Utils.esc(p[k]) : '');

    const costoMoneda = p.costoMoneda || 'USD';
    const precioMoneda = p.precioMoneda || 'USD';
    const costoMonto = modo === 'recomprar' ? '' : limpio(p.costoOriginal ?? (p.costo ? p.cantidad * p.costo : ''));
    const detalOrig = limpio(p.precioDetalOrig ?? p.precio);
    const mayorOrig = limpio(p.precioMayorOrig);
    const sel = (a, b) => a === b ? 'selected' : '';

    const html = `
      <form class="form" id="prod-form" autocomplete="off">
        <div class="field">
          <label>Nombre</label>
          <input name="nombre" type="text" placeholder="Ej: Helado de vainilla" value="${txt('nombre')}">
        </div>
        <div class="field">
          <label>Categoría</label>
          <input name="categoria" type="text" list="lista-cats" placeholder="Elige o escribe una nueva" value="${txt('categoria')}">
          <datalist id="lista-cats">
            ${Inventario.categorias().map(c => `<option value="${Utils.esc(c)}">`).join('')}
          </datalist>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Cantidad que compraste</label>
            <input name="cantidad" type="text" inputmode="decimal" placeholder="Ej: 50"
                   value="${modo === 'recomprar' ? '' : txt('cantidad')}">
          </div>
          <div class="field">
            <label>Fecha de compra</label>
            <input name="fecha" type="date" value="${modo === 'editar' ? txt('fecha') : Utils.today()}">
          </div>
        </div>

        <div class="field">
          <label>Total que pagaste por toda la compra</label>
          <div class="input-group">
            <input name="costoTotal" type="text" inputmode="decimal" placeholder="0,00" value="${costoMonto}">
            <select name="costoMoneda">
              <option value="USD" ${sel(costoMoneda, 'USD')}>$</option>
              <option value="BS" ${sel(costoMoneda, 'BS')}>Bs</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Los precios de venta están en</label>
          <select name="precioMoneda">
            <option value="USD" ${sel(precioMoneda, 'USD')}>Dólares ($)</option>
            <option value="BS" ${sel(precioMoneda, 'BS')}>Bolívares (Bs)</option>
          </select>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Precio al detal (c/u)</label>
            <input name="detal" type="text" inputmode="decimal" placeholder="0,00" value="${detalOrig}">
          </div>
          <div class="field">
            <label>Precio al mayor (c/u)</label>
            <input name="mayor" type="text" inputmode="decimal" placeholder="Opcional" value="${mayorOrig}">
          </div>
        </div>

        <div class="preview" id="prod-preview"></div>

        <button type="submit" class="btn btn-primary btn-block">
          <i data-lucide="check"></i> Guardar
        </button>
      </form>`;

    UI.openModal(titulos[modo], html, body => {
      const f = body.querySelector('#prod-form');
      const prev = body.querySelector('#prod-preview');

      const aUsd = (monto, moneda) => {
        const t = Tasa.valor();
        return moneda === 'BS' ? (t > 0 ? monto / t : 0) : monto;
      };

      const actualizar = () => {
        const cant = Utils.num(f.cantidad.value);
        const costoUsd = aUsd(Utils.num(f.costoTotal.value), f.costoMoneda.value);
        const detal = aUsd(Utils.num(f.detal.value), f.precioMoneda.value);
        const mayor = aUsd(Utils.num(f.mayor.value), f.precioMoneda.value);
        const unit = cant > 0 ? costoUsd / cant : 0;
        const sinTasa = Tasa.valor() <= 0 && (f.costoMoneda.value === 'BS' || f.precioMoneda.value === 'BS');

        prev.innerHTML = `
          ${sinTasa ? '<div><b style="color:var(--danger)">Primero guarda la tasa BCV para usar bolívares</b></div>' : ''}
          <div><span>Costo por unidad</span><b>${Utils.usd(unit)} · ${Utils.bs(Tasa.toBs(unit))}</b></div>
          <div><span>Ganancia por unidad (detal)</span><b>${Utils.usd(detal - unit)}</b></div>
          ${mayor > 0 ? `<div><span>Ganancia por unidad (mayor)</span><b>${Utils.usd(mayor - unit)}</b></div>` : ''}
          <div><span>Ganancia si vendes todo al detal</span><b>${Utils.usd(cant * detal - costoUsd)}</b></div>`;
      };
      f.addEventListener('input', actualizar);
      f.addEventListener('change', actualizar);
      actualizar();

      f.addEventListener('submit', e => {
        e.preventDefault();
        const tasa = Tasa.valor();
        const cantidad = Utils.num(f.cantidad.value);
        const costoMonto = Utils.num(f.costoTotal.value);
        const costoMon = f.costoMoneda.value;
        const precioMon = f.precioMoneda.value;
        const detal = Utils.num(f.detal.value);
        const mayor = Utils.num(f.mayor.value);
        const nombre = f.nombre.value.trim();

        if (!nombre) return UI.toast('Escribe el nombre', 'error');
        if (cantidad <= 0) return UI.toast('La cantidad debe ser mayor a 0', 'error');
        if (costoMonto <= 0) return UI.toast('Escribe el total que pagaste', 'error');
        if (detal <= 0) return UI.toast('Escribe el precio al detal', 'error');
        if ((costoMon === 'BS' || precioMon === 'BS') && tasa <= 0) {
          return UI.toast('Primero guarda la tasa BCV (sección Dólar)', 'error');
        }

        // Si se edita y el costo en Bs no cambió, se respeta la tasa de la compra original
        let tasaCompra = tasa;
        if (modo === 'editar' && p.costoMoneda === 'BS' && costoMon === 'BS'
            && costoMonto === p.costoOriginal && p.tasaCompra) {
          tasaCompra = p.tasaCompra;
        }
        const costoTotalUsd = costoMon === 'BS' ? costoMonto / tasaCompra : costoMonto;

        const datos = {
          nombre,
          categoria: f.categoria.value.trim() || 'Otros',
          cantidad,
          fecha: f.fecha.value || Utils.today(),
          costoTotal: costoTotalUsd,
          costo: costoTotalUsd / cantidad,
          costoMoneda: costoMon,
          costoOriginal: costoMonto,
          tasaCompra,
          precioMoneda: precioMon,
          precioDetalOrig: detal,
          precioMayorOrig: mayor > 0 ? mayor : null
        };

        if (modo === 'editar') {
          const vendidos = Inventario.stats(p, Store.all('ventas')).vendidos;
          if (cantidad < vendidos) {
            return UI.toast(`Ya vendiste ${Inventario.q(vendidos)}, la cantidad no puede ser menor`, 'error');
          }
          Store.update('productos', p.id, datos);
          UI.toast('Mercancía actualizada');
        } else {
          Store.add('productos', datos);
          UI.toast(modo === 'recomprar' ? 'Recompra registrada' : 'Mercancía agregada');
        }
        UI.closeModal();
      });
    });
  },

  borrar(p) {
    const nVentas = Store.all('ventas').filter(v => v.productoId === p.id).length;
    const aviso = nVentas
      ? `¿Borrar "${p.nombre}"? También se borrarán sus ${nVentas} ventas registradas.`
      : `¿Borrar "${p.nombre}"?`;
    if (!UI.confirm(aviso)) return;
    Store.set('ventas', Store.all('ventas').filter(v => v.productoId !== p.id));
    Store.remove('productos', p.id);
    UI.toast('Mercancía borrada');
  }
};