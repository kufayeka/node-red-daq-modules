module.exports = function(RED) {
    let adminEndpointsRegistered = false;

    function sortNamespacePaths(paths) {
        return paths
            .filter(Boolean)
            .map(String)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    }

    function DAQGetValueNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Register admin endpoints once (global context is shared across nodes)
        if (!adminEndpointsRegistered) {
            adminEndpointsRegistered = true;

            // Endpoint for getting available namespace paths
            // Supports optional query param: ?q=substring (case-insensitive)
            RED.httpAdmin.get("/daq/namespaces", function(req, res) {
                const dbName = "daqStore";
                const db = node.context().global.get(dbName) || {};

                const rawList = Object.values(db)
                    .map((entry) => entry && entry.namespace)
                    .filter(Boolean);

                // Deduplicate
                const unique = Array.from(new Set(rawList));

                // Optional search/filter
                const q = (req.query && typeof req.query.q === "string") ? req.query.q.trim() : "";
                const filtered = q
                    ? unique.filter((p) => String(p).toLowerCase().includes(q.toLowerCase()))
                    : unique;

                res.json(sortNamespacePaths(filtered));
            });

            // Endpoint for clearing the DAQ store
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
        }

        node.status({fill:"grey", shape:"ring", text:"ready"});

        node.on('input', function(msg) {
            // Get global context reference
            const globalContext = node.context().global;
            const daqStore = globalContext.get("daqStore") || {};

            // Use configured namespace path
            const namespacePath = config.namespacePath;

            if (!namespacePath) {
                node.status({fill:"red", shape:"dot", text:"No path specified"});
                node.error("No namespace path specified", msg);
                return;
            }

            // Retrieve data from daqStore
            const metadata = Object.values(daqStore).find(entry => entry.namespace === namespacePath);

            if (!metadata) {
                node.status({fill:"yellow", shape:"dot", text:"Path not found"});
                node.error("Namespace path not found: " + namespacePath, msg);
                return;
            }

            // Set output based on configuration
            switch(config.outputMode) {
                case 'value':
                    // Parse the value based on data type
                    try {
                        switch(metadata.data_type) {
                            case 'bool':
                                msg.payload = metadata.value === 'true';
                                break;
                            case 'int':
                                msg.payload = parseInt(metadata.value);
                                break;
                            case 'float':
                                msg.payload = parseFloat(metadata.value);
                                break;
                            case 'array':
                                msg.payload = JSON.parse(metadata.value);
                                break;
                            case 'object':
                                msg.payload = JSON.parse(metadata.value);
                                break;
                            default: // string and other types
                                msg.payload = metadata.value;
                        }
                    } catch(e) {
                        msg.payload = metadata.value;
                    }
                    break;

                case 'raw':
                    // Raw unparsed value
                    msg.payload = metadata.value;
                    break;

                case 'metadata':
                    // Complete metadata object
                    msg.payload = metadata;
                    break;
            }

            // Show status
            const quality = metadata.quality || "unknown";
            const statusColor = quality === "normal" ? "green" : "red";
            node.status({fill: statusColor, shape: "dot", text: namespacePath});

            // Send message
            node.send(msg);
        });
    }

    // Node registration
    RED.nodes.registerType("DAQ-GetValue", DAQGetValueNode);
};