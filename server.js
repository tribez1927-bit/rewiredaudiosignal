const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve the static HTML receiver page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Store connected peers
// This maintains the "Room Roster" state required by the app [cite: 208, 246]
let rooms = {}; 

wss.on('connection', (ws) => {
    let currentUser = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'join':
                // logic matches 'join' message in NwSessionCoordinator [cite: 222]
                currentUser = {
                    id: data.id,
                    name: data.name,
                    room: data.room,
                    role: data.role || 'receiver',
                    isMicEnabled: data.isMicEnabled || false,
                    isMusicEnabled: data.isMusicEnabled || true,
                    isBroadcasting: data.isBroadcasting || false,
                    ws: ws
                };

                if (!rooms[data.room]) rooms[data.room] = [];
                rooms[data.room].push(currentUser);

                console.log(`👤 ${currentUser.name} joined room: ${data.room}`);

                // Send full roster update to all in room [cite: 234, 246]
                broadcastRoster(data.room);
                break;

            case 'offer':
            case 'answer':
            case 'candidate':
                // Relay WebRTC signaling between Mac App and JS Receiver [cite: 242, 243, 244, 267]
                relayMessage(data);
                break;

            case 'status-update':
                // Update user state for UI meters/icons [cite: 219, 240]
                updateUserStatus(data);
                break;
        }
    });

    ws.on('close', () => {
        if (currentUser) {
            console.log(`👋 ${currentUser.name} left.`);
            rooms[currentUser.room] = rooms[currentUser.room].filter(u => u.id !== currentUser.id);
            broadcastRoster(currentUser.room); // [cite: 238]
        }
    });
});

function relayMessage(data) {
    const room = rooms[Object.keys(rooms).find(r => rooms[r].some(u => u.id === data.id))];
    if (!room) return;

    const target = room.find(u => u.id === data.targetId);
    if (target && target.ws.readyState === WebSocket.OPEN) {
        target.ws.send(JSON.stringify(data));
    }
}

function broadcastRoster(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    const rosterData = JSON.stringify({
        type: 'roster-update',
        roster: room.map(u => ({
            id: u.id,
            name: u.name,
            role: u.role,
            isMicEnabled: u.isMicEnabled,
            isMusicEnabled: u.isMusicEnabled,
            isBroadcasting: u.isBroadcasting
        }))
    });

    room.forEach(u => {
        if (u.ws.readyState === WebSocket.OPEN) {
            u.ws.send(rosterData);
        }
    });
}

function updateUserStatus(data) {
    const roomName = Object.keys(rooms).find(r => rooms[r].some(u => u.id === data.id));
    if (!roomName) return;

    const user = rooms[roomName].find(u => u.id === data.id);
    if (user) {
        user.isMicEnabled = data.isMicEnabled;
        user.isMusicEnabled = data.isMusicEnabled;
        broadcastRoster(roomName);
    }
}

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
