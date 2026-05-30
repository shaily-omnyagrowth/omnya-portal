// api/_lib/stripeClient.js
//
// Singleton Stripe SDK client. Fails loudly if STRIPE_SECRET_KEY is missing.

const Stripe = require('stripe');

let _stripe = null;

function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  _stripe = Stripe(key, { apiVersion: '2024-06-20' });
  return _stripe;
}

module.exports = { getStripe };
