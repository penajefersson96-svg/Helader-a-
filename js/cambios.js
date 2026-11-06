/* =========================================================
   CAMBIOS - Cambio de divisas a la tasa del trato
   Cuando cambias Bs por $ (o $ por Bs) a una tasa distinta del
   BCV (ej: 1$ = 1.100 Bs), aquí queda anotado:
   - Se mueve la caja: sale una moneda y entra la otra.
   - Queda la tasa del trato y cuánto ganaste o perdiste
     frente al BCV de ese día.
   Cada cambio se guarda como DOS movimientos de caja con la
   categoría "Cambio de divisas" y el mismo cambioId, así viaja
   en los respaldos sin tocar nada más.
   ========================================================= */

const Cambios = {
  CAT: 'Cambio de divisas',

  _red(n, d) { return Math.round(n * 10 ** d) / 10 ** d; },

  // Un renglón por operación, del más nuevo al más viejo
  lista() {
    const vistos = new Map();
    Store.all('movimientos').forEach(m => {
      const c = m.cambio;
      if (!m.cambioId || !c || vistos.has(m.cambioId)) return;
      if (!(c.tipo === 'compra' || c.tipo === 'venta')) return;
      if (![c.usd, c.bs, c.tasa].every(x => Number.isFinite(x) && x > 0)) return;
      vistos.set(m.cambioId, {
        id: m.cambioId, fecha: m.fecha, creado: m.creado || '',
        tipo: c.tipo, usd: c.usd, bs: c.bs, tasa: c.tasa, bcv: Number.isFinite(c.bcv) ? c.bcv : 0
      });
    });
    return [...vistos.values()].sort((a, b) =>
      (b.fecha || '').localeCompare(a.fecha || '') || b.creado.localeCompare(a.creado));
  },

  // Ganancia (+) o pérdida (−) en Bs frente al BCV de ese día. null si no había tasa.
  difBcv(c) {
    if (!(c.bcv > 0)) return null;
    const dif = c.bs - c.usd * c.bcv;
    return c.tipo === 'venta' ? dif : -dif;   // vender más caro gana; comprar más caro pierde
  },

  /* ---------- Tarjeta para la sección Dólar ---------- */
  fila(c) {
    const dif = this.difBcv(c);
    return `
      <div class="mov">
        <div class="mov-icon ${c.tipo === 'compra' ? 'in' : 'out'}"><i data-lucide="repeat"></i></div>
        <div class="mov-info">
          <b>${c.tipo === 'compra' ? 'Compré' : 'Vendí'} ${Utils.usd(c.usd)} a ${Utils.bs(c.tasa)}</b>
          <span>${Utils.formatDate(c.fecha)} · ${Utils.bs(c.bs)}${dif === null ? '' : ` · ${dif >= 0 ? 'ganaste' : 'perdiste'} ${Utils.bs(Math.abs(dif))} vs BCV`}</span>
        </div>
        <button class="icon-btn" data-cambio-del="${Utils.esc(c.id)}" aria-label="Borrar"><i data-lucide="trash-2"></i></button>
      </div>`;
  },

  cardHtml() {
    const todos = this.lista();
    const mes = Caja.desde('mes');
    const prom = tipo => {
      const arr = todos.filter(c => c.tipo === tipo && c.fecha >= mes);
      const usd = arr.reduce((a, c) => a + c.usd, 0);
      const bs = arr.reduce((a, c) => a + c.bs, 0);
      return usd > 0 ? { usd, tasa: bs / usd } : null;
    };
    const pc = prom('compra'), pv = prom('venta');

    return `
      <div class="card" id="cambios-card">
        <div class="card-title">Cambio de divisas</div>
        <p class="muted" style="font-size:.85rem;margin-bottom:10px">
          Anota cuando cambias Bs por $ (o al revés) a la tasa del trato. Se mueve tu caja y queda la diferencia contra el BCV.
        </p>
        <div class="row">
          <button class="btn btn-primary" data-cambio="compra"><i data-lucide="arrow-down-left"></i> Compré $</button>
          <button class="btn btn-soft" data-cambio="venta"><i data-lucide="arrow-up-right"></i> Vendí $</button>
        </div>
        ${pc || pv ? `
          <div class="item-meta" style="flex-direction:column;margin-top:10px">
            ${pc ? `<span>Este mes compraste <b>${Utils.usd(pc.usd)}</b> a un promedio de <b>${Utils.bs(pc.tasa)}</b></span>` : ''}
            ${pv ? `<span>Este mes vendiste <b>${Utils.usd(pv.usd)}</b> a un promedio de <b>${Utils.bs(pv.tasa)}</b></span>` : ''}
          </div>` : ''}
        ${todos.length ? `<div style="margin-top:10px">${todos.slice(0, 8).map(c => this.fila(c)).join('')}</div>` : ''}
      </div>`;
  },

  montar(container) {
    const card = container.querySelector('#cambios-card');
    if (!card) return;
    card.addEventListener('click', e => {
      const a = e.target.closest('[data-cambio]');
      if (a) return this.abrir(a.dataset.cambio);
      const d = e.target.closest('[data-cambio-del]');
      if (d) this.borrar(d.dataset.cambioDel);
    });
  },

  borrar(id) {
    if (!Seguridad.dueno()) return UI.toast('Solo el dueño puede borrar cambios', 'error');
    if (!UI.confirm('¿Borrar este cambio? También se devuelve el dinero a la caja como estaba.')) return;
    Store.set('movimientos', Store.all('movimientos').filter(m => m.cambioId !== id));
    UI.toast('Cambio borrado');
  },

  /* ---------- Ventana para registrar un cambio ---------- */
  abrir(tipo = 'compra') {
    if (!Seguridad.dueno()) return UI.toast('Solo el dueño puede registrar cambios', 'error');
    const bcv = Tasa.valor();
    const sel = (a, b) => (a === b ? 'selected' : '');

    UI.openModal('Cambio de divisas', `
      <form class="form" id="cambio-form" autocomplete="off">
        <div class="field">
          <label>¿Qué hiciste?</label>
          <select name="tipo">
            <option value="compra" ${sel(tipo, 'compra')}>Compré dólares (entregué Bs)</option>
            <option value="venta" ${sel(tipo, 'venta')}>Vendí dólares (recibí Bs)</option>
          </select>
        </div>
        <div class="field">
          <label>Dólares ($)</label>
          <input name="usd" type="text" inputmode="decimal" placeholder="0,00">
        </div>
        <div class="field">
          <label>Tasa del trato (Bs por 1 $)</label>
          <input name="tasa" type="text" inputmode="decimal" placeholder="Ej: 1100" value="${bcv > 0 ? this._red(bcv, 4) : ''}">
        </div>
        <div class="field">
          <label>Bolívares (Bs)</label>
          <input name="bs" type="text" inputmode="decimal" placeholder="0,00">
        </div>
        <p class="hint">Escribe dos de los tres y el otro se calcula solo.</p>
        <div class="field">
          <label>Fecha</label>
          <input name="fecha" type="date" value="${Utils.today()}">
        </div>
        <div class="preview" id="cambio-prev"></div>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="repeat"></i> Registrar cambio</button>
      </form>`, body => {
      const f = body.querySelector('#cambio-form');
      const prev = body.querySelector('#cambio-prev');
      const num = el => Utils.num(el.value);

      // Dos de los tres datos mandan; el tercero se calcula
      f.addEventListener('input', e => {
        const n = e.target.name;
        const usd = num(f.usd), tasa = num(f.tasa), bs = num(f.bs);
        if (n === 'usd') {
          f.bs.value = usd > 0 && tasa > 0 ? this._red(usd * tasa, 2) : '';
        } else if (n === 'bs') {
          if (bs > 0 && tasa > 0) f.usd.value = this._red(bs / tasa, 2);
          else if (bs > 0 && usd > 0) f.tasa.value = this._red(bs / usd, 4);
        } else if (n === 'tasa') {
          if (usd > 0 && tasa > 0) f.bs.value = this._red(usd * tasa, 2);
          else if (bs > 0 && tasa > 0) f.usd.value = this._red(bs / tasa, 2);
        }
        pintar();
      });
      f.tipo.addEventListener('change', () => pintar());

      const pintar = () => {
        const usd = num(f.usd), bs = num(f.bs), t = f.tipo.value;
        if (!(usd > 0 && bs > 0)) {
          prev.innerHTML = '<div><span>Escribe dos datos para ver el resultado</span></div>';
          return;
        }
        const tasa = bs / usd;
        let html = `
          <div><span>Entregas</span><b>${t === 'compra' ? Utils.bs(bs) : Utils.usd(usd)}</b></div>
          <div><span>Recibes</span><b>${t === 'compra' ? Utils.usd(usd) : Utils.bs(bs)}</b></div>
          <div><span>Tasa del trato</span><b>${Utils.bs(tasa)} por $</b></div>`;
        if (bcv > 0) {
          const dif = (bs - usd * bcv) * (t === 'venta' ? 1 : -1);
          const pct = Math.abs(tasa / bcv - 1) * 100;
          html += `
            <div><span>BCV hoy</span><b>${Utils.bs(bcv)}</b></div>
            <div><span>${dif >= 0 ? 'Ganas' : 'Pierdes'} frente al BCV</span>
              <b class="${dif >= 0 ? 'positive' : 'negative'}">${Utils.bs(Math.abs(dif))} · ${Utils.fmt(pct, 1)}%</b></div>`;
        }
        prev.innerHTML = html;
      };
      pintar();

      f.addEventListener('submit', e => {
        e.preventDefault();
        const t = f.tipo.value;
        const usd = this._red(num(f.usd), 2), bs = this._red(num(f.bs), 2);
        if (!(usd > 0)) return UI.toast('Escribe los dólares', 'error');
        if (!(bs > 0)) return UI.toast('Escribe los bolívares', 'error');
        const tasa = this._red(bs / usd, 4);
        if (!(tasa > 0 && tasa < 1e7)) return UI.toast('La tasa no parece correcta', 'error');
        if (usd > 1e9 || bs > 1e12) return UI.toast('Esos montos son demasiado grandes', 'error');

        // ¿Alcanza lo que entregas?
        const saldo = Caja.saldo(Caja.movimientos());
        const entrega = t === 'compra' ? { m: 'BS', v: bs } : { m: 'USD', v: usd };
        if (entrega.v - saldo[entrega.m] > 0.005 &&
            !UI.confirm(`En tu caja hay ${Caja.fmt(saldo[entrega.m], entrega.m)} y vas a entregar ${Caja.fmt(entrega.v, entrega.m)}. ¿Registrar de todas formas?`)) return;

        const cambioId = Utils.uid();
        const fecha = f.fecha.value || Utils.today();
        const resumen = `${t === 'compra' ? 'Compré' : 'Vendí'} ${Utils.usd(usd)} a ${Utils.bs(tasa)}`;
        const base = {
          categoria: this.CAT, fecha, cambioId,
          concepto: 'Cambio: ' + resumen,
          cambio: { tipo: t, usd, bs, tasa, bcv: this._red(bcv, 4) }
        };
        // Compra: sale Bs, entra $.  Venta: sale $, entra Bs.
        Store.add('movimientos', { ...base, tipo: t === 'compra' ? 'gasto' : 'ingreso', monto: bs, moneda: 'BS' });
        Store.add('movimientos', { ...base, tipo: t === 'compra' ? 'ingreso' : 'gasto', monto: usd, moneda: 'USD' });

        UI.closeModal();
        UI.toast('Cambio registrado');
      });
    });
  }
};