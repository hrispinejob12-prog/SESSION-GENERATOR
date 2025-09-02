// itxxwasi.js (Modified)

const express = require('express');
const app = express();
const path = require('path'); // <-- IMPORT PATH
__path = process.cwd()
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
let server = require('./wasiqr.js'),
    code = require('./pair');
require('events').EventEmitter.defaultMaxListeners = 500;

// --- ADD THIS STATIC ROUTE ---
// This will make files in the 'sessions' folder available under the '/sessions' URL path
// e.g., http://localhost:8000/sessions/name_abc12.json
app.use('/sessions', express.static(path.join(__dirname, 'sessions')));
// -----------------------------

app.use('/wasiqr', server);
app.use('/code', code);
app.use('/pair',async (req, res, next) => {
    res.sendFile(__path + '/pair.html')
})
app.use('/',async (req, res, next) => {
    res.sendFile(__path + '/wasipage.html')
})
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.listen(PORT, () => {
    console.log(`
Don't Forget To Give Star

 Server running on http://localhost:` + PORT)
})

module.exports = app
