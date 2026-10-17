import { TYPES, typeName } from "../../supabase/functions/_shared/lists.js";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountButton, useSession } from "./account.jsx";
import { SubmitPage } from "./submit.jsx";
import { RankingPage, UserPage } from "./players.jsx";
import { SearchPage } from "./search.jsx";
import { RoulettePage } from "./roulette.jsx";
import { AccountPage } from "./profile.jsx";
import classicChallenges from "./data/classic.json";
import extraChallenges from "./data/extra.json";
import extraLegacy from "./data/extra-legacy.json";
import classicLegacy from "./data/classic-legacy.json";
import platformerChallenges from "./data/platformer.json";
import platformerLegacy from "./data/platformer-legacy.json";
import "./styles.css";

const currentPath = window.location.pathname.replace(/\/index\.html$/, "").replace(/\/+$/, "") || "/";
const isHome = currentPath === "/";
const isPlatformer = currentPath === "/platformer";
const challengeType = TYPES.find(([type]) => currentPath === `/${type}/challenge`)?.[0];
const isSubmit = currentPath === "/submit";
const isRanking = currentPath === "/ranking";
const isUser = currentPath === "/user";
const isSearch = currentPath === "/search";
const isRoulette = currentPath === "/roulette";
const isAccount = currentPath === "/account";
const challengeHref = (type, challenge) => `/${type}/challenge/?levelId=${encodeURIComponent(challenge.levelId)}`;
// The fallback carries only the static halves — the map list and the archived clears.
// Live clears always come from the fetch, so nothing here can go stale into a wrong count.
const fallbackSnapshots = {
  classic: { challenges: classicChallenges, clearers: {}, legacy: classicLegacy },
  extra: { challenges: extraChallenges, clearers: {}, legacy: extraLegacy },
  platformer: { challenges: platformerChallenges, clearers: {}, legacy: platformerLegacy },
};

function Navigation({ current }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openCategory, setOpenCategory] = useState("");
  const session = useSession();
  const toggleCategory = (category) => setOpenCategory((open) => open === category ? "" : category);
  const toggleMenu = () => {
    if (menuOpen) setOpenCategory("");
    setMenuOpen(!menuOpen);
  };

  return (
    <header className="site-header">
      <div className="site-header-top">
        <a className="brand" href="/">
          <img className="brand-logo" src="/freecl-wordmark.png" alt="FreeCL" height="148" width="474" />
        </a>
        <button aria-controls="site-navigation nav-trailing" aria-expanded={menuOpen} className="menu-toggle" onClick={toggleMenu} type="button">{menuOpen ? "× CLOSE" : "☰ MENU"}</button>
        <nav aria-label="서비스 카테고리" className={menuOpen ? "menu-open" : ""} id="site-navigation">
          <a aria-current={current === "home" ? "page" : undefined} className={current === "home" ? "active" : ""} href="/">HOME</a>
          <button aria-controls="nav-level" aria-expanded={openCategory === "level"} className={TYPES.some(([type]) => current === type) ? "active" : ""} onClick={() => toggleCategory("level")} type="button">LEVEL <span aria-hidden="true">v</span></button>
          <button aria-controls="nav-ranking" aria-expanded={openCategory === "ranking"} className={current === "ranking" ? "active" : ""} onClick={() => toggleCategory("ranking")} type="button">RANKING <span aria-hidden="true">v</span></button>
          <button aria-controls="nav-search" aria-expanded={openCategory === "search"} className={current === "search" ? "active" : ""} onClick={() => toggleCategory("search")} type="button">SEARCH <span aria-hidden="true">v</span></button>
          {session && <button aria-controls="nav-extensions" aria-expanded={openCategory === "extensions"} className={current === "roulette" ? "active" : ""} onClick={() => toggleCategory("extensions")} type="button">EXTENSIONS <span aria-hidden="true">v</span></button>}
          {session && <a aria-current={current === "submit" ? "page" : undefined} className={current === "submit" ? "active" : ""} href="/submit/">SUBMIT</a>}
        </nav>
        <div className={`nav-trailing${menuOpen ? " menu-open" : ""}`} id="nav-trailing">
          <div className="nav-social">
            <a aria-label="Discord" className="social-link" href="https://discord.com/invite/MAkmJnfnG9" rel="noreferrer" target="_blank" title="Discord"><img src="/icons/discord_logo.png" alt="" /></a>
          </div>
          <AccountButton session={session} />
        </div>
      </div>
      {openCategory && (openCategory !== "extensions" || session) && <div className="nav-panel" id={`nav-${openCategory}`}><div className="nav-panel-links">
        {openCategory === "level" && <>{TYPES.map(([type, label]) => <a href={`/${type}/`} key={type}>{label}</a>)}</>}
        {openCategory === "ranking" && <>{TYPES.map(([type, label]) => <a href={`/ranking/?type=${type}`} key={type}>{label} RANKING</a>)}</>}
        {openCategory === "search" && <>{TYPES.map(([type, label]) => <a href={`/search/?tab=${type}`} key={type}>{label} SEARCH</a>)}<a href="/search/?tab=users">USER SEARCH</a></>}
        {openCategory === "extensions" && <><a className="nav-mode" href="https://github.com/jawvcl/misfire" rel="noreferrer" target="_blank">MODE</a>{session && <a aria-current={current === "roulette" ? "page" : undefined} href="/roulette/">ROULETTE</a>}</>}
      </div></div>}
    </header>
  );
}


const withNumberedChallenges = (challenges) => challenges.map((challenge, index) => ({ ...challenge, displayNumber: String(index + 1) }));

function Challenge({ challenge, href }) {
  const thumbnail = challenge.video ? <img src={`https://i.ytimg.com/vi/${challenge.video}/hqdefault.jpg`} alt={`${challenge.name} 영상 썸네일`} loading="lazy" /> : "영상 없음";
  const thumbnailClass = `thumbnail${challenge.video ? "" : " no-thumbnail"}`;

  return (
    <li className="challenge-card">
      <a className={thumbnailClass} href={href} aria-label={`${challenge.name} 상세 보기`}>{thumbnail}</a>
      <div className="challenge-content">
        <div className="challenge-title-row">
          <div className="rank" aria-label={`순위 ${challenge.displayNumber}`}>{challenge.displayNumber}</div>
          <h2><a href={href}>{challenge.name}</a></h2>
        </div>
        <p className="description">{challenge.description || "-"}</p>
      </div>
    </li>
  );
}

function Home() {

  return (
    <>
      <Navigation current="home" />
      <main className="page home-page">
        <section className="home-hero">
          <div className="home-copy">
            <h1>FreeCL</h1>
            <h2>지오메트리 대시 챌린지 리스트</h2>
            <p>지오메트리 대시(Geometry Dash)의 클래식·플랫포머 챌린지 맵 순위와 클리어 기록을 모아 두는 커뮤니티 리스트입니다.</p>
          </div>
          <picture className="home-banner-wrap">
            <source srcSet="/banner.webp" type="image/webp" />
            <img className="home-banner" src="/banner.png" alt="FreeCL GNU GPL License 배너" decoding="async" fetchPriority="high" height="540" width="960" />
          </picture>
        </section>
        <section className="home-content" aria-label="FreeCL 안내">
          <article className="home-panel">
            <h2>FreeCL에 오신 것을 환영합니다!</h2>
            <p>이 사이트는 클래식 및 플랫포머 챌린지들을 주 컨텐츠로 다양한 기능을 사용할 수 있습니다. 비로그인 기능은 클래식 맵 보기, 플랫포머 맵 보기, 랭킹 보기, 맵/유저 검색이 있으며 로그인 기능은 EXTENSIONS와 제출, 프로필 설정이 있습니다.</p>
            <p>FreeCL은 사이트와 관련한 기능을 제공하는 곳에 한해서 개인정보를 수집하고 있습니다. 또한 커뮤니티 기반의 소통으로 적극적으로 피드백을 받고 있습니다.</p>
          </article>
          <article className="home-panel home-panel-note">
            <h2>제출 기준 안내</h2>
            <p><a href="https://docs.google.com/document/d/1quGBmljguvYOFRXyDLOTvQVPIQa3pm29STTr673WrOQ/edit?tab=t.0#heading=h.21j1r6bhu3ts" rel="noreferrer" target="_blank">제출 기준 바로가기</a></p>
            <p>맵 등재 및 기록 등재를 포함한 제출 사항에 대한 안내는 해당 하이퍼링크를 통해 확인 가능합니다. 문서 탭에 있는 보기 중 가장 최신 버전의 문서를 참조하여 맵이나 기록을 제출하십시오.</p>
          </article>
        </section>
      </main>
    </>
  );
}

function ListPage({ current, title, challenges }) {
  const numberedChallenges = withNumberedChallenges(challenges);

  return (
    <>
      <Navigation current={current} />
      <main className="page">
        <section className="hero classic-hero">
          <div className="hero-copy" style={{ "--title-length": title.length }}>
            <p className="eyebrow">FREECL</p>
            <h1>{title}</h1>
            <p>{typeName(current)} 순위 리스트입니다.</p>
          </div>
          <aside className="hero-stat" aria-label={`${title} 챌린지 수`}>
            <span>{title} SNAPSHOT</span>
            <strong>{challenges.length}</strong>
            <small>ranked challenges</small>
          </aside>
        </section>
        <section className="list-toolbar" aria-label="챌린지 목록 도구">
          <p className="result-count">{numberedChallenges.length}개 챌린지</p>
          <a className="toolbar-link" href={`/search/?tab=${current}`}>검색 및 필터 →</a>
        </section>
        <ul className="challenge-list">
          {numberedChallenges.length ? numberedChallenges.map((challenge) => <Challenge key={challenge.levelId} challenge={challenge} href={challengeHref(current, challenge)} />) : <li className="empty-list">등록된 챌린지가 없습니다.</li>}
        </ul>
      </main>
    </>
  );
}

function Classic({ snapshots }) {
  return <ListPage current="classic" title="TIMED" challenges={snapshots.classic.challenges} />;
}

function Platformer({ snapshots }) {
  return <ListPage current="platformer" title="PLAT" challenges={snapshots.platformer.challenges} />;
}

function MapIdValue({ levelId }) {
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    if (!copyStatus) return undefined;
    const timer = window.setTimeout(() => setCopyStatus(""), 3000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  if (!levelId) return "-";

  const copied = copyStatus === "copied";
  const copyMapId = async () => {
    if (copied) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(String(levelId));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return <span className="map-id-value">
    <span>{levelId}</span>
    <button aria-label={copied ? "맵 ID가 복사되었습니다" : "맵 ID 복사"} className="map-id-copy-button" data-copied={copied} onClick={copyMapId} title={copied ? "복사됨" : "맵 ID 복사"} type="button">
      {copied ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m20 6-11 11-5-5" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24"><rect height="14" rx="2" width="14" x="8" y="8" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>}
    </button>
    <span aria-live="polite" className="copy-feedback">{copied ? "복사됨" : copyStatus === "failed" ? "복사 실패" : ""}</span>
  </span>;
}

// Written by the maps trigger, so it covers every move including the ones caused by
// another map being inserted above this one.
function PositionHistory({ levelId, type }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let active = true;
    import("./supabase.js")
      .then(({ fetchPositionHistory }) => fetchPositionHistory(levelId, type))
      .then((data) => { if (active) setRows(data); })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [levelId, type]);

  if (!rows?.length) return null;

  return (
    <section className="clearer-section history-section" aria-label="순위 변동 기록">
      <h3>Position History <span>{rows.length}</span></h3>
      <div className="clearer-table-wrap">
        <table className="clearers-table">
          <thead><tr><th>날짜</th><th>변동</th><th>순위</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const added = row.from_position === null;
              const rose = !added && row.to_position < row.from_position;
              return <tr key={row.id}>
                <td>{new Date(row.changed_at).toLocaleDateString("ko-KR")}</td>
                <td className={added ? "" : rose ? "rank-up" : "rank-down"}>{added ? "등재" : `${rose ? "▲" : "▼"} ${Math.abs(row.to_position - row.from_position)}`}</td>
                <td>{added ? row.to_position : `${row.from_position} → ${row.to_position}`}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ClearTable({ clears, isPlatformer, dated }) {
  return (
    <div className="clearer-table-wrap">
      <table className="clearers-table clear-table">
        <thead><tr><th>#</th><th>클리어자</th><th>{isPlatformer ? "시간" : "달성도"}</th><th>플랫폼</th>{dated && <th>제출일</th>}</tr></thead>
        <tbody>
          {clears.map((clear, index) => <tr key={`${clear.player}-${clear.submittedAt ?? index}`}>
            <td>{index + 1}</td>
            <td>
              {clear.player}
              {clear.first && <span className="first-badge">FIRST</span>}
              {clear.video && <a className="clear-video" href={`https://www.youtube.com/watch?v=${clear.video}`} rel="noreferrer" target="_blank" title="클리어 영상 보기">▶</a>}
            </td>
            <td>{isPlatformer ? `${clear.time.toFixed(3)}s` : `${clear.percent}%`}</td>
            <td>{clear.platform}</td>
            {dated && <td>{clear.submittedAt ? new Date(clear.submittedAt).toLocaleDateString("ko-KR") : "-"}</td>}
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}

// A credit that resolved to an account links to it; one that never did is imported text
// from the old spreadsheet and says so.
function Credit({ id, name }) {
  if (!name) return "-";
  if (id) return <a href={`/user/?player=${encodeURIComponent(name)}`}>{name}</a>;
  return <>{name}<span className="first-badge">레거시</span></>;
}

function ChallengeDetails({ challenge, snapshot, type }) {
  const isPlatformer = type === "platformer";
  // Already in submission order; that order is the order the maps were beaten in.
  const clears = snapshot.clearers[challenge.levelId] ?? [];
  const legacy = snapshot.legacy?.[challenge.levelId] ?? [];
  const facts = [
    ["순위", challenge.displayNumber],
    ["제작자", <Credit id={challenge.creatorId} name={challenge.creator} />],
    ["베리파이어", <Credit id={challenge.verifierId} name={challenge.verifier} />],
    ["레벨 ID", <MapIdValue levelId={challenge.levelId} />],
    ["길이", challenge.length || "-"],
    ["오브젝트 수", challenge.objectCount || "-"],
  ];

  return <>
    <table className="challenge-facts">
      <caption className="sr-only">{challenge.name} 상세 정보</caption>
      <tbody>
        {facts.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}
      </tbody>
    </table>
    <section className="clearer-section" aria-label={`${challenge.name} 클리어 기록`}>
      <h3>클리어 기록 <span>{clears.length}</span></h3>
      {clears.length ? <ClearTable clears={clears} dated isPlatformer={isPlatformer} /> : <p className="missing-video">아직 제출된 기록이 없습니다.</p>}
    </section>
    {legacy.length > 0 && <section className="clearer-section legacy-section" aria-label={`${challenge.name} 레거시 기록`}>
      <h3>레거시 기록 <span>{legacy.length}</span></h3>
      <p className="legacy-note">구 스프레드시트에서 이관된 기록입니다. 가입된 닉네임과 이름이 같으면 랭킹 점수에 반영됩니다.</p>
      <ClearTable clears={legacy} isPlatformer={isPlatformer} />
    </section>}
    <PositionHistory levelId={challenge.levelId} type={type} />
  </>;
}

// 이전 = 한 단계 높은 순위, 이후 = 한 단계 낮은 순위. index는 맵을 찾은 뒤에만 쓰이므로
// 음수가 들어올 일이 없고, 목록 양 끝은 undefined로 떨어진다.
// 화살표와 글자는 한 링크 안의 두 조각이다 — 화살표를 눌러도 그대로 이동한다.
function Neighbours({ challenges, index, type }) {
  const sides = [["이전", "←", "to-prev", challenges[index - 1]], ["이후", "→", "to-next", challenges[index + 1]]];

  return (
    <nav className="detail-neighbours" aria-label="앞뒤 순위 맵">
      {sides.map(([label, arrow, side, neighbour]) => {
        const body = <>
          <span aria-hidden="true" className="neighbour-arrow">{arrow}</span>
          <span className="neighbour-text">
            <small>{label}</small>
            <span>{neighbour ? `${neighbour.displayNumber}. ${neighbour.name}` : "없음"}</span>
          </span>
        </>;
        return neighbour
          ? <a className={side} href={challengeHref(type, neighbour)} key={label}>{body}</a>
          : <span className={`${side} neighbour-end`} key={label}>{body}</span>;
      })}
    </nav>
  );
}

function ChallengePage({ type, snapshots }) {
  const params = new URLSearchParams(window.location.search);
  const { challenges } = snapshots[type];
  const numberedChallenges = withNumberedChallenges(challenges);
  const title = typeName(type);
  const index = numberedChallenges.findIndex(({ levelId }) => levelId === params.get("levelId"));
  const challenge = numberedChallenges[index];

  return (
    <>
      <Navigation current={type} />
      <main className="page detail-page">
        <a className="back-link" href={`/${type}/`}>← {title} 목록</a>
        {!challenge ? <section className="missing-challenge"><h1>챌린지를 찾을 수 없습니다.</h1></section> : <>
          <header className="detail-heading">
            <div className="rank" aria-label={`순위 ${challenge.displayNumber}`}>{challenge.displayNumber}</div>
            {/* 순위 박스가 이 칸의 높이를 그대로 받도록, 아이브로우와 이름만 첫 행에 둔다. */}
            <div className="detail-title">
              <p className="eyebrow">{title} CHALLENGE</p>
              <h1 style={{ "--len": challenge.name.length }}>{challenge.name}</h1>
            </div>
            <p className="detail-description">{challenge.description || "-"}</p>
            <Neighbours challenges={numberedChallenges} index={index} type={type} />
          </header>
          <section className="detail-video" aria-labelledby="video-title">
            <h2 id="video-title">영상 보기</h2>
            {challenge.video ? <div className="youtube-frame"><iframe src={`https://www.youtube-nocookie.com/embed/${challenge.video}`} title={`${challenge.name} 플레이 영상`} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div> : <p className="missing-video">등록된 영상이 없습니다.</p>}
          </section>
          <section className="detail-data" aria-labelledby="details-title">
            <h2 id="details-title">상세 정보</h2>
            <ChallengeDetails challenge={challenge} snapshot={snapshots[type]} type={type} />
          </section>
        </>}
      </main>
    </>
  );
}

function App() {
  const [snapshots, setSnapshots] = useState(fallbackSnapshots);

  useEffect(() => {
    if (isHome || isRanking || isUser || isSearch || isAccount) return undefined;
    let active = true;
    import("./supabase.js")
      .then(({ fetchSnapshots }) => fetchSnapshots())
      .then((remote) => { if (active) setSnapshots(remote); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (isSearch) return <SearchPage Navigation={Navigation} />;
  if (isRanking) return <RankingPage Navigation={Navigation} />;
  if (isUser) return <UserPage Navigation={Navigation} />;
  if (isAccount) return <AccountPage Navigation={Navigation} />;
  if (isRoulette) return <RoulettePage Navigation={Navigation} snapshots={snapshots} />;
  if (isSubmit) return <SubmitPage Navigation={Navigation} snapshots={snapshots} />;
  if (currentPath === "/extra") return <ListPage current="extra" title="EXTRA" challenges={snapshots.extra.challenges} />;
  return challengeType ? <ChallengePage type={challengeType} snapshots={snapshots} /> : isHome ? <Home /> : isPlatformer ? <Platformer snapshots={snapshots} /> : <Classic snapshots={snapshots} />;
}

createRoot(document.getElementById("root")).render(<App />);
