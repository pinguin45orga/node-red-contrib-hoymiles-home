const MIN_INTERVAL_MS    = 1000;
const DEFAULT_DELAY_MS   = 5000;
const URI_RETRY_DELAY_MS = 3000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = function (RED) {
    function HoymilesWatchNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const configNode = RED.nodes.getNode(config.server);
        if (!configNode) {
            node.error('No Hoymiles credentials configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no credentials' });
            return;
        }

        const sid = parseInt(config.sid, 10);
        const intervalOverride = config.interval ? parseInt(config.interval, 10) * 1000 : null;

        if (!sid) {
            node.error('Station ID (sid) is required');
            node.status({ fill: 'red', shape: 'ring', text: 'no station ID' });
            return;
        }

        let running = false;
        let stopResolve = null;
        let currentTimer = null;

        async function getLiveUri(client) {
            const data = await client.post('/pvmc/api/0/station/get_sd_uri_c', { sid });
            const uri = data?.uri;
            if (!uri) throw new Error('No live URI returned from get_sd_uri_c');
            return uri;
        }

        async function fetchLive(client, uri) {
            return client.postUrl(uri, { sid, m: 0 });
        }

        async function interruptibleSleep(ms) {
            await new Promise(resolve => {
                stopResolve = resolve;
                currentTimer = setTimeout(resolve, ms);
            });
            stopResolve = null;
            currentTimer = null;
        }

        // Re-authenticates via the config node and returns the fresh client.
        async function reauth() {
            node.status({ fill: 'yellow', shape: 'ring', text: 're-authenticating…' });
            await configNode.relogin();
            return configNode.client;
        }

        async function watchLoop() {
            // client is mutable so re-auth can swap it in during the loop
            let client = configNode.client;

            node.status({ fill: 'yellow', shape: 'ring', text: 'connecting…' });

            let uri, data;
            try {
                uri  = await getLiveUri(client);
                data = await fetchLive(client, uri);
            } catch (err) {
                node.error(`Initial connect failed: ${err.message}`);
                node.status({ fill: 'red', shape: 'dot', text: 'connect error' });
                return;
            }

            node.status({ fill: 'green', shape: 'dot', text: `watching sid=${sid}` });

            while (running) {
                node.send({ payload: data?.power ?? {}, topic: `hoymiles/watch/${sid}`, sid });

                const dly = intervalOverride ?? Math.max(MIN_INTERVAL_MS, data?.dly ?? DEFAULT_DELAY_MS);
                await interruptibleSleep(dly);

                if (!running) break;

                try {
                    data = await fetchLive(client, uri);

                    // No "flow" field → URI expired, get a fresh one
                    if (!data || !('flow' in data)) {
                        try {
                            uri  = await getLiveUri(client);
                            data = await fetchLive(client, uri);
                        } catch (uriErr) {
                            // URI fetch failed → token likely expired, re-authenticate
                            node.warn(`URI refresh failed (${uriErr.message}) — re-authenticating`);
                            const fresh = await reauth();
                            if (fresh) {
                                client = fresh;
                                uri    = await getLiveUri(client);
                                data   = await fetchLive(client, uri);
                            }
                        }
                    }
                } catch (err) {
                    node.warn(`Poll error: ${err.message} — re-authenticating`);
                    node.status({ fill: 'yellow', shape: 'ring', text: 're-authenticating…' });
                    try {
                        const fresh = await reauth();
                        if (fresh) {
                            client = fresh;
                            uri    = await getLiveUri(client);
                        }
                    } catch (_) { /* will retry next iteration */ }
                    await sleep(URI_RETRY_DELAY_MS);
                    node.status({ fill: 'green', shape: 'dot', text: `watching sid=${sid}` });
                }
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
            await watchLoop();
        }

        node.on('close', (done) => { stop(); done(); });

        start().catch(err => {
            node.error(`Startup failed: ${err.message}`);
            node.status({ fill: 'red', shape: 'dot', text: 'crashed' });
        });
    }

    RED.nodes.registerType('hoymiles-watch', HoymilesWatchNode);
};
