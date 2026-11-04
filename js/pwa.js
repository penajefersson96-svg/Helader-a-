/* =========================================================
   PWA - Registro del service worker, instalación y avisos
   ========================================================= */

const PWA = {
  prompt: null,

  init() {
    this.registrar();
    this.instalacion();
    this.persistir();
  },

  // Activa el modo sin internet (solo funciona en https, no en la vista previa)
  registrar() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;

    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
            this.aviso('Hay una versión nueva de la app', 'Actualizar', () => location.reload());
          }
        });
      });
    }).catch(() => {});
  },

  // Botón de instalar (Android/Chrome) y guía para iPhone
  instalacion() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this.prompt = e;
      if (this.cerrado()) return;
      this.aviso('Instala la app en tu teléfono', 'Instalar', async () => {
        this.quitar();
        this.prompt.prompt();
        await this.prompt.userChoice;
        this.prompt = null;
      });
    });

    window.addEventListener('appinstalled', () => {
      this.quitar();
      UI.toast('App instalada');
    });

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (ios && !instalada && !this.cerrado()) {
      this.aviso('Para instalar: toca Compartir y luego "Agregar a inicio"');
    }
  },

  // Pide al teléfono que no borre los datos si le falta espacio
  persistir() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  },

  // Recuerda que el aviso se cerró (por 7 días)
  cerrado(marcar) {
    try {
      if (marcar) { localStorage.setItem('pwa_cerrado', String(Date.now())); return true; }
      const t = Number(localStorage.getItem('pwa_cerrado') || 0);
      return t && Date.now() - t < 7 * 86400000;
    } catch (_) { return false; }
  },

  aviso(texto, boton, fn) {
    this.quitar();
    const bar = document.createElement('div');
    bar.id = 'pwa-bar';
    bar.innerHTML = `
      <span>${texto}</span>
      ${boton ? `<button type="button" class="btn btn-primary btn-sm" data-ok>${boton}</button>` : ''}
      <button type="button" class="pwa-x" aria-label="Cerrar" data-x>✕</button>`;
    bar.onclick = e => {
      if (e.target.closest('[data-ok]')) { if (fn) fn(); }
      else if (e.target.closest('[data-x]')) { this.cerrado(true); this.quitar(); }
    };
    document.body.appendChild(bar);
  },

  quitar() {
    const b = document.getElementById('pwa-bar');
    if (b) b.remove();
  }
};

PWA.init();