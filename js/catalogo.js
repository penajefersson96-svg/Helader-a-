/* =========================================================
   CATÁLOGO - Lista de precios al detal y al mayor
   Se dibuja como imagen (canvas) para verla y descargarla
   igual a como se ve. Los precios y la tasa se toman solos.
   ========================================================= */

Modules.catalogo = {
  modo: 'disponibles',

  // Un renglón por producto (si hay varias compras del mismo, manda la más reciente)
  items() {
    const ventas = Store.all('ventas');
    const grupos = new Map();

    Store.all('productos').forEach(p => {
      const s = Inventario.stats(p, ventas);
      if (this.modo === 'disponibles' && s.restante <= 0) return;
      const key = (p.categoria || 'Otros') + '|' + p.nombre.trim().toLowerCase();
      const orden = (p.fecha || '') + (p.creado || '');
      const previo = grupos.get(key);
      if (!previo || orden >= previo.orden) grupos.set(key, { p, orden });
    });

    return [...grupos.values()].map(({ p }) => ({
      nombre: p.nombre,
      categoria: p.categoria || 'Otros',
      detal: Inventario.precioDetal(p),
      mayor: Inventario.tienePrecioMayor(p) ? Inventario.precioMayor(p) : null
    })).sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre));
  },

  render(container) {
    const cfg = Store.get('config', {});
    const hay = this.items().length > 0;

    container.innerHTML = `
      <div class="card">
        <div class="form">
          <div class="form-row">
            <div class="field">
              <label>Nombre del negocio (sale en el catálogo)</label>
              <input id="cat-nombre" type="text" placeholder="Mi Tienda" value="${Utils.esc(cfg.negocio || '')}">
            </div>
            <div class="field">
              <label>Qué mostrar</label>
              <select id="cat-modo">
                <option value="disponibles" ${this.modo === 'disponibles' ? 'selected' : ''}>Solo lo disponible</option>
                <option value="todos" ${this.modo === 'todos' ? 'selected' : ''}>Todo lo registrado</option>
              </select>
            </div>
          </div>
          <div class="row">
            <button class="btn btn-primary" data-action="descargar"><i data-lucide="download"></i> Descargar imagen</button>
            <button class="btn btn-soft" data-action="compartir"><i data-lucide="share-2"></i> Compartir</button>
          </div>
        </div>
      </div>

      ${hay ? `
        <div class="card catalog-preview mt"><canvas id="cat-canvas"></canvas></div>
      ` : `
        <div class="card empty mt">
          <i data-lucide="book-open"></i>
          <p>No hay mercancía para mostrar. Agrégala en la sección Mercancía.</p>
        </div>`}
    `;

    if (hay) this.dibujar(container.querySelector('#cat-canvas'));

    container.onclick = e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const canvas = container.querySelector('#cat-canvas');
      if (!canvas) return UI.toast('No hay catálogo para descargar', 'error');
      if (btn.dataset.action === 'descargar') this.descargar(canvas);
      if (btn.dataset.action === 'compartir') this.compartir(canvas);
    };

    container.onchange = e => {
      if (e.target.id === 'cat-nombre') {
        Store.set('config', { ...Store.get('config', {}), negocio: e.target.value.trim() });
      }
      if (e.target.id === 'cat-modo') {
        this.modo = e.target.value;
        this.render(container);
        UI.icons();
      }
    };
  },

  /* ---------- Dibujo del catálogo ---------- */
  rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  // Recorta un texto con "…" si no cabe
  ajustar(ctx, texto, ancho) {
    if (ctx.measureText(texto).width <= ancho) return texto;
    while (texto.length > 1 && ctx.measureText(texto + '…').width > ancho) texto = texto.slice(0, -1);
    return texto + '…';
  },

  async dibujar(canvas) {
    const F = '"Plus Jakarta Sans", system-ui, sans-serif';
    try {
      await document.fonts.load(`800 20px ${F}`);
      await document.fonts.load(`500 20px ${F}`);
    } catch (e) { /* si falla, usa la letra del sistema */ }

    const items = this.items();
    const cfg = Store.get('config', {});
    const negocio = cfg.negocio || 'Mi Tienda';
    const tasa = Tasa.valor();

    const W = 720, PAD = 32, S = 2;
    const HEAD = 170, CATH = 50, ROW = 70, GAP = 18, FOOT = 90;
    const hayMayor = items.some(i => i.mayor !== null);

    const cats = {};
    items.forEach(i => { (cats[i.categoria] = cats[i.categoria] || []).push(i); });
    const nombres = Object.keys(cats);

    const H = HEAD + nombres.reduce((a, c) => a + CATH + cats[c].length * ROW + GAP, 0) + FOOT;
    canvas.width = W * S;
    canvas.height = H * S;
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);

    // Fondo
    const fondo = ctx.createLinearGradient(0, 0, 0, H);
    fondo.addColorStop(0, '#e0f2fe');
    fondo.addColorStop(1, '#ffffff');
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, W, H);

    // Encabezado
    const head = ctx.createLinearGradient(0, 0, W, HEAD);
    head.addColorStop(0, '#0ea5e9');
    head.addColorStop(1, '#22d3ee');
    ctx.fillStyle = head;
    this.rr(ctx, 0, -40, W, HEAD + 40, 36);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 38px ${F}`;
    ctx.fillText(this.ajustar(ctx, negocio, W - PAD * 2), PAD, 72);
    ctx.font = `500 18px ${F}`;
    ctx.fillText(`Catálogo de precios · ${Utils.formatDate(Utils.today())}`, PAD, 106);
    if (tasa > 0) {
      ctx.font = `700 16px ${F}`;
      ctx.fillText(`Tasa BCV: ${Utils.bs(tasa)}`, PAD, 138);
    }

    // Columnas de precios (alineadas a la derecha)
    const xMayor = W - PAD - 18;
    const xDetal = hayMayor ? xMayor - 150 : xMayor;
    const anchoNombre = xDetal - 110 - (PAD + 18);

    let y = HEAD + 10;
    nombres.forEach(cat => {
      // Título de categoría y columnas
      ctx.textAlign = 'left';
      ctx.fillStyle = '#0284c7';
      ctx.font = `800 22px ${F}`;
      ctx.fillText(cat, PAD, y + 30);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#5b7a8f';
      ctx.font = `700 12px ${F}`;
      ctx.fillText('AL DETAL', xDetal, y + 30);
      if (hayMayor) ctx.fillText('AL MAYOR', xMayor, y + 30);
      y += CATH;

      cats[cat].forEach(item => {
        const h = ROW - 10;
        ctx.fillStyle = '#ffffff';
        this.rr(ctx, PAD, y, W - PAD * 2, h, 16);
        ctx.fill();
        ctx.strokeStyle = '#d6ecfa';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Nombre
        ctx.textAlign = 'left';
        ctx.fillStyle = '#0c2a3f';
        ctx.font = `700 21px ${F}`;
        ctx.fillText(this.ajustar(ctx, item.nombre, anchoNombre), PAD + 18, y + 36);

        // Precios
        const precio = (usd, x) => {
          ctx.textAlign = 'right';
          if (usd === null) {
            ctx.fillStyle = '#9db8c9';
            ctx.font = `700 21px ${F}`;
            ctx.fillText('—', x, y + 33);
            return;
          }
          ctx.fillStyle = '#0284c7';
          ctx.font = `800 21px ${F}`;
          ctx.fillText(Utils.usd(usd), x, y + 28);
          if (tasa > 0) {
            ctx.fillStyle = '#5b7a8f';
            ctx.font = `500 14px ${F}`;
            ctx.fillText(Utils.bs(Tasa.toBs(usd)), x, y + 49);
          }
        };
        precio(item.detal, xDetal);
        if (hayMayor) precio(item.mayor, xMayor);

        y += ROW;
      });
      y += GAP;
    });

    // Pie
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5b7a8f';
    ctx.font = `500 14px ${F}`;
    ctx.fillText('Precios en bolívares según la tasa BCV del día', W / 2, H - 46);
    ctx.fillText('Los precios pueden cambiar sin previo aviso', W / 2, H - 26);
  },

  /* ---------- Descargar / compartir ---------- */
  nombreArchivo() { return `catalogo-${Utils.today()}.png`; },

  descargar(canvas) {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.nombreArchivo();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      UI.toast('Catálogo descargado');
    }, 'image/png');
  },

  compartir(canvas) {
    canvas.toBlob(async blob => {
      const file = new File([blob], this.nombreArchivo(), { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Catálogo de precios' });
        } catch (e) { /* la persona canceló */ }
      } else {
        UI.toast('Tu navegador no puede compartir. Se descargará.', 'error');
        this.descargar(canvas);
      }
    }, 'image/png');
  }
};