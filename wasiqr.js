const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL');
const { makeid } = require('./id');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib'); // Added for compression
let router = express.Router();
const pino = require("pino");
const {
	default: Wasi_Tech,
	useMultiFileAuthState,
	jidNormalizedUser,
	Browsers,
	delay,
	makeInMemoryStore,
} = require("@whiskeysockets/baileys");

/**
 * Compresses and encodes a session file content into the BWM-XMD format.
 * @param {string} sessionData The raw string content of creds.json.
 * @returns {string} The encrypted session string.
 */
function encryptSession(sessionData) {
	const compressedData = zlib.gzipSync(sessionData);
	const base64Data = compressedData.toString('base64');
	return `BWM-XMD;;;${base64Data}`;
}

function removeFile(FilePath) {
	if (!fs.existsSync(FilePath)) return false;
	fs.rmSync(FilePath, {
		recursive: true,
		force: true
	});
};

router.get('/', async (req, res) => {
	const id = makeid();
	async function WASI_MD_QR_CODE() {
		const {
			state,
			saveCreds
		} = await useMultiFileAuthState('./temp/' + id);
		try {
			let Qr_Code_By_Wasi_Tech = Wasi_Tech({
				auth: state,
				printQRInTerminal: false,
				logger: pino({
					level: "silent"
				}),
				browser: Browsers.macOS("Desktop"),
			});

			Qr_Code_By_Wasi_Tech.ev.on('creds.update', saveCreds);
			Qr_Code_By_Wasi_Tech.ev.on("connection.update", async (s) => {
				const {
					connection,
					lastDisconnect,
					qr
				} = s;
				if (qr) await res.end(await QRCode.toBuffer(qr));
				if (connection == "open") {
					await delay(5000);

					// --- MODIFIED SECTION START ---
					// Read the session file as a string
					const sessionFileContent = fs.readFileSync(__dirname + `/temp/${id}/creds.json`, 'utf8');

					// Encrypt the session content
					const encryptedSessionId = encryptSession(sessionFileContent);

					// Send the encrypted session ID
					let session = await Qr_Code_By_Wasi_Tech.sendMessage(Qr_Code_By_Wasi_Tech.user.id, { text: encryptedSessionId });
					// --- MODIFIED SECTION END ---

					let WASI_MD_TEXT = `
*_Session Connected By Wasi Tech_*
*_Made With 🤍_*
______________________________________
╔════◇
║ *『AMAZING YOU'VE CHOSEN WASI MD』*
║ _You Have Completed the First Step to Deploy a Whatsapp Bot._
║
║ *Your encrypted session ID has been sent.*
╚════════════════════════╝
╔═════◇
║  『••• 𝗩𝗶𝘀𝗶𝘁 𝗙𝗼𝗿 𝗛𝗲𝗹𝗽 •••』
║❒ *Ytube:* _youtube.com/@wasitech1
║❒ *Owner:* _https://wa.me/message/THZ3I25BYZM2E1_
║❒ *Repo:* _https://github.com/wasixd/WASI-MD_
║❒ *WaGroup:* _https://chat.whatsapp.com/FF6YuOZTAVB6Lu65cnY5BN_
║❒ *WaChannel:* _https://whatsapp.com/channel/0029VaDK8ZUDjiOhwFS1cP2j_
║❒ *Plugins:* _https://github.com/Itxxwasi 
╚════════════════════════╝
_____________________________________
	
_Don't Forget To Give Star To My Repo_`;
					await Qr_Code_By_Wasi_Tech.sendMessage(Qr_Code_By_Wasi_Tech.user.id, { text: WASI_MD_TEXT }, { quoted: session });

					await delay(100);
					await Qr_Code_By_Wasi_Tech.ws.close();
					return await removeFile("temp/" + id);
				} else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
					await delay(10000);
					WASI_MD_QR_CODE();
				}
			});
		} catch (err) {
			if (!res.headersSent) {
				await res.json({
					code: "Service is Currently Unavailable"
				});
			}
			console.log(err);
			await removeFile("temp/" + id);
		}
	}
	return await WASI_MD_QR_CODE();
});
module.exports = router;
