module.exports = function(RED) {

    function DAQMetadataNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Buat unified‐namespace key
        const unifiedNamespace = [
            config.location,
            config.plant_name,
            config.floor_name,
            config.device_group,
            config.device_name,
            config.tag_group,
            config.tag_name
        ].join('/');

        node.on('input', msg => {
            // ambil rawValue sesuai config.valuePathType
            let rawValue;
            switch(config.valuePathType) {
                case 'flow':
                    rawValue = node.context().flow.get(config.valuePath);
                    break;
                case 'global':
                    rawValue = node.context().global.get(config.valuePath);
                    break;
                default:
                    rawValue = RED.util.getMessageProperty(msg, config.valuePath);
            }

            // tentukan quality
            let quality = config.quality;
            if (msg.hasOwnProperty('error') || rawValue == null) {
                quality = 'error';
            }

            // serialize rawValue
            const value = (typeof rawValue === 'string')
                ? rawValue
                : (JSON.stringify(rawValue) || '');

            // status
            node.status({fill: "green", shape: "dot", text: `value: ${value}, un: ${unifiedNamespace}`});

            // bangun metadata object
            const meta = {
                tag_id:       config.id,
                tag_name:     config.tag_name,
                tag_group:    config.tag_group,
                location:     config.location,
                plant_name:   config.plant_name,
                floor:        config.floor_name,
                device_group: config.device_group,
                device_name:  config.device_name,
                data_type:    config.data_type,
                quality:      quality,
                unit:         config.unit,
                description:  config.description,
                namespace: unifiedNamespace,
                value:        value
            };

            // kirim metadata ke output
            msg.metadata = meta;

            // Store to DB
            const dbName = 'daqStore';
            const db = node.context().global.get(dbName) || {};
            db[config.id] = meta;
            node.context().global.set(dbName, db);

            // mqtt config
            msg.topic = unifiedNamespace;
            msg.payload = value;

            // Log for debugging
            node.debug(`Updated daqStore with path: ${config.id}`);
            node.send(msg);
        });
    }

    RED.nodes.registerType('DAQ-Metadata', DAQMetadataNode);
};
