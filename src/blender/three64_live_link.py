bl_info = {
	"name": "Three64 Component Data",
	"author": "Three64",
	"version": (1, 0, 0),
	"blender": (3, 0, 0),
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

# Cached items to avoid re-parsing on every draw
_cached_items: List[Tuple[str, str, str]] = []
_cached_dir_abs: str = ""
_cached_index: Dict[str, str] = {}
_cached_param_desc: Dict[str, Dict[str, str]] = {}


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
	global _cached_items, _cached_dir_abs, _cached_index, _cached_param_desc
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
		try:
			for p in _read_component_files(dir_path_abs):
				identifier = os.path.splitext(os.path.basename(p))[0]
				_cached_index[identifier] = p
				# Preload parameter descriptions
				try:
					with open(p, "r", encoding="utf-8") as f:
						data = json.load(f)
					desc_map: Dict[str, str] = {}
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
								if isinstance(n, str) and isinstance(d, str):
                                    # normalize key to string
									desc_map[n] = d
					_cached_param_desc[identifier] = desc_map
				except Exception:
					_cached_param_desc[identifier] = {}
		except Exception:
			_cached_index = {}
			_cached_param_desc = {}
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
			if isinstance(old_params, dict):
				for key in old_params.keys():
					try:
						if key in obj and key not in new_params:
							del obj[key]
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
		# Set parameter properties
		for key, value in (new_params or {}).items():
			try:
				if isinstance(value, (str, int, float, bool)) or value is None:
					obj[key] = "" if value is None else value
				else:
					# Store complex types as JSON strings
					obj[key] = json.dumps(value)
				# Set tooltip if available
				try:
					desc = param_tooltips.get(key)
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
			for pkey in (params or {}).keys():
				prop_name = _param_key_for_index(pkey, idx)
				if prop_name in obj:
					try:
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
			row3 = layout.row(align=True)
			row3.prop(obj, "three64_component", text="Component")
			row3.operator("three64.add_selected_component", text="", icon="ADD")

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
					for pkey in (params or {}).keys():
						prop_name = _param_key_for_index(pkey, idx)
						if prop_name in obj:
							try:
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
			for key, value in (params or {}).items():
				prop_key = _param_key_for_index(key, index)
				if prop_key in obj:
					continue
				try:
					if isinstance(value, (str, int, float, bool)) or value is None:
						obj[prop_key] = "" if value is None else value
					else:
						obj[prop_key] = json.dumps(value)
					# set tooltip if available
					try:
						desc = param_tooltips.get(key)
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


classes = (
	THREE64_OT_reload_component_data,
	Three64AddonPreferences,
	OBJECT_PT_three64_component,
	THREE64_OT_open_addon_preferences,
	THREE64_OT_add_selected_component,
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
	# Also draw within the default Custom Properties panel for convenience
	try:
		bpy.types.OBJECT_PT_custom_props.append(_draw_into_custom_props)
	except Exception:
		pass


def unregister():
	# Remove custom props extension
	try:
		bpy.types.OBJECT_PT_custom_props.remove(_draw_into_custom_props)
	except Exception:
		pass
	# Remove property
	if hasattr(bpy.types.Object, "three64_component"):
		try:
			del bpy.types.Object.three64_component
		except Exception:
			pass
	# Unregister classes (reverse order)
	for cls in reversed(classes):
		try:
			bpy.utils.unregister_class(cls)
		except Exception:
			pass



