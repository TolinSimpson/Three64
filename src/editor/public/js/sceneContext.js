/**
 * sceneContext.js - Scans the scene graph to build live cross-reference lists
 * for hinted dropdowns in the property editor.
 *
 * Lists built:
 *   componentTypes   - from /api/components (set externally via setComponentDefs)
 *   statisticNames   - from Statistic components' "name" param
 *   eventNames       - from events.* param values across all components
 *   archetypeNames   - from *Archetype params + userData.archetype
 *   objectNames      - from scene graph object.name
 *   tagNames         - from tags / *Tag params
 */
import { readComponents } from './userData.js';

export class SceneContext {
  /** @param {import('./viewport.js').Viewport} viewport */
  constructor(viewport) {
    this.viewport = viewport;

    /** @type {string[]} */ this.componentTypes  = [];
    /** @type {string[]} */ this.statisticNames  = [];
    /** @type {string[]} */ this.eventNames      = [];
    /** @type {string[]} */ this.archetypeNames  = [];
    /** @type {string[]} */ this.objectNames     = [];
    /** @type {string[]} */ this.tagNames        = [];
  }

  /**
   * Populate the component-type list from definitions fetched via /api/components.
   * @param {Array<{type:string}>} defs
   */
  setComponentDefs(defs) {
    this.componentTypes = defs.map(d => d.type).sort();
  }

  /** Re-scan the scene graph and rebuild all scene-derived lists. */
  rebuild() {
    const stats      = new Set();
    const events     = new Set();
    const archetypes = new Set(['Projectile']);  // known engine default
    const names      = new Set();
    const tags       = new Set();

    const root = this.viewport.sceneRoot;
    if (!root) return;

    root.traverse((obj) => {
      // Object names
      if (obj.name && obj.name !== 'SceneRoot') names.add(obj.name);

      // Archetype declared directly on userData
      if (obj.userData?.archetype) archetypes.add(obj.userData.archetype);

      // Read component instances from userData
      const comps = readComponents(obj.userData);
      for (const comp of comps) {
        const p = comp.params || {};

        // Statistic names
        if ((comp.type === 'Statistic' || comp.type === 'StatisticBar') && p.name) {
          stats.add(p.name);
        }

        // Walk all params for events, archetypes, tags
        this._collectFromParams(p, events, archetypes, tags);
      }
    });

    this.statisticNames  = [...stats].sort();
    this.eventNames      = [...events].sort();
    this.archetypeNames  = [...archetypes].sort();
    this.objectNames     = [...names].sort();
    this.tagNames        = [...tags].sort();
  }

  /**
   * Recursively walk a params object to collect event names, archetypes, and tags.
   * @private
   */
  _collectFromParams(params, events, archetypes, tags) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return;

    for (const [key, val] of Object.entries(params)) {
      // events sub-object  -->  collect all string values
      if (key === 'events' && val && typeof val === 'object' && !Array.isArray(val)) {
        for (const v of Object.values(val)) {
          if (typeof v === 'string' && v) events.add(v);
        }
        continue;
      }

      // *Archetype / *archetype
      if (/archetype$/i.test(key) && typeof val === 'string' && val) {
        archetypes.add(val);
      }

      // tags (may be comma-separated) or *Tag
      if ((key === 'tags' || /Tag$/i.test(key)) && typeof val === 'string' && val) {
        for (const t of val.split(',')) {
          const trimmed = t.trim();
          if (trimmed) tags.add(trimmed);
        }
      }

      // Recurse into nested objects (e.g. BehaviorFSM states with waypointTag)
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        this._collectFromParams(val, events, archetypes, tags);
      }
    }
  }
}

// ============================================================
// Hint resolution
// ============================================================

/**
 * Determine which SceneContext list (if any) should supply hints for a given
 * component param key.  Returns the property name on SceneContext, or null.
 *
 * @param {string} componentType  e.g. "Volume", "Agent"
 * @param {string} key            dotted param key, e.g. "events.onEnter"
 * @param {object} [desc]         paramDescription entry (may carry explicit `hint`)
 * @returns {string|null}
 */
export function resolveHint(componentType, key, desc) {
  // Explicit hint in paramDescription takes top priority
  if (desc?.hint) return desc.hint;

  // events.*
  if (/^events\./i.test(key)) return 'eventNames';

  // *Archetype
  if (/Archetype$/i.test(key)) return 'archetypeNames';

  // filters.hasComponent
  if (key === 'filters.hasComponent') return 'componentTypes';

  // "name" on Statistic or StatisticBar
  if (key === 'name' && /^Statistic(Bar)?$/i.test(componentType)) return 'statisticNames';

  // objectName, targetName, filters.nameEquals, target.names
  if (/objectName$/i.test(key) || /targetName$/i.test(key) ||
      key === 'filters.nameEquals' || key === 'target.names') {
    return 'objectNames';
  }

  // *Tag or tags
  if (/Tag$/i.test(key) || key === 'tags') return 'tagNames';

  return null;
}
