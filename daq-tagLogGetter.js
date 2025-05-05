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

            // Validasi namespace
            if (!namespacePath) {
                node.status({ fill: "red", shape: "dot", text: "No path" });
                return node.error("Namespace path required", msg);
            }

            // Cari metadata
            const metadata = Object.values(daqStore).find(e => e.namespace === namespacePath);
            if (!metadata) {
                node.status({ fill: "yellow", shape: "dot", text: "Path not found" });
                return node.error(`Namespace ${namespacePath} not found`, msg);
            }

            // Base query
            let query = `SELECT * FROM daq_metrics WHERE tag_id='${metadata.tag_id}'`;

            // Time condition
            const mode = config.timeMode;
            if (mode === "between") {
                const start = config.startTimestamp || msg.startTimestamp;
                const end = config.endTimestamp || msg.endTimestamp;
                if (start && end) query += ` AND ts BETWEEN '${start}' AND '${end}'`;
            } else if (mode === "exact") {
                const exact = config.exactTimestamp || msg.exactTimestamp;
                if (exact) query += ` AND ts = '${exact}'`;
            } else if (mode === "window") {
                const amount = parseInt(config.windowAmount) || 5;
                const unit = config.windowUnit || 'm';
                const msMap = {s:1e3, m:6e4, h:3.6e6, d:8.64e7, M:2.628e9, y:3.154e10};
                const start = new Date(Date.now() - (amount * (msMap[unit] || 0))).toISOString();
                query += ` AND ts >= '${start}'`;
            }

            // Property conditions
            const propClauses = [];
            for (let i = 1; i <= 5; i++) {
                const useProp = config[`useProp${i}`] || msg[`useProp${i}`];
                if (!useProp) continue;

                const operator = config[`prop${i}Operator`] || msg[`prop${i}Operator`] || "=";
                let value = config[`prop${i}Value`] || msg[`prop${i}Value`] || "";
                const logic = config[`prop${i}Logic`] || msg[`prop${i}Logic`] || "AND";

                // Sanitize value
                if (operator !== 'LIKE') {
                    value = value.replace(/'/g, "''");
                }

                propClauses.push({
                    clause: `tag_properties_${i} ${operator} '${value}'`,
                    logic: logic
                });
            }

            // Gabung property conditions
            if (propClauses.length > 0) {
                query += " AND (";
                propClauses.forEach((cond, idx) => {
                    query += idx === 0 ? cond.clause : ` ${cond.logic} ${cond.clause}`;
                });
                query += ")";
            }

            // Output
            msg.query = query;
            msg.namespacePath = namespacePath;
            node.send(msg);
            node.status({ fill: "green", shape: "dot", text: "Query generated" });
        });
    }
    RED.nodes.registerType("DAQ-TagLogGetter", DAQTagLogGetter);
};