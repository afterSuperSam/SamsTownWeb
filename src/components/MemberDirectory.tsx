import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { MAX_HOME_MEMBERS } from "../domain/memberPolicy";
import type { Language, TownMember } from "../domain/types";
import { useI18n } from "../i18n/I18nContext";
import { CountUp } from "./CountUp";

const memberGroups: TownMember["group"][] = ["primary", "town", "friend"];
const memberRowsPerStep = 3;
const initialMemberRows: Record<TownMember["group"], number> = {
  primary: 2,
  town: 1,
  friend: 1
};
const memberColumnCount = () => window.innerWidth <= 720 ? 2 : window.innerWidth <= 1100 ? 4 : 6;

export function FeaturedMembers({ members, language }: { members: TownMember[]; language: Language }) {
  const { t } = useI18n();
  const featured = members.filter(member => member.showOnHome).slice(0, MAX_HOME_MEMBERS);

  return <div className="featured-member-list" data-reveal-group>
    {featured.map(member => {
      const intro = (language === "zh-CN" ? member.introZh : member.introEn)
        || (language === "zh-CN" ? member.introEn : member.introZh)
        || t("home.featured.introPending");
      return <article className={`featured-member-row ${member.variant}`} key={member.id}>
        <div className="featured-member-figure"><MemberAvatar member={member} /></div>
        <div className="featured-member-copy">
          <h3>{member.username}</h3>
          <strong>{language === "zh-CN" ? member.roleZh : member.roleEn}</strong>
          <p>{intro}</p>
        </div>
      </article>;
    })}
  </div>;
}

export function MemberDirectory({ members, language }: {
  members: TownMember[];
  language: Language;
}) {
  const [columns, setColumns] = useState(memberColumnCount);

  // 三个成员分组共用一个响应式监听，分页行数仍各自维护。
  useEffect(() => {
    const update = () => setColumns(memberColumnCount());
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  return <div className="member-groups">
    {memberGroups.map(group => {
      const groupMembers = members.filter(member => member.group === group)
        .sort((left, right) => left.sortOrder - right.sortOrder);
      return groupMembers.length ? <MemberGroup group={group} members={groupMembers} language={language} columns={columns} key={group} /> : null;
    })}
  </div>;
}

function MemberGroup({ group, members, language, columns }: {
  group: TownMember["group"];
  members: TownMember[];
  language: Language;
  columns: number;
}) {
  const { t } = useI18n();
  const minimumRows = initialMemberRows[group];
  const [visibleRows, setVisibleRows] = useState(minimumRows);
  const visibleCount = visibleRows * columns;
  const hasMore = visibleCount < members.length;
  const canCollapse = visibleRows > minimumRows;
  const gridId = `member-grid-${group}`;

  return (
    <section className="member-group">
      <header><span>{t(`home.members.${group}`)}</span><CountUp value={members.length} /></header>
      <div className="member-grid" id={gridId} data-reveal-group>
        {members.slice(0, visibleCount).map(member => (
          <MemberCard member={member} language={language} key={member.id} />
        ))}
      </div>
      {hasMore || canCollapse ? <div className="member-pagination">
        {canCollapse ? <button type="button" className="member-toggle text-action" aria-controls={gridId} onClick={() => setVisibleRows(rows => Math.max(minimumRows, rows - memberRowsPerStep))}>
          <ChevronUp size={18} />{t("home.members.lessRows")}
        </button> : null}
        {hasMore ? <button type="button" className="member-toggle text-action" aria-controls={gridId} onClick={() => setVisibleRows(rows => rows + memberRowsPerStep)}>
          {t("home.members.moreRows")}<ChevronDown size={18} />
        </button> : null}
      </div> : null}
    </section>
  );
}

function MemberCard({ member, language }: {
  member: TownMember;
  language: Language;
}) {
  return <article className={`member-card ${member.variant}`}>
    <MemberAvatar member={member} />
    <div><h3>{member.username}</h3><p>{language === "zh-CN" ? member.roleZh : member.roleEn}</p></div>
  </article>;
}

export function MemberAvatar({ member }: { member: TownMember }) {
  const [failed, setFailed] = useState(false);
  const skinUrl = `https://visage.surgeplay.com/full/256/${encodeURIComponent(member.username)}`;
  return <>
    <div className="member-glow" />
    {failed ? <div className="skin-fallback">?</div> : <div className="member-avatar">
      <span className="member-outline" aria-hidden="true"><img src={skinUrl} alt="" loading="lazy" /></span>
      <img className="member-skin" src={skinUrl} alt={`${member.username} Minecraft skin`} loading="lazy" onError={() => setFailed(true)} />
    </div>}
  </>;
}
