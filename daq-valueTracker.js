// file: DAQ-ValueTracker.js
module.exports = function(RED) {
    function ValueTrackerNode(config) {
        RED.nodes.createNode(this, config);
        const node      = this;
        const globalCtx = node.context().global;
        const KEY_LIST  = '__DAQ_Tracker_KEYS__';

        // Helper: gabung msg.property1...msg.property10 pakai "."
        function genKey(msg) {
            const parts = [];
            for (let i = 1; i <= 10; i++) {
                const v = msg[`property${i}`];
                if (v != null && String(v).trim() !== '') {
                    parts.push(String(v));
                }
            }
            return parts.length ? parts.join('.') : 'default';
        }

        node.on('input', (msg, send, done) => {
            try {
                // ambil daftar key yang udah terdaftar
                let keyList = globalCtx.get(KEY_LIST) || [];
                const key   = genKey(msg);
                let result;

                switch (msg.operation) {
                    case 'select':
                        result = globalCtx.get(key) || { value: null, _lastUpdate: null, _updateCount: 0 };
                        break;

                    case 'delete':
                        result = globalCtx.get(key) || { value: null, _lastUpdate: null, _updateCount: 0 };
                        globalCtx.set(key, undefined);
                        // remove dari keyList
                        keyList = keyList.filter(k => k !== key);
                        globalCtx.set(KEY_LIST, keyList);
                        break;

                    case 'deleteAll':
                        // hapus semua stored keys
                        keyList.forEach(k => globalCtx.set(k, undefined));
                        result = { deletedKeys: keyList.slice(), totalDeleted: keyList.length };
                        keyList = [];
                        globalCtx.set(KEY_LIST, keyList);
                        break;

                    case 'debug':
                        // select all berdasarkan keyList
                        const trackers = {};
                        keyList.forEach(k => {
                            trackers[k] = globalCtx.get(k) || { value: null, _lastUpdate: null, _updateCount: 0 };
                        });
                        result = { totalTracked: keyList.length, trackers };
                        break;

                    default: // update
                        const oldRec   = globalCtx.get(key) || { _updateCount: 0 };
                        const now      = new Date().toISOString();
                        const newCount = (oldRec._updateCount || 0) + 1;
                        const newRec   = {
                            value:        msg.value,
                            _lastUpdate:  now,
                            _updateCount: newCount
                        };
                        globalCtx.set(key, newRec);
                        // add key kalau belum ada di list
                        if (!keyList.includes(key)) {
                            keyList.push(key);
                            globalCtx.set(KEY_LIST, keyList);
                        }
                        result = newRec;
                }

                msg.payload = result;
                node.status({
                    fill:  'green',
                    shape: 'dot',
                    text:  `${msg.operation} (${keyList.length})`
                });
                send(msg);
                done();

            } catch (err) {
                node.status({ fill: 'red', shape: 'ring', text: 'error' });
                done(err);
            }
        });

        node.on('close', done => done());
    }

    RED.nodes.registerType('DAQ-ValueTracker', ValueTrackerNode);
};
