bl_info = {
	"name": "Three64 Component Data",
	"author": "Three64",
	"version": (1, 0, 0),
	"blender": (4, 3, 0),
	"location": "Properties > Object > Three64 Component",
	"description": "Loads JSON component descriptors and exposes a dropdown on selected objects.",
	"category": "Object",
}

from typing import Any, Dict, List, Tuple, cast
try:
	bpy = __import__("bpy")  # pyright: ignore[reportMissingImports]
except Exception:
	bpy = cast(Any, None)  # type: ignore
import os
import json
import math
import re

try:
	import bmesh  # pyright: ignore[reportMissingImports]
except Exception:
	bmesh = cast(Any, None)  # type: ignore

# Cached items to avoid re-parsing on every draw
_cached_items: List[Tuple[str, str, str]] = []
_cached_dir_abs: str = ""
_cached_index: Dict[str, str] = {}
_cached_param_desc: Dict[str, Dict[str, str]] = {}
_cached_param_types: Dict[str, Dict[str, str]] = {}
_cached_param_enums: Dict[str, Dict[str, List[str]]] = {}
_dyn_enum_pids: List[str] = []

def _axis_name_to_index(name: str) -> int:
	try:
		l = name.lower()
		if l == "x": return 0
		if l == "y": return 1
		if l == "z": return 2
		if l == "w": return 3
		return -1
	except Exception:
		return -1

def _flatten_params(params: Any, prefix: str = "") -> Dict[str, Any]:
	"""
	Convert nested dicts/lists into a flat map of dotted keys -> primitive values
	- Dict: a.b.c
	- List/Tuple: a.0, a.1, ... ; special-case 3/4-length numeric vectors to a.x, a.y, a.z, a.w
	"""
	out: Dict[str, Any] = {}
	try:
		base = prefix + "." if prefix else ""
		if isinstance(params, dict):
			for k, v in params.items():
				if not isinstance(k, str):
					continue
				nk = base + k
				if isinstance(v, (str, int, float, bool)) or v is None:
					out[nk] = "" if v is None else v
				elif isinstance(v, (list, tuple)):
					# Heuristic: if length is 3/4 and all are numbers, emit axis names
					use_axes = len(v) in (3, 4) and all(isinstance(x, (int, float)) for x in v)
					for idx, item in enumerate(v):
						suffix = ("x","y","z","w")[idx] if use_axes else str(idx)
						key = f"{nk}.{suffix}"
						if isinstance(item, (str, int, float, bool)) or item is None:
							out[key] = "" if item is None else item
						else:
							# Deeply nested in arrays -> fall back to JSON for that leaf
							try:
								out[key] = json.dumps(item)
							except Exception:
								out[key] = str(item)
				else:
					# Object that is not a primitive/array -> recurse if possible, else JSON-string
					if isinstance(v, dict):
						out.update(_flatten_params(v, nk))
					else:
						try:
							out[nk] = json.dumps(v)
						except Exception:
							out[nk] = str(v)
		else:
			# Non-dict root: store as-is (rare)
			out[prefix or "value"] = params
	except Exception:
		pass
	return out

def _tooltip_for_flat_key(param_tooltips: Dict[str, str], flat_key: str) -> str:
	"""
	Find the best tooltip for a dotted flat key by trying exact match, then walking up parents.
	"""
	try:
		if flat_key in param_tooltips:
			return param_tooltips[flat_key]
		parts = flat_key.split(".")
		while len(parts) > 1:
			parts = parts[:-1]
			parent = ".".join(parts)
			if parent in param_tooltips:
				return param_tooltips[parent]
	except Exception:
		pass
	return ""

def _hex_from_value(v: Any) -> str:
	try:
		# Already hex string
		if isinstance(v, str):
			s = v.strip()
			if s.startswith("#"):
				s = s[1:]
			if s.lower().startswith("0x"):
				s = s[2:]
			# Keep only hex digits and clamp
			s = "".join(ch for ch in s if ch.lower() in "0123456789abcdef")[:6].ljust(6, "0")
			return f"#{s.lower()}"
		# Numeric to hex
		if isinstance(v, (int, float)):
			n = int(v)
			if n < 0: n = 0
			if n > 0xFFFFFF: n = 0xFFFFFF
			return f"#{n:06x}"
	except Exception:
		pass
	# Fallback
	return "#000000"

def _rgb_tuple_from_hex(s: Any) -> tuple:
	try:
		if not isinstance(s, str):
			return (1.0, 1.0, 1.0)
		t = s.strip()
		if t.startswith("#"):
			t = t[1:]
		if t.lower().startswith("0x"):
			t = t[2:]
		t = "".join(ch for ch in t if ch.lower() in "0123456789abcdef")[:6].rjust(6, "0")
		n = int(t, 16)
		r = ((n >> 16) & 0xFF) / 255.0
		g = ((n >> 8) & 0xFF) / 255.0
		b = (n & 0xFF) / 255.0
		return (r, g, b)
	except Exception:
		return (1.0, 1.0, 1.0)

def _is_color_key(identifier: str, flat_key: str) -> bool:
	try:
		tmap = _cached_param_types.get(identifier, {})
		t = tmap.get(flat_key)
		if isinstance(t, str) and t.lower() == "color":
			return True
		# Heuristic fallback
		lk = flat_key.lower()
		return lk.endswith("color") or ".color" in lk
	except Exception:
		return False

def _is_enum_key(identifier: str, flat_key: str) -> bool:
	try:
		em = _cached_param_enums.get(identifier, {})
		return flat_key in em and isinstance(em.get(flat_key), list) and len(em.get(flat_key) or []) > 0
	except Exception:
		return False

def _enum_options(identifier: str, flat_key: str) -> List[str]:
	try:
		em = _cached_param_enums.get(identifier, {})
		opts = em.get(flat_key) or []
		# Normalize to strings
		return [str(o) for o in opts if isinstance(o, (str, int, float))]
	except Exception:
		return []

def _sanitize_pid(text: str) -> str:
	try:
		s = "".join(ch if ch.isalnum() or ch in ("_",) else "_" for ch in str(text))
		while "__" in s:
			s = s.replace("__", "_")
		return s.strip("_")
	except Exception:
		return "enum"

def _ensure_enum_runtime_property(pid: str):
	"""
	Dynamically define a bpy.types.Object EnumProperty for a specific parameter id.
	Stores/reads options and target key from object ID properties:
	- three64_enum_opts__{pid}: JSON array of option strings
	- three64_enum_target__{pid}: target ID prop key to mirror
	Value is kept in: Object.three64_enum_{pid}
	"""
	try:
		global _dyn_enum_pids
		prop_name = f"three64_enum_{pid}"
		if hasattr(bpy.types.Object, prop_name):
			if pid not in _dyn_enum_pids:
				_dyn_enum_pids.append(pid)
			return
		def _items(self, context):
			try:
				raw = self.get(f"three64_enum_opts__{pid}", "[]")
				opts = []
				try:
					opts = json.loads(raw) if isinstance(raw, str) else []
				except Exception:
					opts = []
				items = []
				for o in (opts or []):
					val = str(o)
					items.append((val, val, ""))
				# Ensure current is present
				cur = getattr(self, prop_name, "")
				if isinstance(cur, str) and cur and all(it[0] != cur for it in items):
					items.insert(0, (cur, cur, ""))
				return items or [("", "", "")]
			except Exception:
				return [("", "", "")]
		def _update(self, context):
			try:
				target = self.get(f"three64_enum_target__{pid}", "")
				if isinstance(target, str) and target:
					cur = getattr(self, prop_name, "")
					self[target] = cur
			except Exception:
				pass
		setattr(bpy.types.Object, prop_name, bpy.props.EnumProperty(
			name="",
			description="",
			items=_items,
			update=_update,
		))
		_dyn_enum_pids.append(pid)
	except Exception:
		pass


def _abspath(path: str) -> str:
	# Resolve Blender-style paths (supports // relative to current .blend)
	return bpy.path.abspath(path or "")


def _get_preferences() -> "Three64AddonPreferences | None":
	addon_key = __name__
	prefs = bpy.context.preferences.addons.get(addon_key)
	return getattr(prefs, "preferences", None) if prefs else None


def _read_component_files(dir_path_abs: str) -> List[str]:
	if not dir_path_abs or not os.path.isdir(dir_path_abs):
		return []
	files = []
	try:
		for entry in os.scandir(dir_path_abs):
			if entry.is_file() and entry.name.lower().endswith(".json"):
				files.append(entry.path)
	except Exception:
		return []
	files.sort()
	return files


def _derive_display_name(file_path: str, data: Dict) -> str:
	# Prefer a human-readable name in JSON if present, fall back to filename
	for key in ("name", "title", "label"):
		val = data.get(key)
		if isinstance(val, str) and val.strip():
			return val.strip()
	# e.g., agent.json -> agent
	return os.path.splitext(os.path.basename(file_path))[0]


def _load_items_from_dir(dir_path_abs: str) -> List[Tuple[str, str, str]]:
	items: List[Tuple[str, str, str]] = []
	for file_path in _read_component_files(dir_path_abs):
		try:
			with open(file_path, "r", encoding="utf-8") as f:
				data = json.load(f)
			display_name = _derive_display_name(file_path, data if isinstance(data, dict) else {})
			identifier = os.path.splitext(os.path.basename(file_path))[0]
			description = f"Component from {os.path.basename(file_path)}"
			items.append((identifier, display_name, description))
		except Exception:
			# Skip unreadable/invalid files
			continue
	return items


def _ensure_cache(context: "bpy.types.Context") -> List[Tuple[str, str, str]]:
	global _cached_items, _cached_dir_abs, _cached_index, _cached_param_desc, _cached_param_types
	prefs = _get_preferences()
	base_dir = prefs.component_data_dir if prefs else "//component-data"
	dir_path_abs = _abspath(base_dir)
	if dir_path_abs != _cached_dir_abs or not _cached_items:
		items = _load_items_from_dir(dir_path_abs)
		_cached_dir_abs = dir_path_abs
		_cached_items = items
		# Build identifier -> file path index
		_cached_index = {}
		_cached_param_desc = {}
		_cached_param_types = {}
		_cached_param_enums = {}
		try:
			for p in _read_component_files(dir_path_abs):
				identifier = os.path.splitext(os.path.basename(p))[0]
				_cached_index[identifier] = p
				# Preload parameter descriptions and types
				try:
					with open(p, "r", encoding="utf-8") as f:
						data = json.load(f)
					desc_map: Dict[str, str] = {}
					type_map: Dict[str, str] = {}
					pd = (data or {}).get("paramDescriptions")
					if isinstance(pd, dict):
						for k, v in pd.items():
							if isinstance(v, str):
								desc_map[str(k)] = v
					elif isinstance(pd, list):
						for entry in pd:
							if isinstance(entry, dict):
								n = entry.get("name") or entry.get("key")
								d = entry.get("description") or entry.get("desc") or entry.get("tooltip")
								t = entry.get("type")
								opts = entry.get("options")
								if isinstance(n, str) and isinstance(d, str):
									# normalize key to string
									desc_map[n] = d
								if isinstance(n, str) and isinstance(t, str):
									type_map[n] = t
								# Capture enum options if provided
								if isinstance(n, str) and isinstance(t, str) and t.lower() == "enum":
									try:
										if isinstance(opts, list):
											_cached_param_enums.setdefault(identifier, {})[n] = [str(x) for x in opts]
									except Exception:
										pass
					_cached_param_desc[identifier] = desc_map
					_cached_param_types[identifier] = type_map
				except Exception:
					_cached_param_desc[identifier] = {}
					_cached_param_types[identifier] = {}
					_cached_param_enums[identifier] = {}
		except Exception:
			_cached_index = {}
			_cached_param_desc = {}
			_cached_param_enums = {}
	return _cached_items


def _enum_items(self, context: "bpy.types.Context"):
	items = _ensure_cache(context)
	if not items:
		# Show a single disabled option to inform the user
		dir_display = _cached_dir_abs or _abspath("//component-data")
		return [("NONE", f"No component-data found ({dir_display})", "Set the path in add-on preferences")]
	return items

def _extract_params(data: Dict) -> Dict:
	if not isinstance(data, dict):
		return {}
	if isinstance(data.get("params"), dict):
		return data["params"]
	if isinstance(data.get("options"), dict):
		return data["options"]
	# Fallback: use all keys except common metadata
	meta = {"name","title","label","type","component","script","paramDescriptions","description","display"}
	params = {}
	for k, v in data.items():
		if k in meta:
			continue
		params[k] = v
	return params

def _get_params_for_identifier(identifier: str) -> Dict:
	# Ensure cache to get current directory and index mapping
	_ensure_cache(bpy.context if bpy else None)  # type: ignore[arg-type]
	try:
		file_path = _cached_index.get(identifier)
		if not file_path:
			# Try conventional path as a fallback
			fp = os.path.join(_cached_dir_abs, f"{identifier}.json")
			if os.path.isfile(fp):
				file_path = fp
		if not file_path or not os.path.isfile(file_path):
			return {}
		with open(file_path, "r", encoding="utf-8") as f:
			data = json.load(f)
		return _extract_params(data if isinstance(data, dict) else {})
	except Exception:
		return {}

def _get_param_tooltips_for_identifier(identifier: str) -> Dict[str, str]:
	_ensure_cache(bpy.context if bpy else None)  # type: ignore[arg-type]
	try:
		return _cached_param_desc.get(identifier, {}) or {}
	except Exception:
		return {}

def _set_component_on_object(obj, identifier: str):
	try:
		old_component = obj.get("component")
		new_params = _get_params_for_identifier(identifier)
		param_tooltips = _get_param_tooltips_for_identifier(identifier)
		# Optionally remove old param keys that were provided by prior component
		if isinstance(old_component, str) and old_component and old_component != identifier:
			old_params = _get_params_for_identifier(old_component)
			try:
				old_flat = _flatten_params(old_params or {})
				for key in list(old_flat.keys()):
					try:
						if key in obj:
							del obj[key]
					except Exception:
						pass
			except Exception:
				pass
		# Set the main component property
		obj["component"] = identifier
		try:
			# Set generic tooltip for component id
			ui = obj.id_properties_ui("component")
			ui.update(description=f"Primary component ID: {identifier}")
		except Exception:
			pass
		# Set parameter properties (flatten nested params to dotted keys)
		flat = _flatten_params(new_params or {})
		for key, value in flat.items():
			try:
				val = "" if value is None else value
				if _is_color_key(identifier, key):
					val = _hex_from_value(val)
				obj[key] = val
				# Set tooltip if available
				try:
					desc = _tooltip_for_flat_key(param_tooltips, key)
					if isinstance(desc, str) and desc:
						ui = obj.id_properties_ui(key)
						ui.update(description=desc)
				except Exception:
					pass
			except Exception:
				# skip keys that cannot be set
				continue
	except Exception:
		pass

def _existing_component_indices(obj) -> List[int]:
	indices: List[int] = []
	try:
		for k in obj.keys():
			if k == "component":
				indices.append(1)
				continue
			if not isinstance(k, str):
				continue
			if k.lower().startswith("component"):
				rest = k[len("component"):]
				if rest.startswith("_"):
					rest = rest[1:]
				if rest.isdigit():
					try:
						i = int(rest, 10)
						if i >= 2:
							indices.append(i)
					except Exception:
						pass
	except Exception:
		return indices
	indices = sorted(list(set(indices)))
	return indices

def _next_component_index(obj) -> int:
	inds = _existing_component_indices(obj)
	if not inds:
		return 1
	return max(inds) + 1

def _component_key_for_index(index: int) -> str:
	return "component" if index == 1 else f"component_{index}"

def _param_key_for_index(param_name: str, index: int) -> str:
	return param_name if index == 1 else f"{param_name}_{index}"


class THREE64_OT_reload_component_data(bpy.types.Operator):
	bl_idname = "three64.reload_component_data"
	bl_label = "Reload Three64 Components"
	bl_description = "Re-scan the component-data directory for JSON files"
	bl_options = {"REGISTER"}

	def execute(self, context: "bpy.types.Context"):
		global _cached_items, _cached_dir_abs
		_cached_items = []
		_cached_dir_abs = ""
		_ensure_cache(context)
		self.report({"INFO"}, "Three64 components reloaded")
		return {"FINISHED"}


class Three64AddonPreferences(bpy.types.AddonPreferences):
	bl_idname = __name__

	component_data_dir: bpy.props.StringProperty(
		name="Component Data Directory",
		description="Directory containing JSON files that define components. Supports // for paths relative to the .blend file.",
		subtype="DIR_PATH",
		default="//component-data",
		update=lambda self, ctx: _on_prefs_changed(self, ctx),
	)

	def draw(self, context: "bpy.types.Context"):
		layout = self.layout
		col = layout.column(align=True)
		col.prop(self, "component_data_dir")
		row = col.row(align=True)
		row.operator(THREE64_OT_reload_component_data.bl_idname, icon="FILE_REFRESH")


def _draw_into_custom_props(self, context: "bpy.types.Context"):
	obj = context.object
	if not obj:
		return
	layout = self.layout
	box = layout.box()
	row = box.row(align=True)
	row.label(text="Three64 Component", icon="DECORATE")
	row.operator(THREE64_OT_reload_component_data.bl_idname, text="", icon="FILE_REFRESH")
	# Mark Navigable button
	row_nav = box.row(align=True)
	try:
		nav_key = getattr(context.scene, "three64_nav_prop_key", "navigable")
		nav_on = bool(obj.get(nav_key, False))
		nav_icon = "CHECKBOX_HLT" if nav_on else "CHECKBOX_DEHLT"
		row_nav.operator("three64.mark_navigable", text="Toggle Navigable", icon=nav_icon)
	except Exception:
		row_nav.operator("three64.mark_navigable", text="Toggle Navigable", icon="CHECKBOX_DEHLT")
	row_ds = box.row(align=True)
	try:
		ds_on = bool(obj.get("doubleSided", False))
		ds_icon = "CHECKBOX_HLT" if ds_on else "CHECKBOX_DEHLT"
		row_ds.operator("three64.mark_double_sided", text="Toggle Double-Sided", icon=ds_icon)
	except Exception:
		row_ds.operator("three64.mark_double_sided", text="Toggle Double-Sided", icon="CHECKBOX_DEHLT")
	# Collider authoring
	row_col = box.row(align=True)
	row_col.operator("three64.mark_collider", text="Set Collider", icon="MOD_PHYSICS")
	try:
		op_clear = row_col.operator("three64.mark_collider", text="", icon="X")
		op_clear.clear = True
	except Exception:
		pass
	row2 = box.row(align=True)
	row2.prop(obj, "three64_component", text="Component")
	op = row2.operator("three64.add_selected_component", text="", icon="ADD")

	# Grouped view inside Custom Properties area as well
	try:
		indices = _existing_component_indices(obj)
		for idx in indices:
			comp_key = _component_key_for_index(idx)
			comp_name = obj.get(comp_key)
			if not isinstance(comp_name, str):
				continue
			box.separator()
			inner = box.box()
			r = inner.row(align=True)
			r.label(text=f"Component #{idx}: {comp_name}", icon="DOT")
			params = _get_params_for_identifier(comp_name)
			flat = _flatten_params(params or {})
			for pkey in flat.keys():
				prop_name = _param_key_for_index(pkey, idx)
				if prop_name in obj:
					try:
						if _is_color_key(comp_name, pkey):
							# Sync picker from stored hex and set target, then draw picker and hex field
							try:
								current = obj.get(prop_name, "#ffffff")
								obj.three64_color_picker_target = prop_name
								obj.three64_color_picker = _rgb_tuple_from_hex(current)
							except Exception:
								pass
							row = inner.row(align=True)
							row.prop(obj, "three64_color_picker", text=pkey)
							row.prop(obj, f'["{prop_name}"]', text="Hex")
						else:
							inner.prop(obj, f'["{prop_name}"]', text=pkey)
					except Exception:
						pass
	except Exception:
		pass


class OBJECT_PT_three64_component(bpy.types.Panel):
	bl_label = "Three64 Component"
	bl_idname = "OBJECT_PT_three64_component"
	bl_space_type = "PROPERTIES"
	bl_region_type = "WINDOW"
	bl_context = "object"
	bl_options = {"DEFAULT_CLOSED"}

	def draw(self, context: "bpy.types.Context"):
		layout = self.layout
		obj = context.object
		row = layout.row(align=True)
		row.operator(THREE64_OT_reload_component_data.bl_idname, icon="FILE_REFRESH")
		row = layout.row(align=True)
		row.operator("three64.open_addon_preferences", text="Open Add-on Preferences", icon="PREFERENCES")
		if obj:
			# Mark Navigable button
			row0 = layout.row(align=True)
			try:
				nav_key = getattr(context.scene, "three64_nav_prop_key", "navigable")
				nav_on = bool(obj.get(nav_key, False))
				nav_icon = "CHECKBOX_HLT" if nav_on else "CHECKBOX_DEHLT"
				row0.operator("three64.mark_navigable", text="Toggle Navigable", icon=nav_icon)
			except Exception:
				row0.operator("three64.mark_navigable", text="Toggle Navigable", icon="CHECKBOX_DEHLT")
			row1 = layout.row(align=True)
			try:
				ds_on = bool(obj.get("doubleSided", False))
				ds_icon = "CHECKBOX_HLT" if ds_on else "CHECKBOX_DEHLT"
				row1.operator("three64.mark_double_sided", text="Toggle Double-Sided", icon=ds_icon)
			except Exception:
				row1.operator("three64.mark_double_sided", text="Toggle Double-Sided", icon="CHECKBOX_DEHLT")
			# Collider authoring
			rowc = layout.row(align=True)
			rowc.operator("three64.mark_collider", text="Set Collider", icon="MOD_PHYSICS")
			try:
				opc = rowc.operator("three64.mark_collider", text="", icon="X")
				opc.clear = True
			except Exception:
				pass

			row3 = layout.row(align=True)
			row3.prop(obj, "three64_component", text="Component")
			row3.operator("three64.add_selected_component", text="", icon="ADD")

			# Archetypes & Instancing quick authoring
			layout.separator()
			boxA = layout.box()
			boxA.label(text="Archetypes & Instancing", icon="OUTLINER_OB_GROUP_INSTANCE")
			# Archetype
			rowA = boxA.row(align=True)
			try:
				boxA.prop(obj, '["archetype"]', text="archetype")
			except Exception:
				pass
			rowA = boxA.row(align=True)
			opA = rowA.operator("three64.set_archetype", text="Set Archetype", icon="ADD")
			try:
				opA.archetype = str(obj.get("archetype", ""))
			except Exception:
				pass
			# Overrides
			rowO = boxA.row(align=True)
			rowO.operator("three64.add_override", text="Add Override a.*", icon="PLUS")
			# Traits
			rowT = boxA.row(align=True)
			rowT.operator("three64.add_trait", text="Add Trait t.*", icon="PLUS")
			# Pool
			try:
				rowP0 = boxA.row(align=True)
				if "pool.size" in obj:
					rowP0.prop(obj, '["pool.size"]', text="pool.size")
				if "pool.prewarm" in obj:
					rowP0.prop(obj, '["pool.prewarm"]', text="pool.prewarm")
			except Exception:
				pass
			rowP = boxA.row(align=True)
			opP = rowP.operator("three64.set_pool", text="Set Pool (size/prewarm)", icon="MOD_PHYSICS")
			try:
				opP.size = int(obj.get("pool.size", 0))
				opP.prewarm = bool(obj.get("pool.prewarm", False))
			except Exception:
				pass
			# Instancing
			try:
				rowI0 = boxA.row(align=True)
				if "instKey" in obj:
					rowI0.prop(obj, '["instKey"]', text="instKey")
			except Exception:
				pass
			rowI = boxA.row(align=True)
			opI = rowI.operator("three64.set_inst_key", text="Set instKey", icon="OUTLINER_DATA_EMPTY")
			try:
				opI.inst_key = str(obj.get("instKey", ""))
			except Exception:
				pass
			rowI2 = boxA.row(align=True)
			rowI2.operator("three64.insert_inst_tag", text="Insert [inst=key] in Name", icon="SYNTAX_ON")

			# Grouped display of existing components and their params
			try:
				indices = _existing_component_indices(obj)
				for idx in indices:
					comp_key = _component_key_for_index(idx)
					comp_name = obj.get(comp_key)
					if not isinstance(comp_name, str):
						continue
					layout.separator()
					box = layout.box()
					row = box.row(align=True)
					row.label(text=f"Component #{idx}: {comp_name}", icon="DOT")
					params = _get_params_for_identifier(comp_name)
					flat = _flatten_params(params or {})
					for pkey in flat.keys():
						prop_name = _param_key_for_index(pkey, idx)
						if prop_name in obj:
							try:
								if _is_color_key(comp_name, pkey):
									try:
										current = obj.get(prop_name, "#ffffff")
										obj.three64_color_picker_target = prop_name
										obj.three64_color_picker = _rgb_tuple_from_hex(current)
									except Exception:
										pass
									row2 = box.row(align=True)
									row2.prop(obj, "three64_color_picker", text=pkey)
									row2.prop(obj, f'["{prop_name}"]', text="Hex")
								elif _is_enum_key(comp_name, pkey):
									try:
										opts = _enum_options(comp_name, pkey)
										pid = _sanitize_pid(f"{comp_name}__{pkey}_{idx}")
										_ensure_enum_runtime_property(pid)
										# seed options + target + value
										obj[f"three64_enum_opts__{pid}"] = json.dumps(opts)
										obj[f"three64_enum_target__{pid}"] = prop_name
										cur = obj.get(prop_name, "")
										if not isinstance(cur, str) or cur == "":
											cur = opts[0] if opts else ""
											obj[prop_name] = cur
										setattr(obj, f"three64_enum_{pid}", cur)
										box.prop(obj, f"three64_enum_{pid}", text=pkey)
									except Exception:
										box.prop(obj, f'["{prop_name}"]', text=pkey)
								else:
									box.prop(obj, f'["{prop_name}"]', text=pkey)
							except Exception:
								pass
			except Exception:
				pass


def _on_component_changed(self, context: "bpy.types.Context"):
	# Dropdown selection should not change any data; only the Add button applies changes.
	return None

def _on_prefs_changed(self: "Three64AddonPreferences", context: "bpy.types.Context"):
	# Reset cache when user changes the external component-data path
	global _cached_items, _cached_dir_abs
	_cached_items = []
	_cached_dir_abs = ""
	_ensure_cache(context)

class THREE64_OT_open_addon_preferences(bpy.types.Operator):
	bl_idname = "three64.open_addon_preferences"
	bl_label = "Open Three64 Add-on Preferences"
	bl_description = "Open the add-on preferences to set the component-data directory"
	bl_options = {"INTERNAL"}

	def execute(self, context: "bpy.types.Context"):
		try:
			bpy.ops.screen.userpref_show("INVOKE_DEFAULT")
		except Exception:
			pass
		try:
			bpy.ops.preferences.addon_show(module=__name__)
		except Exception:
			pass
		return {"FINISHED"}

def _on_color_picker_changed(self, context: "bpy.types.Context"):
	try:
		target = getattr(self, "three64_color_picker_target", "")
		if not isinstance(target, str) or not target:
			return
		col = getattr(self, "three64_color_picker", (1.0, 1.0, 1.0))
		if not isinstance(col, (list, tuple)) or len(col) < 3:
			return
		r = max(0, min(255, int(round(float(col[0]) * 255))))
		g = max(0, min(255, int(round(float(col[1]) * 255))))
		b = max(0, min(255, int(round(float(col[2]) * 255))))
		self[target] = f"#{(r<<16 | g<<8 | b):06x}"
		try:
			ui = self.id_properties_ui(target)
			ui.update(description=f"Hex color for {target}")
		except Exception:
			pass
	except Exception:
		pass

class THREE64_OT_add_selected_component(bpy.types.Operator):
	bl_idname = "three64.add_selected_component"
	bl_label = "Add Selected Component"
	bl_description = "Add the selected component's properties without overriding existing ones"
	bl_options = {"REGISTER", "UNDO"}

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		obj = getattr(context, "object", None)
		return obj is not None and hasattr(obj, "three64_component")

	def execute(self, context: "bpy.types.Context"):
		obj = context.object
		identifier = getattr(obj, "three64_component", None)
		if not isinstance(identifier, str) or not identifier or identifier == "NONE":
			self.report({"WARNING"}, "No component selected")
			return {"CANCELLED"}

		# Append: add a new numbered component key and add param properties with the same index, without overwriting existing keys.
		try:
			params = _get_params_for_identifier(identifier)
			param_tooltips = _get_param_tooltips_for_identifier(identifier)

			# Determine next component index
			index = _next_component_index(obj)

			# Set the numbered component key (component or component_N)
			comp_key = _component_key_for_index(index)
			obj[comp_key] = identifier
			try:
				ui = obj.id_properties_ui(comp_key)
				ui.update(description=f"Component #{index}: {identifier}")
			except Exception:
				pass

			# Append param keys with index suffix: only set missing keys; never delete or overwrite existing ones
			flat = _flatten_params(params or {})
			for key, value in flat.items():
				prop_key = _param_key_for_index(key, index)
				if prop_key in obj:
					continue
				try:
					val = "" if value is None else value
					if _is_color_key(identifier, key):
						val = _hex_from_value(val)
					obj[prop_key] = val
					# set tooltip if available
					try:
						desc = _tooltip_for_flat_key(param_tooltips, key)
						if isinstance(desc, str) and desc:
							ui = obj.id_properties_ui(prop_key)
							ui.update(description=desc)
					except Exception:
						pass
				except Exception:
					continue

			self.report({"INFO"}, f"Added component '{identifier}'")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to add component")
			return {"CANCELLED"}


class THREE64_OT_mark_navigable(bpy.types.Operator):
	bl_idname = "three64.mark_navigable"
	bl_label = "Mark Navigable"
	bl_description = "Set the object's navigable custom property to True (used by navmesh export)"
	bl_options = {"REGISTER", "UNDO"}

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return getattr(context, "object", None) is not None

	def execute(self, context: "bpy.types.Context"):
		try:
			obj = context.object
			# Use scene-configured key if available; default to 'navigable'
			prop_key = getattr(context.scene, "three64_nav_prop_key", "navigable")
			cur = bool(obj.get(prop_key, False))
			obj[prop_key] = not cur
			try:
				ui = obj.id_properties_ui(prop_key)
				ui.update(description="Marks this object as walkable for Three64 navmesh baking (toggle)")
			except Exception:
				pass
			self.report({"INFO"}, f"Set {prop_key}={obj.get(prop_key)} on '{obj.name}'")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to set navigable property")
			return {"CANCELLED"}


class THREE64_OT_mark_double_sided(bpy.types.Operator):
	bl_idname = "three64.mark_double_sided"
	bl_label = "Mark Double-Sided"
	bl_description = "Set the object's doubleSided custom property to True (forces double-sided rendering at runtime)"
	bl_options = {"REGISTER", "UNDO"}

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return getattr(context, "object", None) is not None

	def execute(self, context: "bpy.types.Context"):
		try:
			obj = context.object
			prop_key = "doubleSided"
			cur = bool(obj.get(prop_key, False))
			obj[prop_key] = not cur
			try:
				ui = obj.id_properties_ui(prop_key)
				ui.update(description="Marks this object to render with double-sided materials in Three64 runtime (toggle)")
			except Exception:
				pass
			self.report({"INFO"}, f"Set {prop_key}={obj.get(prop_key)} on '{obj.name}'")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to set doubleSided property")
			return {"CANCELLED"}


class THREE64_OT_mark_collider(bpy.types.Operator):
	bl_idname = "three64.mark_collider"
	bl_label = "Set Collider"
	bl_description = "Set collider userData (collider='convex') and optional physics.mergeChildren / physics.visible"
	bl_options = {"REGISTER", "UNDO"}

	shape: bpy.props.EnumProperty(
		name="Shape",
		description="Collider shape to mark in userData",
		items=(
			("convex", "Convex", "Convex hull collider"),
		),
		default="convex",
	)
	merge_children: bpy.props.BoolProperty(
		name="Merge Children",
		description="Merge child meshes into a single convex collider",
		default=True,
	)
	visible: bpy.props.BoolProperty(
		name="Visible (Debug)",
		description="Show generated collider mesh at runtime for debugging",
		default=False,
	)
	clear: bpy.props.BoolProperty(
		name="Clear Collider Props",
		description="Remove collider and physics.* properties from this object",
		default=False,
	)

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return getattr(context, "object", None) is not None

	def invoke(self, context: "bpy.types.Context", event):
		# Try to seed defaults from current object properties
		try:
			obj = context.object
			if isinstance(obj.get("physics.mergeChildren", None), (bool, int)):
				self.merge_children = bool(obj.get("physics.mergeChildren"))
			if isinstance(obj.get("physics.visible", None), (bool, int)):
				self.visible = bool(obj.get("physics.visible"))
			shape_val = obj.get("collider", None) or obj.get("physics.collider", None) or obj.get("physics.collision", None)
			if isinstance(shape_val, str) and shape_val.lower() in ("convex",):
				self.shape = shape_val.lower()
		except Exception:
			pass
		return context.window_manager.invoke_props_dialog(self)

	def execute(self, context: "bpy.types.Context"):
		try:
			obj = context.object
			if self.clear:
				for key in ("collider", "collision", "physics.collider", "physics.collision", "physics.visible", "physics.mergeChildren"):
					try:
						if key in obj:
							del obj[key]
					except Exception:
						pass
				self.report({"INFO"}, f"Cleared collider userData on '{obj.name}'")
				return {"FINISHED"}

			# Set collider and optional flags
			obj["collider"] = str(self.shape or "convex")
			try:
				ui = obj.id_properties_ui("collider")
				ui.update(description="Three64 collider type (e.g., 'convex')")
			except Exception:
				pass
			obj["physics.mergeChildren"] = bool(self.merge_children)
			try:
				ui2 = obj.id_properties_ui("physics.mergeChildren")
				ui2.update(description="Merge child meshes into one convex collider at runtime")
			except Exception:
				pass
			obj["physics.visible"] = bool(self.visible)
			try:
				ui3 = obj.id_properties_ui("physics.visible")
				ui3.update(description="Show generated collider mesh at runtime (debug)")
			except Exception:
				pass

			self.report({"INFO"}, f"Set collider='{self.shape}', mergeChildren={self.merge_children}, visible={self.visible} on '{obj.name}'")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to set collider userData")
			return {"CANCELLED"}


class THREE64_OT_bake_navmesh_json(bpy.types.Operator):
	bl_idname = "three64.bake_navmesh_json"
	bl_label = "Bake & Export NavMesh (JSON)"
	bl_description = "Bake a simple navmesh over meshes tagged with a custom property and export JSON (vertices + triangles)"
	bl_options = {"REGISTER", "UNDO"}

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return hasattr(context, "scene") and context.scene is not None and bmesh is not None and bpy is not None

	def execute(self, context: "bpy.types.Context"):
		try:
			scene = context.scene
			prop_key = getattr(scene, "three64_nav_prop_key", "navigable")
			export_path = _abspath(getattr(scene, "three64_nav_export_path", "//navmesh.json"))
			convert_axes = bool(getattr(scene, "three64_nav_convert_axes", True))
			apply_mods = bool(getattr(scene, "three64_nav_apply_modifiers", True))
			# three64_nav_slope_max is stored as radians due to unit='ROTATION'
			slope_max_rad = float(getattr(scene, "three64_nav_slope_max", math.radians(45.0)))
			slope_cos = math.cos(slope_max_rad if slope_max_rad <= math.pi else math.radians(slope_max_rad))

			if not export_path:
				self.report({"WARNING"}, "Invalid export path")
				return {"CANCELLED"}

			deps = context.evaluated_depsgraph_get()
			# Collect tagged mesh objects
			objects = []
			for o in scene.objects:
				try:
					if o.type != 'MESH':
						continue
					val = o.get(prop_key)
					if isinstance(val, (bool, int, float, str)):
						if bool(val):
							objects.append(o)
				except Exception:
					continue
			if not objects:
				self.report({"WARNING"}, f"No mesh objects with property '{prop_key}' found")
				return {"CANCELLED"}

			# Build combined triangle soup
			verts = []  # list of [x,y,z]
			tris = []   # flat indices
			index_map = {}  # quantized coord -> index
			quant = 1e-5
			def key_from_xyz(x, y, z):
				return (round(x/quant)*quant, round(y/quant)*quant, round(z/quant)*quant)
			def emit_vertex(co):
				x, y, z = co.x, co.y, co.z
				if convert_axes:
					tx, ty, tz = (x, z, -y)
				else:
					tx, ty, tz = (x, y, z)
				k = key_from_xyz(tx, ty, tz)
				idx = index_map.get(k, -1)
				if idx >= 0:
					return idx
				index_map[k] = len(verts)
				verts.append([float(tx), float(ty), float(tz)])
				return len(verts) - 1

			up = (0.0, 0.0, 1.0)  # Blender Z-up for slope test
			for o in objects:
				try:
					ob_eval = o.evaluated_get(deps) if apply_mods else o
					mesh = ob_eval.to_mesh(preserve_all_data_layers=False, depsgraph=deps) if apply_mods else o.to_mesh()
					if not mesh:
						continue
					bm = bmesh.new()
					try:
						bm.from_mesh(mesh)
						bmesh.ops.triangulate(bm, faces=bm.faces[:])
						mat = ob_eval.matrix_world.copy()
						for f in bm.faces:
							# World-space vertices of the triangle
							co = [mat @ v.co for v in (f.verts[0], f.verts[1], f.verts[2])]
							# Compute world normal from triangle
							e0 = co[1] - co[0]
							e1 = co[2] - co[0]
							nx = e0.y * e1.z - e0.z * e1.y
							ny = e0.z * e1.x - e0.x * e1.z
							nz = e0.x * e1.y - e0.y * e1.x
							len_n = max(1e-12, math.sqrt(nx*nx + ny*ny + nz*nz))
							nx, ny, nz = nx/len_n, ny/len_n, nz/len_n
							# Slope test against Blender Z-up
							dot_up = nx*up[0] + ny*up[1] + nz*up[2]
							if dot_up < slope_cos:
								continue
							# Emit vertices and triangle
							i0 = emit_vertex(co[0])
							i1 = emit_vertex(co[1])
							i2 = emit_vertex(co[2])
							tris.extend([i0, i1, i2])
					finally:
						bm.free()
					try:
						if apply_mods:
							ob_eval.to_mesh_clear()
					except Exception:
						pass
					try:
						if not apply_mods and o is not None and hasattr(o, "to_mesh_clear"):
							o.to_mesh_clear()
					except Exception:
						pass
				except Exception:
					continue

			if not verts or not tris:
				self.report({"WARNING"}, "No walkable triangles produced with current settings")
				return {"CANCELLED"}

			os.makedirs(os.path.dirname(export_path), exist_ok=True)
			payload = {
				"vertices": verts,
				"triangles": tris,
				"meta": {
					"propKey": prop_key,
					"slopeMaxDeg": math.degrees(slope_max_rad) if slope_max_rad <= math.pi else slope_max_rad,
					"convertAxes": bool(convert_axes),
				}
			}
			with open(export_path, "w", encoding="utf-8") as f:
				json.dump(payload, f, separators=(",", ":" ))
			self.report({"INFO"}, f"NavMesh exported: {len(verts)} verts, {len(tris)//3} tris -> {export_path}")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to bake/export navmesh")
			return {"CANCELLED"}


class THREE64_OT_visualize_navmesh_json(bpy.types.Operator):
	bl_idname = "three64.visualize_navmesh_json"
	bl_label = "Visualize NavMesh (JSON)"
	bl_description = "Create/refresh a mesh object in the scene from the exported navmesh JSON"
	bl_options = {"REGISTER", "UNDO"}

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return hasattr(context, "scene") and context.scene is not None and bpy is not None

	def execute(self, context: "bpy.types.Context"):
		try:
			scene = context.scene
			path = _abspath(getattr(scene, "three64_nav_export_path", "//navmesh.json"))
			if not path or not os.path.isfile(path):
				self.report({"WARNING"}, "NavMesh JSON not found; check Export Path")
				return {"CANCELLED"}
			with open(path, "r", encoding="utf-8") as f:
				data = json.load(f)
			verts_in = data.get("vertices") or []
			tris_in = data.get("triangles") or []
			meta = data.get("meta") or {}
			convert_axes = bool(meta.get("convertAxes", True))

			# Convert Three.js coords back to Blender if they were converted during export:
			# JSON vertex = (x, y, z) = (blender.x, blender.z, -blender.y)
			# Blender vertex = (x, y, z) = (json.x, -json.z, json.y)
			verts_out = []
			for v in verts_in:
				if not isinstance(v, (list, tuple)) or len(v) < 3:
					continue
				if convert_axes:
					verts_out.append((float(v[0]), float(-v[2]), float(v[1])))
				else:
					verts_out.append((float(v[0]), float(v[1]), float(v[2])))

			if not verts_out or not isinstance(tris_in, list) or len(tris_in) < 3:
				self.report({"WARNING"}, "NavMesh JSON has no vertices/triangles")
				return {"CANCELLED"}

			faces = []
			for i in range(0, len(tris_in) - 2, 3):
				a = int(tris_in[i]); b = int(tris_in[i + 1]); c = int(tris_in[i + 2])
				if a < 0 or b < 0 or c < 0: continue
				if a >= len(verts_out) or b >= len(verts_out) or c >= len(verts_out): continue
				faces.append((a, b, c))
			if not faces:
				self.report({"WARNING"}, "No valid triangle faces in JSON")
				return {"CANCELLED"}

			# Create or refresh a single preview object
			obj_name = "NavMeshPreview"
			obj = bpy.data.objects.get(obj_name)
			if obj and obj.type != 'MESH':
				# Avoid name collision with non-mesh
				obj = None
			if obj is None:
				mesh = bpy.data.meshes.new(obj_name)
				mesh.from_pydata(verts_out, [], faces)
				mesh.update()
				obj = bpy.data.objects.new(obj_name, mesh)
				context.scene.collection.objects.link(obj)
			else:
				me = obj.data
				if not me:
					me = bpy.data.meshes.new(obj_name)
					obj.data = me
				me.clear_geometry()
				me.from_pydata(verts_out, [], faces)
				me.update()

			# Display preferences
			wire = bool(getattr(scene, "three64_nav_vis_wireframe", True))
			try:
				obj.display_type = 'WIRE' if wire else 'TEXTURED'
			except Exception:
				pass

			self.report({"INFO"}, f"NavMesh visualized: {len(verts_out)} verts, {len(faces)} tris")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to visualize navmesh")
			return {"CANCELLED"}


class VIEW3D_PT_three64_navmesh(bpy.types.Panel):
	bl_label = "Three64 NavMesh"
	bl_idname = "VIEW3D_PT_three64_navmesh"
	bl_space_type = "VIEW_3D"
	bl_region_type = "UI"
	bl_category = "NavMesh"
	bl_options = {"DEFAULT_CLOSED"}

	def draw(self, context: "bpy.types.Context"):
		layout = self.layout
		scene = context.scene
		col = layout.column(align=True)
		col.prop(scene, "three64_nav_prop_key")
		col.prop(scene, "three64_nav_slope_max")
		col.prop(scene, "three64_nav_convert_axes")
		col.prop(scene, "three64_nav_apply_modifiers")
		col.prop(scene, "three64_nav_export_path")
		col.prop(scene, "three64_nav_vis_wireframe", text="Wireframe")
		row = col.row(align=True)
		row.operator(THREE64_OT_bake_navmesh_json.bl_idname, icon="MESH_DATA")
		row.operator(THREE64_OT_visualize_navmesh_json.bl_idname, icon="HIDE_OFF")


# -----------------------------
# Archetype & Instancing authoring operators
# -----------------------------
class THREE64_OT_set_archetype(bpy.types.Operator):
	bl_idname = "three64.set_archetype"
	bl_label = "Set Archetype"
	bl_description = "Set userData 'archetype' on this object"
	bl_options = {"REGISTER", "UNDO"}

	archetype: bpy.props.StringProperty(name="Archetype", description="Prefab name to spawn at runtime", default="")

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return getattr(context, "object", None) is not None

	def invoke(self, context: "bpy.types.Context", event):
		return context.window_manager.invoke_props_dialog(self)

	def execute(self, context: "bpy.types.Context"):
		obj = context.object
		try:
			obj["archetype"] = str(self.archetype or "")
			try:
				ui = obj.id_properties_ui("archetype")
				ui.update(description="Three64 prefab name")
			except Exception:
				pass
			self.report({"INFO"}, f"archetype set to '{self.archetype}'")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to set 'archetype'")
			return {"CANCELLED"}


def _parse_value_auto(s: str):
	try:
		# Try JSON first
		return json.loads(s)
	except Exception:
		t = s.strip()
		tlow = t.lower()
		if tlow in ("true", "false"):
			return tlow == "true"
		try:
			if "." in t:
				return float(t)
			return int(t)
		except Exception:
			return t


class THREE64_OT_add_override(bpy.types.Operator):
	bl_idname = "three64.add_override"
	bl_label = "Add Override (a.*)"
	bl_description = "Add a dotted override key under the 'a.' namespace (e.g., a.health.max)"
	bl_options = {"REGISTER", "UNDO"}

	key: bpy.props.StringProperty(name="Override Key (without a.)", description="e.g., health.max or move.speed", default="")
	value: bpy.props.StringProperty(name="Value (JSON/number/bool/string)", description="e.g., 150 or true or \"red\"", default="")

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return getattr(context, "object", None) is not None

	def invoke(self, context: "bpy.types.Context", event):
		return context.window_manager.invoke_props_dialog(self)

	def execute(self, context: "bpy.types.Context"):
		obj = context.object
		try:
			k = str(self.key or "").strip()
			if not k:
				self.report({"WARNING"}, "Override key is empty")
				return {"CANCELLED"}
			full = f"a.{k}"
			val = _parse_value_auto(self.value or "")
			obj[full] = val
			try:
				ui = obj.id_properties_ui(full)
				ui.update(description="Three64 archetype override parameter")
			except Exception:
				pass
			self.report({"INFO"}, f"Set {full} = {val}")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to set override")
			return {"CANCELLED"}


class THREE64_OT_add_trait(bpy.types.Operator):
	bl_idname = "three64.add_trait"
	bl_label = "Add Trait (t.*)"
	bl_description = "Add a trait key under 't.' (e.g., t.mortal=true)"
	bl_options = {"REGISTER", "UNDO"}

	name: bpy.props.StringProperty(name="Trait Name (without t.)", description="e.g., mortal or shoots", default="")
	value: bpy.props.StringProperty(name="Value (bool/number/string)", description="true/false or number or string", default="true")

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return getattr(context, "object", None) is not None

	def invoke(self, context: "bpy.types.Context", event):
		return context.window_manager.invoke_props_dialog(self)

	def execute(self, context: "bpy.types.Context"):
		obj = context.object
		try:
			n = str(self.name or "").strip()
			if not n:
				self.report({"WARNING"}, "Trait name is empty")
				return {"CANCELLED"}
			full = f"t.{n}"
			val = _parse_value_auto(self.value or "true")
			obj[full] = val
			try:
				ui = obj.id_properties_ui(full)
				ui.update(description="Three64 archetype trait")
			except Exception:
				pass
			self.report({"INFO"}, f"Set {full} = {val}")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to add trait")
			return {"CANCELLED"}


class THREE64_OT_set_pool(bpy.types.Operator):
	bl_idname = "three64.set_pool"
	bl_label = "Set Pool"
	bl_description = "Set pool.size and pool.prewarm on this object"
	bl_options = {"REGISTER", "UNDO"}

	size: bpy.props.IntProperty(name="pool.size", description="Number of instances to pre-create for this archetype", default=0, min=0)
	prewarm: bpy.props.BoolProperty(name="pool.prewarm", description="Request prewarm at scene load", default=True)

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return getattr(context, "object", None) is not None

	def invoke(self, context: "bpy.types.Context", event):
		return context.window_manager.invoke_props_dialog(self)

	def execute(self, context: "bpy.types.Context"):
		obj = context.object
		try:
			obj["pool.size"] = int(self.size)
			obj["pool.prewarm"] = bool(self.prewarm)
			try:
				ui = obj.id_properties_ui("pool.size")
				ui.update(description="Three64 pool size hint")
			except Exception:
				pass
			try:
				ui2 = obj.id_properties_ui("pool.prewarm")
				ui2.update(description="Three64 pool prewarm hint")
			except Exception:
				pass
			self.report({"INFO"}, f"Set pool.size={self.size}, pool.prewarm={self.prewarm}")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to set pool.*")
			return {"CANCELLED"}


class THREE64_OT_set_inst_key(bpy.types.Operator):
	bl_idname = "three64.set_inst_key"
	bl_label = "Set instKey"
	bl_description = "Set userData 'instKey' for static instancing"
	bl_options = {"REGISTER", "UNDO"}

	inst_key: bpy.props.StringProperty(name="instKey", description="Key used to group into InstancedMesh", default="")

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return getattr(context, "object", None) is not None

	def invoke(self, context: "bpy.types.Context", event):
		return context.window_manager.invoke_props_dialog(self)

	def execute(self, context: "bpy.types.Context"):
		obj = context.object
		try:
			obj["instKey"] = str(self.inst_key or "")
			try:
				ui = obj.id_properties_ui("instKey")
				ui.update(description="Three64 instancing key")
			except Exception:
				pass
			self.report({"INFO"}, f"instKey set to '{self.inst_key}'")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to set instKey")
			return {"CANCELLED"}


class THREE64_OT_insert_inst_tag(bpy.types.Operator):
	bl_idname = "three64.insert_inst_tag"
	bl_label = "Insert [inst=key] Tag"
	bl_description = "Insert or replace the [inst=key] tag in the object's name"
	bl_options = {"REGISTER", "UNDO"}

	key: bpy.props.StringProperty(name="inst key", description="Key to embed as [inst=key] in the name", default="")

	@classmethod
	def poll(cls, context: "bpy.types.Context"):
		return getattr(context, "object", None) is not None

	def invoke(self, context: "bpy.types.Context", event):
		# Seed with current instKey if present
		try:
			obj = context.object
			self.key = str(obj.get("instKey", ""))
		except Exception:
			pass
		return context.window_manager.invoke_props_dialog(self)

	def execute(self, context: "bpy.types.Context"):
		obj = context.object
		try:
			name = obj.name or ""
			# Remove existing [inst=...] tag
			name = re.sub(r"\s*\[inst\s*=\s*[^]]+\]\s*", " ", name).strip()
			tag = f"[inst={self.key}] " if self.key else ""
			obj.name = (tag + name).strip()
			self.report({"INFO"}, f"Object renamed to '{obj.name}'")
			return {"FINISHED"}
		except Exception:
			self.report({"ERROR"}, "Failed to insert name tag")
			return {"CANCELLED"}


classes = (
	THREE64_OT_reload_component_data,
	Three64AddonPreferences,
	OBJECT_PT_three64_component,
	THREE64_OT_open_addon_preferences,
	THREE64_OT_add_selected_component,
	THREE64_OT_mark_navigable,
	THREE64_OT_mark_double_sided,
	THREE64_OT_mark_collider,
	THREE64_OT_bake_navmesh_json,
	THREE64_OT_visualize_navmesh_json,
	VIEW3D_PT_three64_navmesh,
	THREE64_OT_set_archetype,
	THREE64_OT_add_override,
	THREE64_OT_add_trait,
	THREE64_OT_set_pool,
	THREE64_OT_set_inst_key,
	THREE64_OT_insert_inst_tag,
)
def register():
	for cls in classes:
		bpy.utils.register_class(cls)
	# Per-object property: selected component identifier (matches filename w/o extension)
	bpy.types.Object.three64_component = bpy.props.EnumProperty(
		name="Three64 Component",
		description="Component defined by JSON in component-data directory",
		items=_enum_items,
		update=_on_component_changed,
	)
	# Color picker helpers
	try:
		bpy.types.Object.three64_color_picker = bpy.props.FloatVectorProperty(
			name="Color",
			size=3,
			subtype="COLOR",
			min=0.0, max=1.0,
			default=(1.0, 1.0, 1.0),
			update=lambda self, ctx: _on_color_picker_changed(self, ctx),
		)
	except Exception:
		pass
	try:
		bpy.types.Object.three64_color_picker_target = bpy.props.StringProperty(
			name="Color Target",
			default="",
		)
	except Exception:
		pass
	# Also draw within the default Custom Properties panel for convenience
	try:
		bpy.types.OBJECT_PT_custom_props.append(_draw_into_custom_props)
	except Exception:
		pass
	# NavMesh bake settings on the Scene
	try:
		bpy.types.Scene.three64_nav_prop_key = bpy.props.StringProperty(
			name="Filter Property",
			description="Only include meshes with this custom property set truthy",
			default="navigable",
		)
		bpy.types.Scene.three64_nav_slope_max = bpy.props.FloatProperty(
			name="Max Slope (deg)",
			description="Maximum surface slope to consider walkable (Blender Z-up)",
			default=45.0,
			min=0.0, max=89.9,
			subtype='ANGLE',
			unit='ROTATION',
		)
		bpy.types.Scene.three64_nav_export_path = bpy.props.StringProperty(
			name="Export Path",
			description="Target JSON path (supports // relative to .blend)",
			subtype="FILE_PATH",
			default="//navmesh.json",
		)
		bpy.types.Scene.three64_nav_convert_axes = bpy.props.BoolProperty(
			name="Convert to Three.js (Y-up)",
			description="Convert Blender coords (X,Y,Z) to Three.js (X,Y,Z) as (x, z, -y)",
			default=True,
		)
		bpy.types.Scene.three64_nav_apply_modifiers = bpy.props.BoolProperty(
			name="Apply Modifiers",
			description="Use evaluated meshes with modifiers applied",
			default=True,
		)
		bpy.types.Scene.three64_nav_vis_wireframe = bpy.props.BoolProperty(
			name="Wireframe View",
			description="Display preview object in wireframe mode",
			default=True,
		)
	except Exception:
		pass


def unregister():
	# Remove custom props extension
	try:
		bpy.types.OBJECT_PT_custom_props.remove(_draw_into_custom_props)
	except Exception:
		pass
	# Remove helper properties
	try:
		del bpy.types.Object.three64_color_picker
	except Exception:
		pass
	try:
		del bpy.types.Object.three64_color_picker_target
	except Exception:
		pass
	# Remove scene navmesh props
	for pname in (
		"three64_nav_prop_key",
		"three64_nav_slope_max",
		"three64_nav_export_path",
		"three64_nav_convert_axes",
		"three64_nav_apply_modifiers",
	):
		try:
			delattr(bpy.types.Scene, pname)
		except Exception:
			pass
	# Remove property
	if hasattr(bpy.types.Object, "three64_component"):
		try:
			del bpy.types.Object.three64_component
		except Exception:
			pass
	# Remove dynamic enum props
	global _dyn_enum_pids
	try:
		for pid in _dyn_enum_pids:
			prop_name = f"three64_enum_{pid}"
			if hasattr(bpy.types.Object, prop_name):
				try:
					delattr(bpy.types.Object, prop_name)
				except Exception:
					pass
	except Exception:
		pass
	_dyn_enum_pids = []
	# Unregister classes (reverse order)
	for cls in reversed(classes):
		try:
			bpy.utils.unregister_class(cls)
		except Exception:
			pass


