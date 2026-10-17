import { TYPES, typeName, tableFor } from "../../supabase/functions/_shared/lists.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase.js";

const STATUSES = [["pending", "대기"], ["approved", "승인"], ["rejected", "거부"]];
const KINDS = { map: "맵 등재", record: "클리어 기록" };
const MAP_FIELDS = [["name", "이름"], ["levelId", "레벨 ID"], ["creator", "제작자"], ["verifier", "베리파이어"], ["video", "영상"], ["length", "길이"], ["objectCount", "오브젝트"], ["description", "설명"]];

const when = (value) => new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });

function Details({ entry }) {
  const { payload } = entry;
  const fields = entry.kind === "map"
    ? MAP_FIELDS.map(([key, label]) => [label, payload[key]])
    : [["레벨 ID", payload.levelId], [payload.time === undefined ? "달성도" : "기록", payload.time === undefined ? `${payload.percent}%` : `${payload.time}s`], ["플랫폼", payload.platform], ["영상", payload.video || "—"]];

  return <dl className="fields">
    {fields.filter(([, value]) => value !== undefined && value !== "").map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
}

function Entry({ entry, onReviewed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState("");
  const validPosition = position.trim() !== "" && Number.isSafeInteger(Number(position)) && Number(position) > 0;

  const run = async (action) => {
    if (action === "approve" && entry.kind === "map" && !validPosition) {
      return setError("맵 승인에는 순위를 입력해야 합니다.");
    }
    let note;
    if (action === "reject") {
      note = window.prompt("거부 사유 (선택)");
      if (note === null) return; // Cancelling the prompt must not reject the submission.
    }
    setBusy(true);
    setError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); return setError("다시 로그인해 주세요."); }
    const { error: failure } = action === "approve"
      ? await supabase.rpc(tableFor(entry.type, "approve_submission"), { submission_id: entry.id, at_position: entry.kind === "map" ? Number(position) : null })
      : await supabase.from(tableFor(entry.type, "submissions")).update({ status: "rejected", note: note || null, reviewed_at: new Date().toISOString(), reviewed_by: user.id }).eq("id", entry.id).eq("status", "pending").select("id").single();

    setBusy(false);
    if (failure) return setError(failure.code === "PGRST116" ? "이미 처리된 신청입니다. 목록을 다시 확인해 주세요." : failure.message);
    onReviewed();
  };

  return <li className="entry">
    <header>
      <span className="badge">{KINDS[entry.kind]}</span>
      <span className="badge badge-soft">{typeName(entry.type)}</span>
      <span className="entry-meta">{entry.profiles?.username ?? "알 수 없음"} · {when(entry.created_at)}</span>
    </header>
    {entry.kind === "record" && entry.mapName && <p className="entry-note">{entry.mapName}</p>}
    <Details entry={entry} />
    {entry.note && <p className="entry-note">거부 사유: {entry.note}</p>}
    {entry.status === "pending" && <div className="entry-actions">
      {entry.kind === "map" && <label className="position">순위 (필수)<input min="1" onChange={(event) => setPosition(event.target.value)} required step="1" type="number" value={position} /></label>}
      <button disabled={busy || (entry.kind === "map" && !validPosition)} onClick={() => run("approve")} type="button">승인</button>
      <button className="ghost" disabled={busy} onClick={() => run("reject")} type="button">거부</button>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </li>;
}

export function Queue() {
  const [type, setType] = useState("classic");
  const [status, setStatus] = useState("pending");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");

  const requestId = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestId.current;
    let query = supabase.from(tableFor(type, "submissions")).select("*, profiles(username)").eq("type", type).eq("status", status).order("created_at");
    if (kind) query = query.eq("kind", kind);
    const [submissions, maps] = await Promise.all([query, supabase.from(tableFor(type, "maps")).select("level_id, name").eq("type", type)]);
    const failure = submissions.error ?? maps.error;
    const names = new Map((maps.data ?? []).map((map) => [map.level_id, map.name]));
    const data = submissions.data?.map((entry) => ({ ...entry, mapName: entry.payload.name ?? names.get(entry.payload.levelId) ?? "" }));
    if (request !== requestId.current) return;
    setError(failure?.message ?? "");
    setEntries(data ?? []);
  }, [status, kind, type]);

  useEffect(() => { setEntries(null); load(); return () => { requestId.current++; }; }, [load]);

  const needle = search.trim().toLowerCase();
  const visible = (entries ?? []).filter((entry) => [entry.id, entry.profiles?.username, entry.mapName, entry.note, ...Object.values(entry.payload)].some((value) => String(value ?? "").toLowerCase().includes(needle)));

  return <section className="queue">
    <div className="account-tabs" role="tablist">{TYPES.map(([value, label]) => <button key={value} role="tab" aria-selected={type === value} onClick={() => setType(value)} type="button">{label}</button>)}</div>
    <div className="filters">
      <div className="account-tabs" role="tablist">
        {STATUSES.map(([value, label]) => <button aria-selected={status === value} key={value} onClick={() => setStatus(value)} role="tab" type="button">{label}</button>)}
      </div>
      <input aria-label="제출 검색" onChange={(event) => setSearch(event.target.value)} placeholder="신청 번호, 닉네임, 맵 이름, 레벨 ID 검색" type="search" value={search} />
      <select aria-label="제출 종류" onChange={(event) => setKind(event.target.value)} value={kind}>
        <option value="">전체</option>
        {Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {entries === null ? <p className="muted">불러오는 중…</p>
      : visible.length === 0 ? <p className="muted">해당하는 제출이 없습니다.</p>
      : <ul className="entries">{visible.map((entry) => <Entry entry={entry} key={`${entry.type}:${entry.id}`} onReviewed={load} />)}</ul>}
  </section>;
}
