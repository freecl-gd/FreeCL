import { useEffect, useState } from "react";
import { manageUser, supabase } from "./supabase.js";

function UserRow({ account, actorId, root, onChanged }) {
  const [months, setMonths] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const banned = account.permanent || Date.parse(account.banned_until) > Date.now();
  const protectedAccount = account.id === actorId || account.role_id === 0 || (account.role_id !== null && !root);

  const act = async (action, permanent = false) => {
    const timed = action === "ban" && !permanent;
    const term = Number(months);
    if (timed && !(Number.isInteger(term) && term >= 1)) return setError("밴 기간을 1개월 이상의 정수로 입력해 주세요.");
    const label = action === "unban" ? "밴을 해제" : permanent ? "영구 밴" : `${term}개월 일시 밴`;
    if (!window.confirm(`${account.username} 계정의 ${label} 처리할까요?`)) return;
    setBusy(true);
    setError("");
    try {
      await manageUser({ action, userId: account.id, permanent, months: timed ? term : undefined });
      setMonths("");
      onChanged();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  return <li className="entry user-entry">
    <header>
      <strong>{account.username}</strong>
      <span className={`badge ${banned ? "" : "badge-soft"}`}>{account.permanent ? "영구 밴" : banned ? "일시 밴" : "정상"}</span>
      {account.role_id !== null && <span className="badge badge-soft">{account.role_id === 0 ? "Root" : "Admin"}</span>}
      <span className="entry-meta">가입 {new Date(account.created_at).toLocaleDateString("ko-KR")}</span>
    </header>
    <div className="user-info"><span>{account.email || "이메일 없음"}</span><span className="user-id">ID <code>{account.id}</code></span></div>
    {banned && !account.permanent && <p className="muted">밴 종료: {new Date(account.banned_until).toLocaleString("ko-KR")}</p>}
    {protectedAccount ? <p className="muted">{account.id === actorId ? "본인 계정" : account.role_id === 0 ? "Root 보호 계정" : "관리자 계정은 Root만 관리할 수 있습니다."}</p> : <div className="user-actions">
      <div className="timed-ban">
      <label className="ban-term">밴 기간 (개월)<input aria-label={`${account.username} 밴 기간 (개월)`} disabled={busy || account.permanent} inputMode="numeric" min="1" onChange={(event) => setMonths(event.target.value)} placeholder="예: 3" step="1" type="number" value={months} /></label>
      <button disabled={busy || account.permanent || !months} onClick={() => act("ban")} type="button">일시 밴</button>
      </div>
      <div className="user-secondary-actions">
      <button className="ghost danger" disabled={busy || account.permanent} onClick={() => act("ban", true)} type="button">영구 밴</button>
      {banned && <button className="ghost" disabled={busy} onClick={() => act("unban")} type="button">밴 해제</button>}
      </div>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </li>;
}

export function Users({ actorId, root }) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc("admin_list_users", { p_query: query.trim(), p_offset: offset });
      if (active) setState(error ? { error: error.message } : { data });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, offset, revision]);
  return <section className="queue">
    <h2>유저 관리</h2>
    <div className="filters">
      <input aria-label="유저 검색" onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="닉네임, 이메일, 계정 ID 검색" type="search" value={query} />
      <button className="ghost" onClick={() => setRevision((value) => value + 1)} type="button">새로고침</button>
    </div>
    {state.error ? <p className="error" role="alert">{state.error}</p> : state.loading ? <p className="muted">불러오는 중…</p> : <>
      <p className="muted">{state.data.total}개 계정</p>
      {state.data.users.length ? <ul className="entries">{state.data.users.map((account) => <UserRow account={account} actorId={actorId} key={account.id} onChanged={() => { setOffset(0); setRevision((value) => value + 1); }} root={root} />)}</ul> : <p className="muted">일치하는 계정이 없습니다.</p>}
      <div className="pagination">
        <button className="ghost" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))} type="button">이전</button>
        <span>{Math.floor(offset / 50) + 1} / {Math.max(1, Math.ceil(state.data.total / 50))}</span>
        <button className="ghost" disabled={offset + 50 >= state.data.total} onClick={() => setOffset((value) => value + 50)} type="button">다음</button>
      </div>
    </>}
  </section>;
}
