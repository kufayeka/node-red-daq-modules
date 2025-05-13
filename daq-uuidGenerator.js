/**
 * daq-uuidGenerator.js
 *
 * Node-RED node to generate a UUID v4 using the 'uuid' library.
 */

module.exports = function(RED) {
    // import uuid library
    const { v4: uuidv4 } = require('uuid');

    function DaqUuidGeneratorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // config (you can extend with more options)
        node.field = config.field || 'payload';  // where to put the UUID
        node.msgTopic = config.msgTopic || '';

        node.on('input', function(msg, send, done) {
            try {
                // generate uuid
                const id = uuidv4();

                // attach to msg
                if (node.field === 'payload') {
                    msg.payload = id;
                } else {
                    RED.util.setMessageProperty(msg, node.field, id, true);
                }

                // optional: set topic
                if (node.msgTopic) {
                    msg.topic = node.msgTopic;
                }

                send(msg);
                done();
            } catch (err) {
                node.error("UUID generation failed", err);
                done(err);
            }
        });
    }

    RED.nodes.registerType('DAQ-UUID', DaqUuidGeneratorNode);
};
