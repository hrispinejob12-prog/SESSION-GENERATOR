// pair.js (Corrected and Improved)

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
    DisconnectReason // <-- Import DisconnectReason
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom"); // <-- Import Boom for error handling

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
        return res.status(400).send({ error: "A valid phone number is required to get a pairing code." });
    }

    // Clean the phone number
    num = num.replace(/[^0-9]/g, '');

    const id = makeid(); // For temporary authentication folder
    const authPath = path.join('./temp/', id);
    const sessionsDir = path.join(__dirname, 'sessions');

    // Ensure the sessions directory exists
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
            browser: Browsers.macOS("Desktop"),
            version: [2, 2423, 7], // Optional: Specify a stable WhatsApp version
        });

        // This listener will handle saving the session AFTER the user pairs successfully
        sock.ev.on('creds.update', saveCreds);

        // This listener handles the connection logic
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === "open") {
                try {
                    console.log("✅ Connection opened, saving session...");
                    await delay(5000); // Allow time for all credentials to be received

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

Copy this name and paste it into the \`SESSION_ID\` or \`conf.session\` variable in your bot's configuration.

_This session name will be used to fetch your credentials automatically._
`;
                    await sock.sendMessage(sock.user.id, { text: successMessage });
                    
                    console.log(`Session saved for ${sock.user.id}. Name: ${uniqueName}`);

                    await delay(100);
                    sock.ws.close();
                    removeFile(authPath); // Clean up temp folder
                } catch (error) {
                    console.error("❌ Error saving session:", error);
                    removeFile(authPath);
                }
            } else if (connection === "close") {
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                   console.log(`Connection closed. Reason: ${reason}. Cleaning up...`);
                }
                removeFile(authPath); // Clean up on close if not logged out
            }
        });

        // Request the pairing code only if the user is not already registered
        if (!sock.authState.creds.registered) {
            console.log(`Requesting pairing code for: ${num}`);
            try {
                // Add a small delay for the socket to initialize properly before requesting the code
                await delay(2000); 
                const code = await sock.requestPairingCode(num);
                console.log(`✅ Successfully got pairing code: ${code}`);
                if (!res.headersSent) {
                    // Send the code back to the browser
                    res.send({ code });
                }
            } catch (error) {
                console.error("❌ Failed to request pairing code:", error);
                if (!res.headersSent) {
                    res.status(500).send({ error: "Failed to request pairing code. Please check your phone number and try again." });
                }
                removeFile(authPath);
            }
        } else {
            // This case is unlikely with temporary folders but acts as a safeguard
            if (!res.headersSent) {
                res.status(400).send({ error: "This session is already registered. Cannot generate a new pairing code." });
            }
        }

    } catch (err) {
        console.error("❌ An unexpected error occurred in the pairing process:", err);
        removeFile(authPath);
        if (!res.headersSent) {
            res.status(500).send({ error: "An unexpected error occurred. Please try again later." });
        }
    }
});

module.exports = router;
