/**
 * Local Hub WebSocket Server
 * Provides peer-to-peer communication for offline classroom collaboration
 */

const WebSocket = require('ws');
const http = require('http');
const os = require('os');

// Configuration
const PORT = process.env.PORT || 8080;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const CLEANUP_INTERVAL = 60000; // 1 minute
const SESSION_TIMEOUT = 3600000; // 1 hour

// Server state
const classroomData = new Map(); // Stores all quiz responses
const connectedClients = new Map(); // Track connected clients
const sessionData = {
    startTime: Date.now(),
    totalConnections: 0,
    activeUsers: new Set(),
    responses: new Map() // questionId -> Map of userId -> response
};

// Create HTTP server
const server = http.createServer((req, res) => {
    // Basic HTTP endpoint for health check
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            clients: connectedClients.size,
            uptime: Date.now() - sessionData.startTime,
            activeUsers: sessionData.activeUsers.size
        }));
    } else if (req.url === '/info') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
                <head><title>AP Stats Local Hub</title></head>
                <body style="font-family: Arial, sans-serif; padding: 20px;">
                    <h1>🏠 AP Statistics Local Hub Server</h1>
                    <p><strong>Status:</strong> Running</p>
                    <p><strong>Local IP:</strong> ${getLocalIP()}</p>
                    <p><strong>Port:</strong> ${PORT}</p>
                    <p><strong>WebSocket URL:</strong> ws://${getLocalIP()}:${PORT}</p>
                    <p><strong>Connected Clients:</strong> ${connectedClients.size}</p>
                    <p><strong>Active Users:</strong> ${sessionData.activeUsers.size}</p>
                    <p><strong>Uptime:</strong> ${Math.floor((Date.now() - sessionData.startTime) / 1000)} seconds</p>
                    <hr>
                    <p style="color: #666;">Students should enter this IP in their browser when offline: <strong>${getLocalIP()}:${PORT}</strong></p>
                </body>
            </html>
        `);
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and IPv6 addresses
            if (!iface.internal && iface.family === 'IPv4') {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Broadcast message to all clients except sender
function broadcast(message, senderWs = null) {
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);

    wss.clients.forEach(client => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}

// Send message to specific client
function sendToClient(clientWs, message) {
    if (clientWs.readyState === WebSocket.OPEN) {
        const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
        clientWs.send(messageStr);
    }
}

// Handle client connection
wss.on('connection', (ws, req) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const clientInfo = {
        id: clientId,
        connectedAt: Date.now(),
        ip: req.socket.remoteAddress,
        userId: null,
        displayName: null,
        isAlive: true
    };

    connectedClients.set(ws, clientInfo);
    sessionData.totalConnections++;

    console.log(`[CONNECT] New client connected: ${clientId} from ${clientInfo.ip}`);

    // Send welcome message
    sendToClient(ws, {
        type: 'welcome',
        clientId: clientId,
        serverTime: Date.now(),
        connectedClients: sessionData.activeUsers.size,
        message: 'Connected to Local Hub successfully'
    });

    // Send current classroom data to new client
    if (sessionData.responses.size > 0) {
        const existingData = [];
        sessionData.responses.forEach((userResponses, questionId) => {
            userResponses.forEach((response, userId) => {
                existingData.push({
                    type: 'peer_response',
                    ...response
                });
            });
        });

        if (existingData.length > 0) {
            sendToClient(ws, {
                type: 'bulk_update',
                responses: existingData,
                message: 'Syncing existing classroom data'
            });
        }
    }

    // Handle messages from client
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleClientMessage(ws, message, clientInfo);
        } catch (error) {
            console.error(`[ERROR] Failed to parse message from ${clientId}:`, error);
            sendToClient(ws, {
                type: 'error',
                message: 'Invalid message format'
            });
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        console.log(`[DISCONNECT] Client disconnected: ${clientId}`);

        if (clientInfo.userId) {
            sessionData.activeUsers.delete(clientInfo.userId);

            // Notify other clients about user disconnect
            broadcast({
                type: 'user_disconnected',
                userId: clientInfo.userId,
                displayName: clientInfo.displayName,
                activeUsers: sessionData.activeUsers.size
            }, ws);
        }

        connectedClients.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error(`[ERROR] WebSocket error for ${clientId}:`, error);
    });

    // Heartbeat for connection monitoring
    ws.on('pong', () => {
        clientInfo.isAlive = true;
    });
});

// Handle different message types
function handleClientMessage(ws, message, clientInfo) {
    switch (message.type) {
        case 'identify':
            // User identification
            clientInfo.userId = message.userId;
            clientInfo.displayName = message.displayName;
            sessionData.activeUsers.add(message.userId);

            console.log(`[IDENTIFY] User ${message.displayName} (${message.userId}) identified`);

            // Notify all clients about new user
            broadcast({
                type: 'user_joined',
                userId: message.userId,
                displayName: message.displayName,
                activeUsers: sessionData.activeUsers.size
            });

            // Send acknowledgment
            sendToClient(ws, {
                type: 'identified',
                success: true,
                activeUsers: Array.from(sessionData.activeUsers)
            });
            break;

        case 'submit_response':
            // Handle quiz response submission
            const { questionId, answer, reason, userId, displayName, timestamp } = message;

            // Store response in session data
            if (!sessionData.responses.has(questionId)) {
                sessionData.responses.set(questionId, new Map());
            }
            sessionData.responses.get(questionId).set(userId, {
                questionId,
                answer,
                reason,
                userId,
                displayName,
                timestamp: timestamp || Date.now()
            });

            console.log(`[RESPONSE] User ${displayName} submitted answer for question ${questionId}`);

            // Broadcast to all other clients
            broadcast({
                type: 'peer_response',
                questionId,
                answer,
                reason,
                userId,
                displayName,
                timestamp: timestamp || Date.now()
            }, ws);

            // Send confirmation to sender
            sendToClient(ws, {
                type: 'response_confirmed',
                questionId,
                success: true
            });
            break;

        case 'request_sync':
            // Client requesting full data sync
            console.log(`[SYNC] User ${clientInfo.displayName} requested data sync`);

            const syncData = [];
            sessionData.responses.forEach((userResponses, qId) => {
                userResponses.forEach((response, uId) => {
                    syncData.push(response);
                });
            });

            sendToClient(ws, {
                type: 'sync_response',
                responses: syncData,
                activeUsers: Array.from(sessionData.activeUsers),
                timestamp: Date.now()
            });
            break;

        case 'ping':
            // Respond to ping
            sendToClient(ws, {
                type: 'pong',
                timestamp: Date.now()
            });
            break;

        case 'get_stats':
            // Send server statistics
            sendToClient(ws, {
                type: 'stats',
                connectedClients: connectedClients.size,
                activeUsers: sessionData.activeUsers.size,
                totalResponses: Array.from(sessionData.responses.values())
                    .reduce((sum, map) => sum + map.size, 0),
                uptime: Date.now() - sessionData.startTime
            });
            break;

        default:
            console.log(`[UNKNOWN] Unknown message type: ${message.type}`);
            sendToClient(ws, {
                type: 'error',
                message: `Unknown message type: ${message.type}`
            });
    }
}

// Heartbeat interval to check connection health
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(ws => {
        const clientInfo = connectedClients.get(ws);
        if (clientInfo && !clientInfo.isAlive) {
            console.log(`[HEARTBEAT] Terminating inactive client: ${clientInfo.id}`);
            ws.terminate();
            return;
        }

        if (clientInfo) {
            clientInfo.isAlive = false;
        }
        ws.ping();
    });
}, HEARTBEAT_INTERVAL);

// Cleanup old data periodically
const cleanupInterval = setInterval(() => {
    // Remove responses older than session timeout
    const cutoffTime = Date.now() - SESSION_TIMEOUT;
    let removedCount = 0;

    sessionData.responses.forEach((userResponses, questionId) => {
        userResponses.forEach((response, userId) => {
            if (response.timestamp < cutoffTime) {
                userResponses.delete(userId);
                removedCount++;
            }
        });

        if (userResponses.size === 0) {
            sessionData.responses.delete(questionId);
        }
    });

    if (removedCount > 0) {
        console.log(`[CLEANUP] Removed ${removedCount} old responses`);
    }
}, CLEANUP_INTERVAL);

// Handle server shutdown
process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Shutting down server...');

    clearInterval(heartbeatInterval);
    clearInterval(cleanupInterval);

    // Notify all clients
    broadcast({
        type: 'server_shutdown',
        message: 'Local Hub server is shutting down'
    });

    // Close all connections
    wss.clients.forEach(ws => {
        ws.close();
    });

    server.close(() => {
        console.log('[SHUTDOWN] Server closed');
        process.exit(0);
    });

    // Force exit after 5 seconds
    setTimeout(() => {
        console.log('[SHUTDOWN] Forced exit');
        process.exit(0);
    }, 5000);
});

// Start server
server.listen(PORT, () => {
    const localIP = getLocalIP();
    console.log('===========================================');
    console.log('🚀 AP Statistics Local Hub Server Started');
    console.log('===========================================');
    console.log(`📡 WebSocket Server: ws://${localIP}:${PORT}`);
    console.log(`🌐 Web Interface: http://${localIP}:${PORT}/info`);
    console.log(`💻 Local Access: http://localhost:${PORT}/info`);
    console.log('===========================================');
    console.log('Share this IP with students:');
    console.log(`   ${localIP}:${PORT}`);
    console.log('===========================================');
    console.log('Press Ctrl+C to stop the server\n');
});