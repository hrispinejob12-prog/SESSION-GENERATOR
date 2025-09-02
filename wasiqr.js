// at the top of wasiqr.js
const { encryptSession } = require('./session-encrypt'); // Assuming you created this file
const fs = require('fs');
//... other requires

// Inside the router.get function, modify the "connection.update" event
// ...
if (connection == "open") {
    await delay(5000);
    // OLD WAY:
    // let data = fs.readFileSync(__dirname + `/temp/${id}/creds.json`);
    // let b64data = Buffer.from(data).toString('base64');
    // let session = await Qr_Code_By_Wasi_Tech.sendMessage(Qr_Code_By_Wasi_Tech.user.id, { text: '' + b64data });

    // NEW, ENCRYPTED WAY:
    // Step 1: Read the session file content as a string
    const sessionFileContent = fs.readFileSync(__dirname + `/temp/${id}/creds.json`, 'utf8');
    
    // Encrypt it using your new function
    const encryptedSessionId = encryptSession(sessionFileContent);

    // Send the encrypted session ID to the user
    let session = await Qr_Code_By_Wasi_Tech.sendMessage(Qr_Code_By_Wasi_Tech.user.id, { text: encryptedSessionId });

    let WASI_MD_TEXT = `
*_Session Connected By Wasi Tech_*
*_Encrypted Session ID Generated Successfully!_*
______________________________________
╔════◇
║ *『 COPY YOUR SESSION ID BELOW 』*
╚════════════════════════╝
`
    await Qr_Code_By_Wasi_Tech.sendMessage(Qr_Code_By_Wasi_Tech.user.id, { text: WASI_MD_TEXT }, { quoted: session })

    await delay(100);
    await Qr_Code_By_Wasi_Tech.ws.close();
    return await removeFile("temp/" + id);
} 
//... rest of the file
