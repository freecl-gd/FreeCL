// Explicit-render Turnstile, loaded once and only when a site key exists.
export const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";

let loading;
const load = () => (loading ??= new Promise((resolve, reject) => {
  const timer = window.setTimeout(() => reject(new Error("Turnstile 응답 없음 (10초 초과)")), 10000);
  const settle = (outcome, value) => { window.clearTimeout(timer); outcome(value); };

  // Cloudflare's documented handshake: the API takes the name of a global callback and
  // calls it once window.turnstile is really usable. script.onload fires before that, so
  // rendering from it hit an undefined turnstile and failed silently.
  window.__turnstileReady = () => settle(resolve, window.turnstile);

  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__turnstileReady";
  script.async = true;
  script.defer = true;
  script.onerror = () => settle(reject, new Error("Turnstile 스크립트를 불러올 수 없습니다"));
  document.head.append(script);
}));

// Returns a cleanup function, so callers can hand it straight to useEffect.
export function mountTurnstile(element, onToken, onFailure = () => {}) {
  if (!SITE_KEY || !element) return () => {};
  let widget;
  let cancelled = false;
  load().then((turnstile) => {
    if (cancelled) return;
    widget = turnstile.render(element, {
      sitekey: SITE_KEY,
      size: "flexible",
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": (code) => { onToken(""); onFailure(`오류 코드 ${code ?? "?"}`); },
    });
  }).catch((error) => {
    onToken("");
    onFailure(error.message ?? String(error));
  });
  return () => {
    cancelled = true;
    if (widget !== undefined) window.turnstile?.remove(widget);
  };
}
