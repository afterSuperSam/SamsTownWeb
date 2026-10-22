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
  render: (item: T, update: (next: T) => void) => ReactNode;
}

// Shared ordered-editor mechanics keep members, FAQ, and history consistent.
export function OrderedCollection<T extends OrderedItem>({
  items,
  setItems,
  createItem,
  addLabel,
  fieldClassName,
  scrollable = false,
  render
}: OrderedCollectionProps<T>) {
  const { t } = useI18n();
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

  return (
    <>
      <div className={`collection-list${scrollable ? " admin-scroll-region" : ""}`}>
        {items.map((item, index) => (
          <article
            className={`collection-row panel ${draggedId === item.id ? "is-dragging" : ""}`}
            key={item.id}
            onDragOver={event => event.preventDefault()}
            onDrop={() => drop(item.id)}
          >
            <span
              className="drag-handle"
              draggable
              onDragStart={() => setDraggedId(item.id)}
              onDragEnd={() => setDraggedId(null)}
              aria-hidden="true"
            >
              <GripVertical size={18} />
            </span>
            <div className="order-controls">
              <button type="button" className="order-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("app.moveUp")}><ChevronUp size={14} /></button>
              <span className="order">{String(index + 1).padStart(2, "0")}</span>
              <button type="button" className="order-button" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label={t("app.moveDown")}><ChevronDown size={14} /></button>
            </div>
            <div className={`collection-fields${fieldClassName ? ` ${fieldClassName}` : ""}`}>
              {render(item, next => setItems(items.map(entry => entry.id === item.id ? next : entry)))}
            </div>
            <button type="button" className="icon-button danger" onClick={() => setItems(items.filter(entry => entry.id !== item.id))} aria-label={t("app.delete")}><Trash2 size={17} /></button>
          </article>
        ))}
      </div>
      <button type="button" className="button add-row" onClick={() => setItems([...items, createItem()])}><Plus size={17} />{addLabel}</button>
    </>
  );
}
