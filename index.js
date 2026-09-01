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
          origin_instance_id TEXT,
          webhook_id TEXT,
          identity_type TEXT,
          wix_user_id TEXT,
          owner_email TEXT,
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
          ADD COLUMN IF NOT EXISTS origin_instance_id TEXT,
          ADD COLUMN IF NOT EXISTS webhook_id TEXT,
          ADD COLUMN IF NOT EXISTS identity_type TEXT,
          ADD COLUMN IF NOT EXISTS wix_user_id TEXT,
          ADD COLUMN IF NOT EXISTS owner_email TEXT
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
        (event_id, request_id, event_type, instance_id, app_id,
         origin_instance_id, webhook_id, identity_type, wix_user_id,
         owner_email, payload, event_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id, event_id, received_at
    `,
    [
      eventId,
      requestId,
      event.eventType,
      event.instanceId ?? null,
      eventData?.appId ?? null,
      eventData?.originInstanceId ?? null,
      eventData?.webhookId ?? null,
      identity.identityType ?? null,
      identity.wixUserId ?? null,
      eventData?.ownerEmail ?? eventData?.ownerInfo?.email ?? null,
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

console.log("[handler:loaded]", {
  vercel: Boolean(process.env.VERCEL),
  nodeVersion: process.version,
  hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
});

app.use((request, response, next) => {
  const requestId = request.get("x-request-id") || randomUUID();
  const startedAt = Date.now();

  response.set("x-request-id", requestId);
  console.log("[request:start]", {
    requestId,
    method: request.method,
    path: request.originalUrl,
    contentType: request.get("content-type") || null,
  });

  response.on("finish", () => {
    console.log("[request:finish]", {
      requestId,
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

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

  console.log("[webhook:received]", {
    requestId,
    body: rawBody,
    bodyBytes: Buffer.byteLength(rawBody, "utf8"),
    hasBody: rawBody.length > 0,
    hasWixSignature: Boolean(request.get("x-wix-signature")),
  });

  let event;
  let eventData;
  let payload;

  try {
    const rawPayload = jwt.verify(rawBody, PUBLIC_KEY);
    payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;

    event = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data;
    eventData = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch (err) {
    console.error("[webhook:error]", {
      requestId,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    });
    response.status(400).send("Invalid webhook");
    return;
  }

  try {
    const saveResult = await saveWebhookEvent({ requestId, payload, event, eventData });
    console.log("[webhook:database]", {
      requestId,
      eventType: event.eventType,
      saved: true,
      inserted: saveResult.inserted,
      duplicate: !saveResult.inserted,
      databaseRowId: saveResult.row?.id ?? null,
      savedEventId:
        saveResult.row?.event_id ??
        payload.id ??
        event.id ??
        event.webhookId ??
        eventData?.id ??
        eventData?.webhookId ??
        null,
      savedAt: saveResult.row?.received_at ?? null,
    });
  } catch (err) {
    console.error("[database:error]", {
      requestId,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    });
    response.status(500).send("Webhook could not be saved");
    return;
  }

  switch (event.eventType) {
    case "AppInstalled":
      console.log("[wix:app-installed]", {
        requestId,
        hasEventData: eventData !== undefined && eventData !== null,
        instanceId: event.instanceId,
      });
      //
      // handle your event here
      //
      break;
    default:
      console.log("[wix:unknown-event]", {
        requestId,
        eventType: event.eventType,
      });
      break;
  }

  console.log("[webhook:processed]", { requestId, eventType: event.eventType });
  response.sendStatus(200);
});

app.use((err, request, response, _next) => {
  console.error("[request:error]", {
    method: request.method,
    path: request.originalUrl,
    name: err instanceof Error ? err.name : typeof err,
    message: err instanceof Error ? err.message : String(err),
  });
  response.status(400).send("Invalid request");
});

const port = Number(process.env.PORT) || 3000;

if (!process.env.VERCEL) {
  app.listen(port, () => console.log("[server:started]", { port }));
}

export default app;
