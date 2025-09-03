// pair.js (Corrected Version)

const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('LS_Cj1IM_8DPObrYbScXZ1srAu17WCxt');
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
    Browsers
} = require("@whiskeysockets/baileys");

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

function generateUniqueName() {
    const randomPart = makeid(5).toLowerCase();
    return `bwmxmd_${randomPart}`;
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;
    
    if (!num) {
        return res.status(400).send({ error: "Phone number required" });
    }
    
    // Clean the number - remove all non-digit characters
    num = num.replace(/[^0-9]/g, '');
    
    if (num.length < 10) {
        return res.status(400).send({ error: "Invalid phone number" });
    }
    
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const sessionsDir = path.join(__dirname, 'sessions');
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }

    async function WASI_MD_PAIR_CODE() {
        const authPath = path.join('./temp/', id);
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        try {
            let Pair_Code_By_Wasi_Tech = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "silent" }).child({ level: "silent" }),
                browser: Browsers.macOS("Desktop"),
            });

            // Set timeout to prevent hanging requests
            const timeout = setTimeout(() => {
                if (!res.headersSent) {
                    res.status(500).send({ error: "Request timeout" });
                }
                removeFile(authPath);
            }, 30000);

            if (!Pair_Code_By_Wasi_Tech.authState.creds.registered) {
                await delay(2000);
                
                try {
                    console.log("Requesting pairing code for:", num);
                    const code = await Pair_Code_By_Wasi_Tech.requestPairingCode(num);
                    console.log("Pairing code received:", code);
                    
                    if (!res.headersSent) {
                        clearTimeout(timeout);
                        res.send({ code });
                    }
                } catch (error) {
                    console.error("Error requesting pairing code:", error);
                    clearTimeout(timeout);
                    if (!res.headersSent) {
                        res.status(500).send({ error: "Failed to request pairing code: " + error.message });
                    }
                    removeFile(authPath);
                    return;
                }
            }

            Pair_Code_By_Wasi_Tech.ev.on('creds.update', saveCreds);
            
            Pair_Code_By_Wasi_Tech.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === "open") {
                    try {
                        console.log("Connection opened successfully");
                        await delay(3000);

                        // Read and process the session data
                        const credsPath = path.join(authPath, 'creds.json');
                        if (fs.existsSync(credsPath)) {
                            const credsData = fs.readFileSync(credsPath);
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

                            await Pair_Code_By_Wasi_Tech.sendMessage(
                                Pair_Code_By_Wasi_Tech.user.id, 
                                { text: successMessage }
                            );
                        }

                        await delay(1000);
                        await Pair_Code_By_Wasi_Tech.ws.close();
                        removeFile(authPath);
                        clearTimeout(timeout);
                        
                    } catch (error) {
                        console.error("Error in connection:", error);
                        removeFile(authPath);
                        clearTimeout(timeout);
                    }
                } else if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log("Connection closed with status:", statusCode);
                    
                    if (statusCode !== 401) {
                        await delay(10000);
                        removeFile(authPath);
                        WASI_MD_PAIR_CODE().catch(console.error);
                    }
                }
            });

        } catch (err) {
            console.error("Error in pairing process:", err);
            removeFile(path.join('./temp/', id));
            if (!res.headersSent) {
                res.status(500).send({ error: "Service Unavailable: " + err.message });
            }
        }
    }
    
    await WASI_MD_PAIR_CODE();
});

module.exports = router;
