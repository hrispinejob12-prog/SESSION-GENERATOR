// pair.js (Enhanced Version with Robust Error Handling)

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
    Browsers,
    DisconnectReason
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");

// Track pairing attempts to prevent duplicates and rate limiting
const pairingCooldown = new Map();

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    try {
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (error) {
        console.error(`[ERROR] Failed to remove file ${FilePath}:`, error);
        return false;
    }
}

function generateUniqueName() {
  const randomPart = makeid(5).toLowerCase();
  return `bwmxmd_${randomPart}`;
}

// Helper function to find existing sessions for a number (if needed)
function findExistingSession(number) {
    // Implementation would depend on how you're tracking sessions
    return null; // Placeholder
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let sock;
    let timeout;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;
    const PAIRING_TIMEOUT = process.env.PAIRING_TIMEOUT || 180000; // 3 minutes

    console.log("--- [NEW PAIRING REQUEST] ---");

    // Enhanced phone number validation
    if (!num || !num.match(/^[\d\s+\-()]+$/) || num.replace(/[^0-9]/g, '').length < 8) {
        console.log(`[ERROR] Invalid phone number format: ${num}`);
        return res.status(400).send({ error: "A valid phone number with at least 8 digits is required." });
    }
    
    num = num.replace(/[^0-9]/g, '');
    console.log(`[INFO] Processing pairing for number: ${num}`);
    
    // Check for recent pairing attempts
    if (pairingCooldown.has(num)) {
        const lastAttempt = pairingCooldown.get(num);
        if (Date.now() - lastAttempt < 30000) { // 30 second cooldown
            console.log(`[RATE LIMIT] Too many attempts for ${num}`);
            return res.status(429).send({ error: "Please wait 30 seconds between pairing attempts" });
        }
    }
    
    pairingCooldown.set(num, Date.now());
    
    const id = makeid();
    const authPath = path.join('./temp/', id);
    const sessionsDir = path.join(__dirname, 'sessions');

    // Check directory permissions
    try {
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }
        fs.accessSync(sessionsDir, fs.constants.W_OK);
        console.log("[DEBUG] Write permissions confirmed");
    } catch (error) {
        console.error("[ERROR] No write permissions to sessions directory:", error);
        pairingCooldown.delete(num);
        return res.status(500).send({ error: "Server configuration error" });
    }

    // Clean up existing session if found
    const existingSession = findExistingSession(num);
    if (existingSession) {
        console.log(`[INFO] Found existing session for ${num}, cleaning up`);
        removeFile(path.join(sessionsDir, existingSession));
    }

    let heartbeatInterval;
    let connectionAlive = true;

    const cleanup = (message = "Cleaning up") => {
        console.log(`[INFO] ${message}. Closing connection and removing temp files.`);
        clearTimeout(timeout);
        timeout = undefined;
        
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
        
        // Remove from tracking
        if (pairingCooldown.has(num)) {
            pairingCooldown.delete(num);
        }
        
        if (sock) {
            try {
                sock.ws.close();
                sock.end();
            } catch (e) {
                console.log("[INFO] Error closing socket:", e.message);
            }
        }
        removeFile(authPath);
    };

    console.log(`[INFO] Using temporary auth path: ${authPath}`);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.windows("Chrome"),
        });
        console.log("[INFO] Socket created.");

        // Heartbeat monitoring
        heartbeatInterval = setInterval(() => {
            if (!connectionAlive && sock) {
                console.log("[HEARTBEAT] Connection appears dead, forcing cleanup");
                cleanup("Connection heartbeat failed");
            }
            connectionAlive = false;
        }, 30000);

        sock.ev.on('creds.update', saveCreds);
        console.log("[INFO] 'creds.update' event listener attached.");

        sock.ev.on("connection.update", async (update) => {
            try {
                const { connection, lastDisconnect } = update;
                connectionAlive = true; // Reset heartbeat
                console.log(`[CONNECTION_UPDATE] Status: ${connection}`, update);

                if (connection === "open") {
                    console.log("[SUCCESS] Connection opened. Clearing timeout and preparing to save session.");
                    clearTimeout(timeout);

                    await delay(5000);

                    // Read and compress credentials
                    const credsData = fs.readFileSync(path.join(authPath, 'creds.json'));
                    const compressedData = zlib.gzipSync(credsData);
                    const base64CompressedData = compressedData.toString('base64');
                    const finalSessionString = `BWM-XMD;;;${base64CompressedData}`;
                    const uniqueName = generateUniqueName();
                    const sessionFilePath = path.join(sessionsDir, `${uniqueName}.json`);
                    
                    // Save session file
                    fs.writeFileSync(sessionFilePath, finalSessionString);
                    console.log(`[SUCCESS] Session file created: ${sessionFilePath}`);

                    // Verify session file
                    try {
                        const savedData = fs.readFileSync(sessionFilePath, 'utf8');
                        if (!savedData.startsWith('BWM-XMD;;;')) {
                            throw new Error('Invalid session format');
                        }
                        
                        const base64Data = savedData.replace('BWM-XMD;;;', '');
                        const compressedData = Buffer.from(base64Data, 'base64');
                        zlib.gunzipSync(compressedData);
                        
                        console.log("[SUCCESS] Session file verified successfully");
                    } catch (error) {
                        console.error("[ERROR] Session verification failed:", error);
                        removeFile(sessionFilePath);
                        throw error;
                    }

                    const successMessage = `✅ *Your Session ID Has Been Generated!*\n\nYour unique session name is:\n📋 \`${uniqueName}\`\n\nCopy this name and paste it into the \`SESSION_ID\` or \`conf.session\` variable.`;
                    
                    await sock.sendMessage(sock.user.id, { text: successMessage });
                    console.log(`[SUCCESS] Session name sent to user: ${sock.user.id}`);
                    
                    await delay(100);
                    cleanup("Pairing successful");

                } else if (connection === "close") {
                    const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                    console.log(`[INFO] Connection closed. Reason code: ${reason} (${DisconnectReason[reason]})`);
                    
                    if (reason === DisconnectReason.loggedOut) {
                        cleanup("Device Logged Out");
                    } else if (reason === DisconnectReason.connectionLost && 
                               reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        // Auto-reconnect on connection loss
                        reconnectAttempts++;
                        console.log(`[RECONNECT] Attempt ${reconnectAttempts} of ${MAX_RECONNECT_ATTEMPTS}`);
                        await delay(2000);
                        // Reinitialize connection logic would go here
                    } else {
                        console.log("[INFO] Connection closed for a non-logout reason.");
                    }
                }
            } catch (error) {
                console.error("[ERROR] In connection.update handler:", error);
                cleanup("Error in connection update");
                if (!res.headersSent) {
                    res.status(500).send({ error: "Connection processing failed" });
                }
            }
        });

        if (!sock.authState.creds.registered) {
            console.log("[INFO] No existing registration found. Requesting new pairing code.");
            await delay(1500);
            const code = await sock.requestPairingCode(num);
            console.log(`[INFO] Pairing code received from WhatsApp: ${code}`);
            
            if (!res.headersSent) {
                res.send({ code });
                console.log("[INFO] Pairing code sent to browser.");
            }

            timeout = setTimeout(() => {
                cleanup("Pairing timed out after 3 minutes");
                if (!res.headersSent) {
                    res.status(408).send({ error: "Pairing timed out. Please try again." });
                }
            }, PAIRING_TIMEOUT);
            console.log(`[INFO] ${PAIRING_TIMEOUT/1000}-second pairing timeout initiated.`);

        } else {
            console.log("[INFO] User is already registered.");
            if (!res.headersSent) {
                res.status(400).send({ error: "Already registered." });
            }
            cleanup("Already registered");
        }

    } catch (err) {
        console.error("[FATAL_ERROR] An unexpected error occurred:", err);
        cleanup("Error occurred");
        if (!res.headersSent) {
            res.status(500).send({ error: "An unexpected error occurred." });
        }
    }
});

module.exports = router;
