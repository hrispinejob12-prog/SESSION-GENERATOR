// session-encrypt.js
const zlib = require('zlib');
const fs = require('fs');

/**
 * Compresses and encodes a session file content into the BWM-XMD format.
 * @param {string} sessionData The raw string content of creds.json.
 * @returns {string} The encrypted session string.
 */
function encryptSession(sessionData) {
  // Step 2: Compress the session data
  const compressedData = zlib.gzipSync(sessionData);
  
  // Step 3: Encode the compressed data to Base64
  const base64Data = compressedData.toString('base64');
  
  // Step 4: Prepend the header and return
  return `BWM-XMD;;;${base64Data}`;
}

module.exports = { encryptSession };
