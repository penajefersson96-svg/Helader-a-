/* =========================================================
   SERVICE WORKER - Hace que la app funcione sin internet
   - Archivos de la app: se abren AL INSTANTE desde la copia
     guardada y se actualizan por detrás (la versión nueva se
     ve la próxima vez que abras la app).
   - Archivos externos (iconos, fuentes): copia guardada primero.
     Si no hay copia, esperan máximo 3 s y la app sigue sin ellos.
   - La tasa del dólar nunca se guarda: siempre en vivo.
   Cada vez que AGREGUES un archivo nuevo a la app, súmalo a
   LOCAL y cambia VERSION.
   ========================================================= */

const VERSION = 'v16';
const CACHE = 'Tienda-' + VERSION;

// Únicos sitios externos que la app puede guardar en memoria
const PERMITIDOS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

const LOCAL = [
  './', 'index.html', 'manifest.json',
  'css/styles.css',
  'js/utils.js', 'js/storage.js', 'js/cripto.js', 'js/maestra.js', 'js/licencia.js', 'js/boveda.js', 'js/picker.js', 'js/tasa.js',
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
    
    // Archivos externos que usa index.html (Lucide, fuentes...). Se guardan "opacos".
    try {
      const html = await (await fetch('index.html', { cache: 'reload' })).text();
      const urls = [...html.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)["']/g)].map(m => m[1]);
      await Promise.allSettled(urls.map(async u => {
        const r = await conTiempo(new Request(u, { mode: 'no-cors' }), 6000);
        await cache.put(u, r);
      }));
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

// fetch que se rinde a los N milisegundos (evita quedarse colgado con wifi sin internet)
function conTiempo(req, ms, opciones) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const url = typeof req === 'string' ? req : req.url;
  return fetch(req, { ...(opciones || {}), signal: ctrl.signal }).finally(() => clearTimeout(t));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  
  if (url.hostname.includes('dolarapi')) return; // la tasa siempre en vivo
  if (url.origin === location.origin) e.respondWith(propio(e, req));
  else if (PERMITIDOS.includes(url.hostname)) e.respondWith(externo(e, req));
  // cualquier otro sitio externo: no se toca ni se guarda
});

// Archivos de la app: copia guardada al instante + actualización por detrás
async function propio(e, req) {
  const cache = await caches.open(CACHE);
  let hit = await cache.match(req, { ignoreSearch: true });
  if (!hit && req.mode === 'navigate') hit = await cache.match('index.html');
  
  const red = conTiempo(req.url, 10000, { cache: 'no-cache' })
    .then(r => { if (r && r.ok) cache.put(req, r.clone()); return r; })
    .catch(() => null);
  
  if (hit) { e.waitUntil(red); return hit; }
  return (await red) || Response.error();
}

// Externos: copia guardada al instante; si no hay, espera máx. 3 s
async function externo(e, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const red = conTiempo(req, hit ? 10000 : 3000)
    .then(r => { if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone()); return r; })
    .catch(() => null);
  if (hit) { e.waitUntil(red); return hit; }
  return (await red) || Response.error();
}