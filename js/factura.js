/* =========================================================
   FACTURA - Mini factura (nota de entrega) como imagen
   Se arma con ventas ya registradas de un cliente.
   Colección "facturas":
   { id, numero, cliente, telefono, direccion, rif, fecha, tasa,
     lineas: [{ ventaId, nombre, cantidad, precioUnit, total }],
     totalUsd, condicion, vence, nota }
   Una venta solo puede estar en una factura.
   ========================================================= */

const Factura = {
  num(n) { return String(n).padStart(4, '0'); },

  // Ventas del cliente que todavía no están en ninguna factura
  sinFacturar(nombre) {
    const usadas = new Set(Store.all('facturas').flatMap(f => f.lineas.map(l => l.ventaId)));
    const k = Clientes.clave(nombre);
    return Store.all('ventas')
      .filter(v => Clientes.clave(v.cliente) === k && !usadas.has(v.id))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.creado || '').localeCompare(a.creado || ''));
  },

  nuevaDesdeVenta(ventaId) {
    const v = Store.find('ventas', ventaId);
    if (!v || !v.cliente) return UI.toast('Esta venta no tiene cliente', 'error');
    this.nueva(v.cliente, ventaId);
  },
    // Factura/ticket de una venta con varios productos (con o sin nombre de cliente)
  deTicket(ticket) {
    const lineas = Store.all('ventas').filter(v => v.ticket === ticket);
    if (!lineas.length) return UI.toast('No se encontró la venta', 'error');

    // Si ya tiene factura, se abre la misma
    const ids = new Set(lineas.map(v => v.id));
    const previa = Store.all('facturas').find(f => f.lineas.some(l => ids.has(l.ventaId)));
    if (previa) return this.ver(previa.id);

    const v0 = lineas[0];
    const cli = (v0.cliente && Clientes.buscar(v0.cliente)) || {};
    const fiadas = lineas.filter(v => v.fiado && !v.pagado);
    const numero = Store.get('facturaSeq', 0) + 1;
    Store.set('facturaSeq', numero);

    const rec = Store.add('facturas', {
      numero,
      cliente: v0.cliente || 'Cliente general',
      telefono: cli.telefono || '',
      direccion: cli.direccion || '',
      rif: cli.rif || '',
      fecha: v0.fecha || Utils.today(),
      tasa: Tasa.valor(),
      lineas: lineas.map(v => ({
        ventaId: v.id, nombre: v.nombre + (v.oferta ? ' (' + v.oferta + ')' : ''), cantidad: v.cantidad,
        precioUnit: v.precioUnit, total: v.total
      })),
      totalUsd: lineas.reduce((a, v) => a + v.total, 0),
      condicion: fiadas.length ? 'Crédito' : 'Contado',
      vence: fiadas.length ? fiadas.map(v => v.fechaPago).sort()[0] : null,
      nota: ''
    });
    UI.toast('Factura creada');
    this.ver(rec.id);
  },

  /* ---------- Crear ---------- */
  
  nueva(nombre, ventaId) {
    const pend = this.sinFacturar(nombre);
    if (!pend.length) return UI.toast('Este cliente no tiene ventas sin facturar', 'error');

    // Por defecto se marcan las ventas de la fecha más reciente (o de la venta elegida)
    const base = ventaId ? pend.find(v => v.id === ventaId) : pend[0];
    const fechaBase = base ? base.fecha : pend[0].fecha;
    const marcada = v => (ventaId ? v.id === ventaId || v.fecha === fechaBase : v.fecha === fechaBase);

    const html = `
      <form class="form" id="fac-form" autocomplete="off">
        <div class="preview"><div><span>Cliente</span><b>${Utils.esc(nombre)}</b></div></div>

        <div>
          <div class="muted" style="font-size:.82rem;font-weight:600;margin-bottom:8px">
            Elige las ventas que van en esta factura
          </div>
          ${pend.map(v => `
            <label class="check-row">
              <input type="checkbox" value="${v.id}" ${marcada(v) ? 'checked' : ''}>
              <span>
                <b>${Utils.esc(v.nombre)} × ${Inventario.q(v.cantidad)}</b>
                <small>${Utils.formatDate(v.fecha)}${v.fiado && !v.pagado ? ' · fiado' : ''}</small>
              </span>
              <b>${Utils.usd(v.total)}</b>
            </label>`).join('')}
        </div>

        <div class="form-row">
          <div class="field">
            <label>Fecha de la factura</label>
            <input name="fecha" type="date" value="${Utils.today()}">
          </div>
          <div class="field">
            <label>Nota (opcional)</label>
            <input name="nota" type="text" placeholder="Ej: entrega en tienda">
          </div>
        </div>

        <div class="preview" id="fac-total"></div>
        <button type="submit" class="btn btn-primary btn-block"><i data-lucide="file-text"></i> Crear mini factura</button>
      </form>`;

    UI.openModal('Nueva mini factura', html, body => {
      const f = body.querySelector('#fac-form');
      const totalBox = body.querySelector('#fac-total');
      const marcadas = () => [...f.querySelectorAll('input[type=checkbox]:checked')]
        .map(c => pend.find(v => v.id === c.value));

      const actualizar = () => {
        const sel = marcadas();
        const t = sel.reduce((a, v) => a + v.total, 0);
        totalBox.innerHTML = `
          <div><span>Productos incluidos</span><b>${sel.length}</b></div>
          <div><span>Total</span><b>${Utils.usd(t)} · ${Utils.bs(Tasa.toBs(t))}</b></div>`;
      };
      f.addEventListener('change', actualizar);
      actualizar();

      f.addEventListener('submit', e => {
        e.preventDefault();
        const sel = marcadas();
        if (!sel.length) return UI.toast('Elige al menos una venta', 'error');

        const cli = Clientes.buscar(nombre) || {};
        const fiadas = sel.filter(v => v.fiado && !v.pagado);
        const numero = Store.get('facturaSeq', 0) + 1;

        Store.set('facturaSeq', numero);
        const rec = Store.add('facturas', {
          numero,
          cliente: nombre,
          telefono: cli.telefono || '',
          direccion: cli.direccion || '',
          rif: cli.rif || '',
          fecha: f.fecha.value || Utils.today(),
          tasa: Tasa.valor(),
          lineas: sel.map(v => ({
            ventaId: v.id, nombre: v.nombre + (v.oferta ? ' (' + v.oferta + ')' : ''), cantidad: v.cantidad,
            precioUnit: v.precioUnit, total: v.total
          })),
          totalUsd: sel.reduce((a, v) => a + v.total, 0),
          condicion: fiadas.length ? 'Crédito' : 'Contado',
          vence: fiadas.length ? fiadas.map(v => v.fechaPago).sort()[0] : null,
          nota: f.nota.value.trim()
        });

        UI.closeModal();
        UI.toast('Mini factura creada');
        this.ver(rec.id);
      });
    });
  },

  /* ---------- Lista de facturas de un cliente ---------- */
  lista(nombre) {
    const k = Clientes.clave(nombre);
    const facs = Store.all('facturas').filter(f => Clientes.clave(f.cliente) === k)
      .sort((a, b) => b.numero - a.numero);

    const html = facs.length ? facs.map(f => `
      <button type="button" class="mov" data-id="${f.id}" style="width:100%;text-align:left">
        <div class="mov-icon in"><i data-lucide="file-text"></i></div>
        <div class="mov-info">
          <b>N° ${this.num(f.numero)}</b>
          <span>${Utils.formatDate(f.fecha)} · ${f.lineas.length} producto(s) · ${f.condicion}</span>
        </div>
        <div class="mov-amount">${Utils.usd(f.totalUsd)}</div>
      </button>`).join('') : '<p class="muted">Este cliente no tiene facturas.</p>';

    UI.openModal('Facturas de ' + nombre, html, body => {
      body.onclick = e => {
        const b = e.target.closest('[data-id]');
        if (b) this.ver(b.dataset.id);
      };
    });
  },

  /* ---------- Ver / descargar / compartir ---------- */
    ver(id) {
    const fac = Store.find('facturas', id);
    if (!fac) return;
    
    const html = `
      <div class="catalog-preview" style="padding:0"><canvas id="fac-canvas"></canvas></div>
      <div class="row mt">
        <button class="btn btn-primary" data-a="imprimir"><i data-lucide="printer"></i> Imprimir</button>
        <button class="btn btn-soft" data-a="descargar"><i data-lucide="download"></i> Descargar</button>
        <button class="btn btn-soft" data-a="compartir"><i data-lucide="share-2"></i> Compartir</button>
        <button class="btn btn-danger" data-a="anular"><i data-lucide="x-circle"></i> Anular</button>
      </div>
      ${Imprimir.selector()}`;
    
    UI.openModal('Factura N° ' + this.num(fac.numero), html, body => {
      const canvas = body.querySelector('#fac-canvas');
      this.dibujar(canvas, fac);
      
      body.onchange = e => {
        if (e.target.matches('[data-papel]')) Imprimir.cambiar(e.target.value);
      };
      body.onclick = e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'imprimir') Imprimir.imagen(canvas, 'Factura ' + this.num(fac.numero));
        if (b.dataset.a === 'descargar') this.descargar(canvas, fac);
        if (b.dataset.a === 'compartir') this.compartir(canvas, fac);
        if (b.dataset.a === 'anular' && UI.confirm('¿Anular esta factura? Sus ventas quedan libres para facturarlas de nuevo.')) {
          Store.remove('facturas', fac.id);
          UI.closeModal();
          UI.toast('Factura anulada');
        }
      };
    });
  },

  nombreArchivo(fac) {
    const slug = Inventario.norm(fac.cliente).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `factura-${this.num(fac.numero)}-${slug}.png`;
  },

  descargar(canvas, fac) {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.nombreArchivo(fac);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      UI.toast('Factura descargada');
    }, 'image/png');
  },

  compartir(canvas, fac) {
    canvas.toBlob(async blob => {
      const file = new File([blob], this.nombreArchivo(fac), { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Factura ' + this.num(fac.numero) }); } catch (e) { /* canceló */ }
      } else {
        UI.toast('Tu navegador no puede compartir. Se descargará.', 'error');
        this.descargar(canvas, fac);
      }
    }, 'image/png');
  },

  /* ---------- Dibujo ---------- */
  rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  ajustar(ctx, texto, ancho) {
    texto = String(texto);
    if (ctx.measureText(texto).width <= ancho) return texto;
    while (texto.length > 1 && ctx.measureText(texto + '…').width > ancho) texto = texto.slice(0, -1);
    return texto + '…';
  },

  async dibujar(canvas, fac) {
    const F = '"Plus Jakarta Sans", system-ui, sans-serif';
    try {
      await document.fonts.load(`800 20px ${F}`);
      await document.fonts.load(`500 20px ${F}`);
    } catch (e) { /* usa la letra del sistema */ }

    const cfg = Store.get('config', {});
    const negocio = cfg.negocio || 'Mi Negocio';
    const W = 720, PAD = 32, S = 2;
    const HEAD = 130, ROW = 52;

    const datos = [['Cliente', fac.cliente], ['Teléfono', fac.telefono],
                   ['Dirección', fac.direccion], ['RIF / C.I.', fac.rif]].filter(d => d[1]);
    const clienteH = 28 + datos.length * 28;
    const H = HEAD + 24 + clienteH + 24 + 34 + fac.lineas.length * ROW + 20 + 96 + 46
            + (fac.nota ? 30 : 0) + 84;

    canvas.width = W * S;
    canvas.height = H * S;
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);

    const fondo = ctx.createLinearGradient(0, 0, 0, H);
    fondo.addColorStop(0, '#f0f9ff');
    fondo.addColorStop(1, '#ffffff');
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, W, H);

    // Encabezado
    const head = ctx.createLinearGradient(0, 0, W, HEAD);
    head.addColorStop(0, '#0ea5e9');
    head.addColorStop(1, '#22d3ee');
    ctx.fillStyle = head;
    this.rr(ctx, 0, -40, W, HEAD + 40, 32);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = `800 32px ${F}`;
    ctx.fillText(this.ajustar(ctx, negocio, W - PAD * 2 - 170), PAD, 58);
    ctx.font = `600 17px ${F}`;
    ctx.fillText('Nota de entrega N° ' + this.num(fac.numero), PAD, 92);
        const datosNeg = [cfg.rif ? 'RIF ' + cfg.rif : '', cfg.telefono ? 'Tel. ' + cfg.telefono : ''].filter(Boolean).join(' · ');
    if (datosNeg) {
      ctx.font = `500 14px ${F}`;
      ctx.fillText(this.ajustar(ctx, datosNeg, W - PAD * 2 - 170), PAD, 116);
    }
    ctx.textAlign = 'right';
    ctx.font = `700 17px ${F}`;
    ctx.fillText(Utils.formatDate(fac.fecha), W - PAD, 58);
    if (fac.tasa > 0) {
      ctx.font = `500 14px ${F}`;
      ctx.fillText('Tasa BCV: ' + Utils.bs(fac.tasa), W - PAD, 92);
    }

    // Datos del cliente
    let y = HEAD + 24;
    ctx.fillStyle = '#ffffff';
    this.rr(ctx, PAD, y, W - PAD * 2, clienteH, 16);
    ctx.fill();
    ctx.strokeStyle = '#d6ecfa';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    datos.forEach(([k, v], i) => {
      const yy = y + 36 + i * 28;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#5b7a8f';
      ctx.font = `600 13px ${F}`;
      ctx.fillText(k.toUpperCase(), PAD + 18, yy);
      ctx.fillStyle = '#0c2a3f';
      ctx.font = `700 17px ${F}`;
      ctx.fillText(this.ajustar(ctx, v, W - PAD * 2 - 150), PAD + 130, yy);
    });
    y += clienteH + 24;

    // Tabla de productos
    const xCant = W - PAD - 210, xPrecio = W - PAD - 110, xTotal = W - PAD - 6;
    ctx.fillStyle = '#5b7a8f';
    ctx.font = `700 12px ${F}`;
    ctx.textAlign = 'left';
    ctx.fillText('PRODUCTO', PAD + 6, y + 16);
    ctx.textAlign = 'right';
    ctx.fillText('CANT.', xCant, y + 16);
    ctx.fillText('PRECIO', xPrecio, y + 16);
    ctx.fillText('TOTAL', xTotal, y + 16);
    y += 34;

    fac.lineas.forEach(l => {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#0c2a3f';
      ctx.font = `700 18px ${F}`;
      ctx.fillText(this.ajustar(ctx, l.nombre, xCant - 80 - PAD), PAD + 6, y + 32);

      ctx.textAlign = 'right';
      ctx.font = `500 17px ${F}`;
      ctx.fillText(Inventario.q(l.cantidad), xCant, y + 32);
      ctx.fillText(Utils.usd(l.precioUnit), xPrecio, y + 32);
      ctx.fillStyle = '#0284c7';
      ctx.font = `800 18px ${F}`;
      ctx.fillText(Utils.usd(l.total), xTotal, y + 32);

      ctx.strokeStyle = '#d6ecfa';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y + ROW - 1);
      ctx.lineTo(W - PAD, y + ROW - 1);
      ctx.stroke();
      y += ROW;
    });
    y += 20;

    // Total
    ctx.fillStyle = '#e0f2fe';
    this.rr(ctx, PAD, y, W - PAD * 2, 96, 18);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0284c7';
    ctx.font = `800 16px ${F}`;
    ctx.fillText('TOTAL', PAD + 20, y + 54);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0369a1';
    ctx.font = `800 30px ${F}`;
    ctx.fillText(Utils.usd(fac.totalUsd), W - PAD - 20, y + 44);
    if (fac.tasa > 0) {
      ctx.fillStyle = '#5b7a8f';
      ctx.font = `600 17px ${F}`;
      ctx.fillText(Utils.bs(fac.totalUsd * fac.tasa), W - PAD - 20, y + 74);
    }
    y += 96 + 30;

    // Condición y nota
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5b7a8f';
    ctx.font = `600 15px ${F}`;
    ctx.fillText('Condición: ' + fac.condicion + (fac.vence ? ' · paga el ' + Utils.formatDate(fac.vence) : ''), PAD, y);
    if (fac.nota) {
      y += 30;
      ctx.fillText(this.ajustar(ctx, 'Nota: ' + fac.nota, W - PAD * 2), PAD, y);
    }

    // Pie
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0284c7';
    ctx.font = `700 16px ${F}`;
ctx.fillText(this.ajustar(ctx, cfg.pie || '¡Gracias por su compra!', W - PAD * 2), W / 2, H - 52);
    ctx.fillStyle = '#9db8c9';
    ctx.font = `500 12px ${F}`;
    ctx.fillText('Documento de control interno · Sin validez fiscal', W / 2, H - 30);
  }
};