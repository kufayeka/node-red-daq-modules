// file: DAQ-ValueTrackerFilter.js
module.exports = function(RED) {
    function FilterDataNode(config) {
        RED.nodes.createNode(this, config);
        const node      = this;
        const flowCtx   = node.context().flow;
        const globalCtx = node.context().global;

        // helper untuk resolve a value berdasarkan type + path/fixed
        function resolve(type, val, msg) {
            switch(type) {
                case 'msg':    return RED.util.getMessageProperty(msg, val);
                case 'flow':   return flowCtx.get(val);
                case 'global': return globalCtx.get(val);
                case 'str':    return val;
                default:       return undefined;
            }
        }

        node.on('input', (msg, send, done) => {
            send = send || node.send;
            done = done || (()=>{});

            try {
                // 1) build daftar filterParts dari property1…10
                const filterParts = [];
                for (let i = 1; i <= 10; i++) {
                    const type = config['property'+i+'Type'];
                    const path = config['property'+i];
                    if (path) {
                        const v = resolve(type, path, msg);
                        if (v !== undefined && v !== null && String(v).trim() !== '') {
                            filterParts.push(String(v));
                        }
                    }
                }

                // 2) resolve topic dari config, kalau ada
                let topicVal;
                if (config.topic) {
                    topicVal = resolve(config.topicType, config.topic, msg);
                }
                // jika dapat, set; else jika msg.topic belum ada, set empty string
                if (topicVal !== undefined && topicVal !== null) {
                    msg.topic = topicVal;
                } else if (msg.topic === undefined) {
                    msg.topic = "";
                }

                // 3) build propertyString untuk status
                const propertyString = filterParts.join('.');

                // 4) ambil trackers
                const trackers = (msg.payload && msg.payload.trackers) || {};

                // 5) cari entry pertama yang match
                let matched = null;
                for (const [key, rec] of Object.entries(trackers)) {
                    const parts = key.split('.');
                    if (filterParts.every(fp => parts.includes(fp))) {
                        matched = rec;
                        break;
                    }
                }

                // 6) isi payload & status
                if (matched) {
                    msg.payload = matched;
                    node.status({
                        fill:  'green',
                        shape: 'dot',
                        text:  `${propertyString} = ${JSON.stringify(matched.value)}`
                    });
                } else {
                    // no match -> kirim null‐record
                    msg.payload = {
                        value: null,
                        _lastUpdate: null,
                        _updateCount: 0
                    };
                    node.status({
                        fill:  'yellow',
                        shape: 'ring',
                        text:  'no match'
                    });
                }

                // 7) selalu kirim msg, dengan msg.topic sudah ada
                send(msg);
                done();
            } catch(err) {
                node.error(`FilterData error: ${err.message}`, msg);
                // pastikan topic tetap ada
                if (msg.topic === undefined) msg.topic = "";
                node.status({ fill:'red', shape:'ring', text:'error' });
                send(msg);
                done(err);
            }
        });

        node.on('close', () => {
            node.status({});
        });
    }

    RED.nodes.registerType('DAQ-ValueTrackerFilter', FilterDataNode);
};
