'use strict';
import { Vector3, Quaternion, Euler, Group } from "three";
import { ArchetypeRegistry } from "./component.js";

export class NetworkSystem {
  constructor(app) {
    this.app = app;
    this.ws = null;
    this.connected = false;
    this.clientId = -1;
    this.updateRate = 1 / 20; // Send 20 times/sec
    this._timer = 0;
    this.remotePlayers = new Map(); // id -> { object, targetPos, targetYaw }
  }

  connect(url = "ws://localhost:8080") {
    if (this.ws) this.ws.close();
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        console.log("[Network] Connected");
        this.connected = true;
      };
      this.ws.onmessage = (ev) => this._onMessage(ev);
      this.ws.onclose = () => {
        console.log("[Network] Disconnected");
        this.connected = false;
        this._cleanup();
      };
    } catch (e) {
      console.warn("[Network] Connection failed", e);
    }
  }

  update(dt) {
    if (!this.connected) return;

    // 1. Send local state
    this._timer += dt;
    if (this._timer >= this.updateRate) {
      this._timer = 0;
      this._sendLocalState();
    }

    // 2. Interpolate remote players
    this._updateRemotePlayers(dt);
  }

  _sendLocalState() {
    const p = this.app.player;
    if (!p || !p.object) return;
    
    // Get pos/rot
    const pos = p.object.position;
    const rot = p.object.rotation; // Euler
    
    const msg = {
      type: 'state',
      x: parseFloat(pos.x.toFixed(3)),
      y: parseFloat(pos.y.toFixed(3)),
      z: parseFloat(pos.z.toFixed(3)),
      yaw: parseFloat(rot.y.toFixed(3))
    };
    this.ws.send(JSON.stringify(msg));
  }

  _onMessage(ev) {
    try {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'hello':
          this.clientId = msg.id;
          console.log("Assigned Client ID:", this.clientId);
          break;
        case 'join':
          this._spawnRemotePlayer(msg.id, msg.color);
          break;
        case 'leave':
          this._removeRemotePlayer(msg.id);
          break;
        case 'state':
          this._updateRemoteState(msg);
          break;
      }
    } catch (e) {
      console.error("Net parse error", e);
    }
  }

  _spawnRemotePlayer(id, colorInt) {
    if (this.remotePlayers.has(id)) return;
    console.log(`Spawning remote player ${id}`);
    
    // Try to use 'Player' archetype or fallback to a box/agent
    // We usually want a distinct visual for remotes. 
    // For now, spawn a 'Player' but strip the 'Player' component so it doesn't accept input.
    const name = 'RemotePlayer'; 
    let obj = ArchetypeRegistry.create(this.app, 'Player'); 
    
    if (!obj) {
        // Fallback if Player archetype not found
        obj = ArchetypeRegistry.create(this.app, 'crate') || new Group();
    }

    // Remove Player component logic from the remote instance to prevent it from reading local input
    // or just disable it.
    if (obj.__components) {
        const pc = obj.__components.find(c => c.constructor.name === 'Player' || c.__typeName === 'Player');
        if (pc) {
            pc._disabled = true; // We added this flag in Player component
            // Or remove it entirely
            // this.app.removeComponent(pc); 
        }
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

    // Add to scene
    this.app.rendererCore.scene.add(obj);
    
    this.remotePlayers.set(id, {
        id,
        object: obj,
        targetPos: new Vector3(),
        targetYaw: 0,
        velocity: new Vector3()
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
    
    // Simple snapshot interpolation target
    entry.targetPos.set(msg.x, msg.y, msg.z);
    entry.targetYaw = msg.yaw;
  }

  _updateRemotePlayers(dt) {
    const lerpFactor = Math.min(1, dt * 10); // smooth factor
    for (const entry of this.remotePlayers.values()) {
        if (!entry.object) continue;
        
        // Interpolate position
        entry.object.position.lerp(entry.targetPos, lerpFactor);
        
        // Interpolate yaw
        // Simplistic lerp, ideally use shortest arc
        const current = entry.object.rotation.y;
        const target = entry.targetYaw;
        // Shortest arc
        let delta = (target - current) % (Math.PI * 2);
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        
        entry.object.rotation.y += delta * lerpFactor;
    }
  }

  _cleanup() {
    for (const id of this.remotePlayers.keys()) {
        this._removeRemotePlayer(id);
    }
  }
}

