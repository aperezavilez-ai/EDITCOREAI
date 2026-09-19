// Serverless Function: POST /api/create-checkout
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId, userEmail, packCredits, gateway = "mercadopago" } = req.body || {};
  const credits = parseInt(packCredits, 10) || 100;
  
  let priceUsd = 5;
  if (credits === 500) priceUsd = 20;
  if (credits === 1500) priceUsd = 50;

  const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (gateway === "stripe") {
    const checkoutUrl = `https://checkout.stripe.com/pay/${orderId}?client_reference_id=${encodeURIComponent(userId)}&credits=${credits}`;
    return res.status(200).json({ ok: true, orderId, gateway, checkoutUrl, priceUsd, credits });
  } else {
    // Mercado Pago Preference
    const checkoutUrl = `https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=${orderId}&credits=${credits}`;
    return res.status(200).json({ ok: true, orderId, gateway: "mercadopago", checkoutUrl, priceUsd, credits });
  }
};
