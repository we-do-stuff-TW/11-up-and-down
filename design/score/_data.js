/* ── 假資料，但規則是真的 ─────────────────────────────────────
   計分公式抄 docs/index.html 的 roundPoints()（預設規則：叫中 10+叫、叫 0 得 5、
   沒中 −|差|）。每一局所有人「拿到的墩數」加起來一定等於那一局的張數——
   照著真的牌局長，看起來才不會像亂數。種子固定，三案看到的是同一場牌。 */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

function ladderOf(peak){
  const L=[]; for(let i=1;i<=peak;i++)L.push(i); for(let i=peak-1;i>=1;i--)L.push(i); return L;
}
function roundPoints(bid,got){
  if(bid===got) return bid===0?5:10+bid;
  return -Math.abs(got-bid);
}
/* n 個人、第 ri 局（size 張）：先把 size 墩分掉，再讓每個人的叫墩在自己拿到的附近晃 */
function makeGame(names,peak,now,seed){
  const n=names.length, rnd=mulberry32(seed||7), ladder=ladderOf(peak);
  const log=[], score=names.map(()=>0);
  ladder.forEach(function(size,ri){
    const got=new Array(n).fill(0);
    for(let t=0;t<size;t++) got[Math.floor(rnd()*n)]++;
    const cells=[];
    for(let k=0;k<n;k++){
      let bid=got[k];
      const r=rnd();
      if(r<0.34) bid=Math.max(0,Math.min(size,got[k]+(rnd()<0.5?-1:1)));
      else if(r<0.40) bid=Math.max(0,Math.min(size,got[k]+(rnd()<0.5?-2:2)));
      const pts=roundPoints(bid,got[k]);
      cells.push({bid:bid,got:got[k],pts:pts,hit:bid===got[k]});
    }
    log.push({size:size,trump:Math.floor(rnd()*5)===4?null:Math.floor(rnd()*4),cells:cells});
  });
  /* now 之前是打完的，now 這局只有叫墩跟「目前拿到幾墩」，之後是空的 */
  const done=log.slice(0,now);
  done.forEach(r=>r.cells.forEach((c,k)=>score[k]+=c.pts));
  const cur=log[now], part=cur.cells.map(c=>Math.max(0,c.got-1-Math.floor(rnd()*2)));
  return {
    names:names, n:n, ladder:ladder, now:now, size:cur.size, trump:cur.trump,
    log:done,                       /* 已經打完的局 */
    bids:cur.cells.map(c=>c.bid),   /* 這一局叫了幾 */
    won:part,                       /* 這一局目前拿到幾 */
    score:score,
    deckSize:64, decks:2
  };
}
const PIPS=["ps","ph","pd","pc"];
function pip(s,cls){
  if(s===null||s===undefined) return '<span class="notrump">無王</span>';
  return '<svg class="'+(cls||"tsuit")+(s===1||s===2?" r":"")+'" viewBox="0 0 24 24"><use href="#'+PIPS[s]+'"/></svg>';
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const sgn=p=>(p>=0?"+":"−")+Math.abs(p);

/* 預設展示的那一桌：4 個人、打到第 14 局（階梯 1→11→1 的第 14 格＝9 張） */
const G4=makeGame(["Francis","阿哲","Mei","老王"],11,13,20260911);
/* 十個人那桌：欄位最擠的極端，三案都要撐得住 */
const G10=makeGame(["Francis","阿哲","Mei","老王","Ken","小圓","Ray","阿美","Jo","大頭"],6,7,4242);
function pickGame(){
  const q=new URLSearchParams(location.search);
  return q.get("n")==="10"?G10:G4;
}
