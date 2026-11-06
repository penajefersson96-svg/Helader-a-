/* =========================================================
   FIADOS - Quién te debe, cuánto y cuándo paga
   Une dos fuentes:
   - Ventas fiadas (colección "ventas", fiado = true)
   - Deudas manuales (colección "deudas")
   Cada una guarda sus pagos en "abonos":
   [{ fecha, monto, moneda, aplicado, tasa }]
   "aplicado" es lo que se descuenta, en la moneda de la deuda.
   ========================================================= */

const Fiados = {
  tol(moneda) { return moneda === 'BS' ? 0.01 : 0.001; },

  fmt(monto, moneda) { return moneda === 'BS' ? Utils.bs(monto) : Utils.usd(monto); },

  convertir(monto, de, a) {
    if (de === a) return monto;
    const t = Tasa.valor();
    return de === 'USD' ? monto * t : (t > 0 ? monto / t : 0);
  },

  // Lo mismo, pero en la otra moneda (para mostrar equivalencias)
  otra(monto, moneda) {
    return moneda === 'USD' ? Utils.bs(Tasa.toBs(monto)) : Utils.usd(Tasa.toUsd(monto));
  },

  eqUsd(monto, moneda) { return moneda === 'BS' ? Tasa.toUsd(monto) : monto; },

  armar(d) {
    const abonado = d.abonos.reduce((a, x) => a + x.aplicado, 0);
    const pendiente = Math.max(d.total - abonado, 0);
    const pagado = pendiente <= this.tol(d.moneda);
    return { ...d, abonado, pendiente: pagado ? 0 : pendiente, pagado, dias: Utils.daysUntil(d.fechaPago) };
  },

  lista() {
    const out = [];

    Store.all('ventas').filter(v => v.fiado).forEach(v => {
      const moneda = v.moneda === 'BS' ? 'BS' : 'USD';
      out.push(this.armar({
        coleccion: 'ventas', id: v.id, cliente: v.cliente || 'Sin nombre',
        concepto: `${v.nombre} × ${Inventario.q(v.cantidad)}`,
        moneda, total: moneda === 'BS' ? v.precioOrig * v.cantidad : v.total,
        fecha: v.fecha, fechaPago: v.fechaPago, abonos: v.abonos || [], manual: false
      }));
    });

    Store.all('deudas').forEach(d => {
      out.push(this.armar({
        coleccion: 'deudas', id: d.id, cliente: d.cliente, concepto: d.concepto || 'Deuda',
        moneda: d.moneda, total: d.total, fecha: d.fecha, fechaPago: d.fechaPago,
        abonos: d.abonos || [], manual: true
      }));
    });

    return out;
  },

  /* ---------- Cobrar (pago total o abono) ---------- */
  cobrar(it) {
    const html = `
      <form class="form" id="cobro-form" autocomplete="off">
        <div class="preview">
          <div><span>Cliente</span><b>${Utils.esc(it.cliente)}</b></div>
          <div><span>Debe</span><b>${this.fmt(it.pendiente, it.moneda)}</b></div>
          <div><span>Equivale hoy a</span><b>${this.otra(it.pendiente, it.moneda)}</b></div>
        </div>
        <div class="field">
          <label>¿Cuánto pagó y en qué moneda?</label>
          <div class="input-group">
            <input name="monto" type="text" inputmode="decimal" placeholder="0,00">
            <select name="moneda">
              <option value="USD">$</option>
              <option value="BS">Bs</option>
            </select>
          </div>
        </div>
        <button type="button" class="btn btn-soft btn-sm" id="pago-todo">
          <i data-lucide="check-check"></i> Pagó todo lo que debe
        </button>
        <div class="field">
          <label>Fecha del pago</label>
          <input name="fecha" type="date" value="${Utils.today()}">
        </div>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="check"></i> Registrar pago</button>
      </form>`;

    UI.openModal('Cobrar', html, body => {
      const f = body.querySelector('#cobro-form');
      const redondea = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
      let monedaActual = it.moneda;
      f.moneda.value = monedaActual;

      const llenarTodo = () => {
        const v = this.convertir(it.pendiente, it.moneda, monedaActual);
        f.monto.value = redondea(v, monedaActual === 'BS' ? 2 : 4);
      };
      llenarTodo();

      body.querySelector('#pago-todo').addEventListener('click', llenarTodo);

      f.moneda.addEventListener('change', () => {
        const nueva = f.moneda.value;
        if (nueva !== it.moneda && Tasa.valor() <= 0) {
          f.moneda.value = monedaActual;
          return UI.toast('Primero guarda la tasa BCV (sección Dólar)', 'error');
        }
        const v = Utils.num(f.monto.value);
        if (v > 0) f.monto.value = redondea(this.convertir(v, monedaActual, nueva), nueva === 'BS' ? 2 : 4);
        monedaActual = nueva;
      });

      f.addEventListener('submit', e => {
        e.preventDefault();
        const monto = Utils.num(f.monto.value);
        if (monto <= 0) return UI.toast('Escribe el monto', 'error');

        let aplicado = this.convertir(monto, monedaActual, it.moneda);
        const margen = Math.max(this.tol(it.moneda), it.pendiente * 0.005);
        if (Math.abs(aplicado - it.pendiente) <= margen) aplicado = it.pendiente;
        if (aplicado > it.pendiente) return UI.toast('Eso es más de lo que debe', 'error');

        const abonos = [...it.abonos, {
          fecha: f.fecha.value || Utils.today(),
          monto, moneda: monedaActual, aplicado, tasa: Tasa.valor()
        }];
        const saldado = it.pendiente - aplicado <= this.tol(it.moneda);
        Store.update(it.coleccion, it.id, { abonos, pagado: saldado });
        UI.closeModal();
        UI.toast(saldado ? 'Deuda pagada' : 'Abono registrado');
      });
    });
  },

  deshacerUltimo(it) {
    if (!it.abonos.length) return;
    if (!UI.confirm('¿Deshacer el último pago registrado?')) return;
    Store.update(it.coleccion, it.id, { abonos: it.abonos.slice(0, -1), pagado: false });
    UI.toast('Pago deshecho');
  },

  /* ---------- Agregar deuda (con buscador de mercancía) ---------- */
  nuevaDeuda() {
    const ventas = Store.all('ventas');
    const disponibles = Store.all('productos')
      .map(p => ({ p, s: Inventario.stats(p, ventas) }))
      .filter(d => d.s.restante > 0);

    const clientes = [...new Set([
      ...Ventas.clientes(),
      ...Store.all('deudas').map(d => d.cliente)
    ])].sort((a, b) => a.localeCompare(b));

    const html = `
      <form class="form" id="deuda-form" autocomplete="off">
        <div class="field">
          <label>Cliente o negocio</label>
          <input name="cliente" type="text" list="lista-deudores" placeholder="Nombre">
          <datalist id="lista-deudores">${clientes.map(c => `<option value="${Utils.esc(c)}">`).join('')}</datalist>
        </div>

        <div class="field has-picker">
          <label>¿Qué se le fió?</label>
          <input name="concepto" type="text" placeholder="Escribe para buscar en tu mercancía" autocomplete="off">
          <input type="hidden" name="productoId" value="">
          <div class="picker hidden" id="picker-deuda"></div>
          <span class="hint">Si es algo que no está en tu mercancía, escríbelo y pon el monto.</span>
        </div>

        <div class="form-row hidden" id="prod-box">
          <div class="field">
            <label>Cantidad</label>
            <input name="cantidad" type="text" inputmode="decimal" value="1">
          </div>
          <div class="field">
            <label>Precio</label>
            <select name="tipo">
              <option value="detal">Al detal</option>
              <option value="negocio">Al mayor</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Monto que debe</label>
          <div class="input-group">
            <input name="monto" type="text" inputmode="decimal" placeholder="0,00">
            <select name="moneda"><option value="USD">$</option><option value="BS">Bs</option></select>
          </div>
          <span class="hint hidden" id="aviso-prod"></span>
        </div>

        <div class="form-row">
          <div class="field">
            <label>Fecha del fiado</label>
            <input name="fecha" type="date" value="${Utils.today()}">
          </div>
          <div class="field">
            <label>Día de pago</label>
            <input name="fechaPago" type="date">
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="check"></i> Guardar</button>
      </form>`;

    UI.openModal('Agregar deuda', html, body => {
      const f = body.querySelector('#deuda-form');
      const prodBox = body.querySelector('#prod-box');
      const aviso = body.querySelector('#aviso-prod');
      const redondea = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
      const prod = () => disponibles.find(d => d.p.id === f.productoId.value);

      // Con un producto elegido, el monto se calcula solo (cantidad × precio)
      const auto = () => {
        const d = prod();
        if (!d) return;
                const cant = Utils.num(f.cantidad.value);
        const usd = f.tipo.value === 'negocio' ? Inventario.precioMayor(d.p) * cant : Ofertas.totalUsd(d.p, cant);
        f.monto.value = f.moneda.value === 'BS' ? redondea(Tasa.toBs(usd), 2) : redondea(usd, 2);
      };

      Picker.attach({
        input: f.concepto,
        list: body.querySelector('#picker-deuda'),
        items: disponibles.map(d => ({
          id: d.p.id, nombre: d.p.nombre, categoria: d.p.categoria,
          sub: `quedan ${Inventario.q(d.s.restante)}`,
          precio: Utils.usd(Inventario.precioDetal(d.p)),
          pop: d.s.vendidos
        })),
        onSelect: item => {
          f.productoId.value = item.id;
          const d = prod();
          prodBox.classList.remove('hidden');
          aviso.classList.remove('hidden');
          aviso.textContent = 'Se descontará de tu mercancía. Quedan ' + Inventario.q(d.s.restante) + '.';
          f.moneda.value = (d.p.precioMoneda === 'BS' && Tasa.valor() > 0) ? 'BS' : 'USD';
          auto();
          f.cantidad.focus();
          f.cantidad.select();
        },
        onClear: () => {
          f.productoId.value = '';
          prodBox.classList.add('hidden');
          aviso.classList.add('hidden');
        }
      });

      f.cantidad.addEventListener('input', auto);
      f.tipo.addEventListener('change', auto);
      f.moneda.addEventListener('change', () => {
        if (f.moneda.value === 'BS' && Tasa.valor() <= 0) {
          f.moneda.value = 'USD';
          return UI.toast('Primero guarda la tasa BCV (sección Dólar)', 'error');
        }
        auto();
      });

      f.addEventListener('submit', e => {
        e.preventDefault();
        const cliente = f.cliente.value.trim();
        const total = Utils.num(f.monto.value);
        const mon = f.moneda.value;
        const d = prod();

        if (!cliente) return UI.toast('Escribe el nombre del cliente', 'error');
        if (total <= 0) return UI.toast('Escribe el monto', 'error');
        if (!f.fechaPago.value) return UI.toast('Elige el día de pago', 'error');

        if (d) {
          // Fiado de mercancía: se registra como venta fiada y descuenta el inventario
          const cantidad = Utils.num(f.cantidad.value);
          if (cantidad <= 0) return UI.toast('Escribe la cantidad', 'error');
          if (cantidad > d.s.restante) return UI.toast(`Solo quedan ${Inventario.q(d.s.restante)}`, 'error');
          const totalUsd = mon === 'BS' ? Tasa.toUsd(total) : total;

          Store.add('ventas', {
            productoId: d.p.id, nombre: d.p.nombre, cantidad,
            precioUnit: totalUsd / cantidad, total: totalUsd, costoUnit: d.p.costo,
            moneda: mon, precioOrig: total / cantidad, tipo: f.tipo.value,
            cliente, fiado: true, fechaPago: f.fechaPago.value, pagado: false,
            pagoMoneda: null, pagoMonto: null,
            fecha: f.fecha.value || Utils.today(), tasa: Tasa.valor()
          });
          UI.toast('Fiado registrado y descontado de la mercancía');
        } else {
          // Otra cosa que no está en la mercancía
          Store.add('deudas', {
            cliente, concepto: f.concepto.value.trim(),
            moneda: mon, total,
            fecha: f.fecha.value || Utils.today(),
            fechaPago: f.fechaPago.value,
            abonos: [], pagado: false
          });
          UI.toast('Deuda guardada');
        }
        UI.closeModal();
      });
    });
  }
};

Modules.fiados = {
  estado: 'pendientes',
  cliente: 'todos',

  render(container) {
    const todas = Fiados.lista();
    const pendientes = todas.filter(i => !i.pagado);
    const vencidas = pendientes.filter(i => i.dias < 0);

    const sum = arr => arr.reduce((a, i) => a + Fiados.eqUsd(i.pendiente, i.moneda), 0);
    const totalUsd = sum(pendientes);
    const vencidoUsd = sum(vencidas);
    const nombres = [...new Set(todas.map(i => i.cliente))].sort((a, b) => a.localeCompare(b));

    const visibles = todas.filter(i => {
      if (this.cliente !== 'todos' && i.cliente !== this.cliente) return false;
      if (this.estado === 'pendientes') return !i.pagado;
      if (this.estado === 'vencidos') return !i.pagado && i.dias < 0;
      if (this.estado === 'pagados') return i.pagado;
      return true;
    }).sort((a, b) => (a.pagado - b.pagado) || a.fechaPago.localeCompare(b.fechaPago));

    container.innerHTML = `
      <div class="grid grid-2">
        <div class="card stat">
          <div class="stat-icon"><i data-lucide="handshake"></i></div>
          <span class="stat-label">Te deben en total</span>
          <span class="stat-value">${Utils.usd(totalUsd)}</span>
          <span class="stat-sub">${Utils.bs(Tasa.toBs(totalUsd))} · ${pendientes.length} deuda(s)</span>
        </div>
        <div class="card stat">
          <div class="stat-icon" style="background:var(--danger-soft);color:var(--danger)"><i data-lucide="alarm-clock"></i></div>
          <span class="stat-label">Vencido</span>
          <span class="stat-value ${vencidas.length ? 'negative' : ''}">${Utils.usd(vencidoUsd)}</span>
          <span class="stat-sub">${Utils.bs(Tasa.toBs(vencidoUsd))} · ${vencidas.length} vencida(s)</span>
        </div>
      </div>

      <div class="toolbar mt">
        <button class="btn btn-primary" data-action="nueva"><i data-lucide="plus"></i> Agregar deuda</button>
        <span class="spacer"></span>
        <select id="f-cli">
          <option value="todos">Todos los clientes</option>
          ${nombres.map(n => `<option value="${Utils.esc(n)}" ${n === this.cliente ? 'selected' : ''}>${Utils.esc(n)}</option>`).join('')}
        </select>
        <select id="f-est">
          <option value="pendientes" ${this.estado === 'pendientes' ? 'selected' : ''}>Pendientes</option>
          <option value="vencidos" ${this.estado === 'vencidos' ? 'selected' : ''}>Vencidos</option>
          <option value="pagados" ${this.estado === 'pagados' ? 'selected' : ''}>Pagados</option>
          <option value="todos" ${this.estado === 'todos' ? 'selected' : ''}>Todos</option>
        </select>
      </div>

      ${visibles.length ? `<div class="list">${visibles.map(i => this.card(i)).join('')}</div>` : `
        <div class="card empty">
          <i data-lucide="handshake"></i>
          <p>${todas.length ? 'No hay deudas con ese filtro.' : 'Nadie te debe nada por ahora. Las ventas fiadas aparecen aquí solas.'}</p>
        </div>`}
    `;

    container.onclick = e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'nueva') return Fiados.nuevaDeuda();
      const it = Fiados.lista().find(x => x.id === btn.dataset.id);
      if (!it) return;
      if (btn.dataset.action === 'cobrar') Fiados.cobrar(it);
      if (btn.dataset.action === 'deshacer') Fiados.deshacerUltimo(it);
      if (btn.dataset.action === 'borrar' && UI.confirm(`¿Borrar la deuda de ${it.cliente}?`)) {
        Store.remove('deudas', it.id);
        UI.toast('Deuda borrada');
      }
    };

    container.onchange = e => {
      if (e.target.id === 'f-cli') this.cliente = e.target.value;
      else if (e.target.id === 'f-est') this.estado = e.target.value;
      else return;
      this.render(container);
      UI.icons();
    };
  },

  estadoBadge(i) {
    if (i.pagado) return '<span class="badge badge-success">Pagado</span>';
    if (i.dias < 0) return `<span class="badge badge-danger">Vencido hace ${-i.dias} ${-i.dias === 1 ? 'día' : 'días'}</span>`;
    if (i.dias === 0) return '<span class="badge badge-warning">Vence hoy</span>';
    if (i.dias <= 3) return `<span class="badge badge-warning">Vence en ${i.dias} ${i.dias === 1 ? 'día' : 'días'}</span>`;
    return `<span class="badge">Paga el ${Utils.formatDate(i.fechaPago)}</span>`;
  },

  card(i) {
    const pct = Math.min(100, (i.abonado / i.total) * 100 || 0);
    return `
      <div class="card item">
        <div class="item-head">
          <div>
            <div class="item-name">${Utils.esc(i.cliente)}</div>
            <div class="item-meta"><span>${Utils.esc(i.concepto)}</span></div>
          </div>
          ${this.estadoBadge(i)}
        </div>

        <div>
          <div class="profit ${i.pagado ? 'positive' : (i.dias < 0 ? 'negative' : '')}">
            ${i.pagado ? Fiados.fmt(i.total, i.moneda) : Fiados.fmt(i.pendiente, i.moneda)}
            <small>${i.pagado ? 'Total pagado' : `Debe · equivale hoy a ${Fiados.otra(i.pendiente, i.moneda)}`}</small>
          </div>
          ${i.abonos.length && !i.pagado ? `
            <div class="progress mt"><span style="width:${pct}%"></span></div>
            <div class="item-meta" style="margin-top:6px">
              Ha abonado <b>${Fiados.fmt(i.abonado, i.moneda)}</b> de <b>${Fiados.fmt(i.total, i.moneda)}</b>
            </div>` : ''}
        </div>

        <div class="item-foot">
          <div class="item-meta"><span>Fiado el <b>${Utils.formatDate(i.fecha)}</b></span></div>
          <div class="item-actions">
            ${!i.pagado ? `<button class="btn btn-primary btn-sm" data-action="cobrar" data-id="${i.id}"><i data-lucide="hand-coins"></i> Cobrar</button>` : ''}
            ${i.abonos.length ? `<button class="icon-btn" data-action="deshacer" data-id="${i.id}" aria-label="Deshacer último pago"><i data-lucide="undo-2"></i></button>` : ''}
            ${i.manual ? `<button class="icon-btn" data-action="borrar" data-id="${i.id}" aria-label="Borrar"><i data-lucide="trash-2"></i></button>` : ''}
          </div>
        </div>
      </div>`;
  }
};