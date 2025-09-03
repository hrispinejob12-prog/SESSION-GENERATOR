// pair.js (Final Corrected Version with Timeout)

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
    let sock;
    let timeout;

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

    const cleanup = () => {
        console.log("Cleaning up temporary files and closing connection.");
        clearTimeout(timeout);
        timeout = undefined;
        if (sock) {
            sock.ws.close();
        }
        removeFile(authPath);
    };

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    try {
        sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.windows("Chrome"),
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log("✅ Connection opened, clearing timeout and saving session...");
                clearTimeout(timeout); // User paired successfully, cancel the cleanup timeout

                await delay(5000);

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
                cleanup(); // Clean up after successful pairing and message sent

            } else if (connection === "close") {
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                console.log(`Connection closed. Reason: ${DisconnectReason[reason] || reason}`);
                
                // Clean up only on fatal errors, otherwise let the timeout handle it
                if (reason === DisconnectReason.loggedOut) {
                    console.log("Device Logged Out, cleaning up.");
                    cleanup();
                }
            }
        });

        if (!sock.authState.creds.registered) {
            await delay(1500);
            const code = await sock.requestPairingCode(num);
            console.log(`✅ Successfully got pairing code: ${code}`);
            
            if (!res.headersSent) {
                res.send({ code });
            }

            // Start a 60-second timeout to clean up if the user doesn't pair in time
            timeout = setTimeout(() => {
                console.log("⌛ Pairing timed out. Please request a new code.");
                cleanup();
            }, 60000);

        } else {
            if (!res.headersSent) {
                res.status(400).send({ error: "Already registered." });
            }
        }

    } catch (err) {
        console.error("❌ An unexpected error occurred:", err);
        cleanup();
        if (!res.headersSent) {
            res.status(500).send({ error: "An unexpected error occurred." });
        }
    }
});

module.exports = router;
