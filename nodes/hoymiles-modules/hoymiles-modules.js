const { formatError, APIError } = require('../hoymiles-config/hoymiles-config');
const { decodeModuleData } = require('./module-data');

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const MIN_INTERVAL_MS     = 60_000;

function round(v, digits) {
    if (v === undefined || v === null || Number.isNaN(v)) return null;
    const f = 10 ** digits;
    return Math.round(v * f) / f;
}

function localDate(d = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Flattens the nested device tree from select_device_c into id → device
function indexDevices(list, out = {}) {
    for (const dev of list || []) {
        out[dev.id] = dev;
        indexDevices(dev.devices, out);
    }
    return out;
}

// Builds the output payload from the newest data point of the day
function latestSnapshot(data, devices) {
    const inverters = [];
    let time = null;
    let power = 0;

    for (const [id, micro] of Object.entries(data.micros)) {
        const i = micro.time.length - 1;
        if (i < 0) continue;
        if (!time || micro.time[i] > time) time = micro.time[i];

        const panels = Object.entries(micro.ports).map(([port, values]) => {
            // proto3 omits zero values, so missing fields mean 0
            const v = { pv_u: 0, pv_i: 0, bn_p: 0, total_eq: 0, fault_code: 0, ...values[i] };
            power += v.bn_p || 0;
            return {
                port:        Number(port),
                voltage:     round(v.pv_u, 1),
                current:     round(v.pv_i, 2),
                power:       round(v.bn_p, 1),
                energyToday: round(v.total_eq, 0),
                faultCode:   v.fault_code,
            };
        });

        const inverter = {
            id:          Number(id),
            sn:          devices[id]?.sn ?? null,
            name:        devices[id]?.alias_name ?? null,
            time:        micro.time[i],
            temperature: round(micro.pn_temp[i], 1),
            frequency:   round(micro.pn_hz[i], 2),
            gridVoltage: round(micro.pn_u_a[i], 1),
            panels,
        };
        // Phases B/C are only reported (non-zero) by three-phase inverters
        if (micro.pn_u_b.some(Boolean)) inverter.gridVoltageB = round(micro.pn_u_b[i], 1);
        if (micro.pn_u_c.some(Boolean)) inverter.gridVoltageC = round(micro.pn_u_c[i], 1);
        inverters.push(inverter);
    }

    if (!time) return null;
    return {
        date:      data.date,
        time,
        timestamp: new Date(`${data.date}T${time}:00`).toISOString(),
        power:     round(power, 1),
        inverters,
    };
}

function isAuthError(err) {
    return err.response?.status === 401
        // e.g. "token verify error." or "token error,please Re-login."
        || (err instanceof APIError && /token/i.test(err.message));
}

module.exports = function (RED) {
    function HoymilesModulesNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const configNode = RED.nodes.getNode(config.server);
        if (!configNode) {
            node.error('No Hoymiles credentials configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no credentials' });
            return;
        }

        const sid = parseInt(config.sid, 10);
        const intervalMs = config.interval
            ? Math.max(MIN_INTERVAL_MS, parseFloat(config.interval) * 60_000)
            : DEFAULT_INTERVAL_MS;

        if (!sid) {
            node.error('Station ID (sid) is required');
            node.status({ fill: 'red', shape: 'ring', text: 'no station ID' });
            return;
        }

        let running = false;
        let stopResolve = null;
        let currentTimer = null;
        let devices = {};
        let lastKey = null;

        async function interruptibleSleep(ms) {
            await new Promise(resolve => {
                stopResolve = resolve;
                currentTimer = setTimeout(resolve, ms);
            });
            stopResolve = null;
            currentTimer = null;
        }

        // Runs fn with the current client; re-authenticates once on token errors
        async function withClient(fn) {
            try {
                return await fn(configNode.client);
            } catch (err) {
                if (!isAuthError(err)) throw err;
                node.status({ fill: 'yellow', shape: 'ring', text: 're-authenticating…' });
                await configNode.relogin();
                if (!configNode.client) throw err;
                return fn(configNode.client);
            }
        }

        async function refreshDevices() {
            const list = await withClient(c => c.post('/pvmc/api/0/station/select_device_c', { sid }));
            devices = indexDevices(list);
        }

        async function poll() {
            const date = localDate();
            const raw  = await withClient(c => c.postBinary('/pvmc/api/0/module_data/dmdd_c', { sid, date }));
            const data = decodeModuleData(raw);

            if (Object.keys(data.micros).some(id => !devices[id])) {
                try { await refreshDevices(); } catch (err) {
                    node.warn(`Device list refresh failed: ${formatError(err)}`);
                }
            }

            const snapshot = latestSnapshot(data, devices);
            if (!snapshot) {
                node.status({ fill: 'grey', shape: 'dot', text: `no data yet for ${date}` });
                return;
            }

            const key = `${snapshot.date} ${snapshot.time}`;
            if (key === lastKey) return;
            lastKey = key;

            node.send({ payload: snapshot, topic: `hoymiles/modules/${sid}`, sid });
            node.status({ fill: 'green', shape: 'dot', text: `${snapshot.time} · ${snapshot.power} W` });
        }

        async function pollLoop() {
            node.status({ fill: 'yellow', shape: 'ring', text: 'connecting…' });
            try {
                await refreshDevices();
            } catch (err) {
                node.warn(`Device list fetch failed: ${formatError(err)}`);
            }

            while (running) {
                try {
                    await poll();
                } catch (err) {
                    node.warn(`Poll error: ${formatError(err)}`);
                    node.status({ fill: 'red', shape: 'ring', text: 'poll error' });
                }
                if (!running) break;
                await interruptibleSleep(intervalMs);
            }

            node.status({ fill: 'grey', shape: 'ring', text: 'stopped' });
        }

        function stop() {
            running = false;
            if (currentTimer) { clearTimeout(currentTimer); currentTimer = null; }
            if (stopResolve)  { stopResolve(); stopResolve = null; }
        }

        async function start() {
            if (configNode._loginReady) {
                node.status({ fill: 'yellow', shape: 'ring', text: 'authenticating…' });
                await configNode._loginReady;
            }

            if (!configNode.client) {
                node.status({ fill: 'red', shape: 'ring', text: 'auth failed' });
                return;
            }

            running = true;
            await pollLoop();
        }

        node.on('close', (done) => { stop(); done(); });

        start().catch(err => {
            node.error(`Startup failed: ${err.message}`);
            node.status({ fill: 'red', shape: 'dot', text: 'crashed' });
        });
    }

    RED.nodes.registerType('hoymiles-modules', HoymilesModulesNode);
};

module.exports.latestSnapshot = latestSnapshot;
module.exports.indexDevices = indexDevices;
