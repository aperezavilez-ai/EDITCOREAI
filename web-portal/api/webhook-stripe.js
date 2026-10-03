// Serverless Function: POST /api/webhook-stripe
module.exports = async (req, res) => {
  const { type, data } = req.body || {};
  // Recibir evento de checkout.session.completed de Stripe
  return res.status(200).json({ received: true, type, id: data?.object?.id });
};
