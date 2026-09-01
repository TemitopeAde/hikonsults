import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const app = express();

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

app.post("/webhook", express.text({ type: "*/*", limit: "1mb" }), (request, response) => {
  const requestId = response.get("x-request-id");
  const rawBody = typeof request.body === "string" ? request.body : "";

  console.log("[webhook:received]", {
    requestId,
    bodyBytes: Buffer.byteLength(rawBody, "utf8"),
    hasBody: rawBody.length > 0,
    hasWixSignature: Boolean(request.get("x-wix-signature")),
  });

  let event;
  let eventData;

  try {
    const rawPayload = jwt.verify(rawBody, PUBLIC_KEY);
    const payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;

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
