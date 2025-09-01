const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('LS_Cj1IM_8DPObrYbScXZ1srAu17WCxt');
const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const path = require('path'); // Added missing import
let router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket, // Correct import name
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;
    
    // Validate phone number
    if (!num || !num.match(/[\d\s+\-()]+/)) {
        return res.status(400).send({ error: "Valid phone number required" });
    }
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    async function WASI_MD_PAIR_CODE() {
        const authPath = path.join('./temp/', id);
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        try {
            let Pair_Code_By_Wasi_Tech = makeWASocket({ // Correct function name
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
                    return;
                }
            }

            Pair_Code_By_Wasi_Tech.ev.on('creds.update', saveCreds);
            Pair_Code_By_Wasi_Tech.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                
                if (connection === "open") {
                    try {
                        await delay(5000);
                        let data = fs.readFileSync(path.join(authPath, 'creds.json'));
                        await delay(800);
                        let b64data = Buffer.from(data).toString('base64');
                        
                        // Send session data to user
                        let session = await Pair_Code_By_Wasi_Tech.sendMessage(
                            Pair_Code_By_Wasi_Tech.user.id, 
                            { text: b64data }
                        );

                        let WASI_MD_TEXT = `
*_Pair Code Connected by WASI TECH*
*_Made With 🤍_*
______________________________________
╔════◇
║ *『 WOW YOU'VE CHOSEN WASI MD 』*
║ _You Have Completed the First Step to Deploy a Whatsapp Bot._
╚════════════════════════╝
╔═════◇
║  『••• 𝗩𝗶𝘀𝗶𝘁 𝗙𝗼𝗿 𝗛𝗲𝗹𝗽 •••』
║❒ *Ytube:* _youtube.com/@wasitech1_
║❒ *Owner:* _https://wa.me/923192173398_
║❒ *Repo:* _https://github.com/wasixd/WASI-MD
║❒ *WaGroup:* _https://whatsapp.com/channel/0029VaDK8ZUDjiOhwFS1cP2j
║❒ *WaChannel:* _https://whatsapp.com/channel/0029VaDK8ZUDjiOhwFS1cP2j
║❒ *Plugins:* _https://github.com/wasixd/WASI-MD-PLUGINS_
╚════════════════════════╝
_____________________________________

_Don't Forget To Give Star To My Repo_`;

                        await Pair_Code_By_Wasi_Tech.sendMessage(
                            Pair_Code_By_Wasi_Tech.user.id,
                            { text: WASI_MD_TEXT },
                            { quoted: session }
                        );

                        await delay(100);
                        await Pair_Code_By_Wasi_Tech.ws.close();
                        removeFile(authPath);
                    } catch (error) {
                        console.error("Error in connection:", error);
                        removeFile(authPath);
                    }
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && 
                          lastDisconnect.error.output.statusCode !== 401) {
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
    
    try {
        await WASI_MD_PAIR_CODE();
    } catch (error) {
        console.error("Unexpected error:", error);
        if (!res.headersSent) {
            res.status(500).send({ error: "Internal Server Error" });
        }
    }
});

module.exports = router;
