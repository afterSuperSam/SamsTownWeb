import { Brush, Eraser, Focus, MousePointer2, Scan, Settings2, SquareDashed, X } from "lucide-react";
import { useI18n } from "../../../i18n/I18nContext";
import type { SelectionTool } from "../domain/mapTypes";

interface MapToolbarProps {
  tool: SelectionTool;
  subtract: boolean;
  count: number;
  canCreateProject: boolean;
  canManage: boolean;
  editingProject: boolean;
  onTool: (tool: SelectionTool) => void;
  onSubtract: () => void;
  onClear: () => void;
  onReset: () => void;
  onCreateProject: () => void;
  onManage: () => void;
}

export function MapToolbar(props: MapToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="map-toolbar" role="toolbar" aria-label={t("app.nav.map")}>
      <button type="button" onClick={props.onReset} aria-label={t("map.toolbar.reset")} title={t("map.toolbar.reset")}><Focus size={17} /></button>
      {props.canCreateProject ? <>
        <span className="map-toolbar-divider" />
        <button type="button" className={props.tool === "point" ? "active" : ""} aria-pressed={props.tool === "point"} aria-label={t("map.toolbar.select")} onClick={() => props.onTool("point")} title={t("map.toolbar.select")}><MousePointer2 size={17} /></button>
        <button type="button" className={props.tool === "rectangle" ? "active" : ""} aria-pressed={props.tool === "rectangle"} aria-label={t("map.toolbar.rectangle")} onClick={() => props.onTool("rectangle")} title={t("map.toolbar.rectangle")}><SquareDashed size={17} /></button>
        <button type="button" className={props.tool === "brush" ? "active" : ""} aria-pressed={props.tool === "brush"} aria-label={t("map.toolbar.brush")} onClick={() => props.onTool("brush")} title={t("map.toolbar.brush")}><Brush size={17} /></button>
        <button type="button" className={props.subtract ? "active danger" : ""} aria-pressed={props.subtract} aria-label={t("map.toolbar.remove")} onClick={props.onSubtract} title={t("map.toolbar.remove")}><Eraser size={17} /></button>
        <button type="button" onClick={props.onClear} disabled={!props.count} aria-label={t("map.toolbar.clear")} title={t("map.toolbar.clear")}><X size={17} /></button>
        <span className="map-selection-count"><Scan size={15} />{t("map.selection.count", { count: props.count })}</span>
        <button type="button" className="map-toolbar-action" disabled={!props.count} onClick={props.onCreateProject}>{t(props.editingProject ? "map.claim.editTitle" : "map.toolbar.newClaim")}</button>
      </> : null}
      {props.canManage ? <>
        <span className="map-toolbar-divider" />
        <button type="button" aria-label={t("map.toolbar.manage")} onClick={props.onManage} title={t("map.toolbar.manage")}><Settings2 size={17} /></button>
      </> : null}
    </div>
  );
}
