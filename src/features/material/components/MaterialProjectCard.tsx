import { ArrowDownUp, Check, CheckCheck, ChevronDown, ChevronUp, Download, Layers3, MapPin, Pencil, RotateCcw, Sparkles, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SelectField } from "../../../components/SelectField";
import { useI18n } from "../../../i18n/I18nContext";
import { MinecraftAvatar } from "../../atlas/components/MinecraftAvatar";
import type { MaterialAssignment, MaterialItem, MaterialProject } from "../domain/materialTypes";
import { formatCount, MaterialIcon, StarPicker, type BatchClaimItem } from "./MaterialDialogs";

const ITEM_PAGE_SIZE = 96;
type MaterialSort = "default" | "missing" | "total";

export function MaterialProjectCard({
  project,
  items,
  assignments,
  currentUserId,
  canEdit,
  search,
  onEdit,
  onDownload,
  onClaim,
  onComplete,
  onQuickClaim,
  onBatchClaim,
  onBatchComplete
}: {
  project: MaterialProject;
  items: MaterialItem[];
  assignments: MaterialAssignment[];
  currentUserId: string;
  canEdit: boolean;
  search: string;
  onEdit: (project: MaterialProject) => void;
  onDownload: (project: MaterialProject) => void;
  onClaim: (item: MaterialItem, assignment: MaterialAssignment | null, maxAmount: number) => void;
  onComplete: (assignment: MaterialAssignment, completed: boolean) => void;
  onQuickClaim: (items: BatchClaimItem[]) => void;
  onBatchClaim: (items: BatchClaimItem[]) => void;
  onBatchComplete: (assignments: MaterialAssignment[], completed: boolean) => void;
}) {
  const { language, t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [visibleCount, setVisibleCount] = useState(ITEM_PAGE_SIZE);
  const [sortBy, setSortBy] = useState<MaterialSort>("default");
  const [sortAscending, setSortAscending] = useState(false);
  const assignmentByItem = useMemo(() => groupAssignments(assignments), [assignments]);
  const visibleItems = useMemo(() => {
    const filtered = search
      ? items.filter(item => `${item.itemId} ${item.nameZh} ${item.nameEn}`.toLowerCase().includes(search))
      : items;
    return [...filtered].sort((left, right) => compareMaterials(left, right, sortBy, sortAscending));
  }, [items, search, sortAscending, sortBy]);

  useEffect(() => setVisibleCount(ITEM_PAGE_SIZE), [search, sortAscending, sortBy]);
  useEffect(() => {
    const validIds = new Set(items.map(item => item.id));
    setSelected(current => new Set([...current].filter(id => validIds.has(id))));
  }, [items]);

  const selectableItems = canEdit ? visibleItems.filter(item => {
    const mine = findMine(assignmentByItem.get(item.id), currentUserId);
    return Boolean(mine) || claimCapacity(item, mine) > 0;
  }) : [];
  const selectedItems = selectableItems.filter(item => selected.has(item.id));
  const quickClaimItems = items.flatMap(item => {
    const mine = findMine(assignmentByItem.get(item.id), currentUserId);
    const maxAmount = claimCapacity(item, mine);
    return !mine?.completed && maxAmount > 0 ? [{ item, maxAmount }] : [];
  });
  const selectedAssignments = selectedItems.flatMap(item => {
    const mine = findMine(assignmentByItem.get(item.id), currentUserId);
    return mine ? [mine] : [];
  });
  const claimableSelected = selectedItems.filter(item => {
    const mine = findMine(assignmentByItem.get(item.id), currentUserId);
    return !mine?.completed && claimCapacity(item, mine) > 0;
  });
  const incompleteSelected = selectedAssignments.filter(assignment => !assignment.completed);
  const completedSelected = selectedAssignments.filter(assignment => assignment.completed);
  const allSelected = selectableItems.length > 0 && selectableItems.every(item => selected.has(item.id));
  const renderedItems = visibleItems.slice(0, visibleCount);

  function toggleAll() {
    setSelected(current => {
      const next = new Set(current);
      selectableItems.forEach(item => allSelected ? next.delete(item.id) : next.add(item.id));
      return next;
    });
  }

  function toggleItem(itemId: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  const projectComplete = project.missingCount === 0;

  return <article className={`material-project-card ${expanded ? "expanded" : ""} ${canEdit ? "editable" : ""} ${projectComplete ? "complete" : ""}`}>
    <header className="material-project-head">
      <div className="material-project-creator">
        <MinecraftAvatar username={project.creatorUsername} size={54} alt="" />
        <span><small>{t("materials.project.creator")}</small><strong>{project.creatorUsername}</strong></span>
      </div>
      <div className="material-project-title">
        <StarPicker value={project.priority} onChange={() => undefined} disabled />
        <h2>{project.name}</h2>
        <p><MapPin size={14} />{project.storageLocation || t("materials.project.locationEmpty")}</p>
        <div className="material-projection-summary">
          <span>{t("materials.projection.origin")} {project.originX}, {project.originY}, {project.originZ}</span>
          <span>{t(`materials.projection.mirror.${project.mirror}`)} · {t(`materials.projection.rotation.${project.rotation}`)}</span>
          {project.hasProjectionFile ? <button type="button" onClick={() => onDownload(project)}><Download size={14} />{project.projectionFileName}</button> : null}
        </div>
      </div>
      {canEdit ? <button type="button" className="icon-button material-edit" onClick={() => onEdit(project)} aria-label={t("materials.project.edit")}><Pencil size={16} /></button> : null}
    </header>

    <div className="material-project-metrics">
      <span><strong>{formatCount(project.itemCount)}</strong>{t("materials.project.items", { count: project.itemCount })}</span>
      <span><strong>{formatCount(project.totalCount)}</strong>{t("materials.item.total")}</span>
      <span className="missing"><strong>{formatCount(project.missingCount)}</strong>{t("materials.item.missing")}</span>
    </div>

    {expanded ? <div className="material-list">
      <div className="material-list-tools">
        <div className="material-sort-tools">
          <SelectField
            className="material-sort-select"
            value={sortBy}
            label={t("materials.sort.label")}
            options={[
              { value: "default", label: t("materials.sort.default") },
              { value: "missing", label: t("materials.sort.missing") },
              { value: "total", label: t("materials.sort.total") }
            ]}
            onChange={setSortBy}
          />
          {sortBy !== "default" ? <button
            type="button"
            className="material-sort-direction"
            aria-label={t(sortAscending ? "materials.sort.ascending" : "materials.sort.descending")}
            onClick={() => setSortAscending(value => !value)}
          ><ArrowDownUp size={14} />{t(sortAscending ? "materials.sort.ascending" : "materials.sort.descending")}</button> : null}
        </div>
        {canEdit && (selectableItems.length || quickClaimItems.length) ? <div className="material-batch-tools">
          {selectableItems.length ? <label className="material-select-all">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span>{t("materials.batch.selectAll", { count: selectableItems.length })}</span>
          </label> : null}
          <div>
            <button type="button" disabled={!quickClaimItems.length} onClick={() => onQuickClaim(quickClaimItems)}>
              <Sparkles size={15} />{t("materials.quickClaim.open")}
            </button>
            <button type="button" disabled={!claimableSelected.length} onClick={() => onBatchClaim(claimableSelected.map(item => ({
              item,
              maxAmount: claimCapacity(item, findMine(assignmentByItem.get(item.id), currentUserId))
            })))}><Layers3 size={15} />{t("materials.batch.claimCount", { count: claimableSelected.length })}</button>
            <button type="button" disabled={!incompleteSelected.length} onClick={() => onBatchComplete(incompleteSelected, true)}><CheckCheck size={15} />{t("materials.batch.completeCount", { count: incompleteSelected.length })}</button>
            <button type="button" disabled={!completedSelected.length} onClick={() => onBatchComplete(completedSelected, false)}><RotateCcw size={14} />{t("materials.batch.reopenCount", { count: completedSelected.length })}</button>
          </div>
        </div> : null}
      </div>

      {renderedItems.map(item => {
        const itemAssignments = assignmentByItem.get(item.id) ?? [];
        const mine = findMine(itemAssignments, currentUserId);
        const maxAmount = claimCapacity(item, mine);
        const selectable = canEdit && (Boolean(mine) || maxAmount > 0);
        return <div className={`material-row ${item.missingCount === 0 ? "complete" : ""}`} key={item.id}>
          {canEdit ? <input className="material-row-select" type="checkbox" checked={selected.has(item.id)} disabled={!selectable} onChange={() => toggleItem(item.id)} aria-label={t("materials.batch.selectItem", { name: language === "zh-CN" ? item.nameZh : item.nameEn })} /> : null}
          <MaterialIcon item={item} />
          <div className="material-name">
            <strong>{language === "zh-CN" ? item.nameZh : item.nameEn}</strong>
            <span>{language === "zh-CN" ? item.nameEn : item.nameZh}</span>
            <small>{item.itemId}</small>
          </div>
          <div className="material-counts">
            <span><small>{t("materials.item.total")}</small><strong>{formatCount(item.totalCount)}</strong></span>
            <span><small>{t("materials.item.existing")}</small><strong>{formatCount(item.existingCount)}</strong></span>
            <span className="missing"><small>{t("materials.item.missing")}</small><strong>{formatCount(item.missingCount)}</strong></span>
          </div>
          <div className="material-claims">
            {itemAssignments.length ? <div>{itemAssignments.map(assignment => <article className={assignment.completed ? "done" : ""} key={assignment.id}>
              <span><UserRoundCheck size={12} />{t("materials.item.claimedBy", { name: assignment.claimantUsername, count: formatCount(assignment.amount) })}</span>
              {assignment.note ? <p>{assignment.note}</p> : null}
              <small>{t("materials.audit", { name: assignment.updatedByUsername || assignment.claimantUsername, time: formatAuditTime(assignment.updatedAt, language) })}</small>
            </article>)}</div> : null}
            {canEdit && mine ? <button type="button" className={`material-complete ${mine.completed ? "done" : ""}`} onClick={() => onComplete(mine, !mine.completed)}><Check size={15} />{t(mine.completed ? "materials.item.reopen" : "materials.item.complete")}</button> : null}
            {canEdit && !mine && maxAmount > 0 ? <button type="button" className="material-claim-button" onClick={() => onClaim(item, null, maxAmount)}>{t("materials.item.claim")}</button> : null}
            {canEdit && mine && !mine.completed ? <button type="button" className="material-claim-button" onClick={() => onClaim(item, mine, maxAmount)}>{t("materials.item.claimed", { count: formatCount(mine.amount) })}</button> : null}
          </div>
        </div>;
      })}
      {visibleCount < visibleItems.length ? <button type="button" className="material-load-more" onClick={() => setVisibleCount(count => count + ITEM_PAGE_SIZE)}>{t("materials.items.more", { count: visibleItems.length - visibleCount })}</button> : null}
      {!visibleItems.length ? <p className="material-list-empty">{t("materials.items.empty")}</p> : null}
    </div> : null}

    <button type="button" className="material-project-toggle" onClick={() => setExpanded(value => !value)}>
      {t(expanded ? "materials.project.collapse" : "materials.project.expand")}
      {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
    </button>
  </article>;
}

function groupAssignments(assignments: MaterialAssignment[]) {
  const groups = new Map<string, MaterialAssignment[]>();
  assignments.forEach(assignment => {
    const group = groups.get(assignment.itemId);
    if (group) group.push(assignment);
    else groups.set(assignment.itemId, [assignment]);
  });
  return groups;
}

function findMine(assignments: MaterialAssignment[] | undefined, currentUserId: string) {
  return assignments?.find(assignment => assignment.claimantId === currentUserId) ?? null;
}

function claimCapacity(item: MaterialItem, mine: MaterialAssignment | null) {
  return Math.max(0, item.sourceMissingCount - item.initialAvailableCount - (item.reservedCount - (mine?.amount ?? 0)));
}

function compareMaterials(left: MaterialItem, right: MaterialItem, sortBy: MaterialSort, ascending: boolean) {
  const completionOrder = Number(left.missingCount === 0) - Number(right.missingCount === 0);
  if (completionOrder !== 0) return completionOrder;
  if (sortBy === "default") return left.sortOrder - right.sortOrder;
  const difference = sortBy === "missing"
    ? left.missingCount - right.missingCount
    : left.totalCount - right.totalCount;
  return (ascending ? difference : -difference) || left.sortOrder - right.sortOrder;
}

function formatAuditTime(value: string, language: "zh-CN" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
