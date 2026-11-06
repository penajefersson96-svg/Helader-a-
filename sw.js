/* =========================================================
   SERVICE WORKER - Hace que la app funcione sin internet
   - Archivos de la app: primero internet (para recibir
     actualizaciones) y si falla o tarda, usa la copia guardada.
   - Archivos externos (iconos, fuentes): copia guardada y se
     actualiza por detrás.
   - La tasa del dólar nunca se guarda: siempre en vivo.
   Cada vez que AGREGUES un archivo nuevo a la app, súmalo a
   LOCAL y cambia VERSION.
   ========================================================= */

const VERSION = 'v15';
const CACHE = 'Tienda-' + VERSION;

// Únicos sitios externos que la app puede guardar en memoria
const PERMITIDOS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

const LOCAL = [
  './', 'index.html', 'manifest.json',
  'css/styles.css',
  'js/utils.js', 'js/storage.js', 'js/cripto.js', 'js/maestra.js', 'js/boveda.js', 'js/picker.js', 'js/tasa.js',
  'js/inventario.js', 'js/ofertas.js', 'js/ventas.js', 'js/fiados.js', 'js/caja.js', 'js/cambios.js',
  'js/dashboard.js', 'js/catalogo.js', 'js/clientes.js', 'js/factura.js',
  'js/mermas.js', 'js/cierre.js', 'js/comprobante.js', 'js/imprimir.js', 'js/devoluciones.js', 'js/ajustes.js', 'js/seguridad.js', 'js/reportes.js', 'js/app.js', 'js/pwa.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    
    // Archivos propios (si alguno no existe, no se cae la instalación)
    await Promise.allSettled(LOCAL.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    
    // Archivos externos que usa index.html (Lucide, fuentes...)
    try {
      const html = await (await fetch('index.html', { cache: 'reload' })).text();
      const urls = [...html.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)["']/g)].map(m => m[1]);
      await Promise.allSettled(urls.map(u => cache.add(new Request(u, { mode: 'no-cors' }))));
    } catch (_) { /* sin internet: se guardarán al usarlos */ }
    
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter(k => (k.startsWith('Tienda-') || k.startsWith('heladeria-')) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  
  if (url.hostname.includes('dolarapi')) return; // la tasa siempre en vivo
  if (url.origin === location.origin) e.respondWith(propio(req));
  else if (PERMITIDOS.includes(url.hostname)) e.respondWith(externo(req));
  // cualquier otro sitio externo: no se toca ni se guarda
});

// Archivos de la app: internet primero (máx. 4 s), si no, la copia guardada
async function propio(req) {
  const cache = await caches.open(CACHE);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(req.url, { cache: 'no-cache', signal: ctrl.signal });
    clearTimeout(t);
    if (r && r.ok) cache.put(req, r.clone());
    return r;
  } catch (_) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const inicio = await cache.match('index.html');
      if (inicio) return inicio;
    }
    return Response.error();
  }
}

// Externos: copia guardada al instante y se actualiza por detrás
async function externo(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const red = fetch(req).then(r => {
    if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
    return r;
  }).catch(() => null);
  return hit || (await red) || Response.error();
}