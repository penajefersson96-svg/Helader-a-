/* =========================================================
   CLIENTES - Personas y negocios a los que vendes
   Se arma con dos fuentes:
   - Directorio guardado (colección "clientes")
   - Nombres que aparecen en ventas y deudas (se crean solos)
   Las ventas se enlazan por nombre.
   ========================================================= */

const Clientes = {
  clave(n) { return Inventario.norm(String(n || '').trim()); },

  lista() {
    const mapa = new Map();
    Store.all('clientes').forEach(c => mapa.set(this.clave(c.nombre), { ...c, guardado: true }));

    const agregar = (nombre, negocio) => {
      const n = String(nombre || '').trim();
      if (!n) return;
      const k = this.clave(n);
      if (!mapa.has(k)) {
        mapa.set(k, {
          id: null, nombre: n, tipo: negocio ? 'negocio' : 'persona',
          telefono: '', direccion: '', rif: '', notas: '', guardado: false
        });
      } else if (negocio && !mapa.get(k).guardado) {
        mapa.get(k).tipo = 'negocio';
      }
    };
    Store.all('ventas').forEach(v => agregar(v.cliente, v.tipo === 'negocio'));
    Store.all('deudas').forEach(d => agregar(d.cliente, false));

    return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  },

  buscar(nombre) {
    const k = this.clave(nombre);
    return this.lista().find(c => this.clave(c.nombre) === k) || null;
  },

  stats(c, ventas, deudas, facturas) {
    const k = this.clave(c.nombre);
    const mias = ventas.filter(v => this.clave(v.cliente) === k);
    return {
      n: mias.length,
      total: mias.reduce((a, v) => a + v.total, 0),
      ultima: mias.reduce((m, v) => (v.fecha > m ? v.fecha : m), ''),
      debe: deudas.filter(i => this.clave(i.cliente) === k)
        .reduce((a, i) => a + Fiados.eqUsd(i.pendiente, i.moneda), 0),
      facturas: facturas.filter(f => this.clave(f.cliente) === k).length
    };
  },

  // Enlace de WhatsApp (números venezolanos: 0412... -> 58412...)
  wa(tel, texto) {
    let d = String(tel || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = '58' + d.slice(1);
    else if (d.length === 10) d = '58' + d;
    return `https://wa.me/${d}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
  },

  // Si se cambia el nombre, se actualiza en todas las ventas, deudas y facturas
  renombrar(viejo, nuevo) {
    const k = this.clave(viejo);
    ['ventas', 'deudas', 'facturas'].forEach(col => {
      const l = Store.all(col);
      if (l.some(x => this.clave(x.cliente) === k)) {
        Store.set(col, l.map(x => (this.clave(x.cliente) === k ? { ...x, cliente: nuevo } : x)));
      }
    });
  },

  form(c) {
    const v = k => (c && c[k] ? Utils.esc(c[k]) : '');
    const html = `
      <form class="form" id="cli-form" autocomplete="off">
        <div class="field">
          <label>Nombre del cliente o negocio</label>
          <input name="nombre" type="text" placeholder="Ej: Bodega San José" value="${v('nombre')}">
        </div>
        <div class="field">
          <label>Tipo</label>
          <select name="tipo">
            <option value="negocio" ${c && c.tipo === 'negocio' ? 'selected' : ''}>Negocio / comercio</option>
            <option value="persona" ${!c || c.tipo !== 'negocio' ? 'selected' : ''}>Persona</option>
          </select>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Teléfono</label>
            <input name="telefono" type="tel" inputmode="tel" placeholder="0412-1234567" value="${v('telefono')}">
          </div>
          <div class="field">
            <label>RIF o cédula</label>
            <input name="rif" type="text" placeholder="Opcional" value="${v('rif')}">
          </div>
        </div>
        <div class="field">
          <label>Dirección</label>
          <input name="direccion" type="text" placeholder="Opcional" value="${v('direccion')}">
        </div>
        <div class="field">
          <label>Notas</label>
          <input name="notas" type="text" placeholder="Ej: paga los viernes" value="${v('notas')}">
        </div>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="check"></i> Guardar</button>
      </form>`;

    UI.openModal(c ? 'Editar cliente' : 'Nuevo cliente', html, body => {
      const f = body.querySelector('#cli-form');
      f.addEventListener('submit', e => {
        e.preventDefault();
        const nombre = f.nombre.value.trim();
        if (!nombre) return UI.toast('Escribe el nombre', 'error');

        const otro = this.buscar(nombre);
        if (otro && (!c || this.clave(otro.nombre) !== this.clave(c.nombre))) {
          return UI.toast('Ya existe un cliente con ese nombre', 'error');
        }

        const datos = {
          nombre, tipo: f.tipo.value,
          telefono: f.telefono.value.trim(), rif: f.rif.value.trim(),
          direccion: f.direccion.value.trim(), notas: f.notas.value.trim()
        };

        if (c && c.guardado) Store.update('clientes', c.id, datos);
        else Store.add('clientes', datos);

        if (c && c.nombre !== nombre) this.renombrar(c.nombre, nombre);
        UI.closeModal();
        UI.toast('Cliente guardado');
      });
    });
  }
};

Modules.clientes = {
  busqueda: '',
  filtro: 'todos',
  data: [],

  render(container) {
    const ventas = Store.all('ventas');
    const deudas = Fiados.lista().filter(i => !i.pagado);
    const facturas = Store.all('facturas');
    this.data = Clientes.lista().map(c => ({ c, s: Clientes.stats(c, ventas, deudas, facturas) }));

    const conDeuda = this.data.filter(d => d.s.debe > 0);
    const totalDeben = conDeuda.reduce((a, d) => a + d.s.debe, 0);

    container.innerHTML = `
      <div class="grid grid-2">
        <div class="card stat">
          <div class="stat-icon"><i data-lucide="users"></i></div>
          <span class="stat-label">Clientes</span>
          <span class="stat-value">${this.data.length}</span>
          <span class="stat-sub">${this.data.filter(d => d.c.tipo === 'negocio').length} negocio(s)</span>
        </div>
        <div class="card stat">
          <div class="stat-icon" style="background:var(--warning-soft);color:#b45309"><i data-lucide="handshake"></i></div>
          <span class="stat-label">Te deben</span>
          <span class="stat-value">${Utils.usd(totalDeben)}</span>
          <span class="stat-sub">${conDeuda.length} cliente(s) con deuda</span>
        </div>
      </div>

      <div class="toolbar mt">
        <div class="search">
          <i data-lucide="search"></i>
          <input id="f-cli-buscar" type="search" autocomplete="off"
                 placeholder="Buscar cliente: escribe una letra o el nombre"
                 value="${Utils.esc(this.busqueda)}">
        </div>
        <button class="btn btn-primary" data-action="nuevo"><i data-lucide="user-plus"></i> Nuevo cliente</button>
        <span class="spacer"></span>
        <select id="f-cli-tipo">
          <option value="todos" ${this.filtro === 'todos' ? 'selected' : ''}>Todos</option>
          <option value="negocio" ${this.filtro === 'negocio' ? 'selected' : ''}>Negocios</option>
          <option value="persona" ${this.filtro === 'persona' ? 'selected' : ''}>Personas</option>
          <option value="deuda" ${this.filtro === 'deuda' ? 'selected' : ''}>Con deuda</option>
        </select>
      </div>

      <div id="cli-lista"></div>
    `;

    this.pintarLista(container);

    container.onclick = e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'nuevo') return Clientes.form(null);

      const nombre = btn.dataset.n;
      const c = Clientes.buscar(nombre);
      if (!c) return;
      if (a === 'editar') Clientes.form(c);
      if (a === 'factura') Factura.nueva(c.nombre);
      if (a === 'facturas') Factura.lista(c.nombre);
      if (a === 'borrar' && UI.confirm(`¿Quitar a "${c.nombre}" de tu lista? Sus ventas se conservan.`)) {
        Store.remove('clientes', c.id);
        UI.toast('Cliente quitado de la lista');
      }
    };

    container.oninput = e => {
      if (e.target.id === 'f-cli-buscar') {
        this.busqueda = e.target.value;
        this.pintarLista(container);
      }
    };

    container.onchange = e => {
      if (e.target.id === 'f-cli-tipo') { this.filtro = e.target.value; this.render(container); UI.icons(); }
    };
  },

  pintarLista(container) {
    const box = container.querySelector('#cli-lista');
    if (!box) return;
    const q = Inventario.norm(this.busqueda.trim());

    const visibles = this.data.filter(({ c, s }) =>
      (this.filtro === 'todos' || (this.filtro === 'deuda' ? s.debe > 0 : c.tipo === this.filtro)) &&
      (!q || Inventario.norm(c.nombre).includes(q) || Inventario.norm(c.telefono).includes(q))
    );

    box.innerHTML = visibles.length
      ? `<div class="list">${visibles.map(d => this.card(d)).join('')}</div>`
      : `<div class="card empty">
           <i data-lucide="users"></i>
           <p>${this.data.length ? 'No hay clientes que coincidan.' : 'Aún no tienes clientes. Aparecen solos cuando vendes con un nombre, o agrégalos aquí.'}</p>
         </div>`;
    UI.icons();
  },

  card({ c, s }) {
    const n = Utils.esc(c.nombre);
    const negocio = (Store.get('config', {}).negocio) || 'Mi Tienda';
    const msg = s.debe > 0
      ? `Hola ${c.nombre}, te escribo de ${negocio} para recordarte tu pendiente de ${Utils.usd(s.debe)}. ¡Gracias!`
      : '';
    const wa = Clientes.wa(c.telefono, msg);

    return `
      <div class="card item">
        <div class="item-head">
          <div>
            <div class="item-name">${n}</div>
            <span class="badge">${c.tipo === 'negocio' ? 'Negocio' : 'Persona'}</span>
          </div>
          ${s.debe > 0 ? `<span class="badge badge-warning">Debe ${Utils.usd(s.debe)}</span>` : ''}
        </div>

        <div class="item-meta" style="flex-direction:column">
          ${c.telefono ? `<span>Teléfono: <b>${Utils.esc(c.telefono)}</b></span>` : ''}
          ${c.direccion ? `<span>Dirección: <b>${Utils.esc(c.direccion)}</b></span>` : ''}
          ${c.rif ? `<span>RIF / C.I.: <b>${Utils.esc(c.rif)}</b></span>` : ''}
          ${c.notas ? `<span>Nota: <b>${Utils.esc(c.notas)}</b></span>` : ''}
          <span>Ha comprado <b>${Utils.usd(s.total)}</b> en <b>${s.n}</b> venta(s)${s.ultima ? ' · última el ' + Utils.formatDate(s.ultima) : ''}</span>
        </div>

        <div class="item-foot">
          <div class="item-actions" style="flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" data-action="factura" data-n="${n}"><i data-lucide="file-text"></i> Mini factura</button>
            ${s.facturas ? `<button class="btn btn-soft btn-sm" data-action="facturas" data-n="${n}">Facturas (${s.facturas})</button>` : ''}
            ${wa ? `<a class="btn btn-success btn-sm" href="${wa}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i> WhatsApp</a>` : ''}
            <button class="icon-btn" data-action="editar" data-n="${n}" aria-label="Editar"><i data-lucide="pencil"></i></button>
            ${c.guardado ? `<button class="icon-btn" data-action="borrar" data-n="${n}" aria-label="Quitar"><i data-lucide="trash-2"></i></button>` : ''}
          </div>
        </div>
      </div>`;
  }
};