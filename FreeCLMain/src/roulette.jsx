import { TYPES, typeName } from "../../supabase/functions/_shared/lists.js";
import { useEffect, useState } from "react";
import { useSession } from "./account.jsx";

const SPIN_MS = 2600;
const TICK_MS = 70;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Wheel({ challenges, label, type }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const [spun, setSpun] = useState(null);
  const [shown, setShown] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState("");

  // 돌아가는 동안 매 틱마다 후보를 새로 뽑는다 — 순서대로 넘기는 게 아니라 그때그때 무작위다.
  // 당첨은 이미 정해져 있고, 여기 나오는 이름은 연출일 뿐이다.
  useEffect(() => {
    if (!spinning || !spun) return undefined;
    const tick = window.setInterval(() => setShown(Math.floor(Math.random() * spun.pool.length)), TICK_MS);
    const stop = window.setTimeout(() => setSpinning(false), reducedMotion() ? 0 : SPIN_MS);
    return () => { window.clearInterval(tick); window.clearTimeout(stop); };
  }, [spinning, spun]);

  const spin = (event) => {
    event.preventDefault();
    // An empty box reads as 0, which would fail the comparison below and blame the wrong
    // field, so emptiness is its own check and comes first.
    if (!range.from.trim() || !range.to.trim()) return setError("시작 순위와 끝 순위를 모두 입력해 주세요.");
    const from = Number(range.from);
    const to = Number(range.to);
    if (![from, to].every(Number.isInteger) || from < 1) return setError("순위는 1 이상의 정수로 입력해 주세요.");
    if (from >= to) return setError("가장 높은 순위가 가장 낮은 순위보다 앞서야 합니다.");
    if (to > challenges.length) return setError(`${label} 목록은 ${challenges.length}위까지 있습니다.`);

    const pool = challenges.slice(from - 1, to);
    const index = Math.floor(Math.random() * pool.length);

    setError("");
    setSpun({ pool, from, index });
    setShown(index);
    setSpinning(true);
  };

  const at = spun ? (spinning ? shown : spun.index) : 0;
  const current = spun ? spun.pool[at] : null;
  const winner = spun && !spinning ? current : null;

  return <>
    <form className="submit-form roulette-form" onSubmit={spin}>
      <label>
        <span>시작 순위<small>현재 가장 높은 순위</small></span>
        <input inputMode="numeric" min="1" onChange={(event) => setRange({ ...range, from: event.target.value })} placeholder="1" type="number" value={range.from} />
      </label>
      <label>
        <span>끝 순위<small>현재 가장 낮은 순위</small></span>
        <input inputMode="numeric" min="2" onChange={(event) => setRange({ ...range, to: event.target.value })} placeholder={String(challenges.length)} type="number" value={range.to} />
      </label>
      <button disabled={spinning} type="submit">{spinning ? "돌리는 중…" : "룰렛 돌리기"}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>

    {/* Announced only once it has stopped: the names flying past are decoration until then. */}
    <div aria-live={spinning ? "off" : "polite"} className="roulette-display">
      {winner
        ? <a href={`/${type}/challenge/?levelId=${encodeURIComponent(winner.levelId)}`}>
            <span className="rank">{spun.from + spun.index}</span>
            <strong>{winner.name}</strong>
            <small>{winner.creator || "제작자 미상"} · {winner.levelId}</small>
          </a>
        : spinning
          ? <p className="roulette-rolling" aria-hidden="true">
              <span className="rank">{spun.from + at}</span>
              <strong>{current.name}</strong>
            </p>
          : <p className="muted">순위 범위를 정하고 룰렛을 돌려 보세요.</p>}
    </div>
  </>;
}

export function RoulettePage({ Navigation, snapshots }) {
  const session = useSession();
  const [type, setType] = useState("classic");
  const label = typeName(type);

  return <>
    <Navigation current="roulette" />
    <main className="page submit-page">
      <header className="detail-heading"><div><p className="eyebrow">FreeCL</p><h1>ROULETTE</h1></div></header>
      {session === undefined ? <p className="muted">불러오는 중…</p>
        : !session ? <p className="muted">룰렛을 돌리려면 먼저 로그인해 주세요. 오른쪽 위 로그인 버튼을 눌러 주세요.</p>
        : <>
          <div className="account-tabs" role="tablist">
            {TYPES.map(([value, text]) => <button aria-selected={type === value} key={value} onClick={() => setType(value)} role="tab" type="button">{text} 룰렛</button>)}
          </div>
          {/* Keyed by type so switching lists clears the previous draw. */}
          <Wheel challenges={snapshots[type].challenges} key={type} label={label} type={type} />
        </>}
    </main>
  </>;
}
