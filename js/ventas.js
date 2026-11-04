/* =========================================================
   VENTAS - Registrar ventas (carrito con varios productos)
   Cada producto del carrito se guarda como una venta, y todas
   comparten el mismo "ticket":
   { ticket, productoId, nombre, cantidad, precioUnit (USD), total (USD),
     costoUnit, moneda, precioOrig, tipo: 'detal'|'negocio', cliente,
     fiado, fechaPago, pagado, pagoMoneda, pagoMonto, fecha, tasa }
   ========================================================= */

const Ventas = {

  // Nombres de clientes guardados (directorio + los que ya aparecen en ventas)
  clientes() {
    return Clientes.lista().map(c => c.nombre);
  },

  nuevoTicket() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },

  openSale(productoId) {
    const ventas = Store.all('ventas');
    const disponibles = Store.all('productos')
      .map(p => ({ p, s: Inventario.stats(p, ventas) }))
      .filter(d => d.s.restante > 0);

    if (!disponibles.length) {
      return UI.toast('No hay mercancía disponible. Agrega o repón primero.', 'error');
    }

    const html = `
      <form class="form" id="venta-form" autocomplete="off">
        <div class="field">
          <label>Tipo de venta</label>
          <select name="tipo">
            <option value="detal">Al detal</option>
            <option value="negocio">A un negocio (mayor)</option>
          </select>
        </div>

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
            <label>Precio c/u</label>
            <div class="input-group">
              <input name="precio" type="text" inputmode="decimal" placeholder="0,00">
              <select name="moneda">
                <option value="USD">$</option>
                <option value="BS">Bs</option>
              </select>
            </div>
          </div>
        </div>
        <span class="hint">Si haces una rebaja, solo cambia el precio aquí.</span>

        <button type="button" class="btn btn-soft btn-block" id="add-linea">
          <i data-lucide="plus"></i> Agregar otro producto
        </button>

        <div id="carrito"></div>

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
      const carrito = body.querySelector('#carrito');
      const fechaBox = body.querySelector('#fecha-pago-box');
      const pagoBox = body.querySelector('#pago-moneda-box');
      const cliLabel = body.querySelector('#cliente-label');

      const redondea = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
      const lineas = [];            // productos ya agregados al carrito
      let monedaActual = 'USD';     // moneda del precio que se está escribiendo
      let pagoTocado = false;
      let pk = null;

      const productoActual = () => disponibles.find(d => d.p.id === f.producto.value);
      const enCarrito = id => lineas.filter(l => l.p.id === id).reduce((a, l) => a + l.cantidad, 0);
      const usdDe = l => (l.moneda === 'BS' ? Tasa.toUsd(l.precioOrig) : l.precioOrig);
      const sugeridoUsd = p => (f.tipo.value === 'negocio' ? Inventario.precioMayor(p) : Inventario.precioDetal(p));
      const sugeridoEn = (p, moneda) => {
        const usd = sugeridoUsd(p);
        return moneda === 'BS' ? redondea(Tasa.toBs(usd), 2) : redondea(usd, 4);
      };

      // Lo que se cobra de una línea, en la moneda en que te pagan
      const pagoLinea = (l, pm) => {
        const tot = l.cantidad * l.precioOrig;
        if (pm === l.moneda) return tot;
        return pm === 'BS' ? tot * Tasa.valor() : Tasa.toUsd(tot);
      };

      // Carrito + lo que esté escrito arriba (para que el total se vea al instante)
      const vista = () => {
        const out = lineas.slice();
        const d = productoActual();
        const cantidad = Utils.num(f.cantidad.value);
        const precioOrig = Utils.num(f.precio.value);
        if (d && cantidad > 0 && precioOrig > 0) {
          out.push({ p: d.p, cantidad, precioOrig, moneda: monedaActual });
        }
        return out;
      };

      const actualizar = () => {
        const v = vista();
        if (!v.length) {
          prev.innerHTML = '<div><span>Elige un producto para ver el total</span></div>';
          return;
        }
        const pm = f.pagoMoneda.value;
        const totalUsd = v.reduce((a, l) => a + l.cantidad * usdDe(l), 0);
        const gan = totalUsd - v.reduce((a, l) => a + l.cantidad * l.p.costo, 0);
        const contado = f.pago.value === 'contado';
        const monto = v.reduce((a, l) => a + pagoLinea(l, pm), 0);
        prev.innerHTML = `
          <div><span>Productos</span><b>${v.length}</b></div>
          <div><span>Total en dólares</span><b>${Utils.usd(totalUsd)}</b></div>
          <div><span>Total en bolívares</span><b>${Utils.bs(Tasa.toBs(totalUsd))}</b></div>
          ${contado ? `<div><span>Te pagan en ${pm === 'BS' ? 'bolívares' : 'dólares'}</span><b>${pm === 'BS' ? Utils.bs(monto) : Utils.usd(monto)}</b></div>` : ''}
${Seguridad.dueno() ? `<div><span>Ganancia de esta venta</span><b>${Utils.usd(gan)}</b></div>` : ''}`;
      };

      const pintarCarrito = () => {
        if (!lineas.length) { carrito.innerHTML = ''; return; }
        carrito.innerHTML = `
          <div class="card-title" style="margin:4px 0">En esta venta</div>
          ${lineas.map((l, i) => `
            <div class="mov">
              <div class="mov-info">
                <b>${Utils.esc(l.p.nombre)} × ${Inventario.q(l.cantidad)}</b>
                <span>${l.moneda === 'BS' ? Utils.bs(l.precioOrig) : Utils.usd(l.precioOrig)} c/u</span>
              </div>
              <div class="mov-amount">${Utils.usd(l.cantidad * usdDe(l))}</div>
              <button type="button" class="icon-btn" data-quitar="${i}" aria-label="Quitar"><i data-lucide="x"></i></button>
            </div>`).join('')}`;
        UI.icons();
      };

      carrito.onclick = e => {
        const b = e.target.closest('[data-quitar]');
        if (!b) return;
        lineas.splice(Number(b.dataset.quitar), 1);
        pintarCarrito();
        actualizar();
      };

      // Pone el precio del producto (detal o mayor) en la moneda elegida
      const precioSugerido = () => {
        const d = productoActual();
        if (d) f.precio.value = sugeridoEn(d.p, monedaActual);
      };

      const seleccionar = id => {
        f.producto.value = id;
        const d = productoActual();
        if (pk) pk.fijar(d.p.nombre);
        const quiereBs = d.p.precioMoneda === 'BS' && Tasa.valor() > 0;
        monedaActual = quiereBs ? 'BS' : 'USD';
        f.moneda.value = monedaActual;
        if (!pagoTocado && !lineas.length) f.pagoMoneda.value = monedaActual;
        precioSugerido();
        actualizar();
        f.cantidad.focus();
        f.cantidad.select();
      };

      // Pasa lo escrito arriba al carrito. Devuelve false si algo falta.
      const agregar = () => {
        const d = productoActual();
        if (!d) { UI.toast('Elige un producto de la lista', 'error'); return false; }
        const cantidad = Utils.num(f.cantidad.value);
        const precioOrig = Utils.num(f.precio.value);
        if (cantidad <= 0) { UI.toast('Escribe la cantidad', 'error'); return false; }
        if (precioOrig <= 0) { UI.toast('Escribe el precio', 'error'); return false; }
        const libre = d.s.restante - enCarrito(d.p.id);
        if (cantidad > libre) { UI.toast(`Solo quedan ${Inventario.q(libre)}`, 'error'); return false; }

        const igual = lineas.find(l => l.p.id === d.p.id && l.moneda === monedaActual && l.precioOrig === precioOrig);
        if (igual) igual.cantidad += cantidad;
        else lineas.push({
          p: d.p, cantidad, precioOrig, moneda: monedaActual,
          auto: Math.abs(precioOrig - sugeridoEn(d.p, monedaActual)) < 0.005   // sin rebaja manual
        });

        if (!pagoTocado) f.pagoMoneda.value = lineas[0].moneda;
        f.producto.value = '';
        buscar.value = '';
        f.cantidad.value = '1';
        f.precio.value = '';
        pintarCarrito();
        actualizar();
        return true;
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

      body.querySelector('#add-linea').addEventListener('click', () => {
        if (agregar()) buscar.focus();
      });

      // Si cambia el tipo, los precios sin rebaja manual se ajustan al nuevo tipo
      f.tipo.addEventListener('change', () => {
        lineas.forEach(l => { if (l.auto) l.precioOrig = sugeridoEn(l.p, l.moneda); });
        precioSugerido();
        pintarCarrito();
        actualizar();
      });

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
        if (!pagoTocado && !lineas.length) f.pagoMoneda.value = monedaActual;
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

        // Lo que esté escrito arriba también entra a la venta
        if (f.producto.value && !agregar()) return;
        if (!lineas.length) return UI.toast('Agrega al menos un producto', 'error');

        const fiado = f.pago.value === 'fiado';
        const cliente = f.cliente.value.trim();
        const tipo = f.tipo.value;
        const pm = f.pagoMoneda.value;

        if (fiado && !cliente) return UI.toast('Escribe a quién le fías', 'error');
        if (tipo === 'negocio' && !cliente) return UI.toast('Escribe el nombre del negocio', 'error');
        if (fiado && !f.fechaPago.value) return UI.toast('Elige el día de pago', 'error');
        if (!fiado && lineas.some(l => l.moneda !== pm) && Tasa.valor() <= 0) {
          return UI.toast('Primero guarda la tasa BCV (sección Dólar)', 'error');
        }

        const ticket = Ventas.nuevoTicket();
        const fecha = f.fecha.value || Utils.today();

        lineas.forEach(l => {
          const precioUnit = usdDe(l);
          Store.add('ventas', {
            ticket,
            productoId: l.p.id,
            nombre: l.p.nombre,
            cantidad: l.cantidad,
            precioUnit,
            total: l.cantidad * precioUnit,
            costoUnit: l.p.costo,
            moneda: l.moneda,
            precioOrig: l.precioOrig,
            tipo,
            cliente,
            fiado,
            fechaPago: fiado ? f.fechaPago.value : null,
            pagado: !fiado,
            pagoMoneda: fiado ? null : pm,
            pagoMonto: fiado ? null : redondea(pagoLinea(l, pm), 2),
            fecha,
            tasa: Tasa.valor()
          });
        });

        UI.closeModal();
        UI.toast(lineas.length > 1 ? `Venta registrada (${lineas.length} productos)` : 'Venta registrada');
      });
    });
  }
};

Modules.ventas = {
  filtro: 'todas',

  // Junta en un solo grupo las ventas que comparten ticket
  agrupar(lista) {
    const mapa = new Map();
    const grupos = [];
    lista.forEach(v => {
      if (v.ticket) {
        if (!mapa.has(v.ticket)) {
          const g = { ticket: v.ticket, lineas: [] };
          mapa.set(v.ticket, g);
          grupos.push(g);
        }
        mapa.get(v.ticket).lineas.push(v);
      } else {
        grupos.push({ ticket: null, lineas: [v] });
      }
    });
    grupos.forEach(g => g.lineas.reverse());   // en el orden en que se agregaron
    return grupos;
  },

  render(container) {
    const esDueno = Seguridad.dueno();
    const todas = Store.all('ventas').slice().reverse()
      .filter(v => esDueno || v.fecha === Utils.today());
    const hoy = Utils.today();
    const deHoy = todas.filter(v => v.fecha === hoy);
    const totalHoy = deHoy.reduce((a, v) => a + v.total, 0);
    const gananciaHoy = deHoy.reduce((a, v) => a + (v.total - v.cantidad * v.costoUnit), 0);
    const ventasHoy = this.agrupar(deHoy).length;

    const pasa = v => {
      if (this.filtro === 'detal') return v.tipo === 'detal';
      if (this.filtro === 'negocio') return v.tipo === 'negocio';
      if (this.filtro === 'fiado') return v.fiado;
      return true;
    };
    const visibles = this.agrupar(todas).filter(g => pasa(g.lineas[0])).slice(0, 100);

    container.innerHTML = `
      <div class="grid grid-3">
                $ { esDueno ? `
        <div class="card stat">
          <div class="stat-icon"><i data-lucide="trending-up"></i></div>
          <span class="stat-label">Ganancia de hoy</span>
          <span class="stat-value ${gananciaHoy >= 0 ? 'positive' : 'negative'}">${Utils.usd(gananciaHoy)}</span>
          <span class="stat-sub">${Utils.bs(Tasa.toBs(gananciaHoy))}</span>
        </div>` : '' }
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
          <span class="stat-value">${ventasHoy}</span>
          <span class="stat-sub">${Utils.formatDate(hoy)}</span>
        </div>
      </div>

      <div class="toolbar mt">
        <button class="btn btn-primary" data-action="nueva"><i data-lucide="plus"></i> Nueva venta</button>
        <button class="icon-btn" data-action="devoluciones" aria-label="Ver devoluciones"><i data-lucide="undo-2"></i></button>
        <span class="spacer"></span>
        <select id="f-venta">
          <option value="todas" ${this.filtro === 'todas' ? 'selected' : ''}>Todas</option>
          <option value="detal" ${this.filtro === 'detal' ? 'selected' : ''}>Al detal</option>
          <option value="negocio" ${this.filtro === 'negocio' ? 'selected' : ''}>A negocios</option>
          <option value="fiado" ${this.filtro === 'fiado' ? 'selected' : ''}>Fiadas</option>
        </select>
      </div>

      ${visibles.length ? `<div class="list">${visibles.map(g => this.card(g)).join('')}</div>` : `
        <div class="card empty">
          <i data-lucide="shopping-bag"></i>
          <p>Aún no hay ventas registradas.</p>
        </div>`}
    `;

    container.onclick = e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'nueva') Ventas.openSale();
            if (a === 'editar') EditarVenta.abrir(btn.dataset.ids.split(','));
      if (a === 'devolver') Devoluciones.nueva(btn.dataset.ids.split(','));
      if (a === 'devoluciones') Devoluciones.lista();
      if (a === 'factura') {
        if (btn.dataset.ticket) Factura.deTicket(btn.dataset.ticket);
        else Factura.nuevaDesdeVenta(btn.dataset.id);
      }
      if (a === 'borrar') {
        const ids = btn.dataset.ids.split(',');
        const msg = ids.length > 1
          ? `¿Borrar esta venta de ${ids.length} productos? La mercancía vuelve al inventario.`
          : '¿Borrar esta venta? La mercancía vuelve al inventario.';
        if (UI.confirm(msg)) {
          ids.forEach(id => Store.remove('ventas', id));
          UI.toast('Venta borrada');
        }
      }
    };

    container.onchange = e => {
      if (e.target.id === 'f-venta') { this.filtro = e.target.value; this.render(container); UI.icons(); }
    };
  },

    card(g) {
    const L = g.lineas;
    const v = L[0];
    const total = L.reduce((a, x) => a + x.total, 0);
    const gan = L.reduce((a, x) => a + (x.total - x.cantidad * x.costoUnit), 0);
    const debe = v.fiado && L.some(x => !x.pagado);
    const pendiente = L.find(x => !x.pagado) || v;
    const devuelta = L.every(x => x.cantidad <= 0);
    const devueltoQ = L.reduce((a, x) => a + (x.devuelto || 0), 0);
    // Fiado sin pagar: tasa de hoy. Lo demás, la tasa del día de la venta.
    const tasa = debe ? Tasa.valor() : (v.tasa || Tasa.valor());
    const pagoTxt = v.pagoMoneda ? ' · ' + (v.pagoMoneda === 'BS' ? 'Bs' : '$') : '';
    
    const vivas = L.filter(x => x.cantidad > 0);
    const mostrar = vivas.length ? vivas : L;
    const titulo = mostrar.length === 1 ?
      `${Utils.esc(mostrar[0].nombre)} × ${Inventario.q(mostrar[0].cantidad)}` :
      `${mostrar.length} productos`;
    const detalle = mostrar.length > 1 ?
      `<div class="muted" style="font-size:.85rem;margin-top:6px">${mostrar.map(x => `${Utils.esc(x.nombre)} × ${Inventario.q(x.cantidad)}`).join(' · ')}</div>` :
      '';
    
    const ids = L.map(x => x.id).join(',');
    const botonFactura = g.ticket ?
      `<button class="icon-btn" data-action="factura" data-ticket="${g.ticket}" aria-label="Factura"><i data-lucide="file-text"></i></button>` :
      (v.cliente ? `<button class="icon-btn" data-action="factura" data-id="${v.id}" aria-label="Factura"><i data-lucide="file-text"></i></button>` : '');
    
    return `
      <div class="card item">
        <div class="item-head">
          <div>
            <div class="item-name">${titulo}</div>
            <div class="item-meta">
              <span>${Utils.formatDate(v.fecha)}</span>
              ${v.cliente ? `<span><b>${Utils.esc(v.cliente)}</b></span>` : ''}
            </div>
            ${detalle}
          </div>
          <div style="text-align:right">
            <div class="profit">${Utils.usd(total)}</div>
            <div class="item-meta" style="justify-content:flex-end">${Utils.bs(total * tasa)}</div>
          </div>
        </div>
        <div class="item-foot">
          <div class="row">
            <span class="badge">${v.tipo === 'negocio' ? 'Al mayor' : 'Al detal'}</span>
            ${v.fiado
              ? (debe
                  ? `<span class="badge badge-warning">Debe · paga ${Utils.formatDate(pendiente.fechaPago)}</span>`
                  : '<span class="badge badge-success">Fiado pagado</span>')
              : `<span class="badge badge-success">Contado${pagoTxt}</span>`}
            ${devuelta
              ? '<span class="badge badge-warning">Devuelta</span>'
              : (devueltoQ > 0 ? `<span class="badge badge-warning">Devolvió ${Inventario.q(devueltoQ)}</span>` : '')}
${Seguridad.dueno() ? `<span class="muted" style="font-size:.8rem">Ganancia ${Utils.usd(gan)}</span>` : ''}
          </div>
          <div class="item-actions">
            ${botonFactura}
            <button class="icon-btn" data-action="editar" data-ids="${ids}" aria-label="Editar"><i data-lucide="pencil"></i></button>
            ${devuelta ? '' : `<button class="icon-btn" data-action="devolver" data-ids="${ids}" aria-label="Devolver"><i data-lucide="undo-2"></i></button>`}
            <button class="icon-btn" data-action="borrar" data-ids="${ids}" aria-label="Borrar"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
      </div>`;
  }
  };