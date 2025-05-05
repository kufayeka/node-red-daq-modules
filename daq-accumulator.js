module.exports = function(RED) {
    function DAQAccumulatorNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration
        node.accumulatorType = config.accumulatorType || "delta";
        node.deltaMode = config.deltaMode || "last-first";
        node.countValue = config.countValue || "true";
        node.timeMode = config.timeMode || "total";
        node.targetNamespace = config.targetNamespace || "";

        node.on('input', function(msg) {
            // Check if payload is an array
            if (!Array.isArray(msg.payload)) {
                node.error("Input must be an array of timestamped values", msg);
                node.status({fill:"red", shape:"dot", text:"Invalid input"});
                return;
            }

            // Sort array by timestamp to ensure chronological order
            const data = [...msg.payload].sort((a, b) => {
                return new Date(a.ts) - new Date(b.ts);
            });

            if (data.length === 0) {
                node.warn("Empty data array received");
                node.status({fill:"yellow", shape:"dot", text:"Empty data"});
                msg.payload = { result: null, count: 0 };
                node.send(msg);
                return;
            }

            // Process based on accumulator type
            let result;
            switch(node.accumulatorType) {
                case "delta":
                    result = calculateDelta(data);
                    break;

                case "count":
                    result = countValues(data);
                    break;

                case "time":
                    result = calculateTimeInState(data);
                    break;

                case "sum":
                    result = sumValues(data);
                    break;

                case "average":
                    result = calculateAverage(data);
                    break;

                case "minmax":
                    result = findMinMax(data);
                    break;

                default:
                    result = { result: null, error: "Unknown accumulator type" };
            }

            // Add data points count to result
            result.count = data.length;

            // Set as output
            msg.payload = result;

            // Store in target namespace if configured
            if (node.targetNamespace) {
                storeResult(result.result);
            }

            // Update node status
            updateStatus(result);

            // Send result
            node.send(msg);
        });

        // Calculate delta between first and last values
        function calculateDelta(data) {
            try {
                const firstValue = parseFloat(data[0].tag_value);
                const lastValue = parseFloat(data[data.length - 1].tag_value);

                if (isNaN(firstValue) || isNaN(lastValue)) {
                    return {
                        result: null,
                        error: "Non-numeric values found",
                        first: data[0].tag_value,
                        last: data[data.length - 1].tag_value
                    };
                }

                let delta;
                if (node.deltaMode === "last-first") {
                    delta = lastValue - firstValue;
                } else {
                    delta = firstValue - lastValue;
                }

                return {
                    result: delta,
                    first: {
                        value: firstValue,
                        timestamp: data[0].ts
                    },
                    last: {
                        value: lastValue,
                        timestamp: data[data.length - 1].ts
                    },
                    mode: node.deltaMode
                };
            } catch (e) {
                return { result: null, error: e.message };
            }
        }

        // Count occurrences of specific value
        function countValues(data) {
            try {
                // Convert value to string for comparison
                const targetValue = String(node.countValue);
                let count = 0;

                for (const item of data) {
                    if (String(item.tag_value) === targetValue) {
                        count++;
                    }
                }

                return {
                    result: count,
                    targetValue: targetValue,
                    total: data.length
                };
            } catch (e) {
                return { result: null, error: e.message };
            }
        }

        // Calculate time spent in a specific state
        function calculateTimeInState(data) {
            try {
                if (data.length < 2) {
                    return { result: 0, error: "Insufficient data points" };
                }

                const targetValue = String(node.countValue);
                let totalTimeMs = 0;
                let currentStateStart = null;

                // Process each data point
                for (let i = 0; i < data.length; i++) {
                    const current = data[i];
                    const currentValue = String(current.tag_value);
                    const currentTime = new Date(current.ts);

                    // If time mode is "state", only track specific state
                    if (node.timeMode === "state") {
                        // Start tracking if we enter the target state
                        if (currentValue === targetValue && currentStateStart === null) {
                            currentStateStart = currentTime;
                        }
                        // End tracking if we exit the target state
                        else if (currentValue !== targetValue && currentStateStart !== null) {
                            totalTimeMs += (currentTime - currentStateStart);
                            currentStateStart = null;
                        }
                    }
                    // If time mode is "total", track time between all data points
                    else if (i > 0) {
                        const prevTime = new Date(data[i-1].ts);
                        totalTimeMs += (currentTime - prevTime);
                    }
                }

                // If we're still in the target state at the end
                if (node.timeMode === "state" && currentStateStart !== null) {
                    const lastTime = new Date(data[data.length - 1].ts);
                    totalTimeMs += (lastTime - currentStateStart);
                }

                // Convert to seconds
                const totalTimeSeconds = totalTimeMs / 1000;

                return {
                    result: totalTimeSeconds,
                    resultFormatted: formatDuration(totalTimeSeconds),
                    timeMode: node.timeMode,
                    targetState: node.timeMode === "state" ? targetValue : null,
                    startTime: data[0].ts,
                    endTime: data[data.length - 1].ts
                };
            } catch (e) {
                return { result: null, error: e.message };
            }
        }

        // Sum all numeric values
        function sumValues(data) {
            try {
                let sum = 0;
                let validCount = 0;

                for (const item of data) {
                    const value = parseFloat(item.tag_value);
                    if (!isNaN(value)) {
                        sum += value;
                        validCount++;
                    }
                }

                return {
                    result: sum,
                    validValues: validCount,
                    invalidValues: data.length - validCount
                };
            } catch (e) {
                return { result: null, error: e.message };
            }
        }

        // Calculate average of numeric values
        function calculateAverage(data) {
            try {
                let sum = 0;
                let validCount = 0;

                for (const item of data) {
                    const value = parseFloat(item.tag_value);
                    if (!isNaN(value)) {
                        sum += value;
                        validCount++;
                    }
                }

                const average = validCount > 0 ? sum / validCount : 0;

                return {
                    result: average,
                    sum: sum,
                    validValues: validCount,
                    invalidValues: data.length - validCount
                };
            } catch (e) {
                return { result: null, error: e.message };
            }
        }

        // Find minimum and maximum values
        function findMinMax(data) {
            try {
                let min = null;
                let max = null;
                let minItem = null;
                let maxItem = null;

                for (const item of data) {
                    const value = parseFloat(item.tag_value);
                    if (isNaN(value)) continue;

                    if (min === null || value < min) {
                        min = value;
                        minItem = item;
                    }

                    if (max === null || value > max) {
                        max = value;
                        maxItem = item;
                    }
                }

                return {
                    result: { min, max },
                    min: {
                        value: min,
                        timestamp: minItem ? minItem.ts : null
                    },
                    max: {
                        value: max,
                        timestamp: maxItem ? maxItem.ts : null
                    }
                };
            } catch (e) {
                return { result: null, error: e.message };
            }
        }

        // Format duration in seconds to human-readable format
        function formatDuration(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);

            let result = "";
            if (hours > 0) result += hours + "h ";
            if (minutes > 0) result += minutes + "m ";
            result += secs + "s";

            return result.trim();
        }

        // Store result in target namespace if configured
        function storeResult(result) {
            if (!node.targetNamespace) return;

            try {
                const globalContext = node.context().global;
                let daqStore = globalContext.get("daqStore") || {};

                const metadataKey = `accumulator_${node.id}`;
                daqStore[metadataKey] = {
                    namespace: node.targetNamespace,
                    value: String(result),
                    timestamp: new Date().toISOString(),
                    data_type: typeof result === 'number' ? 'float' :
                        typeof result === 'boolean' ? 'bool' : 'string',
                    quality: "normal",
                    source: "accumulator",
                    additional_info: {
                        accumulatorType: node.accumulatorType,
                        nodeId: node.id
                    }
                };

                globalContext.set("daqStore", daqStore);
            } catch (e) {
                node.warn(`Failed to store in namespace: ${e.message}`);
            }
        }

        // Update node status with result
        function updateStatus(result) {
            if (result.error) {
                node.status({fill:"red", shape:"dot", text: result.error});
                return;
            }

            let statusText;
            switch(node.accumulatorType) {
                case "delta":
                    statusText = `Δ: ${result.result}`;
                    break;
                case "count":
                    statusText = `Count: ${result.result}/${result.total}`;
                    break;
                case "time":
                    statusText = result.resultFormatted;
                    break;
                case "sum":
                    statusText = `Sum: ${result.result}`;
                    break;
                case "average":
                    statusText = `Avg: ${result.result.toFixed(2)}`;
                    break;
                case "minmax":
                    statusText = `Min: ${result.result.min}, Max: ${result.result.max}`;
                    break;
                default:
                    statusText = `Result: ${result.result}`;
            }

            node.status({fill:"green", shape:"dot", text: statusText});
        }
    }

    // Register node
    RED.nodes.registerType("DAQ-Accumulator", DAQAccumulatorNode);
};