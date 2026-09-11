/* auth.ts 的把關測試。
   自己生一把 ES256 金鑰、自己發 token，把 verifyLocal 的每一條路都走一次；
   JWKS 用本機起的假伺服器餵，不碰真的 Supabase。
   這支驗簽是自己寫的，JWT 的經典破法（alg 換成 none、換成 HS256、換一把金鑰簽、
   改內容不改簽章、拿別的專案的 token）每一種都要在這裡被擋下來。

       deno run --allow-net supabase/functions/game/auth_test.ts
*/
import { verifyLocal, _resetJwks } from "./auth.ts";

const enc = new TextEncoder();
const b64u = (b: Uint8Array | string) => {
  const bin = typeof b === "string" ? b : String.fromCharCode(...b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const kp2 = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
const KID = "test-kid";
const jwks = { keys: [{ ...pub, alg: "ES256", kid: KID, use: "sig" }] };

let served = 0;
const srv = Deno.serve({ port: 8123, onListen() {} }, (req) => {
  if (new URL(req.url).pathname === "/auth/v1/.well-known/jwks.json") {
    served++;
    return new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } });
  }
  return new Response("no", { status: 404 });
});
const BASE = "http://127.0.0.1:8123";

async function mint(claims: Record<string, unknown>, o?: { kid?: string; alg?: string; key?: CryptoKey }) {
  const head = b64u(JSON.stringify({ alg: o?.alg ?? "ES256", typ: "JWT", kid: o?.kid ?? KID }));
  const body = b64u(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, o?.key ?? kp.privateKey, enc.encode(head + "." + body)));
  return head + "." + body + "." + b64u(sig);
}
const now = Math.floor(Date.now() / 1000);
const good = { sub: "user-123", role: "authenticated", iss: BASE + "/auth/v1",
               exp: now + 3600, email: "a@b.c", user_metadata: { full_name: "Francis" } };

let pass = 0, fail = 0;
const t = async (name: string, jwt: string, want: boolean) => {
  const r = await verifyLocal(jwt, BASE, "anon");
  const got = !!r;
  if (got === want) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log(`  ❌ ${name}  （預期 ${want ? "接受" : "拒絕"}，實際 ${got ? "接受" : "拒絕"}）`); }
  return r;
};

console.log("接受：");
const okClaims = await t("正常的 token", await mint(good), true);
if (okClaims?.sub !== "user-123" || okClaims?.email !== "a@b.c" ||
    (okClaims?.user_metadata as Record<string, unknown>)?.full_name !== "Francis") {
  fail++; console.log("  ❌ claims 取出來不對：" + JSON.stringify(okClaims));
} else { pass++; console.log("  ✅ sub／email／user_metadata 都取得到"); }

console.log("拒絕：");
await t("簽章被改掉", (await mint(good)).slice(0, -3) + "AAA", false);
await t("內容被改掉（換 sub，簽章沒跟著換）",
  await (async () => { const j = await mint(good); const p = j.split("."); 
    return p[0] + "." + b64u(JSON.stringify({ ...good, sub: "someone-else" })) + "." + p[2]; })(), false);
await t("別把金鑰換掉（另一把私鑰簽的）", await mint(good, { key: kp2.privateKey }), false);
await t("alg: none", "eyJhbGciOiJub25lIiwia2lkIjoidGVzdC1raWQifQ." + b64u(JSON.stringify(good)) + ".", false);
await t("alg: HS256（共享密鑰那種）", await mint(good, { alg: "HS256" }), false);
await t("kid 不認識", await mint(good, { kid: "nope" }), false);
await t("過期了", await mint({ ...good, exp: now - 10 }), false);
await t("沒有 exp", await mint({ sub: "x", role: "authenticated", iss: BASE + "/auth/v1" }), false);
await t("nbf 還沒到", await mint({ ...good, nbf: now + 600 }), false);
await t("別的專案簽的（iss 不對）", await mint({ ...good, iss: "https://evil.supabase.co/auth/v1" }), false);
await t("anon key（role 不是 authenticated）", await mint({ ...good, role: "anon" }), false);
await t("service_role", await mint({ ...good, role: "service_role" }), false);
await t("沒有 sub", await mint({ ...good, sub: "" }), false);
await t("根本不是 JWT", "hello-world", false);
await t("只有兩段", "aaa.bbb", false);
await t("空字串", "", false);

console.log("快取：");
const n0 = served;
await verifyLocal(await mint(good), BASE, "anon");
await verifyLocal(await mint(good), BASE, "anon");
if (served === n0) { pass++; console.log(`  ✅ 公鑰只抓一次（總共 ${served} 次）`); }
else { fail++; console.log(`  ❌ 每次都去抓公鑰（${n0} → ${served}）`); }
_resetJwks();
await verifyLocal(await mint(good), BASE, "anon");
if (served === n0 + 1) { pass++; console.log("  ✅ 快取清掉之後會再抓一次"); }
else { fail++; console.log("  ❌ 快取清掉之後沒有重抓"); }

await srv.shutdown();
console.log(`\n${fail ? "❌ " + fail + " 項沒過" : "✅ 全部通過"}（共 ${pass + fail} 項）`);
Deno.exit(fail ? 1 : 0);
