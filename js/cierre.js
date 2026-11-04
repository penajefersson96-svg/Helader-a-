/* =========================================================
   CIERRE - Cierre del día y cuadre de caja
   Resume el día y compara lo que debería haber con lo que
   ella cuenta. Dos modos de conteo:
   - "dia":   solo lo de hoy (entró menos salió ese día)
   - "total": toda la caja hasta ese día
   Colección "cierres":
   { id, fecha, modo, ventasUsd, gananciaUsd, esperadoBs, esperadoUsd,
     contadoBs, contadoUsd, difBs, difUsd, ajuste, ajusteIds, nota }
   ========================================================= */

const Cierre = {

  // "$5,00 + 300,00 Bs" (omite lo que está en cero)
  dual(s) {
    const p = [];
    if (Math.abs(s.USD) >= 0.005) p.push(Utils.usd(s.USD));
    if (Math.abs(s.BS) >= 0.005) p.push(Utils.bs(s.BS));
    return p.join(' + ') || '—';
  },

  resumen(fecha) {
    const suma = (arr, fn) => arr.reduce((a, x) => a + fn(x), 0);
    const previo = Store.all('cierres').find(c => c.fecha === fecha);
    const propios = new Set((previo && previo.ajusteIds) || []);

    const ventas = Store.all('ventas').filter(v => v.fecha === fecha);
    const totalUsd = suma(ventas, v => v.total);
    const gananciaVentas = suma(ventas, v => v.total - v.cantidad * v.costoUnit);

    // Se ignoran los ajustes que hizo este mismo cierre
    const todos = Caja.movimientos().filter(m => !propios.has(m.id));
    const delDia = todos.filter(m => m.fecha === fecha);
    const entro = Caja.saldo(delDia.filter(m => m.tipo === 'ingreso'));
    const salio = Caja.saldo(delDia.filter(m => m.tipo === 'gasto').map(m => ({ ...m, tipo: 'ingreso' })));
    const cobros = Caja.saldo(delDia.filter(m => m.categoria === 'Cobros de fiados'));

    const gastosUsd = suma(
      delDia.filter(m => m.tipo === 'gasto' && !m.auto && m.categoria !== 'Ajuste de caja'),
      m => (m.moneda === 'BS' ? Tasa.toUsd(m.monto) : m.monto)
    );
    const perdidasUsd = suma(Store.all('mermas').filter(m => m.fecha === fecha), m => m.costo);

    return {
      previo, ventas, totalUsd,
      fiadoUsd: suma(ventas.filter(v => v.fiado), v => v.total),
      mayorUsd: suma(ventas.filter(v => v.tipo === 'negocio'), v => v.total),
      entro, salio, cobros, gastosUsd, perdidasUsd,
      ganancia: gananciaVentas - gastosUsd - perdidasUsd,
      esperadoDia: Caja.saldo(delDia),
      esperadoTotal: Caja.saldo(todos.filter(m => (m.fecha || '') <= fecha))
    };
  },

  abrir(fecha) {
    fecha = fecha || Utils.today();
    const r = this.resumen(fecha);
    const p = r.previo;
    const modoInicial = (p && p.modo) || 'dia';
    const val = v => (v === null || v === undefined ? '' : v);
    const cierres = Store.all('cierres').slice().sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 7);

    const html = `
      <form class="form" id="cierre-form" autocomplete="off">
        <div class="field">
          <label>Día a cerrar</label>
          <input name="fecha" type="date" value="${fecha}">
          ${p ? '<span class="hint">Ya cerraste este día. Puedes corregirlo.</span>' : ''}
        </div>

        <div class="preview">
          <div><span>Vendido</span><b>${Utils.usd(r.totalUsd)} · ${Utils.bs(Tasa.toBs(r.totalUsd))}</b></div>
          <div><span>Ventas</span><b>${r.ventas.length}${r.fiadoUsd > 0 ? ' (fiado ' + Utils.usd(r.fiadoUsd) + ')' : ''}</b></div>
          <div><span>Al mayor</span><b>${Utils.usd(r.mayorUsd)}</b></div>
        </div>

        <div class="preview">
          <div><span>Entró a caja</span><b>${this.dual(r.entro)}</b></div>
          <div><span>… de cobros de fiados</span><b>${this.dual(r.cobros)}</b></div>
          <div><span>Salió de caja</span><b>${this.dual(r.salio)}</b></div>
          <div><span>Pérdidas (mermas)</span><b>${Utils.usd(r.perdidasUsd)}</b></div>
        </div>

        <div class="preview" style="background:var(--success-soft)">
          <div>
            <span><b>Ganancia del día</b></span>
            <b class="${r.ganancia >= 0 ? 'pos' : 'neg'}">${Utils.usd(r.ganancia)} · ${Utils.bs(Tasa.toBs(r.ganancia))}</b>
          </div>
        </div>

        <div class="card-title" style="margin:8px 0 0">Cuadre de caja</div>

        <div class="field">
          <label>¿Qué vas a contar?</label>
          <select name="modo">
            <option value="dia" ${modoInicial === 'dia' ? 'selected' : ''}>Solo lo de hoy (entró menos salió)</option>
            <option value="total" ${modoInicial === 'total' ? 'selected' : ''}>Toda la caja (incluye lo guardado)</option>
          </select>
          <span class="hint" id="cierre-hint"></span>
        </div>

        <div class="preview" id="cierre-esp"></div>

        <div class="form-row">
          <div class="field">
            <label>Contaste en Bs</label>
            <input name="contadoBs" type="text" inputmode="decimal" placeholder="0,00" value="${val(p && p.contadoBs)}">
          </div>
          <div class="field">
            <label>Contaste en $</label>
            <input name="contadoUsd" type="text" inputmode="decimal" placeholder="0,00" value="${val(p && p.contadoUsd)}">
          </div>
        </div>
        <div class="preview" id="cierre-dif"></div>

        <label class="check-row">
          <input type="checkbox" name="ajustar" ${!p || p.ajuste ? 'checked' : ''}>
          <span><b>Ajustar la caja a lo contado</b><small>Así mañana empiezas con la caja cuadrada</small></span>
        </label>

        <div class="field">
          <label>Nota (opcional)</label>
          <input name="nota" type="text" placeholder="Ej: faltó dar un vuelto" value="${p ? Utils.esc(p.nota || '') : ''}">
        </div>

        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="calendar-check"></i> Guardar cierre</button>
        ${p ? '<button type="button" class="btn btn-soft btn-block" data-comp="1"><i data-lucide="file-text"></i> Ver comprobante</button>' : ''}
      </form>

      ${cierres.length ? `
        <div class="card-title" style="margin:20px 0 4px">Cierres anteriores</div>
        ${cierres.map(c => {
          const cuadra = Math.abs(c.difBs || 0) < 0.005 && Math.abs(c.difUsd || 0) < 0.005;
          return `
            <button type="button" class="mov" data-fecha="${c.fecha}" style="width:100%;text-align:left">
              <div class="mov-info">
                <b>${Utils.formatDate(c.fecha)}</b>
                <span>Ganancia ${Utils.usd(c.gananciaUsd)}</span>
              </div>
              <span class="badge ${cuadra ? 'badge-success' : 'badge-warning'}">${cuadra ? 'Cuadró' : 'Hubo diferencia'}</span>
            </button>`;
        }).join('')}` : ''}
    `;

    UI.openModal('Cierre del día', html, body => {
      const f = body.querySelector('#cierre-form');
      const espBox = body.querySelector('#cierre-esp');
      const difBox = body.querySelector('#cierre-dif');
      const hint = body.querySelector('#cierre-hint');
      const redondea = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

      const esperadoActual = () => (f.modo.value === 'total' ? r.esperadoTotal : r.esperadoDia);

      const leer = (campo, esperado) => {
        const t = campo.value.trim();
        return t === '' ? null : redondea(Utils.num(t) - esperado, 2);
      };
      const texto = (dif, moneda) => {
        if (dif === null) return '<b>—</b>';
        if (Math.abs(dif) < 0.005) return '<b class="pos">Cuadra ✓</b>';
        const monto = moneda === 'BS' ? Utils.bs(Math.abs(dif)) : Utils.usd(Math.abs(dif));
        return dif > 0 ? `<b class="pos">Sobra ${monto}</b>` : `<b class="neg">Falta ${monto}</b>`;
      };

      const actualizar = () => {
        const esp = esperadoActual();
        const dia = f.modo.value === 'dia';
        hint.textContent = dia
          ? 'Cuenta solo el dinero de las ventas y cobros de hoy, sin lo que ya tenías guardado.'
          : 'Cuenta todo el dinero que hay en la caja.';
        espBox.innerHTML = `
          <div><span>${dia ? 'Debería haber de lo de hoy en Bs' : 'Debería haber en Bs'}</span><b>${Utils.bs(esp.BS)}</b></div>
          <div><span>${dia ? 'Debería haber de lo de hoy en $' : 'Debería haber en $'}</span><b>${Utils.usd(esp.USD)}</b></div>
          ${dia && (esp.BS < -0.005 || esp.USD < -0.005)
            ? '<div><span class="muted">Hoy salió más dinero del que entró. Si quieres contar todo, elige "Toda la caja".</span></div>' : ''}`;
        difBox.innerHTML = `
          <div><span>Diferencia en Bs</span>${texto(leer(f.contadoBs, esp.BS), 'BS')}</div>
          <div><span>Diferencia en $</span>${texto(leer(f.contadoUsd, esp.USD), 'USD')}</div>`;
      };
      f.addEventListener('input', actualizar);
      f.addEventListener('change', actualizar);
      actualizar();

      // Cambiar el día abre el cierre de ese día
      f.fecha.addEventListener('change', () => {
        if (f.fecha.value) this.abrir(f.fecha.value);
      });

      body.onclick = e => {
        if (e.target.closest('[data-comp]')) return Comprobante.cierre(fecha);
        const b = e.target.closest('[data-fecha]');
        if (b) this.abrir(b.dataset.fecha);
      };

      f.addEventListener('submit', e => {
        e.preventDefault();
        const dia = f.fecha.value || Utils.today();
        const modo = f.modo.value;

        // Si se está corrigiendo un cierre, primero se quitan sus ajustes anteriores
        if (p && p.ajusteIds && p.ajusteIds.length) {
          Store.set('movimientos', Store.all('movimientos').filter(m => !p.ajusteIds.includes(m.id)));
        }

        const todos = Caja.movimientos();
        const esperado = modo === 'total'
          ? Caja.saldo(todos.filter(m => (m.fecha || '') <= dia))
          : Caja.saldo(todos.filter(m => m.fecha === dia));

        const difBs = leer(f.contadoBs, esperado.BS);
        const difUsd = leer(f.contadoUsd, esperado.USD);
        const ajusteIds = [];

        if (f.ajustar.checked) {
          [['BS', difBs], ['USD', difUsd]].forEach(([moneda, dif]) => {
            if (dif !== null && Math.abs(dif) >= 0.005) {
              const rec = Store.add('movimientos', {
                tipo: dif > 0 ? 'ingreso' : 'gasto',
                concepto: 'Ajuste de cierre ' + Utils.formatDate(dia),
                categoria: 'Ajuste de caja',
                monto: Math.abs(dif), moneda, fecha: dia
              });
              ajusteIds.push(rec.id);
            }
          });
        }

        const datos = {
          fecha: dia, modo,
          ventasUsd: r.totalUsd,
          gananciaUsd: r.ganancia,
          esperadoBs: esperado.BS, esperadoUsd: esperado.USD,
          contadoBs: f.contadoBs.value.trim() === '' ? null : Utils.num(f.contadoBs.value),
          contadoUsd: f.contadoUsd.value.trim() === '' ? null : Utils.num(f.contadoUsd.value),
          difBs, difUsd,
          ajuste: f.ajustar.checked, ajusteIds,
          nota: f.nota.value.trim()
        };

        if (p) Store.update('cierres', p.id, datos);
        else Store.add('cierres', datos);

        UI.closeModal();
        UI.toast('Cierre guardado');
        Comprobante.cierre(dia);
      });
    });
  }
};