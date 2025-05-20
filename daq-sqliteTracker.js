// file: daq-sqlite-tracker.js
module.exports = function(RED) {
    function DAQSQLiteTrackerNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const sqlite3 = require('sqlite3').verbose();
        const path = require('path');

        // Configuration options
        const dbPath = config.dbPath || path.join(RED.settings.userDir, 'daq-tracker.db');
        const tableName = config.tableName || 'daq_values';

        let db = null;
        let dbInitialized = false;

        // Initialize the database and create table if needed
        function initializeDB() {
            return new Promise((resolve, reject) => {
                if (dbInitialized) {
                    resolve();
                    return;
                }

                // Create or open database
                db = new sqlite3.Database(dbPath, (err) => {
                    if (err) {
                        node.error(`Failed to open database: ${err.message}`);
                        reject(err);
                        return;
                    }

                    // Create table if it doesn't exist
                    const createTableSQL = `
                    CREATE TABLE IF NOT EXISTS ${tableName} (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        composite_key TEXT UNIQUE,
                        value TEXT,
                        property1 TEXT,
                        property2 TEXT,
                        property3 TEXT,
                        property4 TEXT,
                        property5 TEXT,
                        property6 TEXT,
                        property7 TEXT,
                        property8 TEXT,
                        property9 TEXT,
                        property10 TEXT,
                        timestamp TEXT,
                        updated_count INTEGER,
                        created_at TEXT,
                        updated_at TEXT
                    )`;

                    db.run(createTableSQL, (err) => {
                        if (err) {
                            node.error(`Failed to create table: ${err.message}`);
                            reject(err);
                            return;
                        }

                        // Create index for faster lookups
                        db.run(`CREATE INDEX IF NOT EXISTS idx_${tableName}_key ON ${tableName} (composite_key)`, (err) => {
                            if (err) {
                                node.warn(`Failed to create index: ${err.message}`);
                            }

                            dbInitialized = true;
                            resolve();
                        });
                    });
                });
            });
        }

        // Generate composite key from properties
        function generateKey(msg) {
            return Array.from({length: 10}, (_, i) => {
                const val = msg[`property${i+1}`];
                return val !== undefined ? String(val) : "";
            }).join("|");
        }

        // Update node status with record count
        function updateNodeStatus() {
            if (!db || !dbInitialized) {
                node.status({fill: "yellow", shape: "ring", text: "Initializing..."});
                return;
            }

            db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
                if (err) {
                    node.status({fill: "red", shape: "ring", text: "Error: " + err.message});
                    return;
                }

                node.status({fill: "green", shape: "dot", text: `${row.count} items tracked`});
            });
        }

        // Operations
        // Update or insert a value
        function updateTracker(msg) {
            return new Promise((resolve, reject) => {
                const key = generateKey(msg);
                const now = new Date().toISOString();

                // First check if record exists
                db.get(`SELECT * FROM ${tableName} WHERE composite_key = ?`, [key], (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const count = row ? row.updated_count + 1 : 1;
                    const created_at = row ? row.created_at : now;

                    // Prepare values for insert/update
                    const values = [
                        key,
                        msg.value !== undefined ? JSON.stringify(msg.value) : null,
                        msg.property1 || "",
                        msg.property2 || "",
                        msg.property3 || "",
                        msg.property4 || "",
                        msg.property5 || "",
                        msg.property6 || "",
                        msg.property7 || "",
                        msg.property8 || "",
                        msg.property9 || "",
                        msg.property10 || "",
                        now,
                        count,
                        created_at,
                        now
                    ];

                    // Insert or replace
                    const sql = `
                    INSERT OR REPLACE INTO ${tableName} 
                    (composite_key, value, property1, property2, property3, property4, property5,
                     property6, property7, property8, property9, property10, timestamp, updated_count, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    db.run(sql, values, function(err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        // Get the inserted/updated record
                        db.get(`SELECT * FROM ${tableName} WHERE composite_key = ?`, [key], (err, row) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            // Parse the value field which is stored as JSON
                            if (row && row.value) {
                                try {
                                    row.value = JSON.parse(row.value);
                                } catch (e) {
                                    // Keep as string if parsing fails
                                }
                            }

                            resolve(row);
                        });
                    });
                });
            });
        }

        // Select values based on properties
        function selectTracker(msg) {
            return new Promise((resolve, reject) => {
                // Build WHERE clause based on specified properties
                const whereConditions = [];
                const params = [];

                for (let i = 1; i <= 10; i++) {
                    const propName = `property${i}`;
                    if (msg[propName] !== undefined) {
                        whereConditions.push(`${propName} = ?`);
                        params.push(msg[propName]);
                    }
                }

                let sql = `SELECT * FROM ${tableName}`;
                if (whereConditions.length > 0) {
                    sql += ` WHERE ${whereConditions.join(' AND ')}`;
                }

                // Add optional order by
                if (msg.orderBy) {
                    sql += ` ORDER BY ${msg.orderBy}`;
                } else {
                    sql += ` ORDER BY updated_at DESC`;
                }

                // Add optional limit
                if (msg.limit !== undefined && !isNaN(parseInt(msg.limit))) {
                    sql += ` LIMIT ${parseInt(msg.limit)}`;
                }

                db.all(sql, params, (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Parse JSON values
                    rows.forEach(row => {
                        if (row.value) {
                            try {
                                row.value = JSON.parse(row.value);
                            } catch (e) {
                                // Keep as string if parsing fails
                            }
                        }
                    });

                    resolve(rows);
                });
            });
        }

        // Delete a specific record
        function deleteTracker(msg) {
            return new Promise((resolve, reject) => {
                const key = generateKey(msg);

                // First get the record to return it
                db.get(`SELECT * FROM ${tableName} WHERE composite_key = ?`, [key], (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!row) {
                        resolve(null); // Nothing to delete
                        return;
                    }

                    // Parse value if it exists
                    if (row.value) {
                        try {
                            row.value = JSON.parse(row.value);
                        } catch (e) {
                            // Keep as string if parsing fails
                        }
                    }

                    // Delete the record
                    db.run(`DELETE FROM ${tableName} WHERE composite_key = ?`, [key], function(err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        resolve(row);
                    });
                });
            });
        }

        // Delete all records
        function deleteAllTrackers() {
            return new Promise((resolve, reject) => {
                // Get count first
                db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const count = row ? row.count : 0;

                    // Delete all records
                    db.run(`DELETE FROM ${tableName}`, function(err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        resolve({ deletedCount: count });
                    });
                });
            });
        }

        // Handle input messages
        node.on('input', function(msg, send, done) {
            send = send || ((...args) => node.send.apply(node, args));
            done = done || ((err) => err && node.error(err, msg));

            // Initialize DB if not already done
            initializeDB()
                .then(() => {
                    const operation = msg.operation || 'update';

                    switch (operation) {
                        case 'update':
                            return updateTracker(msg);
                        case 'select':
                            return selectTracker(msg);
                        case 'delete':
                            return deleteTracker(msg);
                        case 'deleteAll':
                            return deleteAllTrackers();
                        default:
                            node.warn(`Unknown operation: ${operation}, using 'update'`);
                            return updateTracker(msg);
                    }
                })
                .then(result => {
                    msg.payload = result;
                    updateNodeStatus();
                    send(msg);
                    done();
                })
                .catch(err => {
                    node.error(`Operation failed: ${err.message}`, msg);
                    msg.error = err.message;
                    send(msg);
                    done(err);
                });
        });

        // Initial status update
        node.status({fill: "yellow", shape: "ring", text: "Initializing..."});

        // Initialize DB and update status
        initializeDB()
            .then(() => {
                updateNodeStatus();
            })
            .catch(err => {
                node.error(`Failed to initialize database: ${err.message}`);
                node.status({fill: "red", shape: "ring", text: "DB Init Failed"});
            });

        // Clean up on close
        node.on('close', function(done) {
            if (db) {
                db.close(() => {
                    done();
                });
            } else {
                done();
            }
        });
    }

    // Register node
    RED.nodes.registerType("DAQ-SQLiteTracker", DAQSQLiteTrackerNode);

    // Node configuration in the editor
    RED.httpAdmin.get('/daq-tracker/tables', RED.auth.needsPermission('DAQ-SQLiteTracker.read'), function(req, res) {
        // Could implement a utility to list tables from the database
        res.json([]);
    });
};