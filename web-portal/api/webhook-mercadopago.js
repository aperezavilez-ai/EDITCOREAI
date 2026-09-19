// Serverless Function: POST /api/webhook-mercadopago
module.exports = async (req, res) => {
  const { type, data } = req.body || {};
  // Recibir notificación IPN de Mercado Pago
  return res.status(200).json({ received: true, type, id: data?.id });
};
