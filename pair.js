// pair.js (Final Working Version)

const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const router = express.Router();
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

// Utility to remove files/directories
function removeFile(FilePath) {
    if (fs.existsSync(FilePath)) {
        fs.rmSync(FilePath, { recursive: true, force: true });
    }
}

// Generates a unique session name
function generateUniqueName() {
  const randomPart = makeid(5).toLowerCase();
  return `bwmxmd_${randomPart}`;
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let sock;
    let timeout;
    const id = makeid(); // Unique ID for this pairing request
    const authPath = path.join('./temp/', id);

    // Validate phone number
    if (!num || !/^\d+$/.test(num.replace(/[\s+\-()]/g, ''))) {
        return res.status(400).send({ error: "A valid phone number is required." });
    }
    
    num = num.replace(/[^0-9]/g, '');

    const sessionsDir = path.join(__dirname, 'sessions');
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }

    // Cleanup function to close socket and remove temp files
    const cleanup = () => {
        console.log("Cleaning up resources for request:", id);
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
        if (sock) {
            // End the connection gracefully
            sock.end(undefined); 
        }
        removeFile(authPath);
    };

    try {
        const { state, saveCreds } = await useMultiFileAuthState(authPath);

        sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.macOS("Chrome"),
        });

        // Event listener for credentials updates
        sock.ev.on('creds.update', saveCreds);

        // Event listener for connection updates
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log(`✅ Connection opened for ${id}. Saving session...`);
                clearTimeout(timeout); // Pairing successful, cancel the cleanup timeout

                await delay(2000); // Small delay to ensure creds are fully saved

                const credsData = fs.readFileSync(path.join(authPath, 'creds.json'));
                const compressedData = zlib.gzipSync(credsData);
                const base64CompressedData = compressedData.toString('base64');
                const finalSessionString = `BWM-XMD;;;${base64CompressedData}`;
                
                const uniqueName = generateUniqueName();
                const sessionFilePath = path.join(sessionsDir, `${uniqueName}.json`);
                
                fs.writeFileSync(sessionFilePath, JSON.stringify({ session: finalSessionString }));

                const successMessage = `✅ *Session ID Generated!*\n\nYour unique session name is:\n\`\`\`${uniqueName}\`\`\`\n\nCopy this name and paste it into your \`SESSION_ID\` environment variable.`;
                
                await sock.sendMessage(sock.user.id, { text: successMessage });
                console.log(`Session saved for ${sock.user.id}. Name: ${uniqueName}`);
                
                cleanup(); // Clean up after successful pairing

            } else if (connection === "close") {
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                const reasonText = DisconnectReason[reason] || `unknown (${reason})`;
                console.log(`Connection closed for ${id}. Reason: ${reasonText}`);

                // **THIS IS THE FIX:** Clean up on ANY close event during pairing,
                // unless it's a "loggedOut" event which is a valid final state.
                // We also check if the response hasn't been sent to notify the user.
                if (reason !== DisconnectReason.loggedOut) {
                    if (!res.headersSent) {
                         res.status(500).send({ error: "Connection failed after pairing. Please try again.", reason: reasonText });
                    }
                }
                cleanup(); // Always cleanup on close during the pairing phase
            }
        });

        // Request pairing code if not already registered
        if (!sock.authState.creds.registered) {
            await delay(1500);
            const code = await sock.requestPairingCode(num);
            console.log(`Pairing code for ${id}: ${code}`);
            
            if (!res.headersSent) {
                res.send({ code });
            }

            // Start a timeout to clean up if the user doesn't pair in time
            timeout = setTimeout(() => {
                console.log(`⌛ Pairing timed out for ${id}. Cleaning up.`);
                if (!res.headersSent) {
                    res.status(408).send({ error: "Pairing timed out. Please request a new code." });
                }
                cleanup();
            }, 60000); // 60 seconds

        } else {
            if (!res.headersSent) {
                res.status(400).send({ error: "Already registered." });
            }
            cleanup();
        }

    } catch (err) {
        console.error("❌ An unexpected error occurred:", err);
        if (!res.headersSent) {
            res.status(500).send({ error: "An unexpected error occurred." });
        }
        cleanup();
    }
});

module.exports = router;
