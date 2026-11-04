/* =========================================================
   COMPROBANTE - Imagen del cierre de caja (para descargar
   o compartir). Usa los datos del cierre ya guardado.
   ========================================================= */

const Comprobante = {

  cierre(fecha) {
    const c = Store.all('cierres').find(x => x.fecha === fecha);
    if (!c) return UI.toast('Primero guarda el cierre', 'error');

    const html = `
      <div class="catalog-preview" style="padding:0"><canvas id="comp-canvas"></canvas></div>
      <div class="row mt">
        <button class="btn btn-primary" data-a="descargar"><i data-lucide="download"></i> Descargar</button>
        <button class="btn btn-soft" data-a="compartir"><i data-lucide="share-2"></i> Compartir</button>
      </div>`;

    UI.openModal('Comprobante de cierre', html, body => {
      const canvas = body.querySelector('#comp-canvas');
      this.dibujar(canvas, c);
      const nombre = `cierre-${c.fecha}.png`;
      body.onclick = e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'descargar') this.descargar(canvas, nombre);
        if (b.dataset.a === 'compartir') this.compartir(canvas, nombre);
      };
    });
  },

  descargar(canvas, nombre) {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      UI.toast('Comprobante descargado');
    }, 'image/png');
  },

  compartir(canvas, nombre) {
    canvas.toBlob(async blob => {
      const file = new File([blob], nombre, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Cierre de caja' }); } catch (e) { /* canceló */ }
      } else {
        UI.toast('Tu navegador no puede compartir. Se descargará.', 'error');
        this.descargar(canvas, nombre);
      }
    }, 'image/png');
  },

  dif(d, moneda) {
    if (d === null || d === undefined) return null;
    if (Math.abs(d) < 0.005) return ['Cuadra', '#16a34a'];
    const m = moneda === 'BS' ? Utils.bs(Math.abs(d)) : Utils.usd(Math.abs(d));
    return d > 0 ? ['Sobra ' + m, '#16a34a'] : ['Falta ' + m, '#dc2626'];
  },

  async dibujar(canvas, c) {
    const F = '"Plus Jakarta Sans", system-ui, sans-serif';
    try {
      await document.fonts.load(`800 20px ${F}`);
      await document.fonts.load(`500 20px ${F}`);
    } catch (e) { /* usa la letra del sistema */ }

    const r = Cierre.resumen(c.fecha);
    const tasa = (r.ventas.length && r.ventas[r.ventas.length - 1].tasa) || Tasa.valor();
    const bs = usd => Utils.bs(usd * tasa);
    const verde = '#16a34a', rojo = '#dc2626';
    const ganancia = c.gananciaUsd !== undefined ? c.gananciaUsd : r.ganancia;
    const negocio = Store.get('config', {}).negocio || 'Mi Heladería';

    const secciones = [
      { t: 'VENTAS DEL DÍA', f: [
        ['Ventas realizadas', String(r.ventas.length)],
        ['Total vendido', Utils.usd(r.totalUsd) + ' · ' + bs(r.totalUsd)],
        ['Al mayor', Utils.usd(r.mayorUsd)],
        ['Fiado', Utils.usd(r.fiadoUsd)]
      ]},
      { t: 'MOVIMIENTO DE CAJA', f: [
        ['Entró', Cierre.dual(r.entro)],
        ['De cobros de fiados', Cierre.dual(r.cobros)],
        ['Salió', Cierre.dual(r.salio)],
        ['Pérdidas (mermas)', Utils.usd(r.perdidasUsd)]
      ]},
      { t: 'GANANCIA', dest: true, f: [
        ['Ganancia del día', Utils.usd(ganancia) + ' · ' + bs(ganancia), ganancia >= 0 ? verde : rojo]
      ]}
    ];

    if (c.contadoBs != null || c.contadoUsd != null) {
      const f = [
        ['Conteo', c.modo === 'total' ? 'Toda la caja' : 'Solo lo de hoy'],
        ['Debería haber', Utils.bs(c.esperadoBs) + ' · ' + Utils.usd(c.esperadoUsd)]
      ];
      if (c.contadoBs != null) f.push(['Contado en Bs', Utils.bs(c.contadoBs)]);
      if (c.contadoUsd != null) f.push(['Contado en $', Utils.usd(c.contadoUsd)]);
      const dBs = this.dif(c.difBs, 'BS');
      const dUsd = this.dif(c.difUsd, 'USD');
      if (dBs) f.push(['Diferencia en Bs', dBs[0], dBs[1]]);
      if (dUsd) f.push(['Diferencia en $', dUsd[0], dUsd[1]]);
      secciones.push({ t: 'CUADRE DE CAJA', f });
    }

    const W = 720, PAD = 32, S = 2, HEAD = 130, RH = 40, TIT = 34, GAP = 20;
    let H = HEAD + 24;
    secciones.forEach(s => { H += TIT + s.f.length * RH + 16 + GAP; });
    if (c.nota) H += 34;
    H += 76;

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
    Factura.rr(ctx, 0, -40, W, HEAD + 40, 32);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = `800 32px ${F}`;
    ctx.fillText(Factura.ajustar(ctx, negocio, W - PAD * 2 - 170), PAD, 58);
    ctx.font = `600 17px ${F}`;
    ctx.fillText('Cierre de caja', PAD, 92);
    ctx.textAlign = 'right';
    ctx.font = `700 17px ${F}`;
    ctx.fillText(Utils.formatDate(c.fecha), W - PAD, 58);
    if (tasa > 0) {
      ctx.font = `500 14px ${F}`;
      ctx.fillText('Tasa BCV: ' + Utils.bs(tasa), W - PAD, 92);
    }

    let y = HEAD + 24;
    secciones.forEach(s => {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#5b7a8f';
      ctx.font = `700 12px ${F}`;
      ctx.fillText(s.t, PAD + 6, y + 14);

      const top = y + TIT - 6;
      const alto = s.f.length * RH + 12;
      ctx.fillStyle = s.dest ? '#e0f2fe' : '#ffffff';
      Factura.rr(ctx, PAD, top, W - PAD * 2, alto, 16);
      ctx.fill();
      if (!s.dest) {
        ctx.strokeStyle = '#d6ecfa';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      s.f.forEach((fila, i) => {
        const yy = top + 6 + i * RH + 27;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#5b7a8f';
        ctx.font = `600 15px ${F}`;
        ctx.fillText(fila[0], PAD + 20, yy);

        ctx.textAlign = 'right';
        ctx.fillStyle = fila[2] || '#0c2a3f';
        ctx.font = s.dest ? `800 20px ${F}` : `700 17px ${F}`;
        ctx.fillText(Factura.ajustar(ctx, fila[1], 400), W - PAD - 20, yy);

        if (i < s.f.length - 1) {
          ctx.strokeStyle = '#e6f2fb';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(PAD + 16, top + 6 + (i + 1) * RH);
          ctx.lineTo(W - PAD - 16, top + 6 + (i + 1) * RH);
          ctx.stroke();
        }
      });
      y += TIT + s.f.length * RH + 16 + GAP;
    });

    if (c.nota) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#5b7a8f';
      ctx.font = `600 15px ${F}`;
      ctx.fillText(Factura.ajustar(ctx, 'Nota: ' + c.nota, W - PAD * 2), PAD, y + 8);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#9db8c9';
    ctx.font = `500 12px ${F}`;
    ctx.fillText('Documento de control interno · Sin validez fiscal', W / 2, H - 28);
  }
};