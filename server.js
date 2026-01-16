const WebSocket = require('ws');

// Use Render's Environment Port (Critical for deployment)
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map();

console.log(`[SERVER] Signaling Server v2.3 (Logged) Running on ${PORT}`);

wss.on('connection', (ws, req) => {
    // 1. EXTRACT IP ADDRESS
    // Render passes the real client IP in 'x-forwarded-for'. 
    // It can be a list (e.g. "client, proxy1, proxy2"), so we take the first one.
    let clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    
    // Clean up IPv6 prefix if present (::ffff:)
    if (clientIp.includes('::ffff:')) {
        clientIp = clientIp.replace('::ffff:', '');
    }

    console.log(`[CONNECTION] New socket connected from: ${clientIp}`);

    let myRoom = null;
    let myId = null;
    let myName = "Unknown";
    let myRole = "listener";

    ws.on('message', message => {
        try {
            const msg = JSON.parse(message);
            
            // --- JOIN ---
            if (msg.type === 'join') {
                myRoom = msg.room;
                myId = msg.id; 
                myName = msg.name || "Anonymous";
                myRole = msg.role || "listener";
                
                if (!rooms.has(myRoom)) {
                    console.log(`[ROOM] [${clientIp}] Creating Room: ${myRoom}`);
                    rooms.set(myRoom, new Set());
                }
                
                // Store user data directly on the socket
                ws.clientData = { ws, id: myId, name: myName, role: myRole, ip: clientIp };
                rooms.get(myRoom).add(ws.clientData);
                
                // LOG: Detailed Join Info
                console.log(`[JOIN] [${clientIp}] User: "${myName}" (ID: ${myId}) | Role: ${myRole} | Room: ${myRoom}`);
                
                // Broadcast FULL roster
                broadcastRoster(myRoom);
            } 
            
            // --- SIGNALING (Targeted Relay) ---
            else if (myRoom && rooms.has(myRoom)) {
                if (msg.target) {
                    const roomUsers = rooms.get(myRoom);
                    const targetClient = Array.from(roomUsers).find(c => c.id === msg.target);
                    if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                        targetClient.ws.send(JSON.stringify(msg));
                        // Optional: Log signals (can be spammy, maybe keep commented out unless debugging)
                        // console.log(`[SIGNAL] [${clientIp}] ${msg.type} -> ${targetClient.name} (${targetClient.ip})`);
                    }
                } else {
                    broadcastToRoom(myRoom, msg, ws);
                }
            }
        } catch(e) {
            console.error(`[ERROR] [${clientIp}] Error parsing message: ${e.message}`);
        }
    });

    // --- CLEANUP ---
    ws.on('close', () => {
        if (myRoom && rooms.has(myRoom)) {
            const roomUsers = rooms.get(myRoom);
            
            if (ws.clientData) {
                roomUsers.delete(ws.clientData);
            }
            
            console.log(`[LEAVE] [${clientIp}] User: "${myName}" (ID: ${myId}) left Room: ${myRoom}`);
            
            if (roomUsers.size === 0) {
                console.log(`[ROOM] Room empty. Closing: ${myRoom}`);
                rooms.delete(myRoom);
            } else {
                broadcastRoster(myRoom);
            }
        } else {
             console.log(`[DISCONNECT] [${clientIp}] Socket closed (No room joined)`);
        }
    });
});

function broadcastRoster(room) {
    if (!rooms.has(room)) return;
    
    const roomUsers = rooms.get(room);
    const rosterList = Array.from(roomUsers).map(c => ({
        id: c.id,
        name: c.name,
        role: c.role
    }));

    const message = JSON.stringify({ 
        type: 'roster-update', 
        roster: rosterList 
    });

    roomUsers.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

function broadcastToRoom(room, msg, excludeWs) {
    if (!rooms.has(room)) return;
    const json = JSON.stringify(msg);
    rooms.get(room).forEach(client => {
        if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(json);
        }
    });
}
