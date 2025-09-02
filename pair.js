const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('LS_Cj1IM_8DPObrYbScXZ1srAu17WCxt');
const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
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
    
    if (!num || !num.match(/[\d\s+\-()]+/)) {
        return res.status(400).send({ error: "Valid phone number required" });
    }
    
    const tempDir = path.join(__dirname, 'temp');
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    } catch (dirError) {
        console.error("Error creating temp directory:", dirError);
        return res.status(500).send({ error: "Server configuration error" });
    }

    const sessionsDir = path.join(__dirname, 'sessions');
    try {
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }
    } catch (dirError) {
        console.error("Error creating sessions directory:", dirError);
        return res.status(500).send({ error: "Server configuration error" });
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

            // Store whether we've sent a response to avoid headers sent errors
            let responseSent = false;

            if (!Pair_Code_By_Wasi_Tech.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                
                try {
                    const code = await Pair_Code_By_Wasi_Tech.requestPairingCode(num);
                    if (!responseSent) {
                        responseSent = true;
                        res.send({ code });
                    }
                } catch (error) {
                    console.error("Error requesting pairing code:", error);
                    if (!responseSent) {
                        responseSent = true;
                        res.status(500).send({ error: "Failed to request pairing code" });
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
                        await delay(3000); // Give time for connection to stabilize

                        try {
                            // Read and verify creds file exists
                            const credsPath = path.join(authPath, 'creds.json');
                            if (!fs.existsSync(credsPath)) {
                                throw new Error("Credentials file not found");
                            }
                            
                            const credsData = fs.readFileSync(credsPath);
                            
                            // Compress the data
                            const compressedData = zlib.gzipSync(credsData);
                            
                            // Add checksum for verification
                            const checksum = crypto.createHash('md5').update(credsData).digest('hex');
                            
                            // Encode to Base64 and format it
                            const base64CompressedData = compressedData.toString('base64');
                            const finalSessionString = `BWM-XMD;;;${base64CompressedData};;;${checksum}`;

                            // Generate unique name and file path
                            const uniqueName = generateUniqueName();
                            const sessionFilePath = path.join(sessionsDir, `${uniqueName}.json`);

                            // Save the formatted string to the file
                            fs.writeFileSync(sessionFilePath, finalSessionString);
                            
                            // Verify file was created
                            if (!fs.existsSync(sessionFilePath)) {
                                throw new Error("Failed to create session file");
                            }
                            
                            // Send success message
                            const successMessage = `✅ *Your Session ID Has Been Generated!*

Your unique session name is:
📋 \`${uniqueName}\`

Copy this name and paste it into the \`SESSION_ID\` or \`conf.session\` variable in your bot's configuration.

_This session name will be used to fetch your credentials automatically._`;

                            await Pair_Code_By_Wasi_Tech.sendMessage(
                                Pair_Code_By_Wasi_Tech.user.id, 
                                { text: successMessage }
                            );

                        } catch (processingError) {
                            console.error("Error processing session:", processingError);
                            try {
                                await Pair_Code_By_Wasi_Tech.sendMessage(
                                    Pair_Code_By_Wasi_Tech.user.id, 
                                    { text: "❌ Error creating your session. Please try again." }
                                );
                            } catch (msgError) {
                                console.error("Failed to send error message:", msgError);
                            }
                        }

                        await delay(100);
                        // Don't close the connection immediately - let the user complete pairing
                        setTimeout(async () => {
                            try {
                                await Pair_Code_By_Wasi_Tech.ws.close();
                            } catch (closeError) {
                                console.error("Error closing connection:", closeError);
                            }
                            removeFile(authPath);
                        }, 10000); // Give 10 seconds for the message to be delivered
                        
                    } catch (error) {
                        console.error("Error in connection:", error);
                        removeFile(authPath);
                    }
                } else if (connection === "close") {
                    const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                    console.log("Connection closed with reason:", DisconnectReason[reason] || reason);
                    
                    // Only restart if it's not a normal closure
                    if (reason !== DisconnectReason.connectionClosed && reason !== 401) {
                        await delay(5000);
                        WASI_MD_PAIR_CODE().catch(console.error);
                    } else {
                        removeFile(authPath);
                    }
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
