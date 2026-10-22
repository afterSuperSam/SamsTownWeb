import { CheckCheck, ChevronRight, Gauge, Layers3 } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Dialog } from "../../../components/Dialog";
import { getErrorTranslationKey } from "../../../i18n/errors";
import { useI18n } from "../../../i18n/I18nContext";
import {
  setMaterialClaim,
  setMaterialClaims,
  setMaterialClaimsCompleted
} from "../data/materialRepository";
import type { MaterialAssignment, MaterialItem } from "../domain/materialTypes";
import { formatCount, MaterialIcon, type BatchClaimItem } from "./MaterialPrimitives";

type Notice = (message: string, tone?: "success" | "error") => void;

export function ClaimDialog({ item, assignment, maxAmount, onClose, onSaved, onNotice }: {
  item: MaterialItem;
  assignment: MaterialAssignment | null;
  maxAmount: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onNotice: Notice;
}) {
  const { language, t } = useI18n();
  const [partialClaim, setPartialClaim] = useState(Boolean(assignment && assignment.amount < maxAmount));
  const [amount, setAmount] = useState(assignment?.amount ?? maxAmount);
  const [note, setNote] = useState(assignment?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function save(nextAmount: number) {
    setBusy(true);
    try {
      await setMaterialClaim(item.id, nextAmount, note);
      await onSaved();
      onNotice(t("materials.saved"));
      onClose();
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={t("materials.claim.title")} onClose={onClose} className="material-dialog claim-dialog" dismissible={!busy}>
    <div className="claim-dialog-item"><MaterialIcon item={item} /><div><strong>{language === "zh-CN" ? item.nameZh : item.nameEn}</strong><small>{item.itemId}</small></div></div>
    <form className="material-dialog-form" onSubmit={event => { event.preventDefault(); void save(partialClaim ? amount : maxAmount); }}>
      <div className="material-field">
        <span>{t("materials.claim.mode")}</span>
        <div className="claim-mode-switch segmented-control" role="group" aria-label={t("materials.claim.mode")}>
          <button type="button" aria-pressed={!partialClaim} onClick={() => setPartialClaim(false)}>{t("materials.claim.all")}</button>
          <button type="button" aria-pressed={partialClaim} onClick={() => setPartialClaim(true)}>{t("materials.claim.partial")}</button>
        </div>
      </div>
      {partialClaim
        ? <label>{t("materials.claim.amount")}<input type="number" min={1} max={maxAmount} required value={amount} onChange={event => setAmount(Number(event.target.value))} /></label>
        : <div className="claim-all-summary"><CheckCheck size={17} /><span>{t("materials.claim.allSummary", { count: formatCount(maxAmount) })}</span></div>}
      <label>{t("materials.claim.note")}<textarea maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
      <small>{t("materials.claim.available", { count: formatCount(maxAmount) })}</small>
      <div className="button-row end">
        {assignment ? <button type="button" className="button danger" disabled={busy} onClick={() => void save(0)}>{t("materials.claim.remove")}</button> : null}
        <button type="submit" className="button primary" disabled={busy || (partialClaim && (amount < 1 || amount > maxAmount))}>{t("materials.claim.save")}</button>
      </div>
    </form>
  </Dialog>;
}

export function BatchClaimDialog({ items, onClose, onSaved, onNotice }: {
  items: BatchClaimItem[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onNotice: Notice;
}) {
  const { language, t } = useI18n();
  const [partialClaim, setPartialClaim] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map(({ item, maxAmount }) => [item.id, maxAmount]))
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const invalidPartialAmount = partialClaim && items.some(({ item, maxAmount }) => {
    const amount = amounts[item.id];
    return !Number.isInteger(amount) || amount < 1 || amount > maxAmount;
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await setMaterialClaims(
        items.map(({ item }) => item.id),
        partialClaim ? items.map(({ item }) => amounts[item.id]) : null,
        note
      );
      await onSaved();
      onNotice(t("materials.batch.saved", { count: items.length }));
      onClose();
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={t("materials.batch.claimTitle")} onClose={onClose} className="material-dialog" dismissible={!busy}>
    <div className="material-batch-summary"><Layers3 size={20} /><span>{t("materials.batch.selected", { count: items.length })}</span></div>
    <form className="material-dialog-form" onSubmit={submit}>
      <div className="material-field">
        <span>{t("materials.claim.mode")}</span>
        <div className="claim-mode-switch segmented-control" role="group" aria-label={t("materials.claim.mode")}>
          <button type="button" aria-pressed={!partialClaim} onClick={() => setPartialClaim(false)}>{t("materials.claim.all")}</button>
          <button type="button" aria-pressed={partialClaim} onClick={() => setPartialClaim(true)}>{t("materials.claim.partial")}</button>
        </div>
      </div>
      {partialClaim
        ? <div className="batch-claim-amounts">
          {items.map(({ item, maxAmount }) => {
            const name = language === "zh-CN" ? item.nameZh : item.nameEn;
            return <label className="batch-claim-amount" key={item.id}>
              <span><MaterialIcon item={item} /><span><strong>{name}</strong><small>{t("materials.claim.available", { count: formatCount(maxAmount) })}</small></span></span>
              <input
                type="number"
                min={1}
                max={maxAmount}
                required
                aria-label={t("materials.batch.itemAmount", { name })}
                value={amounts[item.id]}
                onChange={event => setAmounts(current => ({ ...current, [item.id]: Number(event.target.value) }))}
              />
            </label>;
          })}
        </div>
        : <div className="claim-all-summary"><CheckCheck size={17} /><span>{t("materials.batch.allSummary", { count: items.length })}</span></div>}
      <label>{t("materials.claim.note")}<textarea maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
      <button type="submit" className="button primary" disabled={busy || invalidPartialAmount}><Layers3 size={17} />{t("materials.batch.claim")}</button>
    </form>
  </Dialog>;
}

export function QuickClaimDialog({ items, onClose, onSaved, onNotice }: {
  items: BatchClaimItem[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onNotice: Notice;
}) {
  const { language, t } = useI18n();
  const maximum = Math.max(1, ...items.map(item => item.maxAmount));
  const [threshold, setThreshold] = useState(Math.min(64, maximum));
  const [slideProgress, setSlideProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const selected = useMemo(
    () => items.filter(item => item.maxAmount <= threshold),
    [items, threshold]
  );

  function updateThreshold(value: number) {
    setThreshold(Math.max(1, Math.min(maximum, Math.round(value) || 1)));
    setSlideProgress(0);
  }

  async function claimSelected() {
    if (submitting.current || !selected.length) return;
    submitting.current = true;
    setBusy(true);
    try {
      await setMaterialClaims(selected.map(({ item }) => item.id), null, "");
      await onSaved();
      onNotice(t("materials.quickClaim.saved", { count: selected.length }));
      onClose();
    } catch (error) {
      submitting.current = false;
      setBusy(false);
      setSlideProgress(0);
      // Concurrent claims can invalidate this entire preview. Refresh and
      // close it so the next attempt is based on current capacities.
      await onSaved().catch(() => undefined);
      onClose();
      onNotice(t(getErrorTranslationKey(error)), "error");
    }
  }

  function updateSlide(value: number) {
    setSlideProgress(value);
    if (value >= 100) void claimSelected();
  }

  return <Dialog title={t("materials.quickClaim.title")} onClose={onClose} className="material-dialog quick-claim-dialog" dismissible={!busy}>
    <p className="material-dialog-lead">{t("materials.quickClaim.body")}</p>
    <div className="quick-claim-threshold">
      <label>
        <span>{t("materials.quickClaim.threshold")}</span>
        <input
          type="number"
          min={1}
          max={maximum}
          value={threshold}
          onChange={event => updateThreshold(Number(event.target.value))}
        />
      </label>
      <input
        type="range"
        min={1}
        max={maximum}
        step={1}
        value={threshold}
        aria-label={t("materials.quickClaim.threshold")}
        onChange={event => updateThreshold(Number(event.target.value))}
      />
    </div>

    <div className="quick-claim-summary">
      <Gauge size={18} />
      <span>{t("materials.quickClaim.preview", { count: selected.length, threshold: formatCount(threshold) })}</span>
    </div>
    <div className="quick-claim-list">
      {selected.map(({ item, maxAmount }) => (
        <article key={item.id}>
          <MaterialIcon item={item} />
          <span><strong>{language === "zh-CN" ? item.nameZh : item.nameEn}</strong><small>{item.itemId}</small></span>
          <b>{formatCount(maxAmount)}</b>
        </article>
      ))}
      {!selected.length ? <p>{t("materials.quickClaim.empty")}</p> : null}
    </div>

    <label className={`quick-claim-slider ${busy ? "busy" : ""}`}>
      <span>{t(busy ? "materials.quickClaim.saving" : "materials.quickClaim.slide")}</span>
      <ChevronRight size={18} />
      <input
        type="range"
        min={0}
        max={100}
        value={slideProgress}
        disabled={busy || !selected.length}
        aria-label={t("materials.quickClaim.slide")}
        style={{ "--slide-progress": `${slideProgress}%` } as CSSProperties}
        onChange={event => updateSlide(Number(event.target.value))}
        onPointerUp={() => {
          if (slideProgress < 100) setSlideProgress(0);
        }}
        onBlur={() => {
          if (slideProgress < 100) setSlideProgress(0);
        }}
      />
    </label>
  </Dialog>;
}

export function BatchCompletionDialog({ assignmentIds, completed, onClose, onSaved, onNotice }: {
  assignmentIds: string[];
  completed: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onNotice: Notice;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await setMaterialClaimsCompleted(assignmentIds, completed, note || undefined);
      await onSaved();
      onNotice(t("materials.batch.saved", { count: assignmentIds.length }));
      onClose();
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={t(completed ? "materials.batch.completeTitle" : "materials.batch.reopenTitle")} onClose={onClose} className="material-dialog" dismissible={!busy}>
    <div className="material-batch-summary"><CheckCheck size={20} /><span>{t("materials.batch.selected", { count: assignmentIds.length })}</span></div>
    <form className="material-dialog-form" onSubmit={submit}>
      <label>{t("materials.claim.note")}<textarea maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
      <button type="submit" className="button primary" disabled={busy}><CheckCheck size={17} />{t(completed ? "materials.batch.complete" : "materials.batch.reopen")}</button>
    </form>
  </Dialog>;
}
