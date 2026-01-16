const WebSocket = require('ws');

// Use Render's Environment Port
const PORT = process.env.PORT || 3535;
const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map();

console.log(`[SERVER] Signaling Server v2.4 (Debug Candidates) Running on ${PORT}`);

wss.on('connection', (ws, req) => {
    // 1. IP Extraction
    let clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    if (clientIp.includes('::ffff:')) clientIp = clientIp.replace('::ffff:', '');

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
                
                ws.clientData = { ws, id: myId, name: myName, role: myRole, ip: clientIp };
                rooms.get(myRoom).add(ws.clientData);
                
                console.log(`[JOIN] [${clientIp}] User: "${myName}" (ID: ${myId}) | Role: ${myRole} | Room: ${myRoom}`);
                broadcastRoster(myRoom);
            } 
            
            // --- SIGNALING (Targeted Relay) ---
            else if (myRoom && rooms.has(myRoom)) {
                if (msg.target) {
                    const roomUsers = rooms.get(myRoom);
                    const targetClient = Array.from(roomUsers).find(c => c.id === msg.target);
                    
                    if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                        
                        // --- NEW: LOGGING ICE CANDIDATES & SDP ---
                        if (msg.type === 'candidate') {
                            console.log(`\n[ICE CANDIDATE] ${myName} -> ${targetClient.name}`);
                            // This outputs the exact structure you asked for
                            console.log(JSON.stringify(msg, null, 2)); 
                        } 
                        else if (msg.type === 'offer' || msg.type === 'answer') {
                            console.log(`\n[${msg.type.toUpperCase()}] ${myName} -> ${targetClient.name}`);
                            // Logging just the type and target to avoid 50 lines of SDP spam, 
                            // but enough to know the handshake is working.
                            console.log(JSON.stringify({ 
                                type: msg.type, 
                                target: msg.target, 
                                sdpSummary: "..." + msg.sdp.substring(0, 50) + "..." 
                            }, null, 2));
                        }

                        // Relay the message
                        targetClient.ws.send(JSON.stringify(msg));
                    } else {
                        console.warn(`[WARN] Target "${msg.target}" not found or offline.`);
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
            if (ws.clientData) roomUsers.delete(ws.clientData);
            
            console.log(`[LEAVE] [${clientIp}] ${myName} left ${myRoom}`);
            
            if (roomUsers.size === 0) {
                console.log(`[ROOM] Room empty. Closing: ${myRoom}`);
                rooms.delete(myRoom);
            } else {
                broadcastRoster(myRoom);
            }
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

    const message = JSON.stringify({ type: 'roster-update', roster: rosterList });
    roomUsers.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) client.ws.send(message);
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
