const enabledValues = new Set(['1', 'true', 'yes', 'on']);

const operationalPagePatterns = [
  /^\/admin(?:\/|$)/,
  /^\/fotografo\/?$/,
  /^\/fotografo\/definir-senha\/?$/,
  /^\/auth\/callback\/?$/,
  /^\/checkout\/?$/,
  /^\/(?:pagar|pagamento\/sucesso|checkout\/sucesso)\/?$/,
  /^\/download\/?$/,
  /^\/(?:minha-conta|minhas-compras)\/?$/,
];

const assetExtensions = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mp4|png|svg|txt|webmanifest|webp|woff2?)$/i;

export function isMaintenanceModeEnabled(value = process.env.MAINTENANCE_MODE) {
  return enabledValues.has(String(value || '').trim().toLowerCase());
}

export function isOperationalPagePath(pathname: string) {
  const normalized = pathname.split('?')[0] || '/';
  return operationalPagePatterns.some((pattern) => pattern.test(normalized));
}

export function isMaintenanceAssetPath(pathname: string) {
  const normalized = pathname.split('?')[0] || '/';
  return normalized.startsWith('/assets/') ||
    normalized.startsWith('/src/') ||
    normalized.startsWith('/@vite/') ||
    normalized === '/@react-refresh' ||
    normalized.startsWith('/.well-known/') ||
    assetExtensions.test(normalized);
}

export function shouldServeMaintenancePage(input: {
  method?: string;
  pathname: string;
  maintenanceMode?: string;
}) {
  if (!isMaintenanceModeEnabled(input.maintenanceMode)) return false;
  if (!['GET', 'HEAD'].includes(String(input.method || 'GET').toUpperCase())) return false;
  if (input.pathname.startsWith('/api/') || input.pathname === '/api') return false;
  if (isOperationalPagePath(input.pathname)) return false;
  if (isMaintenanceAssetPath(input.pathname)) return false;
  return true;
}

export function getMaintenanceRetryAfter(value = process.env.MAINTENANCE_RETRY_AFTER) {
  const seconds = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(seconds) && seconds > 0 ? String(seconds) : '3600';
}

export function getMaintenanceHtml() {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Language" content="pt-BR" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="A plataforma FUNPACE MEDIA está passando por melhorias. Em breve estaremos de volta." />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="theme-color" content="#090909" />
    <meta property="og:site_name" content="FUNPACE MEDIA" />
    <meta property="og:title" content="FUNPACE MEDIA — Estamos preparando uma nova experiência" />
    <meta property="og:description" content="A plataforma está passando por melhorias. Em breve estaremos de volta." />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="pt_BR" />
    <meta property="og:image" content="https://funpace.media/maintenance-og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="FUNPACE MEDIA — Estamos preparando uma nova experiência" />
    <meta name="twitter:description" content="A plataforma está passando por melhorias. Em breve estaremos de volta." />
    <meta name="twitter:image" content="https://funpace.media/maintenance-og.png" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <title>FUNPACE MEDIA — Plataforma em atualização</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; margin: 0; }
      body { background: #090909; color: #f7f7f3; }
      .page { position: relative; display: grid; min-height: 100svh; overflow: hidden; isolation: isolate; background: #090909; }
      .bg-video { position: fixed; inset: 0; z-index: -3; width: 100%; height: 100%; object-fit: cover; object-position: center; }
      .overlay { position: fixed; inset: 0; z-index: -2; background: linear-gradient(180deg, rgba(9,9,9,.7) 0%, rgba(9,9,9,.45) 40%, rgba(9,9,9,.45) 65%, rgba(9,9,9,.8) 100%); }
      .shell { display: flex; width: min(100%, 90rem); min-height: 100svh; margin: 0 auto; padding: clamp(1.4rem, 4vw, 3.5rem); flex-direction: column; }
      .brand { display: flex; align-items: center; gap: 1.5rem; }
      .logo { display: block; width: clamp(10.5rem, 22vw, 16rem); height: auto; }
      .content { flex: 1; display: flex; flex-direction: column; justify-content: center; width: min(100%, 59rem); padding: clamp(2rem, 5vh, 4rem) 0; }
      .eyebrow { display: flex; align-items: center; gap: .8rem; margin: 0 0 1.35rem; color: #ff6a2b; font-size: .72rem; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
      .eyebrow::before { width: 2.4rem; height: 2px; background: currentColor; content: ""; }
      h1 { max-width: 13ch; margin: 0; font-size: clamp(3rem, 7.8vw, 7.6rem); font-weight: 750; letter-spacing: -.065em; line-height: .91; text-wrap: balance; text-transform: uppercase; }
      .accent { color: #ff4e00; }
      .lead { max-width: 42rem; margin: clamp(1.7rem, 4vw, 2.8rem) 0 0; color: rgba(255,255,255,.7); font-size: clamp(1rem, 1.65vw, 1.3rem); line-height: 1.68; text-wrap: pretty; }
      .lead strong { color: #fff; font-weight: 650; }
      @media (max-width: 640px) {
        .shell { padding: 1.35rem; }
        .brand { align-items: flex-start; flex-direction: column; }
        .content { padding: 2.25rem 0; }
        h1 { font-size: clamp(2.8rem, 14.2vw, 4.8rem); }
      }
      @media (prefers-reduced-motion: reduce) {
        .bg-video { display: none; }
        .page { background: radial-gradient(ellipse at top right, rgba(255,78,0,.14), transparent 60%), #090909; }
      }
    </style>
  </head>
  <body>
    <main class="page" aria-labelledby="maintenance-title">
      <video class="bg-video" src="/hero-background.mp4" autoplay muted loop playsinline preload="metadata" aria-hidden="true"></video>
      <div class="overlay" aria-hidden="true"></div>
      <div class="shell">
        <header class="brand">
          <img class="logo" src="/funpace.png" width="919" height="123" alt="FUNPACE" />
        </header>
        <section class="content">
          <p class="eyebrow">Novidades a caminho</p>
          <h1 id="maintenance-title">Estamos preparando uma <span class="accent">nova experiência.</span></h1>
          <p class="lead">A plataforma FUNPACE MEDIA está passando por melhorias para entregar uma experiência ainda melhor. <strong>Em breve estaremos de volta.</strong></p>
        </section>
      </div>
    </main>
  </body>
</html>`;
}

export function sendMaintenanceResponse(req: any, res: any) {
  res.status(503);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Retry-After', getMaintenanceRetryAfter());
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (String(req?.method || 'GET').toUpperCase() === 'HEAD') return res.end();
  return res.send(getMaintenanceHtml());
}
