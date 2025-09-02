const express = require('express');
const app = express();
const path = require('path'); // Make sure the 'path' module is imported
const bodyParser = require("body-parser");

const __path = process.cwd(); // Defines the base directory

const PORT = process.env.PORT || 8000;
let server = require('./wasiqr.js');
let code = require('./pair.js');

require('events').EventEmitter.defaultMaxListeners = 500;

// --- Static Route to Serve Session Files ---
// This is the crucial line that makes the files in your 'sessions' directory
// available to be fetched by your bot. For example: your-domain.com/sessions/bwmxmd_a1b2c.json
app.use('/sessions', express.static(path.join(__dirname, 'sessions')));

// --- API Routes for QR and Pairing Code ---
app.use('/wasiqr', server);
app.use('/code', code);

// --- HTML Page Routes ---
app.use('/pair', async (req, res, next) => {
    // Use path.join for better compatibility
    res.sendFile(path.join(__path, 'pair.html'));
});

app.use('/', async (req, res, next) => {
    // Use path.join for better compatibility
    res.sendFile(path.join(__path, 'wasipage.html'));
});

// --- Middleware ---
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`
Don't Forget To Give Star ⭐

Server running on http://localhost:${PORT}
`);
});

module.exports = app;
