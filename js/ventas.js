/* =========================================================
   VENTAS - Registrar ventas (al detal o a negocios)
   Cada venta guarda:
   { productoId, nombre, cantidad, precioUnit (USD), total (USD), costoUnit,
     moneda, precioOrig, tipo: 'detal'|'negocio', cliente,
     fiado, fechaPago, pagado, pagoMoneda, pagoMonto, fecha, tasa }
   ========================================================= */

const Ventas = {

  // Nombres de clientes guardados (directorio + los que ya aparecen en ventas)
  clientes() {
    return Clientes.lista().map(c => c.nombre);
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
        <div class="field has-picker">
          <label>Producto</label>
          <input type="text" id="buscar-prod" placeholder="Escribe una letra o el nombre" autocomplete="off">
          <input type="hidden" name="producto" value="">
          <div class="picker hidden" id="picker"></div>
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

        <div class="field" id="pago-moneda-box">
          <label>¿En qué moneda te pagaron?</label>
          <select name="pagoMoneda">
            <option value="USD">Dólares ($)</option>
            <option value="BS">Bolívares (Bs)</option>
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
      const buscar = body.querySelector('#buscar-prod');
      const picker = body.querySelector('#picker');
      const fechaBox = body.querySelector('#fecha-pago-box');
      const pagoBox = body.querySelector('#pago-moneda-box');
      const cliLabel = body.querySelector('#cliente-label');

      const redondea = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
      const productoActual = () => disponibles.find(d => d.p.id === f.producto.value);
      let monedaActual = 'USD';
      let pagoTocado = false;
      let pk = null;

      const precioUsd = () => {
        const v = Utils.num(f.precio.value);
        return monedaActual === 'BS' ? Tasa.toUsd(v) : v;
      };

      // Lo que realmente se cobra, en la moneda en que te pagan
      const montoPago = () => {
        const total = Utils.num(f.cantidad.value) * Utils.num(f.precio.value);
        const pm = f.pagoMoneda.value;
        if (pm === monedaActual) return total;
        return pm === 'BS' ? total * Tasa.valor() : Tasa.toUsd(total);
      };

      const actualizar = () => {
        const d = productoActual();
        if (!d) {
          prev.innerHTML = '<div><span>Elige un producto para ver el total</span></div>';
          return;
        }
        const cant = Utils.num(f.cantidad.value);
        const totalUsd = cant * precioUsd();
        const gan = totalUsd - cant * d.p.costo;
        const contado = f.pago.value === 'contado';
        const pm = f.pagoMoneda.value;
        prev.innerHTML = `
          <div><span>Total en dólares</span><b>${Utils.usd(totalUsd)}</b></div>
          <div><span>Total en bolívares</span><b>${Utils.bs(Tasa.toBs(totalUsd))}</b></div>
          ${contado ? `<div><span>Te pagan en ${pm === 'BS' ? 'bolívares' : 'dólares'}</span><b>${pm === 'BS' ? Utils.bs(montoPago()) : Utils.usd(montoPago())}</b></div>` : ''}
          <div><span>Ganancia de esta venta</span><b>${Utils.usd(gan)}</b></div>`;
      };

      // Pone el precio del producto (detal o mayor) en la moneda elegida
      const precioSugerido = () => {
        const d = productoActual();
        if (!d) return;
        const usd = f.tipo.value === 'negocio' ? Inventario.precioMayor(d.p) : Inventario.precioDetal(d.p);
        f.precio.value = monedaActual === 'BS' ? redondea(Tasa.toBs(usd), 2) : redondea(usd, 4);
      };

      const sugerirPagoMoneda = () => {
        if (!pagoTocado) f.pagoMoneda.value = monedaActual;
      };

      const seleccionar = id => {
        f.producto.value = id;
        const d = productoActual();
        if (pk) pk.fijar(d.p.nombre);

        const quiereBs = d.p.precioMoneda === 'BS' && Tasa.valor() > 0;
        monedaActual = quiereBs ? 'BS' : 'USD';
        f.moneda.value = monedaActual;
        sugerirPagoMoneda();
        precioSugerido();
        actualizar();
        f.cantidad.focus();
        f.cantidad.select();
      };

      // Buscador desplegable: muestra pocos productos y filtra al escribir
      pk = Picker.attach({
        input: buscar,
        list: picker,
        items: disponibles.map(d => ({
          id: d.p.id,
          nombre: d.p.nombre,
          categoria: d.p.categoria,
          sub: `quedan ${Inventario.q(d.s.restante)}`,
          precio: Utils.usd(Inventario.precioDetal(d.p)),
          pop: d.s.vendidos
        })),
        onSelect: item => seleccionar(item.id),
        onClear: () => { f.producto.value = ''; actualizar(); }
      });

      f.tipo.addEventListener('change', () => { precioSugerido(); actualizar(); });

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
        sugerirPagoMoneda();
        actualizar();
      });

      f.pagoMoneda.addEventListener('change', () => { pagoTocado = true; actualizar(); });

      const fiadoCambio = () => {
        const esFiado = f.pago.value === 'fiado';
        fechaBox.classList.toggle('hidden', !esFiado);
        pagoBox.classList.toggle('hidden', esFiado);
        cliLabel.textContent = esFiado ? 'Cliente o negocio (obligatorio)' : 'Cliente o negocio (opcional)';
        actualizar();
      };
      f.pago.addEventListener('change', fiadoCambio);
      f.addEventListener('input', actualizar);

      // Arranque: si viene de la tarjeta de un producto, ya lo elige; si no, abre el buscador
      if (productoId && disponibles.some(d => d.p.id === productoId)) {
        seleccionar(productoId);
      } else {
        actualizar();
        buscar.focus();
      }
      fiadoCambio();

      f.addEventListener('submit', e => {
        e.preventDefault();
        const d = productoActual();
        if (!d) return UI.toast('Elige un producto de la lista', 'error');

        const { p, s } = d;
        const cantidad = Utils.num(f.cantidad.value);
        const precioOrig = Utils.num(f.precio.value);
        const precioUnit = precioUsd();
        const fiado = f.pago.value === 'fiado';
        const cliente = f.cliente.value.trim();
        const pm = f.pagoMoneda.value;

        if (cantidad <= 0) return UI.toast('Escribe la cantidad', 'error');
        if (cantidad > s.restante) return UI.toast(`Solo quedan ${Inventario.q(s.restante)}`, 'error');
        if (precioOrig <= 0 || precioUnit <= 0) return UI.toast('Escribe el precio', 'error');
        if (fiado && !cliente) return UI.toast('Escribe a quién le fías', 'error');
        if (f.tipo.value === 'negocio' && !cliente) return UI.toast('Escribe el nombre del negocio', 'error');
        if (fiado && !f.fechaPago.value) return UI.toast('Elige el día de pago', 'error');
        if (!fiado && pm !== monedaActual && Tasa.valor() <= 0) {
          return UI.toast('Primero guarda la tasa BCV (sección Dólar)', 'error');
        }

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
          pagoMoneda: fiado ? null : pm,
          pagoMonto: fiado ? null : redondea(montoPago(), 2),
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
      if (btn.dataset.action === 'factura') Factura.nuevaDesdeVenta(btn.dataset.id);
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
    const pagoTxt = v.pagoMoneda ? ' · ' + (v.pagoMoneda === 'BS' ? 'Bs' : '$') : '';

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
              : `<span class="badge badge-success">Contado${pagoTxt}</span>`}
            <span class="muted" style="font-size:.8rem">Ganancia ${Utils.usd(gan)}</span>
          </div>
          <div class="item-actions">
            ${v.cliente ? `<button class="icon-btn" data-action="factura" data-id="${v.id}" aria-label="Mini factura"><i data-lucide="file-text"></i></button>` : ''}
            <button class="icon-btn" data-action="borrar" data-id="${v.id}" aria-label="Borrar"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
      </div>`;
  }
};