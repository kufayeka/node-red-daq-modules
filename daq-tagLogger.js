module.exports = function(RED) {
    function DAQGetValueNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Endpoint: get available namespace paths
        RED.httpAdmin.get("/daq/namespaces", function(req, res) {
            const daqStore = node.context().global.get("daqStore") || {};
            const pathsList = Object.values(daqStore).map(e => e.namespace);
            res.json(pathsList);
        });

        // Endpoint: clear the DAQ store
        RED.httpAdmin.post("/daq/clear", function(req, res) {
            try {
                node.context().global.set("daqStore", {});
                RED.log.info("DAQ store cleared by user");
                res.sendStatus(200);
            } catch (error) {
                RED.log.error("Error clearing DAQ store: " + error.message);
                res.sendStatus(500);
            }
        });

        node.status({ fill: "grey", shape: "ring", text: "ready" });

        node.on('input', function(msg) {
            const daqStore = node.context().global.get("daqStore") || {};
            const namespacePath = config.namespacePath;

            if (!namespacePath) {
                node.status({ fill: "red", shape: "dot", text: "No path specified" });
                node.error("No namespace path specified", msg);
                return;
            }
            const metadata = Object.values(daqStore).find(e => e.namespace === namespacePath);
            if (!metadata) {
                node.status({ fill: "yellow", shape: "dot", text: "Path not found" });
                node.error("Namespace path not found: " + namespacePath, msg);
                return;
            }

            // Helper: extract based on mode; fixedVal only for 'fixed'
            const getPropertyValue = (nsPath, valueType, valuePath, fixedVal) => {
                if (valueType === 'fixed') {
                    return fixedVal || null;
                }
                if (!nsPath) return null;
                const entry = Object.values(daqStore).find(e => e.namespace === nsPath);
                if (!entry) return null;

                const raw = entry.value;
                if (valueType === 'whole') {
                    // return raw string or parsed object
                    try {
                        return JSON.parse(raw);
                    } catch {
                        return raw;
                    }
                }
                if (valueType === 'specific') {
                    try {
                        // Parse JSON kalau raw string, atau pakai object langsung
                        const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                        if (!obj || !valuePath) return null;

                        // Split nested path dan iterasi
                        const parts = valuePath.split('.');
                        let curr = obj;
                        for (let key of parts) {
                            if (curr !== null && typeof curr === 'object' && key in curr) {
                                curr = curr[key];
                            } else {
                                // path invalid atau tidak ada → return null
                                return null;
                            }
                        }
                        return curr;
                    } catch (e) {
                        node.error("Error extracting specific path: " + e.message);
                        return null;
                    }
                }
                return null;
            };

            // Collect props 1..5
            const prop1 = getPropertyValue(
                config.tagProperties1Path,
                config.tagProperties1Type,
                config.tagProperties1ValuePath,
                config.tagProperties1FixedValue
            );
            const prop2 = getPropertyValue(
                config.tagProperties2Path,
                config.tagProperties2Type,
                config.tagProperties2ValuePath,
                config.tagProperties2FixedValue
            );
            const prop3 = getPropertyValue(
                config.tagProperties3Path,
                config.tagProperties3Type,
                config.tagProperties3ValuePath,
                config.tagProperties3FixedValue
            );
            const prop4 = getPropertyValue(
                config.tagProperties4Path,
                config.tagProperties4Type,
                config.tagProperties4ValuePath,
                config.tagProperties4FixedValue
            );
            const prop5 = getPropertyValue(
                config.tagProperties5Path,
                config.tagProperties5Type,
                config.tagProperties5ValuePath,
                config.tagProperties5FixedValue
            );
            const prop6 = getPropertyValue(
                config.tagProperties6Path,
                config.tagProperties6Type,
                config.tagProperties6ValuePath,
                config.tagProperties6FixedValue
            );
            const prop7 = getPropertyValue(
                config.tagProperties7Path,
                config.tagProperties7Type,
                config.tagProperties7ValuePath,
                config.tagProperties7FixedValue
            );
            const prop8 = getPropertyValue(
                config.tagProperties8Path,
                config.tagProperties8Type,
                config.tagProperties8ValuePath,
                config.tagProperties8FixedValue
            );
            const prop9 = getPropertyValue(
                config.tagProperties9Path,
                config.tagProperties9Type,
                config.tagProperties9ValuePath,
                config.tagProperties9FixedValue
            );
            const prop10 = getPropertyValue(
                config.tagProperties10Path,
                config.tagProperties10Type,
                config.tagProperties10ValuePath,
                config.tagProperties10FixedValue
            );

            // Escape single-quotes for SQL
            const esc = s => s == null ? null : String(s).replace(/'/g, "''");

            // Build INSERT with explicit columns
            msg.query = `
INSERT INTO daq_metrics
VALUES (
  '${esc(msg.payload)}',
  '${esc(metadata.tag_id)}',
  '${esc(metadata.value)}',
  ${prop1 != null ? `'${esc(prop1)}'` : 'NULL'},
  ${prop2 != null ? `'${esc(prop2)}'` : 'NULL'},
  ${prop3 != null ? `'${esc(prop3)}'` : 'NULL'},
  ${prop4 != null ? `'${esc(prop4)}'` : 'NULL'},
  ${prop5 != null ? `'${esc(prop5)}'` : 'NULL'},
  ${prop6 != null ? `'${esc(prop6)}'` : 'NULL'},
  ${prop7 != null ? `'${esc(prop7)}'` : 'NULL'},
  ${prop8 != null ? `'${esc(prop8)}'` : 'NULL'},
  ${prop9 != null ? `'${esc(prop9)}'` : 'NULL'},
  ${prop10 != null ? `'${esc(prop10)}'` : 'NULL'}
);
            `.trim();

            // Update status & send
            const quality = metadata.quality || "unknown";
            node.status({
                fill: quality === "normal" ? "green" : "red",
                shape: "dot",
                text: namespacePath
            });
            node.send(msg);
        });
    }

    RED.nodes.registerType("DAQ-TagLogger", DAQGetValueNode);
};
