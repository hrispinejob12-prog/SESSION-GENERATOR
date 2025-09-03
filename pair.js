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

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

function generateUniqueName() {
    const randomPart = makeid(5).toLowerCase();
    return `bwmxmd_${randomPart}`;
}

router.get('/', async (req, res) => {
    const num = req.query.number?.replace(/[^0-9]/g, '');
    let sock;

    if (!num) {
        return res.status(400).send({ error: "A valid phone number is required." });
    }
    
    const id = makeid();
    const authPath = path.join(tempDir, id);
    const sessionsDir = path.join(__dirname, 'sessions');

    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    try {
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.macOS("Desktop"),
        });

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                await delay(5000);
                const credsData = fs.readFileSync(path.join(authPath, 'creds.json'));
                const compressedData = zlib.gzipSync(credsData);
                const base64CompressedData = compressedData.toString('base64');
                const finalSessionString = `BWM-XMD;;;${base64CompressedData}`;
                const uniqueName = generateUniqueName();
                const sessionFilePath = path.join(sessionsDir, `${uniqueName}.json`);
                
                fs.writeFileSync(sessionFilePath, finalSessionString);

                const successMessage = `✅ *Your Session ID Has Been Generated!*\n\nYour unique session name is:\n📋 \`${uniqueName}\`\n\nCopy this name and paste it into the \`SESSION_ID\` variable.`;
                
                await sock.sendMessage(sock.user.id, { text: successMessage });
                
                await delay(100);
                sock.ws.close();
                removeFile(authPath);

            } else if (connection === "close") {
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                    removeFile(authPath);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered) {
            await delay(1500);
            const code = await sock.requestPairingCode(num);
            if(res.headersSent) return;
            res.send({ code });
        }

    } catch (err) {
        console.error("An unexpected error occurred:", err);
        removeFile(authPath);
        if(res.headersSent) return;
        res.status(500).send({ error: "An unexpected error occurred." });
    }
});

module.exports = router;
