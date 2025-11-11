bl_info = {
	"name": "Three64 Component Data",
	"author": "Three64",
	"version": (1, 0, 0),
	"blender": (3, 0, 0),
	"location": "Properties > Object > Three64 Component",
	"description": "Loads JSON component descriptors and exposes a dropdown on selected objects.",
	"category": "Object",
}

import bpy
import os
import json
from typing import Dict, List, Tuple

# Cached items to avoid re-parsing on every draw
_cached_items: List[Tuple[str, str, str]] = []
_cached_dir_abs: str = ""


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


def _ensure_cache(context: bpy.types.Context) -> List[Tuple[str, str, str]]:
	global _cached_items, _cached_dir_abs
	prefs = _get_preferences()
	base_dir = prefs.component_data_dir if prefs else "//component-data"
	dir_path_abs = _abspath(base_dir)
	if dir_path_abs != _cached_dir_abs or not _cached_items:
		items = _load_items_from_dir(dir_path_abs)
		_cached_dir_abs = dir_path_abs
		_cached_items = items
	return _cached_items


def _enum_items(self, context: bpy.types.Context):
	items = _ensure_cache(context)
	if not items:
		# Show a single disabled option to inform the user
		dir_display = _cached_dir_abs or _abspath("//component-data")
		return [("NONE", f"No component-data found ({dir_display})", "Set the path in add-on preferences")]
	return items


class THREE64_OT_reload_component_data(bpy.types.Operator):
	bl_idname = "three64.reload_component_data"
	bl_label = "Reload Three64 Components"
	bl_description = "Re-scan the component-data directory for JSON files"
	bl_options = {"REGISTER"}

	def execute(self, context: bpy.types.Context):
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

	def draw(self, context: bpy.types.Context):
		layout = self.layout
		col = layout.column(align=True)
		col.prop(self, "component_data_dir")
		row = col.row(align=True)
		row.operator(THREE64_OT_reload_component_data.bl_idname, icon="FILE_REFRESH")


def _draw_into_custom_props(self, context: bpy.types.Context):
	obj = context.object
	if not obj:
		return
	layout = self.layout
	box = layout.box()
	row = box.row(align=True)
	row.label(text="Three64 Component", icon="DECORATE")
	row.operator(THREE64_OT_reload_component_data.bl_idname, text="", icon="FILE_REFRESH")
	box.prop(obj, "three64_component", text="Component")


class OBJECT_PT_three64_component(bpy.types.Panel):
	bl_label = "Three64 Component"
	bl_idname = "OBJECT_PT_three64_component"
	bl_space_type = "PROPERTIES"
	bl_region_type = "WINDOW"
	bl_context = "object"
	bl_options = {"DEFAULT_CLOSED"}

	def draw(self, context: bpy.types.Context):
		layout = self.layout
		obj = context.object
		row = layout.row(align=True)
		row.operator(THREE64_OT_reload_component_data.bl_idname, icon="FILE_REFRESH")
		row = layout.row(align=True)
		row.operator("three64.open_addon_preferences", text="Open Add-on Preferences", icon="PREFERENCES")
		if obj:
			layout.prop(obj, "three64_component", text="Component")


classes = (
	THREE64_OT_reload_component_data,
	Three64AddonPreferences,
	OBJECT_PT_three64_component,
	THREE64_OT_open_addon_preferences,
)

def _on_component_changed(self, context: bpy.types.Context):
	# Mirror the selection into a true Blender Custom Property so that
	# exporters (e.g., glTF with "Include Custom Properties") can carry it through.
	try:
		val = getattr(self, "three64_component", None)
		if isinstance(val, str) and val and val != "NONE":
			self["id"] = val
	except Exception:
		# Non-fatal; keep UI responsive even if ID props cannot be set
		pass

def _on_prefs_changed(self: "Three64AddonPreferences", context: bpy.types.Context):
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

	def execute(self, context: bpy.types.Context):
		try:
			bpy.ops.screen.userpref_show("INVOKE_DEFAULT")
		except Exception:
			pass
		try:
			bpy.ops.preferences.addon_show(module=__name__)
		except Exception:
			pass
		return {"FINISHED"}


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



