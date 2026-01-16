//
//  server.js
//  RewiredAudioStreamApp
//  Multi-Peer Signaling Server (Port 3535)
//

const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3535 }); // <-- CONFIRMED PORT 3535
const rooms = new Map();

console.log("[SERVER] Signaling Server v2.1 (Multi-Peer) Running on 3535");

wss.on('connection', ws => {
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
                    console.log(`[SERVER] Creating Room: ${myRoom}`);
                    rooms.set(myRoom, new Set());
                }
                
                ws.clientData = { ws, id: myId, name: myName, role: myRole };
                rooms.get(myRoom).add(ws.clientData);
                
                console.log(`[SERVER] ${myName} (${myRole}) joined ${myRoom}`);
                
                // 1. Send Roster to NEW user
                sendRoster(ws, myRoom);
                
                // 2. Announce NEW user to others
                broadcastToRoom(myRoom, {
                    type: 'user-joined',
                    id: myId,
                    name: myName,
                    role: myRole
                }, ws); 
            } 
            
            // --- SIGNALING (Targeted Relay) ---
            else if (myRoom && rooms.has(myRoom)) {
                if (msg.target) {
                    const targetClient = Array.from(rooms.get(myRoom)).find(c => c.id === msg.target);
                    if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                        targetClient.ws.send(JSON.stringify(msg));
                    }
                } else {
                    broadcastToRoom(myRoom, msg, ws);
                }
            }
        } catch(e) {
            console.error("[SERVER] Error parsing message:", e.message);
        }
    });

    ws.on('close', () => {
        if (myRoom && rooms.has(myRoom)) {
            const set = rooms.get(myRoom);
            if (ws.clientData) set.delete(ws.clientData);
            console.log(`[SERVER] ${myName} left ${myRoom}`);
            
            if (set.size === 0) {
                console.log(`[SERVER] Closing Room: ${myRoom}`);
                rooms.delete(myRoom);
            } else {
                broadcastToRoom(myRoom, { type: 'user-left', id: myId, name: myName }, null);
            }
        }
    });
});

function sendRoster(ws, room) {
    if (!rooms.has(room)) return;
    const users = Array.from(rooms.get(room)).map(c => ({
        id: c.id,
        name: c.name,
        role: c.role
    }));
    ws.send(JSON.stringify({ type: 'roster-update', roster: users }));
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
