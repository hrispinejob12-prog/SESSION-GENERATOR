// pair.js (Modified)

const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('LS_Cj1IM_8DPObrYbScXZ1srAu17WCxt');
const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib'); // <-- 1. IMPORT ZLIB FOR COMPRESSION
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

// <-- 2. FUNCTION TO GENERATE YOUR UNIQUE SESSION NAME
function generateUniqueName() {
  const randomPart = makeid(5).toLowerCase(); // Using your makeid function
  return `bwmxmd_${randomPart}`;
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;
    
    if (!num || !num.match(/[\d\s+\-()]+/)) {
        return res.status(400).send({ error: "Valid phone number required" });
    }
    
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // <-- 3. ENSURE THE FINAL SESSIONS DIRECTORY EXISTS
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
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Desktop"),
            });

            if (!Pair_Code_By_Wasi_Tech.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                
                try {
                    const code = await Pair_Code_By_Wasi_Tech.requestPairingCode(num);
                    if (!res.headersSent) {
                        res.send({ code });
                    }
                } catch (error) {
                    console.error("Error requesting pairing code:", error);
                    if (!res.headersSent) {
                        res.status(500).send({ error: "Failed to request pairing code" });
                    }
                    removeFile(authPath);
                }
            }

            Pair_Code_By_Wasi_Tech.ev.on('creds.update', saveCreds);
            Pair_Code_By_Wasi_Tech.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                
                if (connection === "open") {
                    try {
                        await delay(5000);

                        // --- START OF NEW LOGIC ---
                        
                        // 4. READ THE CREDS.JSON FILE
                        const credsData = fs.readFileSync(path.join(authPath, 'creds.json'));
                        
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
                        
                        // 9. SEND THE UNIQUE NAME TO THE USER, NOT THE RAW SESSION
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

                        // --- END OF NEW LOGIC ---

                        await delay(100);
                        await Pair_Code_By_Wasi_Tech.ws.close();
                        removeFile(authPath); // Clean up the temp auth folder
                    } catch (error) {
                        console.error("Error in connection:", error);
                        removeFile(authPath);
                    }
                } else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(10000);
                    WASI_MD_PAIR_CODE().catch(console.error);
                }
            });
        } catch (err) {
            console.error("Error in pairing process:", err);
            removeFile(path.join('./temp/', id));
            if (!res.headersSent) {
                res.status(500).send({ error: "Service Unavailable" });
            }
        }
    }
    
    await WASI_MD_PAIR_CODE();
});

module.exports = router;
