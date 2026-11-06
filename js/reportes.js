/* =========================================================
   REPORTES - Lo más vendido, mejores días, ganancia por mes
   Todo se calcula con las ventas, gastos y pérdidas ya
   registradas. Los montos están en dólares.
   ========================================================= */

Modules.reportes = {
  periodo: 'mes',
  orden: 'unidades',
  
  // Rango de fechas del período elegido
  rango(periodo) {
    const hoy = new Date();
    const iso = d => Utils.toISODate(d);
    if (periodo === 'hoy') return { desde: iso(hoy), hasta: iso(hoy), etiqueta: 'de hoy' };
    if (periodo === 'semana') {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return { desde: iso(d), hasta: iso(hoy), etiqueta: 'de los últimos 7 días' };
    }
    if (periodo === 'mes') {
      return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: iso(hoy), etiqueta: 'de este mes' };
    }
    if (periodo === 'mespasado') {
      const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
      return { desde: iso(ini), hasta: iso(fin), etiqueta: 'del mes pasado' };
    }
    return { desde: '0000-00-00', hasta: '9999-99-99', etiqueta: 'en total' };
  },
  
  // Ventas, ganancia, gastos y pérdidas entre dos fechas
  calcular(desde, hasta, todasVentas, movs, mermas) {
    const ventas = todasVentas.filter(v => v.fecha >= desde && v.fecha <= hasta);
    const total = ventas.reduce((a, v) => a + v.total, 0);
    const bruta = ventas.reduce((a, v) => a + v.total - v.cantidad * v.costoUnit, 0);
    const gastos = movs
      .filter(m => m.tipo === 'gasto' && m.fecha >= desde && m.fecha <= hasta && m.categoria !== 'Ajuste de caja' && m.categoria !== 'Cambio de divisas')
      .reduce((a, m) => a + (m.moneda === 'BS' ? Tasa.toUsd(m.monto) : m.monto), 0);
    const perdidas = mermas
      .filter(m => m.fecha >= desde && m.fecha <= hasta)
      .reduce((a, m) => a + m.costo, 0);
    return { ventas, total, bruta, gastos, perdidas, neta: bruta - gastos - perdidas };
  },
  
  render(container) {
    const r = this.rango(this.periodo);
    const todasVentas = Store.all('ventas');
    const movs = Store.all('movimientos');
    const mermas = Store.all('mermas');
    const catDe = new Map(Store.all('productos').map(p => [p.id, p.categoria || 'Otros']));
    
    const c = this.calcular(r.desde, r.hasta, todasVentas, movs, mermas);
    const ventas = c.ventas;
    const ticket = ventas.length ? c.total / ventas.length : 0;
    const mayorPct = c.total ? (ventas.filter(v => v.tipo === 'negocio').reduce((a, v) => a + v.total, 0) / c.total) * 100 : 0;
    const gan = v => v.total - v.cantidad * v.costoUnit;
    
    /* ----- Productos más vendidos ----- */
    const gp = new Map();
    ventas.forEach(v => {
      const k = Inventario.norm(v.nombre.trim());
      const g = gp.get(k) || { nombre: v.nombre, unidades: 0, ingresos: 0, ganancia: 0 };
      g.unidades += v.cantidad;
      g.ingresos += v.total;
      g.ganancia += gan(v);
      gp.set(k, g);
    });
    const metrica = this.orden === 'ganancia' ? 'ganancia' : 'unidades';
    const top = [...gp.values()].sort((a, b) => b[metrica] - a[metrica]).slice(0, 8);
    const maxTop = Math.max(...top.map(t => t[metrica]), 0.0001);
    
    /* ----- Por categoría ----- */
    const gc = new Map();
    ventas.forEach(v => {
      const k = catDe.get(v.productoId) || 'Otros';
      const g = gc.get(k) || { nombre: k, total: 0, ganancia: 0 };
      g.total += v.total;
      g.ganancia += gan(v);
      gc.set(k, g);
    });
    const cats = [...gc.values()].sort((a, b) => b.total - a.total);
    
    /* ----- Día de la semana ----- */
    const porDia = [0, 0, 0, 0, 0, 0, 0];
    ventas.forEach(v => {
      const [y, m, d] = v.fecha.split('-').map(Number);
      porDia[new Date(y, m - 1, d).getDay()] += v.total;
    });
    const ordenDias = [1, 2, 3, 4, 5, 6, 0];
    const corto = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const largo = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const maxDia = Math.max(...porDia, 0.0001);
    const mejorDia = porDia.indexOf(Math.max(...porDia));
    
    /* ----- Mejores clientes ----- */
    const gcli = new Map();
    ventas.filter(v => v.cliente).forEach(v => {
      const k = Clientes.clave(v.cliente);
      const g = gcli.get(k) || { nombre: v.cliente, total: 0, n: 0 };
      g.total += v.total;
      g.n += 1;
      gcli.set(k, g);
    });
    const clientes = [...gcli.values()].sort((a, b) => b.total - a.total).slice(0, 5);
    const maxCli = Math.max(...clientes.map(x => x.total), 0.0001);
    
    /* ----- Mes a mes (últimos 6 meses) ----- */
    const hoy = new Date();
    const meses = [];
    for (let i = 5; i >= 0; i--) {
      const ini = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 0);
      const m = this.calcular(Utils.toISODate(ini), Utils.toISODate(fin), todasVentas, movs, mermas);
      meses.push({ label: ini.toLocaleDateString('es-VE', { month: 'short' }), neta: m.neta, actual: i === 0 });
    }
    const maxMes = Math.max(...meses.map(m => m.neta), 0.0001);
    
    container.innerHTML = `
      <div class="toolbar">
        <select id="r-per">
          <option value="hoy" ${this.periodo === 'hoy' ? 'selected' : ''}>Hoy</option>
          <option value="semana" ${this.periodo === 'semana' ? 'selected' : ''}>Últimos 7 días</option>
          <option value="mes" ${this.periodo === 'mes' ? 'selected' : ''}>Este mes</option>
          <option value="mespasado" ${this.periodo === 'mespasado' ? 'selected' : ''}>Mes pasado</option>
          <option value="todo" ${this.periodo === 'todo' ? 'selected' : ''}>Todo</option>
        </select>
      </div>

      <div class="grid grid-4">
        ${this.stat('shopping-bag', 'Vendido ' + r.etiqueta, Utils.usd(c.total), Utils.bs(Tasa.toBs(c.total)))}
        ${this.stat('trending-up', 'Ganancia en ventas', Utils.usd(c.bruta), Utils.bs(Tasa.toBs(c.bruta)))}
        ${this.stat('minus-circle', 'Gastos y pérdidas', Utils.usd(c.gastos + c.perdidas), `gastos ${Utils.usd(c.gastos)} · mermas ${Utils.usd(c.perdidas)}`)}
        ${this.stat('badge-dollar-sign', 'Ganancia neta', Utils.usd(c.neta), Utils.bs(Tasa.toBs(c.neta)), c.neta >= 0 ? 'positive' : 'negative')}
      </div>

      <div class="muted" style="font-size:.85rem;margin:12px 4px 0">
        ${ventas.length} venta(s) · cada venta promedia ${Utils.usd(ticket)} · ${Utils.fmt(mayorPct, 0)}% fue al mayor
      </div>

      <div class="grid grid-split mt">
        <div class="card">
          <div class="row-between" style="margin-bottom:12px">
            <div class="card-title" style="margin:0">Lo más vendido</div>
            <select id="r-ord" style="padding:8px 10px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface);font-weight:600;font-size:.82rem;color:var(--text)">
              <option value="unidades" ${this.orden === 'unidades' ? 'selected' : ''}>Por unidades</option>
              <option value="ganancia" ${this.orden === 'ganancia' ? 'selected' : ''}>Por ganancia</option>
            </select>
          </div>
          ${top.length ? top.map((t, i) => `
            <div class="cat-row">
              <div class="row-between">
                <b>${i + 1}. ${Utils.esc(t.nombre)}</b>
                <span>${this.orden === 'ganancia' ? Utils.usd(t.ganancia) : Inventario.q(t.unidades) + ' uds'}</span>
              </div>
              <div class="progress"><span style="width:${Math.max((t[metrica] / maxTop) * 100, 2)}%"></span></div>
              <div class="muted" style="font-size:.76rem">
                ${Inventario.q(t.unidades)} uds · vendido ${Utils.usd(t.ingresos)} · ganancia ${Utils.usd(t.ganancia)}
              </div>
            </div>`).join('') : '<p class="muted">No hay ventas en este período.</p>'}
        </div>

        <div class="card">
          <div class="card-title">Ventas por categoría</div>
          ${cats.length ? cats.map(k => `
            <div class="cat-row">
              <div class="row-between">
                <b>${Utils.esc(k.nombre)}</b>
                <span>${Utils.usd(k.total)} · ${Utils.fmt(c.total ? (k.total / c.total) * 100 : 0, 0)}%</span>
              </div>
              <div class="progress"><span style="width:${c.total ? (k.total / c.total) * 100 : 0}%"></span></div>
              <div class="muted" style="font-size:.76rem">Ganancia ${Utils.usd(k.ganancia)}</div>
            </div>`).join('') : '<p class="muted">No hay ventas en este período.</p>'}
        </div>
      </div>

      <div class="grid grid-split mt">
        <div class="card">
          <div class="card-title">Ventas por día de la semana</div>
          <div class="bars">
            ${ordenDias.map(i => `
              <div class="bar-col ${porDia[i] > 0 && i === mejorDia ? 'today' : ''}">
                <span class="bar-val">${porDia[i] ? Utils.fmt(porDia[i], 0) : ''}</span>
                <div class="bar-track"><div class="bar" style="height:${(porDia[i] / maxDia) * 100}%"></div></div>
                <span class="bar-day">${corto[i]}</span>
              </div>`).join('')}
          </div>
          <div class="muted" style="font-size:.82rem;margin-top:10px">
            ${porDia[mejorDia] > 0 ? `Tu mejor día es el <b>${largo[mejorDia]}</b> (${Utils.usd(porDia[mejorDia])}).` : 'Aún no hay ventas en este período.'}
          </div>
        </div>

        <div class="card">
          <div class="card-title">Mejores clientes</div>
          ${clientes.length ? clientes.map((k, i) => `
            <div class="cat-row">
              <div class="row-between">
                <b>${i + 1}. ${Utils.esc(k.nombre)}</b>
                <span>${Utils.usd(k.total)}</span>
              </div>
              <div class="progress"><span style="width:${Math.max((k.total / maxCli) * 100, 2)}%"></span></div>
              <div class="muted" style="font-size:.76rem">${k.n} compra(s)</div>
            </div>`).join('') : '<p class="muted">Aún no hay ventas con nombre de cliente en este período.</p>'}
        </div>
      </div>

      <div class="card mt">
        <div class="card-title">Ganancia neta mes a mes</div>
        <div class="bars">
          ${meses.map(m => `
            <div class="bar-col ${m.actual ? 'today' : ''}">
              <span class="bar-val" ${m.neta < 0 ? 'style="color:var(--danger)"' : ''}>${Utils.fmt(m.neta, 0)}</span>
              <div class="bar-track">
                <div class="bar" style="height:${Math.max(m.neta, 0) / maxMes * 100}%${m.neta < 0 ? ';background:var(--danger)' : ''}"></div>
              </div>
              <span class="bar-day">${m.label}</span>
            </div>`).join('')}
        </div>
        <div class="muted" style="font-size:.76rem;margin-top:8px">
          Ganancia de las ventas menos gastos y pérdidas. Montos en dólares.
        </div>
      </div>
    `;
    
    container.onchange = e => {
      if (e.target.id === 'r-per') this.periodo = e.target.value;
      else if (e.target.id === 'r-ord') this.orden = e.target.value;
      else return;
      this.render(container);
      UI.icons();
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
  }
};