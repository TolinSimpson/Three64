// Basic IO helpers for the engine (browser-safe)
// - Network JSON fetch
// - Local storage save/load
// - Download JSON to file

export async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load JSON: ${url}`);
  return await res.json();
}

export function saveLocal(key, data) {
  try {
    const json = JSON.stringify(data);
    window.localStorage.setItem(key, json);
    return true;
  } catch (e) {
    console.warn("saveLocal failed:", key, e);
    return false;
  }
}

export function loadLocal(key, fallback = null) {
  try {
    const json = window.localStorage.getItem(key);
    if (json == null) return fallback;
    return JSON.parse(json);
  } catch (e) {
    console.warn("loadLocal failed:", key, e);
    return fallback;
  }
}

export function downloadJSON(filename, data) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "data.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.warn("downloadJSON failed:", filename, e);
  }
}

// Component serialization helpers
export function serializeComponents(game) {
  try {
    const items = [];
    const list = game?.componentInstances || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c && typeof c.Serialize === "function") {
        const item = c.Serialize();
        if (item && item.objectId && item.type) items.push(item);
      }
    }
    return items;
  } catch (e) {
    console.warn("serializeComponents failed:", e);
    return [];
  }
}

export function deserializeComponents(game, items) {
  if (!Array.isArray(items) || !game) return 0;
  let applied = 0;
  const list = game.componentInstances || [];
  const norm = (s) => String(s || "").replace(/[\s\-_]/g, "").toLowerCase();
  for (const it of items) {
    const targetId = it?.objectId;
    const type = it?.type;
    if (!targetId || !type) continue;
    const targetType = norm(type);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || !c.object) continue;
      const cid = c.object.userData?.saveId || c.object.uuid;
      if (cid !== targetId) continue;
      const cname = norm(c.propName || c.__typeName || c.constructor?.name);
      if (cname !== targetType) continue;
      try {
        if (typeof c.Deserialize === "function") {
          c.Deserialize(it.data || {});
          applied += 1;
        }
      } catch (e) {
        console.warn("deserializeComponents failed for", type, "on", targetId, e);
      }
    }
  }
  return applied;
}


