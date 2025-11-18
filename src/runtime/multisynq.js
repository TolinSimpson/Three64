'use strict';
import { Vector3, Group } from "three";
import { ArchetypeRegistry } from "./component.js";

// Access global Multisynq object
const Multisynq = typeof window !== 'undefined' ? window.Multisynq : null;

let Three64Model;

if (Multisynq) {
  class _Three64Model extends Multisynq.Model {
    init() {
      this.players = {}; // { id: {x,y,z,yaw,color} }
      // Session-scoped events for joining/leaving views
      this.subscribe(this.sessionId, "view-join", this.onJoin);
      this.subscribe(this.sessionId, "view-exit", this.onExit);
    }

    onJoin({viewId, userData}) {
      const color = (userData && userData.color) || Math.floor(Math.random() * 0xffffff);
      this.players[viewId] = { x:0, y:0, z:0, yaw:0, color };
      
      // Notify all views
      this.publish(this.sessionId, "player-joined", { id: viewId, color });
      
      // Listen for updates from this specific view
      this.subscribe(viewId, "update-state", (data) => {
        const p = this.players[viewId];
        if (p) {
          p.x = data.x; p.y = data.y; p.z = data.z; p.yaw = data.yaw;
          // Broadcast to everyone
          this.publish(this.sessionId, "player-moved", { id: viewId, ...p });
        }
      });
    }

    onExit({viewId}) {
      delete this.players[viewId];
      this.publish(this.sessionId, "player-left", { id: viewId });
    }
  }
  Three64Model = _Three64Model;
  // Register with a unique ID
  Three64Model.register("Three64Model.v1");
}

export class MultisynqNetworkSystem {
  constructor(app) {
    this.app = app;
    this.connected = false;
    this.clientId = -1;
    this.updateRate = 1 / 20;
    this._timer = 0;
    this.remotePlayers = new Map(); // id -> { object, targetPos, targetYaw }
    this.view = null;
  }

  async connect(options = {}) {
    if (!Multisynq) {
      console.error("Multisynq SDK not loaded. Check your internet connection or index.html.");
      return;
    }

    const apiKey = options.apiKey || new URLSearchParams(window.location.search).get("key");
    const appId = options.appId || new URLSearchParams(window.location.search).get("id") || "io.multisynq.three64";

    if (!apiKey) {
      console.warn("Multisynq requires an API Key. Pass ?key=... in URL.");
      return;
    }

    try {
      this.view = await Multisynq.createSession({
        apiKey,
        appId,
        model: Three64Model,
        viewOptions: {
          userData: { color: Math.floor(Math.random() * 0xffffff) }
        }
      });

      this.clientId = this.view.myId;
      this.connected = true;
      console.log("[Multisynq] Connected. Client ID:", this.clientId);

      // Subscribe to Model events
      // Note: scope is the session ID for broadcast events
      const sessionScope = this.view.model.sessionId;
      this.view.subscribe(sessionScope, "player-joined", this._onPlayerJoin.bind(this));
      this.view.subscribe(sessionScope, "player-left", this._onPlayerLeft.bind(this));
      this.view.subscribe(sessionScope, "player-moved", this._onPlayerMoved.bind(this));

      // Initialize already existing players
      const players = this.view.model.players || {};
      for (const [pid, data] of Object.entries(players)) {
        if (pid !== this.clientId) {
          this._spawnRemotePlayer(pid, data.color);
          this._updateRemoteState({ id: pid, ...data });
        }
      }

    } catch (e) {
      console.error("[Multisynq] Connection failed:", e);
    }
  }

  update(dt) {
    if (!this.connected) return;

    // Send local state periodically
    this._timer += dt;
    if (this._timer >= this.updateRate) {
      this._timer = 0;
      this._sendLocalState();
    }

    // Interpolate remote players
    this._updateRemotePlayers(dt);
  }

  _sendLocalState() {
    const p = this.app.player;
    if (!p || !p.object) return;
    const pos = p.object.position;
    const rot = p.object.rotation;

    // Publish to model using my client ID as scope (Model is listening on this scope)
    this.view.publish(this.clientId, "update-state", {
      x: parseFloat(pos.x.toFixed(3)),
      y: parseFloat(pos.y.toFixed(3)),
      z: parseFloat(pos.z.toFixed(3)),
      yaw: parseFloat(rot.y.toFixed(3))
    });
  }

  _onPlayerJoin(msg) {
    if (msg.id === this.clientId) return;
    console.log("[Multisynq] Player joined:", msg.id);
    this._spawnRemotePlayer(msg.id, msg.color);
  }

  _onPlayerLeft(msg) {
    console.log("[Multisynq] Player left:", msg.id);
    this._removeRemotePlayer(msg.id);
  }

  _onPlayerMoved(msg) {
    if (msg.id === this.clientId) return;
    this._updateRemoteState(msg);
  }

  // --- Reusing logic from NetworkSystem ---

  _spawnRemotePlayer(id, colorInt) {
    if (this.remotePlayers.has(id)) return;
    
    // Try to use 'Player' archetype or fallback
    let obj = ArchetypeRegistry.create(this.app, 'Player'); 
    if (!obj) {
        obj = ArchetypeRegistry.create(this.app, 'crate') || new Group();
    }

    // Disable Player component logic
    if (obj.__components) {
        const pc = obj.__components.find(c => c.constructor.name === 'Player' || c.__typeName === 'Player');
        if (pc) pc._disabled = true;
    }

    // Visual override (color)
    if (colorInt && obj.traverse) {
        obj.traverse(c => {
            if (c.isMesh && c.material) {
                c.material = c.material.clone();
                c.material.color.setHex(colorInt);
            }
        });
    }

    this.app.rendererCore.scene.add(obj);
    
    this.remotePlayers.set(id, {
        id,
        object: obj,
        targetPos: new Vector3(),
        targetYaw: 0,
    });
  }

  _removeRemotePlayer(id) {
    const entry = this.remotePlayers.get(id);
    if (entry) {
        this.app.rendererCore.scene.remove(entry.object);
        this.remotePlayers.delete(id);
    }
  }

  _updateRemoteState(msg) {
    const entry = this.remotePlayers.get(msg.id);
    if (!entry) return;
    entry.targetPos.set(msg.x, msg.y, msg.z);
    entry.targetYaw = msg.yaw;
  }

  _updateRemotePlayers(dt) {
    const lerpFactor = Math.min(1, dt * 10);
    for (const entry of this.remotePlayers.values()) {
        if (!entry.object) continue;
        entry.object.position.lerp(entry.targetPos, lerpFactor);
        
        const current = entry.object.rotation.y;
        const target = entry.targetYaw;
        let delta = (target - current) % (Math.PI * 2);
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        
        entry.object.rotation.y += delta * lerpFactor;
    }
  }
}

