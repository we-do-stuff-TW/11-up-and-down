const G = pickGame();
if (new URLSearchParams(location.search).get("v") === "phone") document.body.classList.add("phone");
if (G.n >= 7) document.body.classList.add("tight");
if (G.n >= 9) document.body.classList.add("tighter");

const MAXSIZE = Math.max.apply(null, G.ladder);
const MAXABS = Math.max.apply(null, G.log.length
  ? [].concat.apply([], G.log.map(r => r.cells.map(c => Math.abs(c.pts)))) : [1]);
/* 打完第 ri 局的時候，每個人累計幾分 */
const RUN = (function(){
  const out = [], acc = G.names.map(() => 0);
  G.log.forEach(function(row){ row.cells.forEach(function(c, k){ acc[k] += c.pts; }); out.push(acc.slice()); });
  return out;
})();
function gut(size, ri, now){
  const row = G.log[ri];
  return '<td class="gut"><span class="szbar" style="--w:' + (6 + Math.round(size / MAXSIZE * 30)) + 'px"></span>' +
    '<span class="sz">' + size + '</span>' +
    (row ? pip(row.trump) : now ? pip(G.trump) : '') + '</td>';
}
function chrome(){
  document.getElementById("of").textContent = G.decks + " 副 · " + G.deckSize + " 張 · " + G.n + " 人";
  document.getElementById("ft").innerHTML =
    '<span>第 <b>' + (G.now + 1) + '</b> 局 · 每人 <b>' + G.size + '</b> 張</span>' +
    '<span class="r">' + (G.now + 1) + " / " + G.ladder.length + '</span>';
  const tr = document.querySelector("tr.now"), box = document.getElementById("scroll");
  if (tr) { const a = tr.getBoundingClientRect(), b = box.getBoundingClientRect();
            box.scrollTop += (a.top - b.top) - (b.height - a.height) / 2; }
}
