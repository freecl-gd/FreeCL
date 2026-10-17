import { TYPES, tableFor, lengthError } from "../../supabase/functions/_shared/lists.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase.js";

const EDITABLE = [["name", "이름"], ["creator", "제작자"], ["verifier", "베리파이어"], ["video", "영상 ID"], ["length", "길이"], ["object_count", "오브젝트"], ["description", "설명"]];
const CREATE_FIELDS = [["name", "이름"], ["creator", "제작자"], ["verifier", "베리파이어"], ["video", "영상 ID"], ["length", "길이"], ["objectCount", "오브젝트"], ["description", "설명"]];

function EditForm({ map, onSaved, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const patch = Object.fromEntries(new FormData(event.currentTarget));
    const invalidLength = lengthError(map.type, patch.length);
    if (invalidLength) { setBusy(false); return setError(invalidLength); }
    // level_id is the public id of the map and its page, and records point at it. Not editable.
    const { error: failure } = await supabase.from(tableFor(map.type, "maps")).update(patch).eq("level_id", map.level_id);
    setBusy(false);
    if (failure) return setError(failure.message);
    onSaved();
  };

  return <form className="map-edit" onSubmit={save}>
    {EDITABLE.map(([key, label]) => <label key={key}><span>{label}</span><input defaultValue={map[key] ?? ""} name={key} /></label>)}
    <div className="entry-actions">
      <button disabled={busy} type="submit">저장</button>
      <button className="ghost" onClick={onCancel} type="button">취소</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function CreateForm({ type, onCreated, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const { position, ...payloadFields } = payload;
    const invalidLength = lengthError(type, payloadFields.length);
    if (invalidLength) { setBusy(false); return setError(invalidLength); }
    const { error: failure } = await supabase.rpc(tableFor(type, "create_map"), { p_payload: payloadFields, p_type: type, p_position: position ? Number(position) : null });
    setBusy(false);
    if (failure) return setError(failure.message);
    onCreated();
  };

  return <form className="map-edit" onSubmit={create}>
    <label><span>레벨 ID</span><input inputMode="numeric" name="levelId" required /></label>
    <label><span>순위</span><input inputMode="numeric" name="position" placeholder="비우면 맨 뒤" /></label>
    {CREATE_FIELDS.map(([key, label]) => <label key={key}><span>{label}</span><input name={key} required={key === "name"} /></label>)}
    <div className="entry-actions">
      <button disabled={busy} type="submit">추가</button>
      <button className="ghost" onClick={onCancel} type="button">취소</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function MapRow({ map, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [position, setPosition] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (run) => {
    setBusy(true);
    setError("");
    const { error: failure } = await run();
    setBusy(false);
    if (failure) return setError(failure.message);
    setPosition("");
    onChanged();
  };

  const remove = async () => {
    if (!window.confirm(`${map.name} 을(를) 삭제할까요?`)) return;
    setBusy(true);
    setError("");
    const { error: failure } = await supabase.rpc(tableFor(map.type, "delete_map"), { p_level_id: map.level_id, p_discard_records: false });
    setBusy(false);
    if (!failure) return onChanged();
    // The function refuses while clears exist and names the count, so ask again with it.
    if (!/클리어 기록이/.test(failure.message)) return setError(failure.message);
    if (!window.confirm(`${failure.message}\n\n계속하면 이 기록들은 복구할 수 없습니다.`)) return;
    act(() => supabase.rpc(tableFor(map.type, "delete_map"), { p_level_id: map.level_id, p_discard_records: true }));
  };

  return <li className="entry">
    <header>
      <span className="badge">{map.position}</span>
      <strong>{map.name}</strong>
      <span className="entry-meta">{map.creator || "제작자 미상"} · {map.level_id}</span>
    </header>
    {editing
      ? <EditForm map={map} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />
      : <div className="entry-actions">
          <label className="position">순위<input inputMode="numeric" onChange={(event) => setPosition(event.target.value)} placeholder={String(map.position)} value={position} /></label>
          <button disabled={busy || !position} onClick={() => act(() => supabase.rpc(tableFor(map.type, "move_map"), { p_level_id: map.level_id, p_position: Number(position) }))} type="button">이동</button>
          <button className="ghost" onClick={() => setEditing(true)} type="button">편집</button>
          <button className="ghost danger" disabled={busy} onClick={remove} type="button">삭제</button>
        </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </li>;
}

export function Maps() {
  const [type, setType] = useState("classic");
  const [query, setQuery] = useState("");
  const [maps, setMaps] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const requestId = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestId.current;
    const { data, error: failure } = await supabase.from(tableFor(type, "maps")).select("*").eq("type", type).order("position");
    if (request !== requestId.current) return;
    setError(failure?.message ?? "");
    setMaps(data ?? []);
  }, [type]);

  useEffect(() => { setMaps(null); load(); return () => { requestId.current++; }; }, [load]);

  const needle = query.trim().toLocaleLowerCase();
  const visible = (maps ?? []).filter((map) => !needle || [map.name, map.creator, map.verifier, map.level_id].some((value) => (value ?? "").toLocaleLowerCase().includes(needle)));

  return <section className="queue">
    <div className="filters">
      <div className="account-tabs" role="tablist">
        {TYPES.map(([value, label]) => <button aria-selected={type === value} disabled={creating} key={value} onClick={() => setType(value)} role="tab" type="button">{label}</button>)}
      </div>
      <input onChange={(event) => setQuery(event.target.value)} aria-label="맵 검색" placeholder="이름, 제작자, 베리파이어, 레벨 ID" type="search" value={query} />
      <button onClick={() => setCreating((open) => !open)} type="button">{creating ? "닫기" : "새 맵"}</button>
    </div>
    {creating && <CreateForm onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} type={type} />}
    {error && <p className="error" role="alert">{error}</p>}
    {maps === null ? <p className="muted">불러오는 중…</p>
      : visible.length === 0 ? <p className="muted">맵이 없습니다.</p>
      : <ul className="entries">{visible.map((map) => <MapRow key={`${map.type}:${map.level_id}`} map={map} onChanged={load} />)}</ul>}
  </section>;
}
