'use strict';

// Randomly generated per server process — used to allow internal scheduler
// HTTP calls (scheduler → localhost API) to bypass session-based auth.
const crypto = require('crypto');

const TOKEN  = crypto.randomBytes(32).toString('hex');
const HEADER = 'x-internal-service-token';

module.exports = { TOKEN, HEADER };
