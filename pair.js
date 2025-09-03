const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const router = express.Router();

// --- HELPER FUNCTIONS ---

/**
 * Generates a random alphanumeric ID of a given length.
 * @param {number} length The desired length of the ID.
 * @returns {string} The generated random ID.
 */
function makeid(length = 5) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

/**
 * Recursively removes a file or directory.
 * @param {string} filePath The path to the file or directory to remove.
 */
function removeFile(filePath) {
    if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { recursive: true, force: true });
    }
}

/**
 * Generates a unique session name with a prefix.
 * @returns {string} The unique session name.
 */
function generateUniqueName() {
    const randomPart = makeid(5).toLowerCase();
    return `bwmxmd_${randomPart}`;
}

/**
 * Validates and formats a phone number, with a focus on Kenyan numbers.
 * @param {string} number The input phone number.
 * @returns {string} The formatted phone number for WhatsApp.
 */
function formatPhoneNumber(number) {
    let cleanNumber = number.replace(/\D/g, ''); // Remove all non-digit characters

    if (cleanNumber.startsWith('0')) {
        cleanNumber = '254' + cleanNumber.substring(1);
    } else if (cleanNumber.length === 9 && !cleanNumber.startsWith('254')) {
        cleanNumber = '254' + cleanNumber;
    }
    return cleanNumber;
}

/**
 * Ensures that the required directories for sessions exist.
 * @param  {...string} dirs A list of directory paths to ensure exist.
 */
function ensureDirectoriesExist(...dirs) {
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}


// --- CORE PAIRING LOGIC ---

/**
 * Handles the logic for saving the session file once connected.
 * @param {object} socket The Baileys socket instance.
 * @param {string} authPath The path to the temporary authentication files.
 */
async function saveSession(socket, authPath) {
    const sessionsDir = path.join(__dirname, 'sessions');
    const credsPath = path.join(authPath, 'creds.json');

    if (!fs.existsSync(credsPath)) {
        throw new Error("Credentials file not found after pairing.");
    }

    const credsData = fs.readFileSync(credsPath);
    const compressedData = zlib.gzipSync(credsData);
    const checksum = crypto.createHash('md5').update(credsData).digest('hex');
    const base64CompressedData = compressedData.toString('base64');
    
    const finalSessionString = `BWM-XMD;;;${base64CompressedData};;;${checksum}`;

    const uniqueName = generateUniqueName();
    const sessionFilePath = path.join(sessionsDir, `${uniqueName}.json`);
    fs.writeFileSync(sessionFilePath, finalSessionString);

    console.log(`[SUCCESS] Session saved successfully: ${uniqueName}`);

    const successMessage = `✅ *Your Session ID Has Been Generated!*

Your unique session name is:
📋 \`${uniqueName}\`

Copy this name and paste it into the \`SESSION_ID\` or \`conf.session\` variable in your bot's configuration.`;

    await socket.sendMessage(socket.user.id, { text: successMessage });
}

/**
 * Manages the entire pairing process for a single request.
 * @param {string} phoneNumber The user's phone number.
 * @param {object} res The Express response object.
 */
async function handlePairingRequest(phoneNumber, res) {
    const id = makeid();
    const authPath = path.join(__dirname, 'temp', id);
    let socket;
    let responseSent = false;
    let codeRequested = false;

    const cleanup = () => {
        clearTimeout(requestTimeout);
        if (socket) {
            socket.end(undefined);
        }
        removeFile(authPath);
    };

    const sendError = (message, statusCode = 500) => {
        if (!responseSent) {
            responseSent = true;
            res.status(statusCode).send({ error: message });
        }
        cleanup();
    };

    const requestTimeout = setTimeout(() => {
        sendError("Pairing process timed out. Please try again.", 408);
    }, 90000);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(authPath);

        socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            // --- KEY CHANGE: Using a common browser identity ---
            browser: Browsers.ubuntu("Chrome"),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
        });

        socket.ev.on('creds.update', saveCreds);

        socket.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            
            // --- KEY CHANGE: Request code only when the socket is ready ---
            if (connection === 'connecting' && !codeRequested) {
                 try {
                    console.log(`[INFO] Socket is connecting. Requesting pairing code for ${phoneNumber}`);
                    codeRequested = true;
                    const code = await socket.requestPairingCode(phoneNumber);
                    if (code && !responseSent) {
                        responseSent = true;
                        res.send({ code: code });
                    }
                } catch (error) {
                    console.error("[ERROR] Failed to request pairing code:", error);
                    sendError("Failed to request pairing code. The phone number might be invalid or WhatsApp is temporarily blocking requests.", 400);
                }
            }

            if (connection === "open") {
                console.log(`[OPEN] Connection established for ${id}`);
                try {
                    await delay(2000); 
                    await saveSession(socket, authPath);
                } catch (error) {
                    console.error("[ERROR] Failed to save session:", error);
                    sendError("Could not process your session after connection.");
                } finally {
                    cleanup();
                }
            } else if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode;
                console.log(`[CLOSE] Connection closed for ${id}. Reason: ${DisconnectReason[reason] || reason}`);
                
                let errorMessage = "Connection failed. Please try again.";
                if (reason === DisconnectReason.timedOut) {
                    errorMessage = "Connection timed out. Please check your internet connection.";
                } else if (reason === 401) {
                    errorMessage = "Unauthorized. The pairing code was likely incorrect or expired. Please try again.";
                }
                
                if (reason !== DisconnectReason.loggedOut) {
                   sendError(errorMessage);
                } else {
                    cleanup();
                }
            }
        });
    } catch (error) {
        console.error(`[FATAL] Error in pairing process for ${id}:`, error);
        sendError(error.message || "An unexpected error occurred.");
    }
}


// --- EXPRESS ROUTE DEFINITION ---

router.get('/', async (req, res) => {
    const num = req.query.number;
    if (!num || !/^\+?\d{10,14}$/.test(num.replace(/\s+/g, ''))) {
        return res.status(400).send({ error: "A valid phone number is required." });
    }

    const formattedNum = formatPhoneNumber(num);

    try {
        ensureDirectoriesExist(path.join(__dirname, 'temp'), path.join(__dirname, 'sessions'));
        await handlePairingRequest(formattedNum, res);
    } catch (error) {
        console.error("[SERVER ERROR] Failed to initialize pairing process:", error);
        if (!res.headersSent) {
            res.status(500).send({ error: "Server configuration error." });
        }
    }
});

module.exports = router;

