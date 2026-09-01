const jwt = require("jsonwebtoken");
const express = require("express");
const app = express();

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

app.post('/webhook', express.text(), (request, response) => {
  let event;
  let eventData;

  try {
    const rawPayload = jwt.verify(request.body, PUBLIC_KEY);
    event = JSON.parse(rawPayload.data);
    eventData = JSON.parse(event.data);
  } catch (err) {
    console.error(err);
    response.status(400).send(`Webhook error: ${err.message}`);
    return;
  }

  switch (event.eventType) {
    case "AppInstalled":
      console.log(`AppInstalled event received with data:`, eventData);
      console.log(`App instance ID:`, event.instanceId);
      //
      // handle your event here
      //
      break;
    default:
      console.log(`Received unknown event type: ${event.eventType}`);
      break;
  }

  response.status(200).send();

});

app.listen(3000, () => console.log("Server started on port 3000"));
