/* =========================================================
   VENTAS - Registrar ventas (al detal o a negocios)
   Cada venta guarda:
   { productoId, nombre, cantidad, precioUnit (USD), total (USD), costoUnit,
     moneda, precioOrig, tipo: 'detal'|'negocio', cliente,
     fiado, fechaPago, pagado, fecha, tasa }
   Las existencias se calculan solas a partir de las ventas.
   ========================================================= */

const Ventas = {

  clientes() {
    const set = new Set();
    Store.all('ventas').forEach(v => v.cliente && set.add(v.cliente));
    return [...set].sort((a, b) => a.localeCompare(b));
  },

  openSale(productoId) {
    const ventas = Store.all('ventas');
    const disponibles = Store.all('productos')
      .map(p => ({ p, s: Inventario.stats(p, ventas) }))
      .filter(d => d.s.restante > 0);

    if (!disponibles.length) {
      return UI.toast('No hay mercancía disponible. Agrega o recompra primero.', 'error');
    }

    const html = `
      <form class="form" id="venta-form" autocomplete="off">
        <div class="field">
          <label>Producto</label>
          <select name="producto">
            ${disponibles.map(({ p, s }) => `
              <option value="${p.id}" ${p.id === productoId ? 'selected' : ''}>
                ${Utils.esc(p.nombre)} (quedan ${Inventario.q(s.restante)})
              </option>`).join('')}
          </select>
        </div>

        <div class="form-row">
          <div class="field">
            <label>Cantidad</label>
            <input name="cantidad" type="text" inputmode="decimal" placeholder="1" value="1">
          </div>
          <div class="field">
            <label>Tipo de venta</label>
            <select name="tipo">
              <option value="detal">Al detal</option>
              <option value="negocio">A un negocio (mayor)</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Precio c/u</label>
          <div class="input-group">
            <input name="precio" type="text" inputmode="decimal" placeholder="0,00">
            <select name="moneda">
              <option value="USD">$</option>
              <option value="BS">Bs</option>
            </select>
          </div>
          <span class="hint">Si haces una rebaja, solo cambia el precio aquí.</span>
        </div>

        <div class="field">
          <label>Forma de pago</label>
          <select name="pago">
            <option value="contado">De contado</option>
            <option value="fiado">Fiado</option>
          </select>
        </div>

        <div class="field">
          <label id="cliente-label">Cliente o negocio (opcional)</label>
          <input name="cliente" type="text" list="lista-clientes" placeholder="Nombre">
          <datalist id="lista-clientes">
            ${this.clientes().map(c => `<option value="${Utils.esc(c)}">`).join('')}
          </datalist>
        </div>

        <div class="field hidden" id="fecha-pago-box">
          <label>¿Qué día debe pagar?</label>
          <input name="fechaPago" type="date">
        </div>

        <div class="field">
          <label>Fecha de la venta</label>
          <input name="fecha" type="date" value="${Utils.today()}">
        </div>

        <div class="preview" id="venta-preview"></div>

        <button type="submit" class="btn btn-primary btn-block">
          <i data-lucide="check"></i> Registrar venta
        </button>
      </form>`;

    UI.openModal('Nueva venta', html, body => {
      const f = body.querySelector('#venta-form');
      const prev = body.querySelector('#venta-preview');
      const fechaBox = body.querySelector('#fecha-pago-box');
      const cliLabel = body.querySelector('#cliente-label');

      const productoActual = () => disponibles.find(d => d.p.id === f.producto.value);
      const redondea = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
      let monedaActual = 'USD';

      // Precio en dólares según lo que esté escrito y la moneda elegida
      const precioUsd = () => {
        const v = Utils.num(f.precio.value);
        return monedaActual === 'BS' ? Tasa.toUsd(v) : v;
      };

      const actualizar = () => {
        const cant = Utils.num(f.cantidad.value);
        const totalUsd = cant * precioUsd();
        const gan = totalUsd - cant * productoActual().p.costo;
        prev.innerHTML = `
          <div><span>Total en dólares</span><b>${Utils.usd(totalUsd)}</b></div>
          <div><span>Total en bolívares</span><b>${Utils.bs(Tasa.toBs(totalUsd))}</b></div>
          <div><span>Ganancia de esta venta</span><b>${Utils.usd(gan)}</b></div>`;
      };

      // Pone el precio del producto (detal o mayor) en la moneda elegida
      const precioSugerido = () => {
        const prod = productoActual().p;
        const usd = f.tipo.value === 'negocio' ? Inventario.precioMayor(prod) : Inventario.precioDetal(prod);
        f.precio.value = monedaActual === 'BS' ? redondea(Tasa.toBs(usd), 2) : redondea(usd, 4);
      };

      // Al elegir producto, usa la moneda en que tiene puesto el precio
      const elegirProducto = () => {
        const quiereBs = productoActual().p.precioMoneda === 'BS' && Tasa.valor() > 0;
        monedaActual = quiereBs ? 'BS' : 'USD';
        f.moneda.value = monedaActual;
        precioSugerido();
      };

      f.producto.addEventListener('change', () => { elegirProducto(); actualizar(); });
      f.tipo.addEventListener('change', () => { precioSugerido(); actualizar(); });

      // Al cambiar $ <-> Bs se convierte el monto que ya está escrito
      f.moneda.addEventListener('change', () => {
        const nueva = f.moneda.value;
        const t = Tasa.valor();
        if (nueva === 'BS' && t <= 0) {
          f.moneda.value = 'USD';
          return UI.toast('Primero guarda la tasa BCV (sección Dólar)', 'error');
        }
        const v = Utils.num(f.precio.value);
        if (nueva !== monedaActual && v > 0) {
          f.precio.value = nueva === 'BS' ? redondea(v * t, 2) : redondea(v / t, 4);
        }
        monedaActual = nueva;
        actualizar();
      });

      const fiadoCambio = () => {
        const esFiado = f.pago.value === 'fiado';
        fechaBox.classList.toggle('hidden', !esFiado);
        cliLabel.textContent = esFiado ? 'Cliente o negocio (obligatorio)' : 'Cliente o negocio (opcional)';
      };
      f.pago.addEventListener('change', fiadoCambio);
      f.addEventListener('input', actualizar);

      elegirProducto();
      actualizar();
      fiadoCambio();

      f.addEventListener('submit', e => {
        e.preventDefault();
        const { p, s } = productoActual();
        const cantidad = Utils.num(f.cantidad.value);
        const precioOrig = Utils.num(f.precio.value);
        const precioUnit = precioUsd();
        const fiado = f.pago.value === 'fiado';
        const cliente = f.cliente.value.trim();

        if (cantidad <= 0) return UI.toast('Escribe la cantidad', 'error');
        if (cantidad > s.restante) return UI.toast(`Solo quedan ${Inventario.q(s.restante)}`, 'error');
        if (precioOrig <= 0 || precioUnit <= 0) return UI.toast('Escribe el precio', 'error');
        if (fiado && !cliente) return UI.toast('Escribe a quién le fías', 'error');
        if (fiado && !f.fechaPago.value) return UI.toast('Elige el día de pago', 'error');

        Store.add('ventas', {
          productoId: p.id,
          nombre: p.nombre,
          cantidad,
          precioUnit,
          total: cantidad * precioUnit,
          costoUnit: p.costo,
          moneda: monedaActual,
          precioOrig,
          tipo: f.tipo.value,
          cliente,
          fiado,
          fechaPago: fiado ? f.fechaPago.value : null,
          pagado: !fiado,
          fecha: f.fecha.value || Utils.today(),
          tasa: Tasa.valor()
        });
        UI.closeModal();
        UI.toast('Venta registrada');
      });
    });
  }
};

Modules.ventas = {
  filtro: 'todas',

  render(container) {
    const todas = Store.all('ventas').slice().reverse();
    const hoy = Utils.today();
    const deHoy = todas.filter(v => v.fecha === hoy);
    const totalHoy = deHoy.reduce((a, v) => a + v.total, 0);
    const gananciaHoy = deHoy.reduce((a, v) => a + (v.total - v.cantidad * v.costoUnit), 0);

    const visibles = todas.filter(v => {
      if (this.filtro === 'detal') return v.tipo === 'detal';
      if (this.filtro === 'negocio') return v.tipo === 'negocio';
      if (this.filtro === 'fiado') return v.fiado;
      return true;
    }).slice(0, 100);

    container.innerHTML = `
      <div class="grid grid-3">
        <div class="card stat">
          <div class="stat-icon"><i data-lucide="shopping-bag"></i></div>
          <span class="stat-label">Vendido hoy</span>
          <span class="stat-value">${Utils.usd(totalHoy)}</span>
          <span class="stat-sub">${Utils.bs(Tasa.toBs(totalHoy))}</span>
        </div>
        <div class="card stat">
          <div class="stat-icon"><i data-lucide="trending-up"></i></div>
          <span class="stat-label">Ganancia de hoy</span>
          <span class="stat-value ${gananciaHoy >= 0 ? 'positive' : 'negative'}">${Utils.usd(gananciaHoy)}</span>
          <span class="stat-sub">${Utils.bs(Tasa.toBs(gananciaHoy))}</span>
        </div>
        <div class="card stat">
          <div class="stat-icon"><i data-lucide="receipt"></i></div>
          <span class="stat-label">Ventas hoy</span>
          <span class="stat-value">${deHoy.length}</span>
          <span class="stat-sub">${Utils.formatDate(hoy)}</span>
        </div>
      </div>

      <div class="toolbar mt">
        <button class="btn btn-primary" data-action="nueva"><i data-lucide="plus"></i> Nueva venta</button>
        <span class="spacer"></span>
        <select id="f-venta">
          <option value="todas" ${this.filtro === 'todas' ? 'selected' : ''}>Todas</option>
          <option value="detal" ${this.filtro === 'detal' ? 'selected' : ''}>Al detal</option>
          <option value="negocio" ${this.filtro === 'negocio' ? 'selected' : ''}>A negocios</option>
          <option value="fiado" ${this.filtro === 'fiado' ? 'selected' : ''}>Fiadas</option>
        </select>
      </div>

      ${visibles.length ? `<div class="list">${visibles.map(v => this.card(v)).join('')}</div>` : `
        <div class="card empty">
          <i data-lucide="shopping-bag"></i>
          <p>Aún no hay ventas registradas.</p>
        </div>`}
    `;

    container.onclick = e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'nueva') Ventas.openSale();
      if (btn.dataset.action === 'borrar') {
        if (UI.confirm('¿Borrar esta venta? La mercancía vuelve al inventario.')) {
          Store.remove('ventas', btn.dataset.id);
          UI.toast('Venta borrada');
        }
      }
    };

    container.onchange = e => {
      if (e.target.id === 'f-venta') { this.filtro = e.target.value; this.render(container); UI.icons(); }
    };
  },

  card(v) {
    // Fiado sin pagar: se muestra con la tasa de hoy. Lo demás, con la tasa del día de la venta.
    const tasa = (v.fiado && !v.pagado) ? Tasa.valor() : (v.tasa || Tasa.valor());
    const gan = v.total - v.cantidad * v.costoUnit;

    return `
      <div class="card item">
        <div class="item-head">
          <div>
            <div class="item-name">${Utils.esc(v.nombre)} × ${Inventario.q(v.cantidad)}</div>
            <div class="item-meta">
              <span>${Utils.formatDate(v.fecha)}</span>
              ${v.cliente ? `<span><b>${Utils.esc(v.cliente)}</b></span>` : ''}
            </div>
          </div>
          <div style="text-align:right">
            <div class="profit">${Utils.usd(v.total)}</div>
            <div class="item-meta" style="justify-content:flex-end">${Utils.bs(v.total * tasa)}</div>
          </div>
        </div>
        <div class="item-foot">
          <div class="row">
            <span class="badge">${v.tipo === 'negocio' ? 'Al mayor' : 'Al detal'}</span>
            ${v.fiado
              ? (v.pagado
                  ? '<span class="badge badge-success">Fiado pagado</span>'
                  : `<span class="badge badge-warning">Debe · paga ${Utils.formatDate(v.fechaPago)}</span>`)
              : '<span class="badge badge-success">Contado</span>'}
            <span class="muted" style="font-size:.8rem">Ganancia ${Utils.usd(gan)}</span>
          </div>
          <button class="icon-btn" data-action="borrar" data-id="${v.id}" aria-label="Borrar"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`;
  }
};