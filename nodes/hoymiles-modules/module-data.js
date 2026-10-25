const zlib = require('zlib');

// Minimal decoder for the PlayModuleData protobuf returned (gzipped) by
// /pvmc/api/0/module_data/dmdd_c. Schema from the S-Miles Home app
// (PlaybackDataPB.proto):
//
//   PlayModuleData    { int32 sid = 1; string date = 2; map<int32, PlayMicroData> micro_data_map = 3; }
//   PlayMicroData     { int32 port_num = 1; repeated string time = 2;
//                       map<int32, PlayPortDataArray> port_data_map = 4;
//                       repeated float pn_hz = 5; repeated float pn_temp = 6;
//                       repeated float pn_u_a = 7; repeated float pn_u_b = 8; repeated float pn_u_c = 9; }
//   PlayPortDataArray { repeated PlayPortData module_data = 1; }
//   PlayPortData      { float pv_u = 1; float pv_i = 2; float bn_p = 3; float total_eq = 4; int32 fault_code = 5; }

function readVarint(buf, pos) {
    let result = 0;
    let shift = 0;
    for (;;) {
        const byte = buf[pos++];
        result += (byte & 0x7f) * 2 ** shift;
        shift += 7;
        if (byte < 0x80) return [result, pos];
    }
}

function* fields(buf) {
    let pos = 0;
    while (pos < buf.length) {
        let key;
        [key, pos] = readVarint(buf, pos);
        const field = Math.floor(key / 8);
        const wire = key & 7;
        let value;
        switch (wire) {
            case 0: [value, pos] = readVarint(buf, pos); break;
            case 1: value = buf.subarray(pos, pos + 8); pos += 8; break;
            case 2: {
                let len;
                [len, pos] = readVarint(buf, pos);
                value = buf.subarray(pos, pos + len);
                pos += len;
                break;
            }
            case 5: value = buf.readFloatLE(pos); pos += 4; break;
            default: throw new Error(`Unsupported protobuf wire type ${wire}`);
        }
        yield { field, wire, value };
    }
}

// Packed repeated float, or a single unpacked float
function floats({ wire, value }) {
    if (wire === 5) return [value];
    const out = [];
    for (let i = 0; i + 4 <= value.length; i += 4) out.push(value.readFloatLE(i));
    return out;
}

function mapEntry(buf) {
    const e = {};
    for (const { field, value } of fields(buf)) e[field] = value;
    return [e[1], e[2]];
}

const PORT_FIELDS = { 1: 'pv_u', 2: 'pv_i', 3: 'bn_p', 4: 'total_eq', 5: 'fault_code' };
const MICRO_FLOAT_FIELDS = { 5: 'pn_hz', 6: 'pn_temp', 7: 'pn_u_a', 8: 'pn_u_b', 9: 'pn_u_c' };

function decodePortData(buf) {
    const d = {};
    for (const { field, value } of fields(buf)) {
        if (PORT_FIELDS[field]) d[PORT_FIELDS[field]] = value;
    }
    return d;
}

function decodeMicro(buf) {
    const m = { port_num: 0, time: [], ports: {}, pn_hz: [], pn_temp: [], pn_u_a: [], pn_u_b: [], pn_u_c: [] };
    for (const f of fields(buf)) {
        if (f.field === 1) m.port_num = f.value;
        else if (f.field === 2) m.time.push(f.value.toString('utf8'));
        else if (f.field === 4) {
            const [port, arr] = mapEntry(f.value);
            m.ports[port] = arr ? [...fields(arr)].filter(x => x.field === 1).map(x => decodePortData(x.value)) : [];
        } else if (MICRO_FLOAT_FIELDS[f.field]) {
            m[MICRO_FLOAT_FIELDS[f.field]].push(...floats(f));
        }
    }
    return m;
}

function decodeModuleData(raw) {
    const buf = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
    const data = { sid: 0, date: '', micros: {} };
    for (const f of fields(buf)) {
        if (f.field === 1) data.sid = f.value;
        else if (f.field === 2) data.date = f.value.toString('utf8');
        else if (f.field === 3) {
            const [id, micro] = mapEntry(f.value);
            data.micros[id] = micro ? decodeMicro(micro) : decodeMicro(Buffer.alloc(0));
        }
    }
    return data;
}

module.exports = { decodeModuleData };
