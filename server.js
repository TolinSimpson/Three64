const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;

const wss = new WebSocketServer({ port: 8080 });

// Store connected clients: id -> ws
const clients = new Map();
let nextId = 1;

console.log("Three64 LAN Server started on port 8080");

wss.on('connection', function connection(ws) {
  const id = nextId++;
  const color = Math.floor(Math.random() * 0xffffff);
  console.log(`Client ${id} connected`);

  // Notify new client of their ID
  send(ws, { type: 'hello', id, color });

  // Notify existing clients of new player
  broadcast({ type: 'join', id, color }, ws);

  // Send existing clients to new player
  for (const [cid, cws] of clients) {
    if (cws.readyState === WebSocket.OPEN && cws.userData) {
      send(ws, { type: 'join', id: cid, color: cws.userData.color });
    }
  }

  clients.set(id, ws);
  ws.userData = { id, color };

  ws.on('message', function message(data) {
    try {
      // Relay updates to all other clients
      // We assume binary or JSON. If JSON string:
      const msg = JSON.parse(data);
      msg.id = id; // Ensure authoritative ID
      
      if (msg.type === 'state') {
        // Broadcast movement/state to others
        broadcast(msg, ws);
      }
    } catch (e) {
      // If binary, just relay? For now assume JSON.
    }
  });

  ws.on('close', function () {
    console.log(`Client ${id} disconnected`);
    clients.delete(id);
    broadcast({ type: 'leave', id });
  });
});

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg, excludeWs) {
  const payload = JSON.stringify(msg);
  for (const [id, ws] of clients) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

