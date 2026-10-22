import { PackagePlus, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n/I18nContext";
import type { MaterialItem } from "../domain/materialTypes";

export interface BatchClaimItem {
  item: MaterialItem;
  maxAmount: number;
}

export function StarPicker({ value, onChange, disabled = false }: {
  value: 1 | 2 | 3;
  onChange: (value: 1 | 2 | 3) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return <span className="material-stars" role="group" aria-label={t("materials.priority.label", { count: value })}>
    {([1, 2, 3] as const).map(star => <button key={star} type="button" disabled={disabled} className={star <= value ? "active" : ""} onClick={() => onChange(star)} aria-label={t("materials.priority.label", { count: star })}><Star size={19} fill={star <= value ? "currentColor" : "none"} /></button>)}
  </span>;
}

export function MaterialIcon({ item }: { item: Pick<MaterialItem, "imageUrl" | "nameEn"> }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.imageUrl]);
  return <span className="material-icon">{item.imageUrl && !failed
    ? <img src={item.imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <PackagePlus size={22} aria-hidden="true" />}</span>;
}

export const formatCount = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
