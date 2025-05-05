module.exports = function(RED) {
    const objectPath = require("object-path");

    function DAQGetValueNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Endpoint untuk getting available namespace paths
        RED.httpAdmin.get("/daq/namespaces", function(req, res) {
            const dbName = 'daqStore';
            const db = node.context().global.get(dbName) || {};
            const pathsList = Object.values(db).map(entry => entry.namespace);
            res.json(pathsList);
        });

        // Endpoint untuk clearing the DAQ store
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

        node.status({fill:"grey", shape:"ring", text:"ready"});

        node.on('input', function(msg) {
            const globalContext = node.context().global;
            const daqStore = globalContext.get("daqStore") || {};
            const namespacePath = config.namespacePath;

            if (!namespacePath) {
                node.status({fill:"red", shape:"dot", text:"No path specified"});
                node.error("No namespace path specified", msg);
                return;
            }

            const metadata = Object.values(daqStore).find(entry => entry.namespace === namespacePath);
            if (!metadata) {
                node.status({fill:"yellow", shape:"dot", text:"Path not found"});
                node.error("Namespace path not found: " + namespacePath, msg);
                return;
            }

            // Fungsi ekstraksi nilai
            const getPropertyValue = (nsPath, valueType, valuePath) => {
                if (!nsPath) return null;
                const entry = Object.values(daqStore).find(e => e.namespace === nsPath);
                if (!entry) return null;

                try {
                    const data = entry.value
                    const data2 = JSON.parse(entry.value);
                    return valueType === 'whole' ? data : data2[valuePath];
                } catch (e) {
                    node.error("Error extracting property value: " + e.message);
                    return null;
                }
            };

            // Ambil nilai properties
            const prop1 = getPropertyValue(
                config.tagProperties1Path,
                config.tagProperties1Type,
                config.tagProperties1ValuePath
            );

            const prop2 = getPropertyValue(
                config.tagProperties2Path,
                config.tagProperties2Type,
                config.tagProperties2ValuePath
            );

            const prop3 = getPropertyValue(
                config.tagProperties3Path,
                config.tagProperties3Type,
                config.tagProperties3ValuePath
            );

            const prop4 = getPropertyValue(
                config.tagProperties4Path,
                config.tagProperties4Type,
                config.tagProperties4ValuePath
            );

            const prop5 = getPropertyValue(
                config.tagProperties5Path,
                config.tagProperties5Type,
                config.tagProperties5ValuePath
            );

            // Update query SQL
            msg.query = `INSERT INTO daq_metrics VALUES (
                '${msg.payload}',
                '${metadata.tag_id}', 
                '${metadata.value}',
                ${prop1 ? `'${prop1}'` : 'NULL'},
                ${prop2 ? `'${prop2}'` : 'NULL'},
                ${prop3 ? `'${prop3}'` : 'NULL'},
                ${prop4 ? `'${prop4}'` : 'NULL'},
                ${prop5 ? `'${prop4}'` : 'NULL'}
            );`;

            const quality = metadata.quality || "unknown";
            node.status({fill: quality === "normal" ? "green" : "red", shape: "dot", text: namespacePath});
            node.send(msg);
        });
    }

    RED.nodes.registerType("DAQ-TagLogger", DAQGetValueNode);
};