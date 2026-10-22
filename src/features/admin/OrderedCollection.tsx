import { Button, IconButton } from "../../components/Button";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useI18n } from "../../i18n/I18nContext";

interface OrderedItem {
  id: string;
}

interface OrderedCollectionProps<T extends OrderedItem> {
  items: T[];
  setItems: (items: T[]) => void;
  createItem: () => T;
  addLabel: string;
  fieldClassName?: string;
  scrollable?: boolean;
  filterItem?: (item: T) => boolean;
  reorderable?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  render: (item: T, update: (next: T) => void) => ReactNode;
}

// 排序行为与操作按钮由媒体、成员、FAQ 和历史编辑器共用。
export function useOrdering<T extends OrderedItem>(items: T[], setItems: (items: T[]) => void) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  function move(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  }

  function drop(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const sourceIndex = items.findIndex(item => item.id === draggedId);
    const targetIndex = items.findIndex(item => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...items];
    const [source] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, source);
    setItems(next);
    setDraggedId(null);
  }

  return { draggedId, setDraggedId, move, drop };
}

export function OrderControls({ index, count, onMove, disabled = false, children }: {
  index: number;
  count: number;
  onMove: (offset: number) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return <>
    <button type="button" className="order-button" disabled={disabled || index === 0} onClick={() => onMove(-1)} aria-label={t("app.moveUp")}><ChevronUp size={14} /></button>
    {children ?? <span className="order">{String(index + 1).padStart(2, "0")}</span>}
    <button type="button" className="order-button" disabled={disabled || index === count - 1} onClick={() => onMove(1)} aria-label={t("app.moveDown")}><ChevronDown size={14} /></button>
  </>;
}

// 筛选只控制展示；编辑、删除与保存始终针对完整集合。
export function OrderedCollection<T extends OrderedItem>({
  items,
  setItems,
  createItem,
  addLabel,
  fieldClassName,
  scrollable = false,
  filterItem,
  reorderable = true,
  disabled = false,
  emptyLabel,
  render
}: OrderedCollectionProps<T>) {
  const { t } = useI18n();
  const { draggedId, setDraggedId, move, drop } = useOrdering(items, setItems);
  const canReorder = reorderable && !disabled;
  const hasVisibleItems = items.some(item => !filterItem || filterItem(item));
  return (
    <>
      <div className={`collection-list${scrollable ? " admin-scroll-region" : ""}`}>
        {!hasVisibleItems && emptyLabel ? <p className="empty" role="status">{emptyLabel}</p> : null}
        {items.map((item, index) => !filterItem || filterItem(item) ? (
          <article
            className={`collection-row panel ${draggedId === item.id ? "is-dragging" : ""}`}
            key={item.id}
            onDragOver={event => { if (canReorder && draggedId) event.preventDefault(); }}
            onDrop={event => {
              if (!canReorder || !draggedId) return;
              event.preventDefault();
              drop(item.id);
            }}
          >
            <span
              className="drag-handle"
              draggable={canReorder}
              onDragStart={event => {
                if (!canReorder) return;
                event.dataTransfer.setData("text/plain", item.id);
                event.dataTransfer.effectAllowed = "move";
                setDraggedId(item.id);
              }}
              onDragEnd={() => setDraggedId(null)}
              aria-hidden="true"
            >
              <GripVertical size={18} />
            </span>
            <div className="order-controls">
              {reorderable ? <OrderControls index={index} count={items.length} disabled={disabled} onMove={offset => move(index, offset)} /> : <span className="order">{String(index + 1).padStart(2, "0")}</span>}
            </div>
            <div className={`collection-fields${fieldClassName ? ` ${fieldClassName}` : ""}`}>
              {render(item, next => setItems(items.map(entry => entry.id === item.id ? next : entry)))}
            </div>
            <IconButton type="button" className="danger" disabled={disabled} onClick={() => setItems(items.filter(entry => entry.id !== item.id))} aria-label={t("app.delete")}><Trash2 size={17} /></IconButton>
          </article>
        ) : null)}
      </div>
      <Button type="button" className="add-row" disabled={disabled} onClick={() => setItems([...items, createItem()])}><Plus size={17} />{addLabel}</Button>
    </>
  );
}
