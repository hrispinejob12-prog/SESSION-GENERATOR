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

// Function to validate and format phone number for WhatsApp
function formatPhoneNumber(number) {
    // Remove all non-digit characters
    let cleanNumber = number.replace(/\D/g, '');
    
    // Remove leading zeros if present
    if (cleanNumber.startsWith('0')) {
        cleanNumber = cleanNumber.substring(1);
    }
    
    // If number starts with Kenyan country code, ensure it's properly formatted
    if (cleanNumber.startsWith('254')) {
        return cleanNumber;
    } else if (cleanNumber.length === 9) {
        // Kenyan number without country code (e.g., 7xxxxxxxx)
        return '254' + cleanNumber;
    }
    
    // For other formats, return as is (let WhatsApp validate)
    return cleanNumber;
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;
    
    if (!num || !num.match(/[\d\s+\-()]+/)) {
        return res.status(400).send({ error: "Valid phone number required" });
    }
    
    // Format the phone number
    num = formatPhoneNumber(num);
    if (num.length < 10) {
        return res.status(400).send({ error: "Invalid phone number format" });
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

    let responseSent = false;
    let pairingCode = null;
    let socket = null;
    let connectionTimeout = null;
    
    async function WASI_MD_PAIR_CODE() {
        const authPath = path.join('./temp/', id);
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        try {
            socket = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Desktop"),
                // Add these connection options for better stability
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
                defaultQueryTimeoutMs: 60000,
            });

            // Handle credentials updates
            socket.ev.on('creds.update', saveCreds);
            
            // Set a timeout for the connection process
            connectionTimeout = setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(500).send({ error: "Connection timeout. Please try again." });
                    removeFile(authPath);
                    if (socket) {
                        socket.end(undefined);
                    }
                }
            }, 60000); // 60 second timeout

            // Handle connection updates
            socket.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                console.log("Connection update:", connection, "QR:", qr ? "present" : "absent");
                
                if (connection === "connecting") {
                    console.log("Connecting to WhatsApp...");
                }
                else if (connection === "open") {
                    console.log("Connection opened successfully - pairing complete");
                    clearTimeout(connectionTimeout);
                    
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
                            
                            console.log("Session saved successfully:", uniqueName);
                            
                            // Send success message
                            const successMessage = `✅ *Your Session ID Has Been Generated!*

Your unique session name is:
📋 \`${uniqueName}\`

Copy this name and paste it into the \`SESSION_ID\` or \`conf.session\` variable in your bot's configuration.

_This session name will be used to fetch your credentials automatically._`;

                            await socket.sendMessage(
                                socket.user.id, 
                                { text: successMessage }
                            );

                        } catch (processingError) {
                            console.error("Error processing session:", processingError);
                            try {
                                await socket.sendMessage(
                                    socket.user.id, 
                                    { text: "❌ Error creating your session. Please try again." }
                                );
                            } catch (msgError) {
                                console.error("Failed to send error message:", msgError);
                            }
                        }

                        await delay(1000);
                        // Close connection after successful pairing
                        try {
                            await socket.ws.close();
                            console.log("Connection closed successfully");
                        } catch (closeError) {
                            console.error("Error closing connection:", closeError);
                        }
                        removeFile(authPath);
                        
                    } catch (error) {
                        console.error("Error in connection:", error);
                        removeFile(authPath);
                    }
                } else if (connection === "close") {
                    console.log("Connection closed");
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log("Disconnect status code:", statusCode);
                    
                    if (statusCode === DisconnectReason.connectionClosed) {
                        console.log("Connection closed normally");
                    } else if (statusCode === DisconnectReason.connectionLost) {
                        console.log("Connection lost, attempting to reconnect...");
                        await delay(5000);
                        WASI_MD_PAIR_CODE().catch(console.error);
                    } else {
                        console.log("Authentication error or connection failure");
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({ error: "Connection failed. Please try again." });
                        }
                        removeFile(authPath);
                    }
                }
                
                // Request pairing code only when the connection is ready
                if (connection === "open" || connection === "connecting") {
                    // Wait a bit more to ensure the connection is stable
                    setTimeout(async () => {
                        if (!socket.authState.creds.registered && !pairingCode && !responseSent) {
                            console.log("Requesting pairing code from WhatsApp for:", num);
                            
                            try {
                                // Request pairing code
                                pairingCode = await socket.requestPairingCode(num);
                                console.log("Pairing code received from WhatsApp:", pairingCode);
                                
                                if (!responseSent) {
                                    responseSent = true;
                                    res.send({ code: pairingCode });
                                }
                            } catch (error) {
                                console.error("Error requesting pairing code from WhatsApp:", error);
                                if (!responseSent) {
                                    responseSent = true;
                                    res.status(500).send({ 
                                        error: "Failed to request pairing code from WhatsApp. Make sure the number is correct and try again." 
                                    });
                                }
                                removeFile(authPath);
                            }
                        }
                    }, 5000); // Wait 5 seconds after connection starts
                }
            });

        } catch (err) {
            console.error("Error in pairing process:", err);
            clearTimeout(connectionTimeout);
            removeFile(path.join('./temp/', id));
            if (!responseSent) {
                responseSent = true;
                res.status(500).send({ error: "Service Unavailable: " + err.message });
            }
        }
    }
    
    await WASI_MD_PAIR_CODE();
});

module.exports = router;
