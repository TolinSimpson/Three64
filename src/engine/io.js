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


