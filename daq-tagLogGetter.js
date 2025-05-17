module.exports = function (RED) {
    function DAQTagLogGetter(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Endpoint untuk get namespaces
        RED.httpAdmin.get("/daq/namespaces", (req, res) => {
            const db = node.context().global.get("daqStore") || {};
            const pathsList = Object.values(db)
                .filter(entry => entry.namespace)
                .map(entry => entry.namespace);
            res.json(pathsList);
        });

        // Endpoint untuk clear store
        RED.httpAdmin.post("/daq/clear", (req, res) => {
            try {
                node.context().global.set("daqStore", {});
                RED.log.info("DAQ store cleared");
                res.sendStatus(200);
            } catch (error) {
                RED.log.error("Clear error: " + error.message);
                res.sendStatus(500);
            }
        });

        node.status({ fill: "grey", shape: "ring", text: "ready" });

        node.on('input', function (msg) {
            const daqStore = node.context().global.get("daqStore") || {};
            const namespacePath = config.namespacePath || msg.namespacePath;
            if (!namespacePath) {
                node.status({ fill: "red", shape: "dot", text: "No path" });
                return node.error("Namespace path required", msg);
            }
            const metadata = Object.values(daqStore).find(e => e.namespace === namespacePath);
            if (!metadata) {
                node.status({ fill: "yellow", shape: "dot", text: "Path not found" });
                return node.error(`Namespace ${namespacePath} not found`, msg);
            }

            // build WHERE clauses
            let where = `tag_id='${metadata.tag_id}'`;
            // time filters
            const mode = config.timeMode;
            if (mode === "between") {
                const start = config.startTimestamp || msg.startTimestamp;
                const end   = config.endTimestamp   || msg.endTimestamp;
                if (start && end) where += ` AND ts BETWEEN '${start}' AND '${end}'`;
            } else if (mode === "exact") {
                const exact = config.exactTimestamp || msg.exactTimestamp;
                if (exact) where += ` AND ts = '${exact}'`;
            } else if (mode === "window") {
                const amount = parseInt(config.windowAmount) || 5;
                const unit   = config.windowUnit || 'm';
                const msMap  = {s:1e3,m:6e4,h:3.6e6,d:8.64e7,M:2.628e9,y:3.154e10};
                const start  = new Date(Date.now() - amount*msMap[unit]).toISOString();
                where += ` AND ts >= '${start}'`;
            }

            // property filters
            const clauses = [];
            for (let i = 1; i <= 10; i++) {
                const use = config[`useProp${i}`] || msg[`useProp${i}`];
                if (!use) continue;
                const op    = config[`prop${i}Operator`] || msg[`prop${i}Operator`] || "=";
                let val     = config[`prop${i}Value`]    || msg[`prop${i}Value`]    || "";
                const logic = config[`prop${i}Logic`]    || msg[`prop${i}Logic`]    || "AND";
                if (op !== 'LIKE') val = val.replace(/'/g,"''");
                clauses.push(`${logic} tag_properties_${i} ${op} '${val}'`);
            }
            if (clauses.length) {
                // first clause already has AND in where
                where += " AND (" + clauses.map((c,i)=> i===0? c.replace(/^AND /,'') : c).join(' ') + ")";
            }

            const base = `SELECT * FROM daq_metrics WHERE ${where}`;
            let query;

            switch (config.retrievalMode) {
                case "first":
                    query = `${base} ORDER BY ts ASC LIMIT 1`;
                    break;

                case "last":
                    query = `${base} ORDER BY ts DESC LIMIT 1`;
                    break;

                case "first_last":
                    // dua baris: earliest + latest
                    query = `
                    (${base} ORDER BY ts ASC LIMIT 1)
                    UNION ALL
                    (${base} ORDER BY ts DESC LIMIT 1)
                    `.trim();
                    break;

                case "row_count":
                    // hitung jumlah row
                    query = `SELECT COUNT(*) as count FROM daq_metrics WHERE ${where}`;
                    break;

                case "all":
                default:
                    query = base;
            }

            msg.query = query;
            msg.namespacePath = namespacePath;
            msg.topic = config.dataTopic || namespacePath;

            node.send(msg);
            node.status({ fill: "green", shape: "dot", text: "Query generated" });
        });
    }
    RED.nodes.registerType("DAQ-TagLogGetter", DAQTagLogGetter);
};
