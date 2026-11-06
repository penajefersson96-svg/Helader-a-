/* =========================================================
   TASA - Dólar BCV y calculadora $ <-> Bs
   Otros módulos pueden usar: Tasa.toBs(usd), Tasa.toUsd(bs)
   ========================================================= */

const Tasa = {
  valor() { return Store.getTasa().valor || 0; },
  toBs(usd) { return Utils.num(usd) * Tasa.valor(); },
  toUsd(bs) {
    const v = Tasa.valor();
    return v > 0 ? Utils.num(bs) / v : 0;
  }
};

Modules.calculadora = {
  
  render(container) {
    const { valor, fecha } = Store.getTasa();
    const hayTasa = valor > 0;
    const desactualizada = hayTasa && fecha !== Utils.today();
    const montos = [1, 5, 10, 20, 50, 100];
    
    container.innerHTML = `
      <div class="stack">

        <!-- TASA DEL DÍA -->
        <div class="card">
          <div class="row-between">
            <div class="stat">
              <span class="stat-label">Tasa BCV actual</span>
              <span class="stat-value">${hayTasa ? Utils.bs(valor) : 'Sin tasa'}</span>
              <span class="stat-sub">
                ${hayTasa ? 'Actualizada: ' + Utils.formatDate(fecha) : 'Escribe la tasa de hoy para empezar'}
              </span>
            </div>
            ${desactualizada ? '<span class="badge badge-warning">Actualízala hoy</span>' : ''}
            ${hayTasa && !desactualizada ? '<span class="badge badge-success">Al día</span>' : ''}
          </div>

          <form class="form mt" id="tasa-form">
            <div class="field">
              <label for="tasa-input">Tasa de hoy (Bs por 1 $)</label>
              <input id="tasa-input" type="text" inputmode="decimal"
                     placeholder="Ej: 45,50" value="${hayTasa ? valor : ''}" autocomplete="off">
            </div>
            <div class="row">
              <button type="submit" class="btn btn-primary">
                <i data-lucide="check"></i> Guardar tasa
              </button>
              <button type="button" class="btn btn-soft" id="tasa-auto">
                <i data-lucide="refresh-cw"></i> Traer automática
              </button>
            </div>
            <span class="hint muted" style="font-size:.76rem">
              Si la automática falla, escríbela a mano. Siempre funciona.
            </span>
          </form>
        </div>

        <!-- CALCULADORA -->
        <div class="card">
          <div class="card-title">Calculadora</div>
          <div class="form-row">
            <div class="field">
              <label for="calc-usd">Dólares ($)</label>
              <input id="calc-usd" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" ${hayTasa ? '' : 'disabled'}>
            </div>
            <div class="field">
              <label for="calc-bs">Bolívares (Bs)</label>
              <input id="calc-bs" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" ${hayTasa ? '' : 'disabled'}>
            </div>
          </div>
          <div class="mt stat" id="calc-result">
            <span class="stat-label">Total a cobrar en bolívares</span>
            <span class="stat-value" style="color:var(--primary-600)">0,00 Bs</span>
          </div>
        </div>

                ${Cambios.cardHtml()}
        <!-- TABLA RÁPIDA -->
        <div class="card">
          <div class="card-title">Referencia rápida</div>
          ${hayTasa ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Dólares</th><th class="text-right">Bolívares</th></tr></thead>
              <tbody>
                ${montos.map(m => `
                  <tr>
                    <td class="bold">${Utils.usd(m)}</td>
                    <td class="text-right">${Utils.bs(m * valor)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : `<p class="muted">Guarda la tasa para ver la tabla.</p>`}
        </div>

      </div>`;
    
    this.bind(container);
  },
  
  bind(container) {
    const form = container.querySelector('#tasa-form');
    const usd = container.querySelector('#calc-usd');
    const bs = container.querySelector('#calc-bs');
    const result = container.querySelector('#calc-result .stat-value');
        Cambios.montar(container);
    
    // Guardar tasa a mano
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = Utils.num(container.querySelector('#tasa-input').value);
if (v <= 0 || v > 100000) return UI.toast('Escribe una tasa válida', 'error');
      Store.setTasa(v);
      UI.toast('Tasa guardada');
      this.render(container);
      UI.icons();
    });
    
    // Traer tasa automática
    container.querySelector('#tasa-auto').addEventListener('click', async btn => {
      const button = btn.currentTarget;
      button.disabled = true;
      try {
        const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
        const data = await res.json();
        const v = Number(data.promedio ?? data.venta);
if (!(v > 0 && v < 100000)) throw new Error('Tasa inválida');
        Store.setTasa(Math.round(v * 100) / 100);
        UI.toast('Tasa actualizada: ' + Utils.bs(v));
        this.render(container);
        UI.icons();
      } catch (err) {
        console.error(err);
        UI.toast('No se pudo traer. Escríbela a mano.', 'error');
        button.disabled = false;
      }
    });
    
    // Calculadora en vivo ($ -> Bs y Bs -> $)
    usd.addEventListener('input', () => {
      const bolivares = Tasa.toBs(usd.value);
      bs.value = usd.value.trim() ? bolivares.toFixed(2) : '';
      result.textContent = Utils.bs(bolivares);
    });
    
    bs.addEventListener('input', () => {
      const dolares = Tasa.toUsd(bs.value);
      usd.value = bs.value.trim() ? dolares.toFixed(2) : '';
      result.textContent = Utils.bs(Utils.num(bs.value));
    });
  }
};