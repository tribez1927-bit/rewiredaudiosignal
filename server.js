// server.js - Rock Solid Signaling with State Persistence
const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

// State Store: Map<roomId, Map<userId, UserObject>>
const rooms = new Map();

wss.on('connection', (ws) => {
    let currentUser = { id: null, room: null };
    ws.isAlive = true;
    
    // Heartbeat: responding to server pings
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch (e) { return; }

        switch (msg.type) {
            case 'join':
                handleJoin(ws, msg, currentUser);
                break;
                
            case 'status-update':
                handleStatusUpdate(currentUser, msg);
                break;
                
            case 'offer':
            case 'answer':
            case 'candidate':
                // Relay WebRTC signals to the specific target peer
                // If 'target' is missing (broadcast), send to all except sender
                relaySignal(currentUser, msg);
                break;
                
            case 'leave':
                handleDisconnect(currentUser);
                break;
        }
    });

    ws.on('close', () => {
        handleDisconnect(currentUser);
    });
});

function handleJoin(ws, msg, userContext) {
    const { room, id, name, role, isMicEnabled, isBroadcasting } = msg;
    userContext.id = id;
    userContext.room = room;

    if (!rooms.has(room)) rooms.set(room, new Map());
    const roomUsers = rooms.get(room);

    // 1. Store the new user state
    const userData = { 
        ws, id, name, role, 
        isMicEnabled: isMicEnabled ?? true, 
        isBroadcasting: isBroadcasting ?? false 
    };
    roomUsers.set(id, userData);

    // 2. Send FULL ROSTER to the new joiner (Snapshot)
    const fullRoster = Array.from(roomUsers.values()).map(u => ({
        id: u.id, name: u.name, role: u.role,
        isMicEnabled: u.isMicEnabled,
        isBroadcasting: u.isBroadcasting
    }));
    
    ws.send(JSON.stringify({
        type: 'roster-update',
        roster: fullRoster
    }));

    // 3. Notify OTHERS that a user joined (Incremental Update)
    broadcastToRoom(room, id, {
        type: 'user-joined',
        id, name, role,
        isMicEnabled: userData.isMicEnabled,
        isBroadcasting: userData.isBroadcasting
    });
}

function handleStatusUpdate(userContext, msg) {
    const roomUsers = rooms.get(userContext.room);
    if (!roomUsers || !roomUsers.has(userContext.id)) return;

    const user = roomUsers.get(userContext.id);
    // Update local state
    if (msg.isMicEnabled !== undefined) user.isMicEnabled = msg.isMicEnabled;
    if (msg.isBroadcasting !== undefined) user.isBroadcasting = msg.isBroadcasting;

    // Broadcast update to room
    broadcastToRoom(userContext.room, userContext.id, {
        type: 'status-update',
        id: userContext.id,
        isMicEnabled: user.isMicEnabled,
        isBroadcasting: user.isBroadcasting
    });
}

function handleDisconnect(userContext) {
    if (!userContext.room || !userContext.id) return;
    
    const roomUsers = rooms.get(userContext.room);
    if (roomUsers) {
        roomUsers.delete(userContext.id);
        broadcastToRoom(userContext.room, userContext.id, {
            type: 'user-left',
            id: userContext.id
        });
        
        if (roomUsers.size === 0) rooms.delete(userContext.room);
    }
    userContext.id = null;
    userContext.room = null;
}

function relaySignal(currentUser, msg) {
    // If the message has a specific 'targetId', send only to them
    const roomUsers = rooms.get(currentUser.room);
    if (!roomUsers) return;

    if (msg.targetId) {
        const target = roomUsers.get(msg.targetId);
        if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify(msg));
        }
    } else {
        // Fallback: Broadcast to everyone else (for legacy/mesh compatibility)
        broadcastToRoom(currentUser.room, currentUser.id, msg);
    }
}

function broadcastToRoom(roomName, senderId, msg) {
    const roomUsers = rooms.get(roomName);
    if (!roomUsers) return;

    const json = JSON.stringify(msg);
    for (const [id, user] of roomUsers) {
        if (id !== senderId && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(json);
        }
    }
}

// Heartbeat Interval (30s)
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

console.log(`Server running on port ${port}`);
