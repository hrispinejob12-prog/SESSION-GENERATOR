// pair.js (Simplified and More Stable)

const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
let router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

function generateUniqueName() {
  const randomPart = makeid(5).toLowerCase();
  return `bwmxmd_${randomPart}`;
}

router.get('/', async (req, res) => {
    let num = req.query.number;

    if (!num || !num.match(/[\d\s+\-()]+/)) {
        return res.status(400).send({ error: "A valid phone number is required." });
    }
    
    num = num.replace(/[^0-9]/g, '');
    const id = makeid();
    const authPath = path.join('./temp/', id);
    const sessionsDir = path.join(__dirname, 'sessions');

    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    try {
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.ubuntu("Chrome"), // Using a different browser identifier for stability
            version: [2, 2443, 4], // Pinning a specific, stable WhatsApp version
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log("✅ Pairing successful, connection opened. Saving session...");
                
                await delay(5000); // Wait for all creds to be received

                const credsData = fs.readFileSync(path.join(authPath, 'creds.json'));
                const compressedData = zlib.gzipSync(credsData);
                const base64CompressedData = compressedData.toString('base64');
                const finalSessionString = `BWM-XMD;;;${base64CompressedData}`;
                const uniqueName = generateUniqueName();
                const sessionFilePath = path.join(sessionsDir, `${uniqueName}.json`);
                
                fs.writeFileSync(sessionFilePath, finalSessionString);

                const successMessage = `
✅ *Your Session ID Has Been Generated!*

Your unique session name is:
📋 \`${uniqueName}\`

Copy this name and paste it into the \`SESSION_ID\` or \`conf.session\` variable.`;
                
                await sock.sendMessage(sock.user.id, { text: successMessage });
                console.log(`Session saved for ${sock.user.id}. Name: ${uniqueName}`);
                
                await delay(100);
                sock.ws.close();
                removeFile(authPath); // Clean up ONLY after a successful pairing
            } else if (connection === "close") {
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                console.log(`Connection closed. Reason: ${DisconnectReason[reason] || reason}`);
                // We will not clean up here to prevent the session from being destroyed prematurely.
            }
        });

        if (!sock.authState.creds.registered) {
            await delay(1500); // Give the socket a moment to initialize
            const code = await sock.requestPairingCode(num);
            console.log(`✅ Your pairing code is: ${code}`);
            res.send({ code }); // Send code to browser and keep the process running
        } else {
            res.status(400).send({ error: "This session is already registered." });
        }

    } catch (err) {
        console.error("❌ Error during pairing process:", err);
        removeFile(authPath); // Clean up if a major error occurs
        if (!res.headersSent) {
            res.status(500).send({ error: "An unexpected error occurred." });
        }
    }
});

module.exports = router;
