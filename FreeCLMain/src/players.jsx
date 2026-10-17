import { TYPES } from "../../supabase/functions/_shared/lists.js";
import { useEffect, useState } from "react";

const userHref = (player) => `/user/?player=${encodeURIComponent(player)}`;

function useRemote(load, deps) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    load().then((data) => active && setState({ data })).catch((error) => active && setState({ error: error.message }));
    return () => { active = false; };
  }, deps);
  return state;
}

export function RankingPage({ Navigation }) {
  const [type, setType] = useState(TYPES.find(([value]) => value === new URLSearchParams(window.location.search).get("type"))?.[0] ?? "classic");
  const { data, error, loading } = useRemote(() => import("./supabase.js").then(({ fetchRankings }) => fetchRankings(type)), [type]);

  const rows = data ?? [];

  return <>
    <Navigation current="ranking" />
    <main className="page">
      <header className="detail-heading"><div><p className="eyebrow">FreeCL</p><h1>RANKING</h1><p>클리어한 맵의 순위가 높을수록 점수가 큽니다. 100위까지 표시합니다.</p></div></header>
      <section className="list-toolbar" aria-label="랭킹 도구">
        <div className="account-tabs" role="tablist">
          {TYPES.map(([value, label]) => <button aria-selected={type === value} key={value} onClick={() => setType(value)} role="tab" type="button">{label}</button>)}
        </div>
      </section>
      {error ? <p className="missing-video">랭킹을 불러오지 못했습니다. ({error})</p>
        : loading ? <p className="missing-video">불러오는 중…</p>
        : <div className="clearer-table-wrap">
            <table className="clearers-table ranking-table">
              <thead><tr><th>순위</th><th>플레이어</th><th>점수</th><th>클리어</th></tr></thead>
              <tbody>
                {rows.length ? rows.map((row) => <tr key={row.player}>
                  <td>{row.position}</td>
                  <td><a href={userHref(row.player)}>{row.player}</a></td>
                  <td>{row.points}</td>
                  <td>{row.clears}</td>
                </tr>) : <tr><td colSpan="4">해당하는 플레이어가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>}
    </main>
  </>;
}

export function UserPage({ Navigation }) {
  const player = new URLSearchParams(window.location.search).get("player") ?? "";
  const { data, error, loading } = useRemote(() => import("./supabase.js").then(({ fetchPlayer }) => fetchPlayer(player)), [player]);

  if (loading || error || !data) {
    return <>
      <Navigation current="search" />
      <main className="page"><p className="missing-video">{error ? `불러오지 못했습니다. (${error})` : "불러오는 중…"}</p></main>
    </>;
  }

  const { totals, clears, profile } = data;
  const bio = profile?.bio || (totals.length ? `${clears.length}개 맵 클리어` : "등록된 클리어 기록이 없습니다.");
  const byType = (type) => clears
    .filter((row) => row.maps.type === type)
    .sort((a, b) => a.maps.position - b.maps.position);

  return <>
    <Navigation current="search" />
    <main className="page detail-page">
      <a className="back-link" href="/search/?tab=users">← USER SEARCH</a>
      <header className="detail-heading profile-heading">
        <div className={`avatar${profile?.avatar_url ? "" : " avatar-empty"}`}>
          {profile?.avatar_url
            ? <img alt={`${player} 프로필 사진`} src={profile.avatar_url} />
            : <span aria-hidden="true">{player.slice(0, 1).toLocaleUpperCase()}</span>}
        </div>
        <div className="profile-name">
          <p className="eyebrow">PLAYER</p>
          <h1 style={{ "--len": player.length }}>{player}</h1>
        </div>
        {/* Below the row, at full width: the clear count is already on the stat cards. */}
        <p className="profile-bio" style={{ "--bio-len": bio.length }}>{bio}</p>
      </header>
      <section className="stat-row" aria-label="플레이어 스탯">
        {TYPES.map(([type, label]) => {
          const total = totals.find((row) => row.type === type);
          return <article className="stat-card" key={type}>
            <span>{label}</span>
            <strong>{total ? `${total.points}` : "-"}</strong>
            <small>{total ? `${total.position}위 · ${total.clears}클리어` : "기록 없음"}</small>
          </article>;
        })}
      </section>
      {TYPES.map(([type, label]) => {
        const rows = byType(type);
        if (!rows.length) return null;
        return <section className="clearer-section" key={type} aria-label={`${label} 클리어 기록`}>
          <h3>{label} <span>{rows.length}</span></h3>
          <div className="clearer-table-wrap">
            <table className="clearers-table">
              <thead><tr><th>순위</th><th>맵</th><th>{type === "platformer" ? "시간" : "달성도"}</th><th>플랫폼</th></tr></thead>
              <tbody>
                {rows.map((row) => <tr key={row.level_id}>
                  <td>{row.maps.position}</td>
                  <td>
                    <a href={`/${type}/challenge/?levelId=${encodeURIComponent(row.level_id)}`}>{row.maps.name}</a>
                    {row.first && <span className="first-badge">FIRST</span>}
                    {row.kind === "verified" && <span className="first-badge">VERIFIER</span>}
                  </td>
                  <td>{row.kind === "verified" ? "-" : type === "platformer" ? `${Number(row.time).toFixed(3)}s` : `${row.percent}%`}</td>
                  <td>{row.platform || "-"}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>;
      })}
    </main>
  </>;
}
