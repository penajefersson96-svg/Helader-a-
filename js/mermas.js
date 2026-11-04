/* =========================================================
   MERMAS - Pérdidas de mercancía (derretido, vencido, roto...)
   Colección "mermas":
   { id, productoId, nombre, cantidad, motivo, nota, fecha,
     costoUnit (USD), costo (USD total perdido) }
   Descuentan de las existencias y restan de la ganancia.
   ========================================================= */

const Mermas = {
  motivos: ['Se derritió', 'Vencido', 'Dañado o roto', 'Regalo o muestra', 'Consumo propio', 'Otro'],

  /* ---------- Registrar una pérdida ---------- */
  nueva(productoId) {
    const ventas = Store.all('ventas');
    const disponibles = Store.all('productos')
      .map(p => ({ p, s: Inventario.stats(p, ventas) }))
      .filter(d => d.s.restante > 0);

    if (!disponibles.length) return UI.toast('No hay mercancía disponible', 'error');

    const html = `
      <form class="form" id="merma-form" autocomplete="off">
        <div class="field has-picker">
          <label>Producto</label>
          <input type="text" id="merma-buscar" placeholder="Escribe una letra o el nombre" autocomplete="off">
          <input type="hidden" name="producto" value="">
          <div class="picker hidden" id="merma-picker"></div>
        </div>

        <div class="form-row">
          <div class="field">
            <label>Cantidad perdida</label>
            <input name="cantidad" type="text" inputmode="decimal" placeholder="1" value="1">
          </div>
          <div class="field">
            <label>Motivo</label>
            <select name="motivo">
              ${this.motivos.map(m => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="field">
            <label>Fecha</label>
            <input name="fecha" type="date" value="${Utils.today()}">
          </div>
          <div class="field">
            <label>Nota (opcional)</label>
            <input name="nota" type="text" placeholder="Ej: se fue la luz">
          </div>
        </div>

        <div class="preview" id="merma-preview"></div>

        <button type="submit" class="btn btn-danger btn-block">
          <i data-lucide="package-x"></i> Registrar pérdida
        </button>
      </form>`;

    UI.openModal('Registrar pérdida', html, body => {
      const f = body.querySelector('#merma-form');
      const prev = body.querySelector('#merma-preview');
      const buscar = body.querySelector('#merma-buscar');
      const actual = () => disponibles.find(d => d.p.id === f.producto.value);
      let pk = null;

      const actualizar = () => {
        const d = actual();
        if (!d) { prev.innerHTML = '<div><span>Elige un producto</span></div>'; return; }
        const costo = Utils.num(f.cantidad.value) * d.p.costo;
        prev.innerHTML = `
          <div><span>Quedan</span><b>${Inventario.q(d.s.restante)}</b></div>
          <div><span>Lo que pierdes (costo)</span><b>${Utils.usd(costo)} · ${Utils.bs(Tasa.toBs(costo))}</b></div>`;
      };

      const seleccionar = id => {
        f.producto.value = id;
        const d = actual();
        if (pk) pk.fijar(d.p.nombre);
        actualizar();
        f.cantidad.focus();
        f.cantidad.select();
      };

      pk = Picker.attach({
        input: buscar,
        list: body.querySelector('#merma-picker'),
        items: disponibles.map(d => ({
          id: d.p.id, nombre: d.p.nombre, categoria: d.p.categoria,
          sub: `quedan ${Inventario.q(d.s.restante)}`,
          precio: Utils.usd(d.p.costo) + ' c/u', pop: d.s.vendidos
        })),
        onSelect: item => seleccionar(item.id),
        onClear: () => { f.producto.value = ''; actualizar(); }
      });

      f.addEventListener('input', actualizar);

      if (productoId && disponibles.some(d => d.p.id === productoId)) seleccionar(productoId);
      else { actualizar(); buscar.focus(); }

      f.addEventListener('submit', e => {
        e.preventDefault();
        const d = actual();
        if (!d) return UI.toast('Elige un producto de la lista', 'error');
        const cantidad = Utils.num(f.cantidad.value);
        if (cantidad <= 0) return UI.toast('Escribe la cantidad', 'error');
        if (cantidad > d.s.restante) return UI.toast(`Solo quedan ${Inventario.q(d.s.restante)}`, 'error');

        Store.add('mermas', {
          productoId: d.p.id, nombre: d.p.nombre, cantidad,
          motivo: f.motivo.value, nota: f.nota.value.trim(),
          fecha: f.fecha.value || Utils.today(),
          costoUnit: d.p.costo, costo: cantidad * d.p.costo
        });
        UI.closeModal();
        UI.toast('Pérdida registrada');
      });
    });
  },

  /* ---------- Lista de pérdidas ---------- */
  lista() {
    const todas = Store.all('mermas').slice().sort((a, b) =>
      (b.fecha || '').localeCompare(a.fecha || '') || (b.creado || '').localeCompare(a.creado || ''));
    const mes = Caja.desde('mes');
    const total = todas.reduce((a, m) => a + m.costo, 0);
    const totalMes = todas.filter(m => m.fecha >= mes).reduce((a, m) => a + m.costo, 0);

    // Motivo que más pérdida causa
    const porMotivo = {};
    todas.forEach(m => { porMotivo[m.motivo] = (porMotivo[m.motivo] || 0) + m.costo; });
    const top = Object.entries(porMotivo).sort((a, b) => b[1] - a[1])[0];

    const html = `
      <div class="preview" style="margin-bottom:12px">
        <div><span>Perdido este mes</span><b class="neg">${Utils.usd(totalMes)}</b></div>
        <div><span>Perdido en total</span><b>${Utils.usd(total)}</b></div>
        ${top ? `<div><span>Lo que más pierdes</span><b>${Utils.esc(top[0])}</b></div>` : ''}
      </div>
      <button class="btn btn-danger btn-block" data-new="1" style="margin-bottom:8px">
        <i data-lucide="plus"></i> Registrar pérdida
      </button>
      ${todas.length ? todas.slice(0, 60).map(m => `
        <div class="mov">
          <div class="mov-icon out"><i data-lucide="package-x"></i></div>
          <div class="mov-info">
            <b>${Utils.esc(m.nombre)} × ${Inventario.q(m.cantidad)}</b>
            <span>${Utils.formatDate(m.fecha)} · ${Utils.esc(m.motivo)}${m.nota ? ' · ' + Utils.esc(m.nota) : ''}</span>
          </div>
          <div class="mov-amount out">− ${Utils.usd(m.costo)}</div>
          <button class="icon-btn" data-del="${m.id}" aria-label="Borrar"><i data-lucide="trash-2"></i></button>
        </div>`).join('') : '<p class="muted" style="margin-top:12px">Aún no has registrado pérdidas.</p>'}
    `;

    UI.openModal('Pérdidas de mercancía', html, body => {
      body.onclick = e => {
        if (e.target.closest('[data-new]')) return this.nueva();
        const del = e.target.closest('[data-del]');
        if (del && UI.confirm('¿Borrar esta pérdida? La mercancía vuelve al inventario.')) {
          Store.remove('mermas', del.dataset.del);
          this.lista();
        }
      };
    });
  }
};