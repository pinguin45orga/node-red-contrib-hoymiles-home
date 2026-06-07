const axios = require('axios');
const crypto = require('crypto');

const DOMAINS = {
    eu:      'https://euapi.hoymiles.com',
    'eu-rt': 'https://eud0.hoymiles.com',
    global:  'https://neapi.hoymiles.com',
    in:      'https://indapi.hoymiles.com',
};

const EU_PREFIXES = ['/iam/', '/dict/', '/hlm/', '/csc/', '/tpa/', '/pvm-ext/', '/iuc/'];
const EU_RT_PATHS = new Set([
    '/pvmc/api/0/station_data/real_g_c',
    '/pvmc/api/0/station_data/eq_day_month_s_c',
    '/pvmc/api/0/station_data/eq_month_year_s_c',
    '/pvmc/api/0/station_data/eq_total_year_s_c',
    '/pvmc/api/0/station_data/p_day_s_c',
]);

function resolveDomain(path) {
    if (EU_RT_PATHS.has(path)) return 'eu-rt';
    if (EU_PREFIXES.some(p => path.startsWith(p))) return 'eu';
    return 'global';
}

class APIError extends Error {
    constructor(message, status, raw) {
        super(message);
        this.status = status;
        this.raw = raw; // full API response body
    }
}

class HoymilesClient {
    constructor(token, language = 'en_us') {
        this.token = token;
        this.language = language;
    }

    _headers() {
        const h = {
            'Content-Type': 'application/json',
            'Charset': 'UTF-8',
            'language': this.language,
            'User-Agent': 'sma/ad/2.9.0/159/0',
        };
        if (this.token) h['Authorization'] = this.token;
        return h;
    }

    async post(path, data = {}, domain = null) {
        const base = DOMAINS[domain || resolveDomain(path)];
        return this._doPost(`${base}${path}`, data);
    }

    async postUrl(url, data = {}) {
        return this._doPost(url, data);
    }

    async _doPost(url, data) {
        const resp = await axios.post(url, data, {
            headers: this._headers(),
            timeout: 30000,
            maxRedirects: 5,
        });
        const result = resp.data;
        if (!['0', '100'].includes(String(result.status))) {
            throw new APIError(result.message || 'Unknown error', String(result.status ?? '???'), result);
        }
        return result.data;
    }
}

// ── Password encoding (mirrors the CLI exactly) ────────────────────────────

function encodePasswordFallback(password) {
    const md5 = crypto.createHash('md5').update(password, 'utf8').digest('hex');
    const sha256 = crypto.createHash('sha256').update(password, 'utf8').digest();
    return `${md5}.${sha256.toString('base64')}`;
}

async function encodePasswordArgon2(password, saltHex) {
    // Lazy-load hash-wasm so the module doesn't fail if the package isn't installed yet
    const { argon2id } = require('hash-wasm');
    return argon2id({
        password,
        salt: Buffer.from(saltHex, 'hex'),
        parallelism: 1,
        iterations: 3,
        memorySize: 32768,
        hashLength: 32,
        outputType: 'hex',
    });
}

async function loginWithCredentials(email, password) {
    const client = new HoymilesClient(); // no token needed for auth endpoints

    // Step 1: pre-inspection — determine password encoding scheme
    const preinsp = await client.post('/iam/pub/3/auth/pre-insp', { u: email });
    const { v, a, n } = preinsp || {};

    // Step 2: encode password (Argon2ID when v=3, MD5.Base64(SHA256) otherwise)
    const ch = (v === 3 && a)
        ? await encodePasswordArgon2(password, a)
        : encodePasswordFallback(password);

    // Step 3: login
    const data = await client.post('/iam/pub/3/auth/login', { u: email, ch, n });
    const token = data?.token;
    if (!token) throw new Error('Login succeeded but no token in response');
    return token;
}

// ── Error formatting ──────────────────────────────────────────────────────

function formatError(err) {
    if (err instanceof APIError) {
        const raw = err.raw ? ` | raw: ${JSON.stringify(err.raw)}` : '';
        return `[API status=${err.status}] ${err.message}${raw}`;
    }
    if (err.response) {
        // Axios HTTP error (4xx / 5xx)
        return `[HTTP ${err.response.status}] ${JSON.stringify(err.response.data)}`;
    }
    return err.message;
}

// ── Retry helpers ─────────────────────────────────────────────────────────

const DAILY_LIMIT_MSG  = 'The number of logins exceeds the daily maximum limit.';
const CREDENTIAL_MSG   = 'Login failed. Please check your account and password.';
const RETRY_MS = 30_000;

function isCredentialError(err) {
    return err instanceof APIError && err.message === CREDENTIAL_MSG;
}

function isDailyLimitError(err) {
    return err instanceof APIError && err.message === DAILY_LIMIT_MSG;
}

function msUntilMidnight() {
    const midnight = new Date();
    midnight.setHours(24, 5, 0, 0); // next midnight + 5 min buffer
    return midnight.getTime() - Date.now();
}

// ── Node-RED registration ──────────────────────────────────────────────────

module.exports = function (RED) {
    function HoymilesConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const email    = node.credentials?.email    || '';
        const password = node.credentials?.password || '';

        node.client = null;

        if (!email || !password) {
            node.error('Hoymiles config: email and password are required');
            node._loginReady = Promise.resolve();
            return;
        }

        let cancelled  = false;
        let wakeUp     = null; // resolves the current sleep early on close

        function interruptibleSleep(ms) {
            return new Promise(resolve => {
                const t = setTimeout(resolve, ms);
                wakeUp = () => { clearTimeout(t); resolve(); };
            }).then(() => { wakeUp = null; });
        }

        node.on('close', () => {
            cancelled = true;
            if (wakeUp) wakeUp();
        });

        // Persistent login loop: retries on technical errors, waits until
        // midnight on daily-limit errors, stops on credential errors.
        async function loginLoop(label) {
            while (!cancelled) {
                try {
                    const token = await loginWithCredentials(email, password);
                    node.client = new HoymilesClient(token);
                    node.log(`${label} successful for ${email}`);
                    return;
                } catch (err) {
                    if (isCredentialError(err)) {
                        node.error(`${label} failed (check credentials): ${formatError(err)}`);
                        return; // wrong password / unknown account — no retry
                    }

                    if (isDailyLimitError(err)) {
                        const ms = msUntilMidnight();
                        const h  = (ms / 3_600_000).toFixed(1);
                        node.warn(`Daily login limit reached — retrying in ${h} h`);
                        await interruptibleSleep(ms);
                        continue;
                    }

                    // Technical error (network, timeout, HTTP 5xx, …)
                    node.warn(`${label} failed — retrying in ${RETRY_MS / 1000}s: ${formatError(err)}`);
                    await interruptibleSleep(RETRY_MS);
                }
            }
        }

        // doLogin wraps loginLoop so dependents can await _loginReady.
        // It resolves once login succeeds or gives up (credential error / cancelled).
        function doLogin(label = 'Login') {
            const p = loginLoop(label);
            node._loginReady = p;
            return p;
        }

        node.relogin = () => doLogin('Re-login');

        doLogin();
    }

    RED.nodes.registerType('hoymiles-config', HoymilesConfigNode, {
        credentials: {
            email:    { type: 'text' },
            password: { type: 'password' },
        },
    });
};

module.exports.APIError = APIError;
module.exports.HoymilesClient = HoymilesClient;
module.exports.formatError = formatError;
