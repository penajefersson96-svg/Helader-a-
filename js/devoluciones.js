/* =========================================================
   DEVOLUCIONES y EDITAR VENTA
   Devolución: la venta baja (cantidad y total), la mercancía
   vuelve al inventario y, si se devuelve dinero, sale de la
   caja el día de hoy.
   Para que el dinero no se cuente dos veces, la venta
   conserva "pagoMonto" (lo que se cobró) y "cantidadInicial".
   Colección "devoluciones":
   { fecha, ventaId, ticket, nombre, cliente, cantidad, montoUsd,
     dinero: { monto, moneda } | null, fiado, motivo }
   ========================================================= */

const Devoluciones = {
  r(n, d) { return Math.round(n * 10 ** d) / 10 ** d; },

  // Lo que se cobró en una venta de contado
  base(v) {
    const moneda = v.moneda === 'BS' ? 'BS' : 'USD';
    const ini = v.cantidadInicial ?? v.cantidad;
    const pm = v.pagoMoneda || moneda;
    const monto = v.pagoMonto ?? (moneda === 'BS' ? v.precioOrig * ini : v.precioUnit * ini);
    return { ini, pm, monto, moneda };
  },

  // Dinero que habría que devolver por q unidades
  calc(v, q) {
    const moneda = v.moneda === 'BS' ? 'BS' : 'USD';
    if (!v.fiado) {
      const b = this.base(v);
      return { monto: this.r(b.monto * q / b.ini, 2), moneda: b.pm };
    }
    // Fiado: solo hay dinero que devolver si ya había pagado más de lo que queda debiendo
    const unidad = moneda === 'BS' ? v.precioOrig : v.precioUnit;
    const nuevoTotal = (v.cantidad - q) * unidad;
    const abonado = (v.abonos || []).reduce((a, x) => a + x.aplicado, 0);
    const exceso = abonado - nuevoTotal;
    return { monto: exceso > Fiados.tol(moneda) ? this.r(exceso, 2) : 0, moneda };
  },

  nueva(ids) {
    const lineas = ids.map(id => Store.find('ventas', id)).filter(v => v && v.cantidad > 0);
    if (!lineas.length) return UI.toast('No hay nada para devolver en esta venta', 'error');

    const html = `
      <form class="form" id="dev-form" autocomplete="off">
        <div class="field ${lineas.length > 1 ? '' : 'hidden'}">
          <label>Producto a devolver</label>
          <select name="linea">
            ${lineas.map(v => `<option value="${v.id}">${Utils.esc(v.nombre)} (vendidos ${Inventario.q(v.cantidad)})</option>`).join('')}
          </select>
        </div>

        <div class="preview">
          <div><span>Cliente</span><b>${Utils.esc(lineas[0].cliente || 'Sin nombre')}</b></div>
          <div><span>Producto</span><b id="dev-nombre"></b></div>
        </div>

        <div class="field">
          <label>¿Cuántas unidades devuelve?</label>
          <input name="cantidad" type="text" inputmode="decimal" value="1">
        </div>

        <div class="field">
          <label>Motivo (opcional)</label>
          <input name="motivo" type="text" placeholder="Ej: se derritió, producto dañado">
        </div>

        <div class="preview" id="dev-prev"></div>

        <label class="check-row" id="dev-dinero-box">
          <input type="checkbox" name="dinero" checked>
          <span><b>Le devolví el dinero</b><small>Sale de la caja de hoy</small></span>
        </label>

        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="undo-2"></i> Registrar devolución</button>
      </form>`;

    UI.openModal('Devolución', html, body => {
      const f = body.querySelector('#dev-form');
      const prev = body.querySelector('#dev-prev');
      const caja = body.querySelector('#dev-dinero-box');
      const nombre = body.querySelector('#dev-nombre');
      const linea = () => lineas.find(v => v.id === f.linea.value);

      const actualizar = () => {
        const v = linea();
        const q = Utils.num(f.cantidad.value);
        nombre.textContent = v.nombre;
        const ok = q > 0 && q <= v.cantidad;
        const c = ok ? this.calc(v, q) : { monto: 0, moneda: 'USD' };
        prev.innerHTML = `
          <div><span>Vuelven al inventario</span><b>${ok ? Inventario.q(q) : '—'}</b></div>
          <div><span>Valor devuelto</span><b>${ok ? Utils.usd(q * v.precioUnit) : '—'}</b></div>
          ${v.fiado ? `<div><span>${c.monto > 0 ? 'Ya había pagado de más' : 'Se descuenta de lo que debe'}</span><b>${c.monto > 0 ? Fiados.fmt(c.monto, c.moneda) : 'Sí'}</b></div>` : ''}
          ${!v.fiado && ok ? `<div><span>Dinero a devolver</span><b>${Fiados.fmt(c.monto, c.moneda)}</b></div>` : ''}`;
        caja.classList.toggle('hidden', !(c.monto > 0));
      };
      f.linea.addEventListener('change', () => { f.cantidad.value = '1'; actualizar(); });
      f.addEventListener('input', actualizar);
      actualizar();

      f.addEventListener('submit', e => {
        e.preventDefault();
        const v = Store.find('ventas', f.linea.value);
        const q = Utils.num(f.cantidad.value);
        if (!v || q <= 0) return UI.toast('Escribe la cantidad', 'error');
        if (q > v.cantidad) return UI.toast(`Solo se vendieron ${Inventario.q(v.cantidad)}`, 'error');

        const moneda = v.moneda === 'BS' ? 'BS' : 'USD';
        const c = this.calc(v, q);
        const devolvio = c.monto > 0 && f.dinero.checked;
        const nuevaCant = v.cantidad - q;
        const cambios = {
          cantidad: nuevaCant,
          total: nuevaCant * v.precioUnit,
          cantidadInicial: v.cantidadInicial ?? v.cantidad,
          devuelto: (v.devuelto || 0) + q
        };

        if (!v.fiado) {
          // Se conserva lo que se cobró para que la caja de ese día no cambie
          const b = this.base(v);
          cambios.pagoMonto = b.monto;
          cambios.pagoMoneda = b.pm;
        } else {
          const unidad = moneda === 'BS' ? v.precioOrig : v.precioUnit;
          const abonado = (v.abonos || []).reduce((a, x) => a + x.aplicado, 0);
          cambios.pagado = nuevaCant <= 0 || (nuevaCant * unidad - abonado) <= Fiados.tol(moneda);
        }
        Store.update('ventas', v.id, cambios);

        // Se guarda como "Ajuste de caja" para que no se reste dos veces de la ganancia
        if (devolvio) {
          Store.add('movimientos', {
            tipo: 'gasto',
            concepto: `Devolución: ${v.nombre} × ${Inventario.q(q)}${v.cliente ? ' (' + v.cliente + ')' : ''}`,
            categoria: 'Ajuste de caja',
            monto: c.monto, moneda: c.moneda, fecha: Utils.today()
          });
        }

        Store.add('devoluciones', {
          fecha: Utils.today(), ventaId: v.id, ticket: v.ticket || null,
          nombre: v.nombre, cliente: v.cliente || '', cantidad: q,
          montoUsd: q * v.precioUnit,
          dinero: devolvio ? { monto: c.monto, moneda: c.moneda } : null,
          fiado: !!v.fiado, motivo: f.motivo.value.trim()
        });

        UI.closeModal();
        UI.toast('Devolución registrada');
      });
    });
  },

  lista() {
    const items = Store.all('devoluciones').slice().reverse();
    const html = items.length ? items.map(d => `
      <div class="mov">
        <div class="mov-info">
          <b>${Utils.esc(d.nombre)} × ${Inventario.q(d.cantidad)}</b>
          <span>${Utils.formatDate(d.fecha)}${d.cliente ? ' · ' + Utils.esc(d.cliente) : ''}${d.motivo ? ' · ' + Utils.esc(d.motivo) : ''}</span>
        </div>
        <div class="mov-amount">${Utils.usd(d.montoUsd)}</div>
      </div>`).join('') : '<p class="muted">Todavía no hay devoluciones.</p>';
    UI.openModal('Devoluciones', html, () => {});
  }
};

const EditarVenta = {
  abrir(ids) {
    const lineas = ids.map(id => Store.find('ventas', id)).filter(Boolean);
    if (!lineas.length) return;
    const v0 = lineas[0];
    const fiado = lineas.some(x => x.fiado);

    const html = `
      <form class="form" id="edit-form" autocomplete="off">
        <div class="field">
          <label>Cliente o negocio</label>
          <input name="cliente" type="text" list="lista-clientes-edit" value="${Utils.esc(v0.cliente || '')}">
          <datalist id="lista-clientes-edit">
            ${Ventas.clientes().map(c => `<option value="${Utils.esc(c)}">`).join('')}
          </datalist>
        </div>
        <div class="field">
          <label>Fecha de la venta</label>
          <input name="fecha" type="date" value="${v0.fecha || Utils.today()}">
        </div>
        ${fiado ? `
          <div class="field">
            <label>Día de pago</label>
            <input name="fechaPago" type="date" value="${v0.fechaPago || ''}">
          </div>` : ''}
        <span class="hint">Para corregir un producto o un precio, haz una devolución y registra la venta de nuevo.</span>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="check"></i> Guardar cambios</button>
      </form>`;

    UI.openModal('Editar venta', html, body => {
      const f = body.querySelector('#edit-form');
      f.addEventListener('submit', e => {
        e.preventDefault();
        const cliente = f.cliente.value.trim();
        if ((fiado || v0.tipo === 'negocio') && !cliente) return UI.toast('Escribe el nombre del cliente', 'error');

        lineas.forEach(v => {
          const cambios = { cliente, fecha: f.fecha.value || v.fecha };
          if (v.fiado && f.fechaPago && f.fechaPago.value) cambios.fechaPago = f.fechaPago.value;
          Store.update('ventas', v.id, cambios);
        });
        UI.closeModal();
        UI.toast('Venta actualizada');
      });
    });
  }
};