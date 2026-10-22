import { Crown } from "lucide-react";
import { MinecraftAvatar } from "../../atlas/components/MinecraftAvatar";
import { useI18n } from "../../../i18n/I18nContext";
import type { MaterialLeaderboardEntry } from "../domain/materialTypes";
import { formatCount } from "./MaterialDialogs";

export function MaterialLeaderboard({ entries }: { entries: MaterialLeaderboardEntry[] }) {
  const { t } = useI18n();
  return <aside className="material-leaderboard">
    <header><Crown size={20} /><div><h2>{t("materials.leaderboard.title")}</h2><p>{t("materials.leaderboard.body")}</p></div></header>
    {entries.length ? <ol>{entries.map((entry, index) => <li key={`${entry.claimantId ?? "deleted"}:${entry.username}`}>
      <span className="material-rank">{String(index + 1).padStart(2, "0")}</span>
      <MinecraftAvatar username={entry.username} size={44} alt="" />
      <strong>{entry.username}</strong>
      <b>{formatCount(entry.collectedCount)}</b>
    </li>)}</ol> : <p className="material-leaderboard-empty">{t("materials.leaderboard.empty")}</p>}
  </aside>;
}
