// 身分：先自己驗簽，驗不了才去問 Auth 伺服器。
//
// Supabase 的 access token 是 ES256 簽的，公鑰就掛在 JWKS 上（公開的，本來就給人驗）。
// 驗簽是純運算，本機做得完——沒必要為了每一個動作再跟 Auth 來回一趟：
// 從東京的函式打到新加坡的 Auth，實測那一趟 0.23 秒，而一局牌要按幾百次。
// 公鑰在 isolate 裡留著，十分鐘換一次。
//
// 只要有一點不確定就退回 getUser：換了簽章金鑰、舊的 HS256 token、任何一步對不上。
// 那條路慢，但它才是權威。所以這裡的失敗永遠只是「慢一點」，不會變成「進不來」，
// 也不會變成「放行了不該放的人」——放行與否最後都還是 Auth 說了算。
//
// 跟 getUser 的差別只有一個，說清楚：帳號被刪掉或登出之後，那張 token 在這裡
// 會一直算數到它自己過期（一小時）。JWT 本來就是這樣，這個遊戲承受得起。

export type Claims = {
  sub: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

const JWKS_TTL = 10 * 60_000;
let cache: { at: number; keys: Map<string, CryptoKey> } | null = null;

function b64u(s: string) {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(p + "=".repeat((4 - (p.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const txt = (b: Uint8Array) => new TextDecoder().decode(b);

/** 這個專案的公鑰。拿不到就回空的——呼叫端會退回 getUser。 */
async function keys(base: string, apikey: string): Promise<Map<string, CryptoKey>> {
  if (cache && Date.now() - cache.at < JWKS_TTL) return cache.keys;
  const out = new Map<string, CryptoKey>();
  try {
    const r = await fetch(base + "/auth/v1/.well-known/jwks.json", { headers: { apikey } });
    const body = await r.json();
    for (const k of body?.keys ?? []) {
      if (k?.kty !== "EC" || k?.alg !== "ES256" || !k?.kid) continue;
      out.set(
        k.kid,
        await crypto.subtle.importKey("jwk", k, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]),
      );
    }
  } catch { /* 拿不到就當沒有 */ }
  // 一把都沒有的時候不要把空的存十分鐘：下一次請求再試一次
  if (out.size) cache = { at: Date.now(), keys: out };
  return out;
}

/** 驗得過就回 claims，任何一點不對勁都回 null（呼叫端退回 getUser）。 */
export async function verifyLocal(jwt: string, base: string, apikey: string): Promise<Claims | null> {
  try {
    const part = jwt.split(".");
    if (part.length !== 3) return null;

    const head = JSON.parse(txt(b64u(part[0])));
    // 只認 ES256。"none" 與 HS*（用共享密鑰簽的）在這裡一律不算數
    if (head?.alg !== "ES256" || typeof head?.kid !== "string") return null;

    const key = (await keys(base, apikey)).get(head.kid);
    if (!key) return null;

    const sig = b64u(part[2]);
    if (sig.length !== 64) return null;   // WebCrypto 要 raw r||s，DER 的不收
    const okSig = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, key, sig,
      new TextEncoder().encode(part[0] + "." + part[1]),
    );
    if (!okSig) return null;

    const c = JSON.parse(txt(b64u(part[1])));
    const now = Date.now() / 1000;
    if (typeof c?.exp !== "number" || c.exp <= now) return null;
    if (typeof c?.nbf === "number" && c.nbf > now + 60) return null;
    if (c?.iss !== base + "/auth/v1") return null;          // 別的專案簽的不算
    if (c?.role !== "authenticated") return null;           // anon key 的 role 是 anon
    if (typeof c?.sub !== "string" || !c.sub) return null;
    return c as Claims;
  } catch {
    return null;
  }
}

/** 測試用：把快取清掉 */
export function _resetJwks() { cache = null; }
