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

export function MemberDirectory({ members, language, linkProfiles = true }: {
  members: TownMember[];
  language: Language;
  linkProfiles?: boolean;
}) {
  const grouped = new Map(memberGroups.map(group => [
    group,
    members.filter(member => member.group === group).sort((left, right) => left.sortOrder - right.sortOrder)
  ]));

  return <div className="member-groups">
    {memberGroups.flatMap(group => {
      const groupMembers = grouped.get(group) ?? [];
      return groupMembers.length ? [
        <MemberGroup group={group} members={groupMembers} language={language} linkProfiles={linkProfiles} key={group} />
      ] : [];
    })}
  </div>;
}

function MemberGroup({ group, members, language, linkProfiles }: {
  group: TownMember["group"];
  members: TownMember[];
  language: Language;
  linkProfiles: boolean;
}) {
  const { t } = useI18n();
  const [columns, setColumns] = useState(() => window.innerWidth <= 720 ? 2 : window.innerWidth <= 1100 ? 4 : 6);
  const minimumRows = initialMemberRows[group];
  const [visibleRows, setVisibleRows] = useState(minimumRows);
  const visibleCount = visibleRows * columns;
  const hasMore = visibleCount < members.length;
  const canCollapse = visibleRows > minimumRows;
  const gridId = `member-grid-${group}`;

  useEffect(() => {
    const update = () => setColumns(window.innerWidth <= 720 ? 2 : window.innerWidth <= 1100 ? 4 : 6);
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <section className="member-group">
      <header><span>{t(`home.members.${group}`)}</span><CountUp value={members.length} /></header>
      <div className="member-grid" id={gridId} data-reveal-group>
        {members.slice(0, visibleCount).map(member => (
          <MemberCard member={member} language={language} linkProfile={linkProfiles} key={member.id} />
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

function MemberCard({ member, language, linkProfile }: {
  member: TownMember;
  language: Language;
  linkProfile: boolean;
}) {
  const content = <>
    <MemberAvatar member={member} />
    <div><h3>{member.username}</h3><p>{language === "zh-CN" ? member.roleZh : member.roleEn}</p></div>
  </>;
  return linkProfile
    ? <a className={`member-card ${member.variant}`} href={nameMcUrl(member.username)} target="_blank" rel="noreferrer">{content}</a>
    : <article className={`member-card ${member.variant}`}>{content}</article>;
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

const nameMcUrl = (username: string) => `https://namemc.com/profile/${encodeURIComponent(username)}`;
