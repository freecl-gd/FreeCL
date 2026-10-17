import { TYPES, typeName, tableFor, lengthError } from "../../supabase/functions/_shared/lists.js";
import { useEffect, useState } from "react";
import { useCaptcha, useSession } from "./account.jsx";
import { callFunction, searchProfiles, supabase } from "./supabase.js";

const PLATFORM_HINT = "예: CBF, CBS, 120TPS, 240TPS";
const STATUS_LABEL = { pending: "대기", approved: "승인", rejected: "거부" };

function Field({ label, hint, ...input }) {
  return <label>
    <span>{label}{hint && <small>{hint}</small>}</span>
    <input {...input} />
  </label>;
}

// Credits have to point at a real account, so the field is a search over profiles rather
// than a free text box. A name that was never an account stays legacy on the map page.
function UserPicker({ hint, label, onSelect, value }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) return setMatches([]);
    let active = true;
    const timer = window.setTimeout(() => {
      searchProfiles(needle).then((rows) => active && setMatches(rows)).catch(() => active && setMatches([]));
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  if (value) {
    return <div className="picked">
      <span><small>{label}</small> <strong>{value}</strong></span>
      <button className="link-button" onClick={() => onSelect("")} type="button">변경</button>
    </div>;
  }

  return <div className="picker">
    <label><span>{label}<small>{hint}</small></span><input onChange={(event) => setQuery(event.target.value)} placeholder="닉네임 검색" type="search" value={query} /></label>
    {query.trim() !== "" && <ul className="picker-results">
      {matches.length ? matches.map((row) => (
        <li key={row.id}>
          <button onClick={() => { onSelect(row.username); setQuery(""); }} type="button"><strong>{row.username}</strong></button>
        </li>
      )) : <li className="picker-empty">가입된 닉네임이 없습니다.</li>}
    </ul>}
  </div>;
}

function MapForm() {
  const captcha = useCaptcha();
  const [type, setType] = useState("classic");
  const [credits, setCredits] = useState({ creator: "", verifier: "" });
  const [state, setState] = useState({});

  const submit = async (event) => {
    event.preventDefault();
    setState({ busy: true });
    const form = event.currentTarget;
    try {
      const invalidLength = lengthError(type, new FormData(form).get("length"));
      if (invalidLength) throw new Error(invalidLength);
      await callFunction("submit", { kind: "map", captchaToken: captcha.token, ...Object.fromEntries(new FormData(form)), ...credits });
      form.reset();
      setType("classic");
      setCredits({ creator: "", verifier: "" });
      setState({ done: "등재 신청을 접수했습니다. 관리자 검토 후 반영됩니다." });
    } catch (failure) {
      setState({ error: failure.message });
    }
    captcha.reset();
  };

  return <form className="submit-form map-form" onSubmit={submit}>
    <label>
      <span>분류</span>
      <select name="type" onChange={(event) => setType(event.target.value)} value={type}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </label>
    <Field label="맵 이름" name="name" maxLength="80" required />
    <Field label="레벨 ID" name="levelId" hint="숫자만" inputMode="numeric" pattern="\d+" maxLength="20" required />
    <Field label="영상" name="video" hint="YouTube 주소 또는 ID" maxLength="200" />
    <UserPicker hint="가입된 닉네임만" label="제작자" onSelect={(creator) => setCredits({ ...credits, creator })} value={credits.creator} />
    <UserPicker hint="가입된 닉네임만" label="베리파이어" onSelect={(verifier) => setCredits({ ...credits, verifier })} value={credits.verifier} />
    <Field disabled={type === "platformer"} required={type !== "platformer"} hint={type === "platformer" ? "플랫포머는 없음" : type === "extra" ? "1:00–9:59 (예: 1:30)" : "1–59초 (예: 23s)"} label="길이" maxLength="20" name="length" />
    <Field label="오브젝트 수" name="objectCount" inputMode="numeric" maxLength="20" />
    <label><span>설명<small>120자 이하</small></span><textarea maxLength="120" name="description" rows="3" /></label>
    {captcha.element}
    <button disabled={state.busy || !captcha.ready} type="submit">{state.busy ? "제출 중…" : "등재 신청"}</button>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.done && <p className="ok" role="status">{state.done}</p>}
  </form>;
}

// 순위가 뒤로 갈수록 더 높은 달성도를 요구한다. 1위 30%에서 마지막 순위 약 80%까지 선형.
// Edge Function에도 같은 식이 있다 — 여기 것은 안내용이고, 막는 쪽은 서버다.
const minPercent = (position, total) => Math.round(30 + ((position - 1) / Math.max(total, 1)) * 50);

function MapPicker({ challenges, selected, onSelect }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? challenges.filter((challenge) => [challenge.name, challenge.creator, challenge.levelId].some((value) => value.toLocaleLowerCase().includes(needle))).slice(0, 8)
    : [];

  if (selected) {
    return <div className="picked">
      <span><strong>{selected.name}</strong> <small>{typeName(selected.type)} · {selected.levelId}</small></span>
      <button className="link-button" onClick={() => onSelect(null)} type="button">변경</button>
    </div>;
  }

  return <div className="picker">
    <label><span>맵 검색</span><input onChange={(event) => setQuery(event.target.value)} placeholder="이름, 제작자, 레벨 ID" type="search" value={query} /></label>
    {needle !== "" && <ul className="picker-results">
      {matches.length ? matches.map((challenge) => (
        <li key={challenge.levelId}>
          <button onClick={() => { onSelect(challenge); setQuery(""); }} type="button">
            <strong>{challenge.name}</strong>
            <small>{typeName(challenge.type)} · {challenge.creator || "제작자 미상"} · {challenge.levelId}</small>
          </button>
        </li>
      )) : <li className="picker-empty">일치하는 맵이 없습니다.</li>}
    </ul>}
  </div>;
}

function RecordForm({ challenges }) {
  const [type, setType] = useState("classic");
  const [selected, setSelected] = useState(null);
  const captcha = useCaptcha();
  const [state, setState] = useState({});
  const isPlatformer = selected?.type === "platformer";
  const floor = selected && !isPlatformer ? minPercent(selected.position, selected.total) : 1;

  const submit = async (event) => {
    event.preventDefault();
    // Enter in the search box submits the form before a map is picked.
    if (!selected) return setState({ error: "목록에 없는 레벨입니다. 검색 후 뜨는 리스트에서 선택해주세요." });
    setState({ busy: true });
    const form = event.currentTarget;
    try {
      await callFunction("submit", { kind: "record", captchaToken: captcha.token, type: selected.type, levelId: selected.levelId, ...Object.fromEntries(new FormData(form)) });
      form.reset();
      setSelected(null);
      setState({ done: "클리어 기록을 접수했습니다. 관리자 검토 후 반영됩니다." });
    } catch (failure) {
      setState({ error: failure.message });
    }
    captcha.reset();
  };

  return <form className="submit-form record-form" onSubmit={submit}>
    <label><span>분류</span><select value={type} onChange={(event) => { setType(event.target.value); setSelected(null); setState({}); }}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <MapPicker key={type} challenges={challenges.filter((challenge) => challenge.type === type)} onSelect={setSelected} selected={selected} />
    {selected && <>
      {isPlatformer
        ? <Field label="기록 시간" name="time" hint="초 단위, 예: 2.975" inputMode="decimal" step="0.001" min="0.001" type="number" required />
        : <Field label="달성도" name="percent" hint={`${floor}–100 · ${selected.position}위 맵`} inputMode="numeric" max="100" min={floor} type="number" required />}
      <Field label="플랫폼" name="platform" hint={PLATFORM_HINT} maxLength="40" required />
      <Field label="클리어 영상" name="video" hint="YouTube 주소 또는 ID" maxLength="200" required />
      {captcha.element}
      <button disabled={state.busy || !captcha.ready} type="submit">{state.busy ? "제출 중…" : "기록 제출"}</button>
    </>}
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.done && <p className="ok" role="status">{state.done}</p>}
  </form>;
}

// Filter by account as well as RLS: admins also have permission to read other users.
function MySubmissions({ challenges, userId }) {
  const [type, setType] = useState("classic");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setRows(null);
    supabase.from(tableFor(type, "submissions")).select("id, kind, type, status, payload, note, created_at").eq("user_id", userId).eq("type", type).order("created_at", { ascending: false }).limit(100)
      .then(({ data, error: failure }) => { if (!active) return; setError(failure?.message ?? ""); setRows(data ?? []); });
    return () => { active = false; };
  }, [userId, type]);

  const nameOf = (levelId) => challenges.find((challenge) => challenge.type === type && challenge.levelId === levelId)?.name ?? levelId;
  const detail = (row) => (row.kind === "map"
    ? `${row.payload.name} (${row.payload.levelId})`
    : `${nameOf(row.payload.levelId)} · ${row.payload.time === undefined ? `${row.payload.percent}%` : `${row.payload.time}s`}`);

  return <>
    <div className="account-tabs" role="tablist">{TYPES.map(([value, label]) => <button key={value} role="tab" aria-selected={type === value} onClick={() => setType(value)} type="button">{label}</button>)}</div>
    {error ? <p className="error" role="alert">{error}</p> : rows === null ? <p className="muted">불러오는 중…</p> : !rows.length ? <p className="muted">아직 제출한 내역이 없습니다.</p> : <div className="clearer-table-wrap">
    <table className="clearers-table my-submissions">
      <thead><tr><th>신청일</th><th>종류</th><th>내용</th><th>상태</th><th>비고</th></tr></thead>
      <tbody>
        {rows.map((row) => <tr key={row.id}>
          <td>{new Date(row.created_at).toLocaleDateString("ko-KR")}</td>
          <td>{row.kind === "map" ? "맵 등재" : "클리어 기록"}</td>
          <td>{detail(row)}</td>
          <td className={`status-${row.status}`}>{STATUS_LABEL[row.status]}</td>
          <td>{row.note || "-"}</td>
        </tr>)}
      </tbody>
    </table>
  </div>}
  </>;
}

export function SubmitPage({ Navigation, snapshots }) {
  const session = useSession();
  const [tab, setTab] = useState("map");
  // 순위(position)와 목록 길이를 함께 실어 보낸다 — 기록 폼의 최소 달성도가 그 둘로 정해진다.
  const challenges = TYPES.flatMap(([type]) => snapshots[type].challenges.map((challenge, index, all) => ({ ...challenge, type, position: index + 1, total: all.length })));

  return <>
    <Navigation current="submit" />
    <main className="page submit-page">
      <header className="detail-heading"><div><p className="eyebrow">FreeCL</p><h1>SUBMIT</h1></div></header>
      {session === undefined ? <p className="muted">불러오는 중…</p>
        : !session ? <p className="muted">제출하려면 먼저 로그인해 주세요. 오른쪽 위 로그인 버튼을 눌러 주세요.</p>
        : <>
          <div className="account-tabs" role="tablist">
            <button aria-selected={tab === "map"} onClick={() => setTab("map")} role="tab" type="button">맵 등재 신청</button>
            <button aria-selected={tab === "record"} onClick={() => setTab("record")} role="tab" type="button">클리어 기록</button>
            <button aria-selected={tab === "mine"} onClick={() => setTab("mine")} role="tab" type="button">내 신청 현황</button>
          </div>
          {tab === "map" ? <MapForm /> : tab === "record" ? <RecordForm challenges={challenges} /> : <MySubmissions challenges={challenges} userId={session.user.id} />}
        </>}
    </main>
  </>;
}
