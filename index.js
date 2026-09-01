import "dotenv/config";
import express from "express";
import jwt from "jsonwebtoken";
import pg from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    })
  : null;

let databaseReady;

function ensureDatabase() {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }

  databaseReady ??= pool
    .query(`
        CREATE TABLE IF NOT EXISTS wix_webhook_events (
          id BIGSERIAL PRIMARY KEY,
          event_id TEXT,
          request_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          instance_id TEXT,
          app_id TEXT,
          app_name TEXT,
          origin_instance_id TEXT,
          webhook_id TEXT,
          identity_type TEXT,
          wix_user_id TEXT,
          owner_email TEXT,
          operation_timestamp TIMESTAMPTZ,
          vendor_product_id TEXT,
          cycle TEXT,
          previous_vendor_product_id TEXT,
          previous_cycle TEXT,
          coupon_name TEXT,
          invoice_id TEXT,
          expires_on TIMESTAMPTZ,
          payload JSONB NOT NULL,
          event_data JSONB,
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (event_id)
        )
      `)
    .then(() =>
      pool.query(`
        ALTER TABLE wix_webhook_events
          ADD COLUMN IF NOT EXISTS app_id TEXT,
          ADD COLUMN IF NOT EXISTS app_name TEXT,
          ADD COLUMN IF NOT EXISTS origin_instance_id TEXT,
          ADD COLUMN IF NOT EXISTS webhook_id TEXT,
          ADD COLUMN IF NOT EXISTS identity_type TEXT,
          ADD COLUMN IF NOT EXISTS wix_user_id TEXT,
          ADD COLUMN IF NOT EXISTS owner_email TEXT,
          ADD COLUMN IF NOT EXISTS operation_timestamp TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS vendor_product_id TEXT,
          ADD COLUMN IF NOT EXISTS cycle TEXT,
          ADD COLUMN IF NOT EXISTS previous_vendor_product_id TEXT,
          ADD COLUMN IF NOT EXISTS previous_cycle TEXT,
          ADD COLUMN IF NOT EXISTS coupon_name TEXT,
          ADD COLUMN IF NOT EXISTS invoice_id TEXT,
          ADD COLUMN IF NOT EXISTS expires_on TIMESTAMPTZ
      `),
    )
    .catch((err) => {
      databaseReady = undefined;
      throw err;
    });

  return databaseReady;
}

async function saveWebhookEvent({ requestId, payload, event, eventData }) {
  await ensureDatabase();

  const identity =
    typeof eventData?.identity === "string"
      ? JSON.parse(eventData.identity)
      : eventData?.identity ?? {};
  const eventId =
    payload.id ??
    event.id ??
    event.webhookId ??
    eventData?.id ??
    eventData?.webhookId ??
    null;

  const result = await pool.query(
    `
      INSERT INTO wix_webhook_events
        (event_id, request_id, event_type, instance_id, app_id, app_name,
         origin_instance_id, webhook_id, identity_type, wix_user_id,
         owner_email, operation_timestamp, vendor_product_id, cycle,
         previous_vendor_product_id, previous_cycle, coupon_name, invoice_id,
         expires_on, payload, event_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
              $14, $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id, event_id, received_at
    `,
    [
      eventId,
      requestId,
      event.eventType,
      event.instanceId ?? null,
      eventData?.appId ?? null,
      eventData?.appName ?? event.appName ?? null,
      eventData?.originInstanceId ?? null,
      eventData?.webhookId ?? null,
      identity.identityType ?? null,
      identity.wixUserId ?? null,
      eventData?.ownerEmail ?? eventData?.ownerInfo?.email ?? null,
      eventData?.operationTimeStamp ?? null,
      eventData?.vendorProductId ?? null,
      eventData?.cycle ?? null,
      eventData?.previousVendorProductId ?? null,
      eventData?.previousCycle ?? null,
      eventData?.couponName ?? null,
      eventData?.invoiceId ?? null,
      eventData?.expiresOn ?? null,
      JSON.stringify(payload),
      eventData == null ? null : JSON.stringify(eventData),
    ],
  );

  return {
    inserted: result.rowCount === 1,
    row: result.rows[0] ?? null,
  };
}

const app = express();

app.use((request, response, next) => {
  const requestId = request.get("x-request-id") || randomUUID();

  response.set("x-request-id", requestId);

  next();
});

// server.js
//
// Use this sample code to handle webhook events in your expressjs server.
//
// 1) Paste this code into a new file (server.js)
//
// 2) Install dependencies
//   npm install jsonwebtoken
//   npm install express
//
// 3) Run the server on http://localhost:3000
//   node server.js

// consider loading your public key from a file or an environment variable
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3KdtTC/Lq5yZMZ7UkbJy
D2J13AYWishPXQ3gaCq06edmvmEvjQddgvV5P4alsV1D84rMPoK2Yj/mgA8992H6
4V1Y/PDxkFnHlLB6rMshlSj5kWB02CeRSguR6PTNnFVbN6d1NbhzPIEnAYxKXROP
lGp4rre829KiJw/RZa+8rTNEacizGvl74+CygpXb9/95xiHDp4K9FLVPLnciPrrc
pxst2FihE3HtLPNi7ZXHmcprMpconchK2DzFQr/0resO9sSUwxhtG+ar3dR04eC0
y3Pm1JoSiZ07m7UbjuIOXrLgXgYZ3hbmcvNwZaDCVAjC3C0RPMl0IGxLOEgS9FmX
hQIDAQAB
-----END PUBLIC KEY-----`;

app.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

app.post("/webhook", express.text({ type: "*/*", limit: "1mb" }), async (request, response) => {
  const requestId = response.get("x-request-id");
  const rawBody = typeof request.body === "string" ? request.body : "";

  let event;
  let eventData;
  let payload;

  try {
    const rawPayload = jwt.verify(rawBody, PUBLIC_KEY);
    payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;

    event = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data;
    eventData = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch {
    response.status(400).send("Invalid webhook");
    return;
  }

  try {
    await saveWebhookEvent({ requestId, payload, event, eventData });
  } catch {
    response.status(500).send("Webhook could not be saved");
    return;
  }

  response.sendStatus(200);
});

app.use((_err, _request, response, _next) => {
  response.status(400).send("Invalid request");
});

const port = Number(process.env.PORT) || 3000;

if (!process.env.VERCEL) {
  app.listen(port);
}

export default app;
