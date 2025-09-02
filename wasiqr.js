const { makeid } = require('./id');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib'); // <-- 1. IMPORT ZLIB
let router = express.Router();
const pino = require("pino");
const {
    default: Wasi_Tech,
    useMultiFileAuthState,
    Browsers,
    delay,
} = require("@whiskeysockets/baileys");

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

// <-- 2. FUNCTION TO GENERATE YOUR UNIQUE SESSION NAME
function generateUniqueName() {
    const randomPart = makeid(5).toLowerCase();
    return `bwmxmd_${randomPart}`;
}

router.get('/', async (req, res) => {
    const id = makeid();

    // <-- 3. ENSURE THE FINAL SESSIONS DIRECTORY EXISTS
    const sessionsDir = path.join(__dirname, 'sessions');
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }

    async function WASI_MD_QR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
        try {
            let Qr_Code_By_Wasi_Tech = Wasi_Tech({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS("Desktop"),
            });

            Qr_Code_By_Wasi_Tech.ev.on('creds.update', saveCreds);
            Qr_Code_By_Wasi_Tech.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect, qr } = s;

                if (qr) {
                    // Send the QR code buffer to the user's browser to display
                    res.end(await QRCode.toBuffer(qr));
                }

                if (connection === "open") {
                    await delay(5000);

                    // --- START OF NEW LOGIC ---

                    // 4. READ THE CREDS.JSON FILE
                    const credsData = fs.readFileSync(path.join(__dirname, `/temp/${id}/creds.json`));

                    // 5. COMPRESS THE DATA
                    const compressedData = zlib.gzipSync(credsData);

                    // 6. ENCODE TO BASE64 AND FORMAT IT
                    const base64CompressedData = compressedData.toString('base64');
                    const finalSessionString = `BWM-XMD;;;${base64CompressedData}`;

                    // 7. GENERATE UNIQUE NAME AND FILE PATH
                    const uniqueName = generateUniqueName();
                    const sessionFilePath = path.join(sessionsDir, `${uniqueName}.json`);

                    // 8. SAVE THE FORMATTED STRING TO THE FILE
                    fs.writeFileSync(sessionFilePath, finalSessionString);

                    // 9. SEND THE UNIQUE NAME TO THE USER
                    const successMessage = `
✅ *Your Session ID Has Been Generated!*

Your unique session name is:
📋 \`${uniqueName}\`

Copy this name and paste it into the \`SESSION_ID\` or \`conf.session\` variable in your bot's configuration.

_This session name will be used to fetch your credentials automatically._
`;

                    await Qr_Code_By_Wasi_Tech.sendMessage(
                        Qr_Code_By_Wasi_Tech.user.id,
                        { text: successMessage }
                    );

                    // --- END OF NEW LOGIC ---

                    await delay(100);
                    await Qr_Code_By_Wasi_Tech.ws.close();
                    return await removeFile("temp/" + id);

                } else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(10000);
                    WASI_MD_QR_CODE();
                }
            });
        } catch (err) {
            if (!res.headersSent) {
                await res.json({ code: "Service is Currently Unavailable" });
            }
            console.log(err);
            await removeFile("temp/" + id);
        }
    }
    return await WASI_MD_QR_CODE();
});

module.exports = router;
