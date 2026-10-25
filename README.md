# node-red-contrib-hoymiles-home

Node-RED nodes for the **Hoymiles S-Miles Home API** — continuously polls live power data and emits a message for every new reading.

## Nodes

### `hoymiles-config` (config node)

Manages authentication against the Hoymiles cloud. Enter your S-Miles Home **e-mail** and **password** — the node performs the same two-step login as the S-Miles Home app (pre-inspection → Argon2ID or MD5·SHA256 password encoding → token) and shares the session with all connected watch nodes.

### `hoymiles-watch` (input node)

Continuously polls live power data for a station and emits one message per reading.

**Configuration:**

| Field | Description |
|---|---|
| Credentials | Select a `hoymiles-config` node |
| Station ID | Numeric station ID (`sid`) — find it in the S-Miles Home app or via the Hoymiles API |
| Interval (s) | Poll interval in seconds. Leave empty to use the `dly` value from each server response (recommended — mirrors the S-Miles Home app) |

**Output `msg.payload`:**

```json
{
  "pv":   210,
  "load": 340,
  "grid": 130,
  "bat":  0
}
```

| Field | Description |
|---|---|
| `pv` | Solar generation (W) |
| `load` | Consumption (W) |
| `grid` | Grid exchange (W) — negative = feed-in |
| `bat` | Battery power (W) — negative = charging |

**Additional message properties:**

| Property | Value |
|---|---|
| `msg.topic` | `hoymiles/watch/{sid}` |
| `msg.sid` | Station ID |

**Status indicators:**

| Colour | Text | Meaning |
|---|---|---|
| Yellow | authenticating… | Login in progress |
| Yellow | connecting… | Fetching live URI |
| Green | watching sid=… | Polling normally |
| Yellow | reconnecting… | Refreshing expired URI |
| Red | auth failed | Login failed — check credentials |
| Red | connect error | Initial connection failed |
| Grey | stopped | Node stopped / redeployed |

### `hoymiles-modules` (input node)

Polls per-panel (DC input) and per-inverter data — voltage, current, power and daily energy of every panel plus inverter temperature, grid frequency and grid voltage. The DTU uploads this data to the cloud about every 5 minutes; a message is only sent when a new data point is available.

**Configuration:**

| Field | Description |
|---|---|
| Credentials | Select a `hoymiles-config` node |
| Station ID | Numeric station ID (`sid`) |
| Interval (min) | Poll interval in minutes (default 5, minimum 1) |

**Output `msg.payload`:**

```json
{
  "date": "2026-10-25",
  "time": "09:40",
  "timestamp": "2026-10-25T08:40:00.000Z",
  "power": 803.5,
  "inverters": [
    {
      "id": 32840040,
      "sn": "1610A0319AEB",
      "name": null,
      "time": "09:40",
      "temperature": 21,
      "frequency": 49.99,
      "gridVoltage": 232.1,
      "panels": [
        { "port": 1, "voltage": 36.6, "current": 13.02, "power": 473.8, "energyToday": 366, "faultCode": 1 },
        { "port": 2, "voltage": 33.4, "current": 9.85,  "power": 329.7, "energyToday": 212, "faultCode": 1 }
      ]
    }
  ]
}
```

| Field | Description |
|---|---|
| `time` / `timestamp` | Time of the data point (`timestamp` is interpreted in the Node-RED host's time zone) |
| `power` | Sum of all panels (W) |
| `inverters[].temperature` | Inverter temperature (°C) |
| `inverters[].frequency` | Grid frequency (Hz) |
| `inverters[].gridVoltage` | Grid voltage (V); three-phase inverters additionally report `gridVoltageB` / `gridVoltageC` |
| `inverters[].panels[]` | One entry per DC input: `voltage` (V), `current` (A), `power` (W), `energyToday` (Wh), `faultCode` |

**Additional message properties:** `msg.topic` = `hoymiles/modules/{sid}`, `msg.sid` = station ID.

## Installation

```bash
npm install node-red-contrib-hoymiles-home
```

Or via the Node-RED palette manager: search for **hoymiles-home**.

## Quick start

1. Add a **hoymiles-watch** node to your flow
2. Open it and create a new **Hoymiles Credentials** config node
3. Enter your S-Miles Home **e-mail** and **password**
4. Enter your **Station ID**
5. Connect a **debug** node and click **Deploy**

## Local development with Docker

A Docker Compose setup is included for testing nodes without a full Node-RED installation.

```bash
# First start — builds the image and initialises the data volume
docker compose up --build

# After changing node code — restart is enough (nodes are bind-mounted)
docker compose restart

# After changing package.json or adding dependencies — rebuild
docker compose up --build
```

Open **http://localhost:1880** — the **Hoymiles Test** flow is pre-loaded.

## Releasing

Versions are published to npm automatically via GitHub Actions when a tag is pushed.

```bash
# Stable release
npm version minor   # or patch / major
git push --follow-tags

# Dev release (published with npm tag "dev", not "latest")
npm version prerelease --preid=dev
git push --follow-tags
```

Install a dev release:

```bash
npm install node-red-contrib-hoymiles-home@dev
```

## License

MIT © Robin Lenz
