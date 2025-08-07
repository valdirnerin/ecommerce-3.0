#!/usr/bin/env node
require('dotenv').config();

const accessToken = process.env.MP_ACCESS_TOKEN;

if (!accessToken) {
  console.error('MP_ACCESS_TOKEN no configurado');
  process.exit(1);
}

async function listarWebhooks() {
  try {
    const res = await fetch('https://api.mercadopago.com/users/me/notifications/webhooks', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Error HTTP ${res.status}: ${txt}`);
    }

    const webhooks = await res.json();

    if (Array.isArray(webhooks) && webhooks.length > 0) {
      webhooks.forEach((wh, i) => {
        console.log(`Webhook ${i + 1}`);
        console.log(`  URL: ${wh.url}`);
        const events = wh.event_types || wh.events || [];
        console.log(`  Eventos: ${events.join(', ')}`);
        console.log('---');
      });
    } else {
      console.log('No hay webhooks configurados.');
    }
  } catch (err) {
    console.error('Error al consultar webhooks:', err.message);
  }
}

listarWebhooks();
