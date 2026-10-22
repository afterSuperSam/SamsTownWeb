import { Brush, Eraser, Focus, MapPinPlus, MousePointer2, Scan, Settings2, SquareDashed, X } from "lucide-react";
import { useI18n } from "../../../i18n/I18nContext";
import type { SelectionTool } from "../domain/mapTypes";

interface MapToolbarProps {
  tool: SelectionTool;
  subtract: boolean;
  count: number;
  canClaim: boolean;
  canManage: boolean;
  markerPlacement: boolean;
  editingClaim: boolean;
  onTool: (tool: SelectionTool) => void;
  onSubtract: () => void;
  onClear: () => void;
  onReset: () => void;
  onCreateClaim: () => void;
  onMarkerPlacement: () => void;
  onManage: () => void;
}

export function MapToolbar(props: MapToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="map-toolbar" aria-label={t("app.nav.map")}>
      <button type="button" onClick={props.onReset} title={t("map.toolbar.reset")}><Focus size={17} /></button>
      {props.canClaim ? <>
        <span className="map-toolbar-divider" />
        <button type="button" className={props.tool === "point" ? "active" : ""} onClick={() => props.onTool("point")} title={t("map.toolbar.select")}><MousePointer2 size={17} /></button>
        <button type="button" className={props.tool === "rectangle" ? "active" : ""} onClick={() => props.onTool("rectangle")} title={t("map.toolbar.rectangle")}><SquareDashed size={17} /></button>
        <button type="button" className={props.tool === "brush" ? "active" : ""} onClick={() => props.onTool("brush")} title={t("map.toolbar.brush")}><Brush size={17} /></button>
        <button type="button" className={props.subtract ? "active danger" : ""} onClick={props.onSubtract} title={t("map.toolbar.remove")}><Eraser size={17} /></button>
        <button type="button" onClick={props.onClear} disabled={!props.count} title={t("map.toolbar.clear")}><X size={17} /></button>
        <span className="map-selection-count"><Scan size={15} />{t("map.selection.count", { count: props.count })}</span>
        <button type="button" className="map-toolbar-action" disabled={!props.count} onClick={props.onCreateClaim}>{t(props.editingClaim ? "map.claim.editTitle" : "map.toolbar.newClaim")}</button>
      </> : null}
      {props.canManage ? <>
        <span className="map-toolbar-divider" />
        <button type="button" className={props.markerPlacement ? "active" : ""} onClick={props.onMarkerPlacement} title={t("map.toolbar.addMarker")}><MapPinPlus size={17} /></button>
        <button type="button" onClick={props.onManage} title={t("map.toolbar.manage")}><Settings2 size={17} /></button>
      </> : null}
    </div>
  );
}
