import { TYPES, typeName } from "../../supabase/functions/_shared/lists.js";
import { useEffect, useState } from "react";

const TABS = [...TYPES, ["users", "유저"]];
const MAP_DEFAULTS = { from: "", to: "" };

function Filters({ values, onChange, fields }) {
  return <div className="filter-row">
    {fields.map(({ name, label, options, ...input }) => <label key={name}>
      <span>{label}</span>
      {options
        ? <select onChange={(event) => onChange({ ...values, [name]: event.target.value })} value={values[name]}>
            {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        : <input {...input} onChange={(event) => onChange({ ...values, [name]: event.target.value })} value={values[name]} />}
    </label>)}
  </div>;
}

function MapResults({ maps }) {
  if (!maps.length) return <p className="missing-video">일치하는 맵이 없습니다.</p>;
  return <ul className="challenge-list search-list">
    {maps.map((map) => <li className="challenge-card" key={map.level_id}>
      <a className={`thumbnail${map.video ? "" : " no-thumbnail"}`} href={`/${map.type}/challenge/?levelId=${encodeURIComponent(map.level_id)}`} aria-label={`${map.name} 상세 보기`}>
        {map.video ? <img alt="" loading="lazy" src={`https://i.ytimg.com/vi/${map.video}/hqdefault.jpg`} /> : "영상 없음"}
      </a>
      <div className="challenge-content">
        <div className="challenge-title-row">
          <div className="rank">{map.position}</div>
          <h2><a href={`/${map.type}/challenge/?levelId=${encodeURIComponent(map.level_id)}`}>{map.name}</a></h2>
        </div>
        <p className="description">{typeName(map.type)} · {map.creator || "제작자 미상"} · {map.level_id}</p>
      </div>
    </li>)}
  </ul>;
}

function UserResults({ users }) {
  if (!users.length) return <p className="missing-video">일치하는 유저가 없습니다.</p>;
  return <ul className="user-search-results">
    {users.map(({ username }) => <li key={username}><a href={`/user/?player=${encodeURIComponent(username)}`}>{username}</a></li>)}
  </ul>;
}

export function SearchPage({ Navigation }) {
  const [query, setQuery] = useState(new URLSearchParams(window.location.search).get("q") ?? "");
  const initialTab = new URLSearchParams(window.location.search).get("tab");
  const [tab, setTab] = useState(["classic", "extra", "platformer", "users"].includes(initialTab) ? initialTab : "classic");
  const [mapFilters, setMapFilters] = useState(MAP_DEFAULTS);
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let active = true;
    setState({ loading: true });
    // Typing should not fire a request per keystroke.
    const timer = window.setTimeout(async () => {
      try {
        const { searchMaps, searchProfiles } = await import("./supabase.js");
        const [maps, users] = await Promise.all([
          tab === "users" ? [] : searchMaps(query, { ...mapFilters, type: tab }),
          tab === "users" ? searchProfiles(query, 100) : [],
        ]);
        if (active) setState({ maps, users });
      } catch (error) {
        if (active) setState({ error: error.message });
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, tab, mapFilters]);

  const showMaps = tab !== "users";

  return <>
    <Navigation current="search" />
    <main className="page">
      <header className="detail-heading"><div><p className="eyebrow">FreeCL</p><h1>SEARCH</h1><p>맵과 유저를 찾습니다.</p></div></header>
      <section className="search-panel" aria-label="검색 조건">
        <label className="search">
          <span>검색어</span>
          <input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder={tab === "users" ? "닉네임 검색" : "맵 이름, 제작자, 레벨 ID, 플레이어"} type="search" value={query} />
        </label>
        <div className="account-tabs" role="tablist">
          {TABS.map(([value, label]) => <button aria-selected={tab === value} key={value} onClick={() => setTab(value)} role="tab" type="button">{label}</button>)}
        </div>
        {showMaps ? <Filters fields={[
          { name: "from", label: "순위 이상", inputMode: "numeric", placeholder: "1" },
          { name: "to", label: "순위 이하", inputMode: "numeric", placeholder: "마지막" },
        ]} onChange={setMapFilters} values={mapFilters} /> : null}
      </section>

      {state.error ? <p className="missing-video">검색에 실패했습니다. ({state.error})</p>
        : state.loading ? <p className="missing-video">불러오는 중…</p>
        : <>
            {showMaps
              ? <section className="clearer-section" aria-label="맵 결과">
                  <h3>{typeName(tab)} <span>{state.maps.length}</span></h3>
                  <MapResults maps={state.maps} />
                </section>
              : <section className="clearer-section" aria-label="유저 결과">
                  <h3>유저 <span>{state.users.length}</span></h3>
                  <UserResults users={state.users} />
                </section>}
          </>}
    </main>
  </>;
}
