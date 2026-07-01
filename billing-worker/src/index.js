/**
 * billing-worker — Stripe Checkout session stub (deploy separately).
 * Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_ID in wrangler secrets — NEVER in repo.
 *
 * Deploy: cd billing-worker && npx wrangler deploy
 * Set billingApiUrl in config.js to the Worker URL.
 */

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/checkout' && request.method === 'POST') {
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
        return json({ error: 'Billing not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID in Worker secrets.' }, 503, cors);
      }
      let returnUrl = url.origin;
      try {
        const body = await request.json();
        if (body.returnUrl) returnUrl = body.returnUrl;
      } catch { /* ok */ }
      const success = `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}checkout=success`;
      const cancel = returnUrl;

      // TODO: call Stripe API — POST https://api.stripe.com/v1/checkout/sessions
      // with price, mode=subscription, success_url, cancel_url.
      // Example (implement when keys are set):
      // const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      //   method: 'POST',
      //   headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      //   body: new URLSearchParams({ 'line_items[0][price]': env.STRIPE_PRICE_ID, mode: 'subscription', success_url: success, cancel_url: cancel }),
      // });
      return json({
        error: 'Stripe checkout not wired yet. Add STRIPE_SECRET_KEY + STRIPE_PRICE_ID and uncomment session creation in billing-worker/src/index.js',
        todo: { success_url: success, cancel_url: cancel },
      }, 501, cors);
    }

    if (url.pathname === '/health') return json({ ok: true, service: 'mathboard-billing' }, 200, cors);
    return json({ error: 'Not found' }, 404, cors);
  },
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}
