// ===== IMPORTS DAN GLOBAL POOL CACHE =====
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Global pool cache
const pools = {}; // { key: { pool, nodes:Set, status, lastError } }
function poolKey(config) {
    return [config.host, config.port, config.database, config.username, config.password].join('|');
}

function activePoolCount() {
    return Object.keys(pools).length;
}

function getOrCreatePool(config, node) {
    const key = poolKey(config);
    if (!pools[key]) {
        pools[key] = {
            pool: new Pool({
                host: config.host,
                port: config.port,
                database: config.database,
                user: config.username,
                password: config.password,
            }),
            nodes: new Set(),
            status: 'connecting',
            lastError: ''
        };
        pools[key].pool.connect()
            .then(client => {
                client.release();
                pools[key].status = 'connected';
                pools[key].lastError = '';
                pools[key].nodes.forEach(n => n.status({
                    fill: "green", shape: "dot",
                    text: `connected | pools: ${activePoolCount()}`
                }));
            })
            .catch(err => {
                pools[key].status = 'error';
                pools[key].lastError = err.message;
                pools[key].nodes.forEach(n => n.status({
                    fill: "red", shape: "ring",
                    text: `${err.message} | pools: ${activePoolCount()}`
                }));
            });
    }
    pools[key].nodes.add(node);

    // Update this node's status
    if (pools[key].status === 'connected') {
        node.status({ fill: "green", shape: "dot", text: `connected | pools: ${activePoolCount()}` });
    } else if (pools[key].status === 'error') {
        node.status({ fill: "red", shape: "ring", text: `${pools[key].lastError} | pools: ${activePoolCount()}` });
    } else {
        node.status({ fill: "yellow", shape: "dot", text: `connecting | pools: ${activePoolCount()}` });
    }
    return pools[key].pool;
}
function releasePool(config, node) {
    const key = poolKey(config);
    if (pools[key]) {
        pools[key].nodes.delete(node);
        if (pools[key].nodes.size === 0) {
            pools[key].pool.end();
            delete pools[key];
        }
    }
}

// ===== NODE-RED NODE DEFINITION =====
module.exports = function(RED) {
    function DAQAccountManagerNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const pool = getOrCreatePool(config, node);

        // Table QuestDB
        pool.query(`
            CREATE TABLE IF NOT EXISTS accounts (
                                                    id STRING,
                                                    fullname STRING,
                                                    role STRING,
                                                    username STRING,
                                                    password STRING,
                                                    status STRING,
                                                    created_at TIMESTAMP,
                                                    updated_at TIMESTAMP,
                                                    last_login TIMESTAMP,
                                                    delete_at TIMESTAMP
            ) timestamp(created_at);
        `).catch(e => {
            node.status({ fill: "red", shape: "ring", text: `table error | pools: ${activePoolCount()}` });
        });

        // ========== CRUD & LOGIN ==========

        async function createAccount(msg, send, done) {
            const data = msg.payload;
            data.id = data.id || uuidv4();
            const now = new Date().toISOString();

            // Cek unique username
            const res = await pool.query(
                `SELECT id FROM accounts WHERE username = $1 AND delete_at IS NULL`,
                [data.username]
            );
            if (res.rows.length) {
                msg.payload = { success: false, error: "Username already exists!" };
                node.status({ fill: "red", shape: "ring", text: `username exists | pools: ${activePoolCount()}` });
                send(msg); return done();
            }

            const passwordHash = await bcrypt.hash(data.password, 10);

            await pool.query(`
                INSERT INTO accounts (id, fullname, role, username, password, status, created_at, updated_at, delete_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$7,null)
            `, [
                data.id,
                data.fullname,
                data.role,
                data.username,
                passwordHash,
                data.status || "active",
                now
            ]);
            msg.payload = { success: true, id: data.id };
            node.status({ fill: "green", shape: "dot", text: `account created | pools: ${activePoolCount()}` });
            send(msg); done();
        }

        async function updateAccount(msg, send, done) {
            const data = msg.payload;
            const now = new Date().toISOString();

            // Cek username unique jika ganti username
            if (data.username) {
                const check = await pool.query(
                    `SELECT id FROM accounts WHERE username = $1 AND id <> $2 AND delete_at IS NULL`,
                    [data.username, data.id]
                );
                if (check.rows.length) {
                    msg.payload = { success: false, error: "Username already used by another user!" };
                    node.status({ fill: "red", shape: "ring", text: `username exists | pools: ${activePoolCount()}` });
                    send(msg); return done();
                }
            }

            // Build update query
            let setQuery = [
                "fullname = $1",
                "role = $2",
                "username = $3",
                "status = $4",
                "updated_at = $5"
            ];
            let params = [
                data.fullname,
                data.role,
                data.username,
                data.status,
                now
            ];
            let paramIdIndex = 6;

            if (data.password) {
                const passwordHash = await bcrypt.hash(data.password, 10);
                setQuery.push(`password = $${paramIdIndex}`);
                params.push(passwordHash);
                paramIdIndex++;
            }
            params.push(data.id);

            await pool.query(
                `UPDATE accounts SET ${setQuery.join(', ')} WHERE id = $${paramIdIndex} AND delete_at IS NULL`,
                params
            );
            msg.payload = { success: true, id: data.id };
            node.status({ fill: "green", shape: "dot", text: `account updated | pools: ${activePoolCount()}` });
            send(msg); done();
        }

        async function deleteAccount(msg, send, done) {
            const id = msg.payload.id;
            const now = new Date().toISOString();
            await pool.query(
                `UPDATE accounts SET delete_at = $1 WHERE id = $2 AND delete_at IS NULL`,
                [now, id]
            );
            msg.payload = { success: true, id };
            node.status({ fill: "grey", shape: "ring", text: `account deleted | pools: ${activePoolCount()}` });
            send(msg); done();
        }

        async function findAccount(msg, send, done) {
            const id = msg.payload.id;
            const res = await pool.query(
                `SELECT id, fullname, role, username, status, created_at, updated_at, last_login FROM accounts WHERE id = $1 AND delete_at IS NULL`,
                [id]
            );
            msg.payload = res.rows[0] || null;
            node.status({
                fill: "green", shape: "dot",
                text: (res.rows[0] ? "found" : "not found") + ` | pools: ${activePoolCount()}`
            });
            send(msg); done();
        }

        async function findAllAccounts(msg, send, done) {
            const res = await pool.query(
                `SELECT id, fullname, role, username, status, created_at, updated_at, last_login FROM accounts WHERE delete_at IS NULL ORDER BY fullname`
            );
            msg.payload = res.rows;
            node.status({ fill: "green", shape: "dot", text: `findAll | pools: ${activePoolCount()}` });
            send(msg); done();
        }

        async function loginAccount(msg, send, done) {
            const { username, password } = msg.payload;
            const res = await pool.query(
                `SELECT * FROM accounts WHERE username = $1 AND delete_at IS NULL`,
                [username]
            );
            if (!res.rows.length) {
                msg.payload = { success: false, error: "Username not found!" };
                node.status({ fill: "red", shape: "ring", text: `login failed | pools: ${activePoolCount()}` });
                send(msg); return done();
            }
            const user = res.rows[0];
            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                msg.payload = { success: false, error: "Wrong password!" };
                node.status({ fill: "red", shape: "ring", text: `login failed | pools: ${activePoolCount()}` });
            } else {
                // Update last_login timestamp
                const now = new Date().toISOString();
                await pool.query(
                    `UPDATE accounts SET last_login = $1 WHERE id = $2`,
                    [now, user.id]
                );
                delete user.password;
                user.last_login = now;
                msg.payload = { success: true, user };
                node.status({ fill: "green", shape: "dot", text: `login success | pools: ${activePoolCount()}` });
            }
            send(msg); done();
        }

        // ===== ON INPUT =====
        node.on('input', async (msg, send, done) => {
            node.status({ fill: "blue", shape: "dot", text: `processing... | pools: ${activePoolCount()}` });
            try {
                const op = (msg.operation || '').toLowerCase();
                if (op === 'create')   return await createAccount(msg, send, done);
                if (op === 'update')   return await updateAccount(msg, send, done);
                if (op === 'delete')   return await deleteAccount(msg, send, done);
                if (op === 'find')     return await findAccount(msg, send, done);
                if (op === 'findall')  return await findAllAccounts(msg, send, done);
                if (op === 'login')    return await loginAccount(msg, send, done);
                throw new Error("Unknown operation: " + op);
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: `${err.message} | pools: ${activePoolCount()}` });
                node.error(err);
                msg.payload = { success: false, error: err.message };
                send(msg); done();
            }
        });

        // ===== ON CLOSE =====
        node.on('close', function(removed, done) {
            releasePool(config, node);
            node.status({ fill: "grey", shape: "ring", text: `disconnected | pools: ${activePoolCount()}` });
            done();
        });
    }

    RED.nodes.registerType('DAQ-AccountManager', DAQAccountManagerNode);
};
