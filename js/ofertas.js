/* =========================================================
   OFERTAS - Precios por cantidad (2 por $X, 3 por $X, docena...)
   - Cada producto puede tener hasta 3 ofertas: { cant, precio }
     (el precio es el de TODO el paquete, en la moneda de venta
     del producto). El sistema sugiere un precio; el dueño pone
     el final.
   - Al vender (al detal), el sistema arma la combinación más
     barata para el cliente: 14 unidades = 1 docena + 2 por $X.
   - Cada parte queda como una línea normal de venta, con su
     precio por unidad, así que devoluciones, caja, reportes y
     cierre siguen cuadrando igual.
   ========================================================= */

const Ofertas = {
  MAX: 3,

  _red(n, d) { return Math.round(n * 10 ** d) / 10 ** d; },

  // Ofertas bien formadas de un producto (ignora cualquier dato raro)
  validas(p) {
    const arr = Array.isArray(p && p.ofertas) ? p.ofertas : [];
    const vistos = new Set();
    return arr
      .filter(o => o && Number.isInteger(o.cant) && o.cant >= 2 && o.cant <= 999 &&
                   Number.isFinite(o.precio) && o.precio > 0 && !vistos.has(o.cant) && vistos.add(o.cant))
      .sort((a, b) => a.cant - b.cant)
      .slice(0, this.MAX);
  },

  // Precio de un paquete en la moneda pedida ('USD' o 'BS')
  precioEn(p, o, moneda) {
    const mia = p.precioMoneda === 'BS' ? 'BS' : 'USD';
    if (mia === moneda) return o.precio;
    return moneda === 'BS' ? this._red(Tasa.toBs(o.precio), 2) : this._red(Tasa.toUsd(o.precio), 4);
  },

  etiqueta(n, precio, moneda) {
    const m = moneda === 'BS' ? Utils.bs(precio) : Utils.usd(precio);
    return n === 12 ? `docena ${m}` : `${n} por ${m}`;
  },

  // "2 por $3,00 · docena $12,00"
  texto(p, moneda) {
    const m = moneda || (p.precioMoneda === 'BS' ? 'BS' : 'USD');
    return this.validas(p).map(o => this.etiqueta(o.cant, this.precioEn(p, o, m), m)).join(' · ');
  },

  // Precio sugerido para un paquete de n: descuento chico, sin bajar del costo + 10%
  sugerir(detal, n, moneda, costo) {
    const d = n >= 12 ? 0.10 : n >= 6 ? 0.08 : n >= 3 ? 0.05 : 0.03;
    let v = detal * n * (1 - d);
    if (costo > 0) v = Math.max(v, costo * n * 1.10);
    v = Math.min(v, detal * n);
    const paso = moneda === 'BS' ? (v >= 20 ? 1 : 0.5) : 0.05;
    return this._red(Math.round(v / paso) * paso, 2);
  },

  // Parte una cantidad en la combinación más barata para el cliente.
  // Devuelve [{ cantidad, precioOrig (por unidad), oferta (texto o null) }]
  partir(p, cantidad, moneda, unitario) {
    const entero = Math.floor(cantidad + 1e-9);
    const frac = Math.max(0, cantidad - entero);
    const paquetes = this.validas(p)
      .map(o => ({ n: o.cant, precio: this.precioEn(p, o, moneda) }))
      .filter(x => x.precio > 0);

    if (!paquetes.length || entero < 2 || entero > 100000 || !(unitario > 0)) {
      return [{ cantidad, precioOrig: unitario, oferta: null }];
    }

    const mejor = new Array(entero + 1).fill(0);
    const via = new Array(entero + 1).fill(-1);
    for (let i = 1; i <= entero; i++) {
      mejor[i] = mejor[i - 1] + unitario;           // por unidad
      via[i] = -1;
      paquetes.forEach((pk, j) => {
        if (i >= pk.n && mejor[i - pk.n] + pk.precio < mejor[i] - 1e-9) {
          mejor[i] = mejor[i - pk.n] + pk.precio;
          via[i] = j;
        }
      });
    }

    const cuentas = paquetes.map(() => 0);
    let sueltas = 0;
    for (let i = entero; i > 0;) {
      const j = via[i];
      if (j === -1) { sueltas++; i--; } else { cuentas[j]++; i -= paquetes[j].n; }
    }

    const out = [];
    paquetes
      .map((pk, j) => ({ pk, k: cuentas[j] }))
      .filter(x => x.k > 0)
      .sort((a, b) => b.pk.n - a.pk.n)
      .forEach(({ pk, k }) => out.push({
        cantidad: k * pk.n,
        precioOrig: pk.precio / pk.n,
        oferta: this.etiqueta(pk.n, pk.precio, moneda)
      }));
    if (sueltas + frac > 0) out.push({ cantidad: sueltas + frac, precioOrig: unitario, oferta: null });
    return out;
  },

  // Total en dólares de una cantidad al detal, con ofertas
  totalUsd(p, cantidad) {
    return this.partir(p, cantidad, 'USD', Inventario.precioDetal(p))
      .reduce((a, x) => a + x.cantidad * x.precioOrig, 0);
  },

  // Carrito de Ventas: junta las líneas "automáticas" de un mismo producto y las parte.
  // Las líneas con el precio cambiado a mano no se tocan.
  // unitarioFn(p, moneda) = precio normal por unidad en esa moneda
  expandir(lista, aplicar, unitarioFn) {
    const grupos = new Map();
    lista.forEach(l => {
      if (!(l.auto && aplicar && this.validas(l.p).length)) return;
      const k = l.p.id + '|' + l.moneda;
      const g = grupos.get(k) || { p: l.p, moneda: l.moneda, cantidad: 0 };
      g.cantidad += l.cantidad;
      grupos.set(k, g);
    });

    const out = [];
    const hechos = new Set();
    lista.forEach(l => {
      const k = l.p.id + '|' + l.moneda;
      if (!l.auto || !grupos.has(k)) { out.push(l); return; }
      if (hechos.has(k)) return;
      hechos.add(k);
      const g = grupos.get(k);
      this.partir(g.p, g.cantidad, g.moneda, unitarioFn(g.p, g.moneda)).forEach(x => {
        out.push({ p: g.p, cantidad: x.cantidad, precioOrig: x.precioOrig, moneda: g.moneda, auto: true, oferta: x.oferta });
      });
    });
    return out;
  },

  /* ---------- Parte del formulario de Mercancía ---------- */
  formHtml(p, limpio) {
    const ya = this.validas(p || {});
    const fila = i => {
      const o = ya[i];
      return `
        <div class="form-row">
          <div class="field"><input name="ofc${i}" type="text" inputmode="numeric" placeholder="${['2', '3', '12'][i]} unidades" value="${o ? o.cant : ''}"></div>
          <div class="field"><input name="ofp${i}" type="text" inputmode="decimal" placeholder="Precio total" value="${o ? limpio(o.precio) : ''}"></div>
        </div>
        <button type="button" class="btn btn-soft btn-sm hidden" data-sug="${i}"></button>`;
    };
    return `
      <div class="form" style="gap:8px">
        <div class="field">
          <label>Ofertas por cantidad (opcional)</label>
          <span class="hint">Ej: 3 unidades por $4. Te sugiero un precio, pero tú pones el final.</span>
        </div>
        ${[0, 1, 2].map(fila).join('')}
        <div class="preview hidden" id="of-prev"></div>
      </div>`;
  },

  formMontar(body, f) {
    const prev = body.querySelector('#of-prev');
    const fmt = (v, mon) => (mon === 'BS' ? Utils.bs(v) : Utils.usd(v));

    const pintar = () => {
      const mon = f.precioMoneda.value;
      const detal = Utils.num(f.detal.value);
      const cant = Utils.num(f.cantidad.value);
      const t = Tasa.valor();
      const costoTot = Utils.num(f.costoTotal.value);
      const costoUsd = f.costoMoneda.value === 'BS' ? (t > 0 ? costoTot / t : 0) : costoTot;
      const unitUsd = cant > 0 ? costoUsd / cant : 0;
      const costoEn = mon === 'BS' ? unitUsd * t : unitUsd;   // costo por unidad, en la moneda del precio
      let html = '';

      for (let i = 0; i < this.MAX; i++) {
        const n = Utils.num(f['ofc' + i].value);
        const b = body.querySelector(`[data-sug="${i}"]`);
        if (Number.isInteger(n) && n >= 2 && detal > 0) {
          const sug = this.sugerir(detal, n, mon, costoEn);
          b.textContent = `Sugerido para ${n}: ${fmt(sug, mon)} · usar`;
          b.dataset.valor = sug;
          b.classList.remove('hidden');
          const pr = Utils.num(f['ofp' + i].value);
          if (pr > 0) {
            html += `<div><span>${n} por ${fmt(pr, mon)}</span><b>${fmt(pr / n, mon)} c/u</b></div>`;
            if (costoEn > 0 && pr < n * costoEn) {
              html += `<div><b style="color:var(--danger)">La oferta de ${n} está por debajo de lo que te costó</b></div>`;
            } else if (pr >= n * detal) {
              html += `<div><span>La oferta de ${n} no le ahorra nada al cliente</span></div>`;
            } else if (costoEn > 0) {
              html += `<div><span>Ganancia de esa oferta</span><b>${fmt(pr - n * costoEn, mon)}</b></div>`;
            }
          }
        } else if (b) {
          b.classList.add('hidden');
        }
      }
      prev.innerHTML = html;
      prev.classList.toggle('hidden', !html);
    };

    f.addEventListener('click', e => {
      const b = e.target.closest('[data-sug]');
      if (b && b.dataset.valor) { f['ofp' + b.dataset.sug].value = b.dataset.valor; pintar(); }
    });
    f.addEventListener('input', pintar);
    f.addEventListener('change', pintar);
    pintar();
  },

  // Lee las ofertas escritas. Devuelve { lista } o { error }
  formLeer(f) {
    const lista = [];
    for (let i = 0; i < this.MAX; i++) {
      const c = f['ofc' + i].value.trim(), p = f['ofp' + i].value.trim();
      if (!c && !p) continue;
      const n = Utils.num(c), pr = Utils.num(p);
      if (!Number.isInteger(n) || n < 2 || n > 999) return { error: 'La cantidad de una oferta debe ser un número entero de 2 o más' };
      if (!(pr > 0)) return { error: `Escribe el precio final de la oferta de ${n}` };
      if (lista.some(o => o.cant === n)) return { error: `La oferta de ${n} está repetida` };
      lista.push({ cant: n, precio: pr });
    }
    lista.sort((a, b) => a.cant - b.cant);
    return { lista };
  }
};