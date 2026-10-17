import { TYPES, tableFor } from "../../supabase/functions/_shared/lists.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase.js";

// A record scores only when it belongs to an account, so the player is picked from
// registered nicknames rather than typed. The pick travels in two hidden inputs.
function PlayerPicker({ initial }) {
  const [picked, setPicked] = useState(initial);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    // % and _ are ilike wildcards, and , ( ) would read as PostgREST syntax.
    const needle = query.replace(/[%_,()]/g, " ").trim();
    if (!needle) return setMatches([]);
    let active = true;
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id, username").ilike("username", `%${needle}%`).order("username").limit(8);
      if (active) setMatches(data ?? []);
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  return <div className="player-picker">
    <input name="player" type="hidden" value={picked?.username ?? ""} />
    <input name="user_id" type="hidden" value={picked?.id ?? ""} />
    {picked
      ? <label><span>플레이어</span><span className="picked-player"><strong>{picked.username}</strong><button className="ghost" onClick={() => setPicked(null)} type="button">변경</button></span></label>
      : <>
          <label><span>플레이어</span><input onChange={(event) => setQuery(event.target.value)} placeholder="닉네임 검색" type="search" value={query} /></label>
          {query.trim() && (matches.length
            ? <div className="player-matches">{matches.map((row) => <button className="ghost" key={row.id} onClick={() => { setPicked(row); setQuery(""); }} type="button">{row.username}</button>)}</div>
            : <p className="muted">가입된 닉네임이 없습니다.</p>)}
        </>}
  </div>;
}

function RecordFields({ type, record = {} }) {
  return <>
    <PlayerPicker initial={record.user_id ? { id: record.user_id, username: record.player } : null} />
    {type === "platformer"
      ? <label><span>기록 (초)</span><input defaultValue={record.time ?? ""} name="time" step="0.001" min="0.001" type="number" required /></label>
      : <label><span>달성도 (%)</span><input defaultValue={record.percent ?? ""} name="percent" max="100" min="1" type="number" required /></label>}
    <label><span>플랫폼</span><input defaultValue={record.platform ?? ""} name="platform" required /></label>
    <label><span>클리어 영상 ID</span><input defaultValue={record.video ?? ""} name="video" /></label>
    <label><span>비고</span><input defaultValue={record.note ?? ""} name="note" /></label>
    <label><span>제출일시</span><input defaultValue={record.submitted_at ? record.submitted_at.slice(0, 16) : ""} name="submitted_at" type="datetime-local" /></label>
  </>;
}

const readFields = (form) => {
  const values = Object.fromEntries(new FormData(form));
  return {
    player: values.player,
    user_id: values.user_id || null,
    platform: values.platform,
    video: values.video?.trim() ?? "",
    note: values.note || null,
    percent: values.percent ? Number(values.percent) : null,
    time: values.time ? Number(values.time) : null,
    // Clears are listed in this order, so an admin has to be able to correct it.
    ...(values.submitted_at ? { submitted_at: new Date(values.submitted_at).toISOString() } : {}),
  };
};

function EditRecord({ record, onSaved, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const patch = readFields(event.currentTarget);
    if (!patch.user_id) { setBusy(false); return setError("플레이어를 검색해서 선택해 주세요."); }
    const { error: failure } = await supabase.from(tableFor(record.maps.type, "records")).update(patch).eq("id", record.id);
    setBusy(false);
    if (failure) return setError(failure.message);
    onSaved();
  };

  return <form className="map-edit" onSubmit={save}>
    <RecordFields record={record} type={record.maps.type} />
    <div className="entry-actions">
      <button disabled={busy} type="submit">저장</button>
      <button className="ghost" onClick={onCancel} type="button">취소</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function CreateRecord({ maps, onCreated, onCancel }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const needle = query.trim().toLocaleLowerCase();
  const matches = needle ? maps.filter((map) => [map.name, map.creator, map.level_id].some((value) => (value ?? "").toLocaleLowerCase().includes(needle))).slice(0, 6) : [];

  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = readFields(event.currentTarget);
    if (!values.user_id) { setBusy(false); return setError("플레이어를 검색해서 선택해 주세요."); }
    // A duplicate or a worse time is refused by the records trigger; its message shows below.
    const { error: failure } = await supabase.from(tableFor(picked.type, "records")).insert({ ...values, level_id: picked.level_id });
    setBusy(false);
    if (failure) return setError(failure.message);
    onCreated();
  };

  if (!picked) {
    return <div className="map-edit">
      <label style={{ gridColumn: "1 / -1" }}><span>맵 검색</span><input onChange={(event) => setQuery(event.target.value)} placeholder="이름, 제작자, 레벨 ID" type="search" value={query} /></label>
      {matches.map((map) => <button className="ghost" key={map.level_id} onClick={() => setPicked(map)} type="button">{map.position}. {map.name}</button>)}
      <div className="entry-actions"><button className="ghost" onClick={onCancel} type="button">취소</button></div>
    </div>;
  }

  return <form className="map-edit" onSubmit={create}>
    <label style={{ gridColumn: "1 / -1" }}><span>맵</span><input disabled value={`${picked.name} · ${picked.level_id}`} /></label>
    <RecordFields type={picked.type} />
    <div className="entry-actions">
      <button disabled={busy} type="submit">추가</button>
      <button className="ghost" onClick={() => setPicked(null)} type="button">맵 변경</button>
      <button className="ghost" onClick={onCancel} type="button">취소</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function RecordRow({ record, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const isPlatformer = record.maps.type === "platformer";

  const remove = async () => {
    if (!window.confirm(`${record.player} 의 ${record.maps.name} 기록을 삭제할까요?`)) return;
    const { error: failure } = await supabase.from(tableFor(record.maps.type, "records")).delete().eq("id", record.id);
    if (failure) return setError(failure.message);
    onChanged();
  };

  return <li className="entry">
    <header>
      <span className="badge">{isPlatformer ? `${Number(record.time).toFixed(3)}s` : `${record.percent}%`}</span>
      <strong>{record.player}</strong>
      {record.first && <span className="badge badge-soft">FIRST</span>}
      {record.video && <a href={`https://www.youtube.com/watch?v=${record.video}`} rel="noreferrer" target="_blank">영상</a>}
      <span className="entry-meta">{record.maps.name} · {record.platform || "플랫폼 미상"} · {new Date(record.submitted_at).toLocaleDateString("ko-KR")}</span>
    </header>
    {record.note && <p className="entry-note">{record.note}</p>}
    {editing
      ? <EditRecord onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} record={record} />
      : <div className="entry-actions">
          <button className="ghost" onClick={() => setEditing(true)} type="button">편집</button>
          <button className="ghost danger" onClick={remove} type="button">삭제</button>
        </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </li>;
}

export function Records() {
  const [type, setType] = useState("classic");
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ records: null, maps: [] });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const requestId = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestId.current;
    const [records, maps] = await Promise.all([
      supabase.from(tableFor(type, "records")).select(`*, maps:${tableFor(type, "maps")}!inner(name, type, position)`).eq("maps.type", type).order("submitted_at"),
      supabase.from(tableFor(type, "maps")).select("level_id, name, creator, type, position").eq("type", type).order("position"),
    ]);
    if (request !== requestId.current) return;
    setError(records.error?.message ?? maps.error?.message ?? "");
    setState({ records: records.data ?? [], maps: maps.data ?? [] });
  }, [type]);

  useEffect(() => { setState({ records: null, maps: [] }); load(); return () => { requestId.current++; }; }, [load]);

  const needle = query.trim().toLocaleLowerCase();
  const visible = (state.records ?? []).filter((record) => !needle || [record.player, record.maps.name, record.level_id, record.platform, record.note].some((value) => (value ?? "").toLocaleLowerCase().includes(needle)));

  return <section className="queue">
    <div className="filters">
      <div className="account-tabs" role="tablist">
        {/* Locked while a new record is open: the map list it searches belongs to this tab. */}
        {TYPES.map(([value, label]) => <button aria-selected={type === value} disabled={creating} key={value} onClick={() => setType(value)} role="tab" type="button">{label}</button>)}
      </div>
      <input onChange={(event) => setQuery(event.target.value)} aria-label="기록 검색" placeholder="플레이어, 맵 이름, 레벨 ID, 플랫폼, 비고" type="search" value={query} />
      <button onClick={() => setCreating((open) => !open)} type="button">{creating ? "닫기" : "새 기록"}</button>
    </div>
    {creating && <CreateRecord maps={state.maps} onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
    {error && <p className="error" role="alert">{error}</p>}
    {state.records === null ? <p className="muted">불러오는 중…</p>
      : visible.length === 0 ? <p className="muted">기록이 없습니다.</p>
      : <ul className="entries">{visible.map((record) => <RecordRow key={`${record.maps.type}:${record.id}`} onChanged={load} record={record} />)}</ul>}
  </section>;
}
