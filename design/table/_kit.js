/* 方向示意圖共用的小零件：同一桌牌（6 人、第 8 局、輪到我出第 3 墩），四個方向畫的是同一個時刻。
   牌面是從 docs/index.html 平面模式截下來的真牌（cards/*.webp），不是重畫的。 */
window.KIT = (function(){
  /* 座位順序：0 是我，順時針。出牌從 3 號阿明開始：阿明 ♦10 → Kelly ♦A → 小美 ♣Q → 輪到我 */
  const P = [
    {n:"Francis", i:"F", you:true, bid:2, won:1},
    {n:"WeiYu",   i:"W", bid:1, won:0},
    {n:"Tom",     i:"T", bid:3, won:1},
    {n:"阿明",    i:"明", bid:0, won:0},
    {n:"Kelly",   i:"K", bid:2, won:0},
    {n:"小美",    i:"美", bid:1, won:0}
  ];
  const HAND = ["SK", "S9", "HK", "H10", "DQ", "D4"];
  const LEGAL = {DQ:1, D4:1};
  const TRICK = [{p:3, c:"D10"}, {p:4, c:"DA"}, {p:5, c:"CQ"}];
  const ROUND = {ri:8, of:15, hs:8, played:2, trump:"SJ", room:"5527"};

  const PIPS = {1:[[.5,.5]], 2:[[.28,.28],[.72,.72]], 3:[[.28,.28],[.5,.5],[.72,.72]],
    4:[[.28,.28],[.72,.28],[.28,.72],[.72,.72]], 5:[[.28,.28],[.72,.28],[.5,.5],[.28,.72],[.72,.72]],
    6:[[.28,.25],[.72,.25],[.28,.5],[.72,.5],[.28,.75],[.72,.75]]};
  function die(v, s, o){
    o = o || {};
    const body = o.body || "#F3EEE3", pip = o.pip || "#1C1A17", edge = o.edge || "rgba(0,0,0,.18)";
    const pr = s * .095;
    const dots = (PIPS[v] || []).map(function(p){
      return '<circle cx="' + (p[0]*s).toFixed(1) + '" cy="' + (p[1]*s).toFixed(1) + '" r="' + pr.toFixed(1) + '" fill="' + pip + '"/>';
    }).join("");
    return '<svg class="die" width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '" aria-hidden="true">' +
      '<rect x=".5" y=".5" width="' + (s-1) + '" height="' + (s-1) + '" rx="' + (s*.22) + '" fill="' + body + '" stroke="' + edge + '"/>' + dots + '</svg>';
  }
  /* 叫 0 不丟骰子（跟遊戲一樣）：只有一個 0 */
  function bidMark(v, s, o){
    if(v === 0) return '<span class="zero" style="width:' + s + 'px;height:' + s + 'px;font-size:' + Math.round(s*.62) + 'px">0</span>';
    if(v > 6) return die(6, s, o) + die(v - 6, s, o);
    return die(v, s, o);
  }
  /* 七段數字（自動麻將桌的 LED） */
  const SEG = {"0":"abcdef","1":"bc","2":"abged","3":"abgcd","4":"fgbc","5":"afgcd","6":"afgedc","7":"abc","8":"abcdefg","9":"abcfgd"," ":""};
  function seg7(str, h, on, off){
    const w = h * .56, t = h * .12, gap = h * .14;
    const segs = {
      a:[t*.6, 0, w - t*1.2, t, 0], d:[t*.6, h - t, w - t*1.2, t, 0], g:[t*.6, h/2 - t/2, w - t*1.2, t, 0],
      f:[0, t*.6, t, h/2 - t*.9, 1], b:[w - t, t*.6, t, h/2 - t*.9, 1],
      e:[0, h/2 + t*.3, t, h/2 - t*.9, 1], c:[w - t, h/2 + t*.3, t, h/2 - t*.9, 1]
    };
    let x = 0, out = "";
    for(const ch of str){
      const lit = SEG[ch] || "";
      for(const k in segs){
        const s = segs[k];
        out += '<rect x="' + (x + s[0]).toFixed(1) + '" y="' + s[1].toFixed(1) + '" width="' + s[2].toFixed(1) + '" height="' + s[3].toFixed(1) +
          '" rx="' + (t*.45).toFixed(1) + '" fill="' + (lit.indexOf(k) >= 0 ? on : off) + '"/>';
      }
      x += w + gap;
    }
    return '<svg class="seg" width="' + (x - gap).toFixed(1) + '" height="' + h + '" viewBox="0 0 ' + (x - gap).toFixed(1) + ' ' + h + '" aria-hidden="true">' + out + '</svg>';
  }
  function card(id, w, extra){
    return '<img class="cd" src="cards/' + id + '.webp" alt="" style="width:' + w + 'px;height:' + (w*1.4).toFixed(1) + 'px;border-radius:' + (w*.058).toFixed(1) + 'px;' + (extra || "") + '">';
  }
  /* 花色小圖示（王牌指示用），跟遊戲的 SUIT_D 同一組形狀 */
  const SUIT_D = {
    S:"M12 1.5C10.1 4.3 2.5 9.4 2.5 14.5c0 2.9 2.05 4.9 4.55 4.9 1.75 0 3.1-.95 3.9-2.35.1 2.75-.75 4.55-2.55 5.45h7.2c-1.8-.9-2.65-2.7-2.55-5.45.8 1.4 2.15 2.35 3.9 2.35 2.5 0 4.55-2 4.55-4.9C21.5 9.4 13.9 4.3 12 1.5z",
    H:"M12 21.6C11.1 20.9 2.4 15 2.4 8.8 2.4 5.4 4.8 3 7.7 3c1.9 0 3.5 1.1 4.3 2.7C12.8 4.1 14.4 3 16.3 3c2.9 0 5.3 2.4 5.3 5.8 0 6.2-8.7 12.1-9.6 12.8z",
    D:"M12 1.4c2.4 4.4 5.2 8 8.9 10.6-3.7 2.6-6.5 6.2-8.9 10.6-2.4-4.4-5.2-8-8.9-10.6C6.8 9.4 9.6 5.8 12 1.4z",
    C:"M12 2.3a4.55 4.55 0 1 0 0 9.1 4.55 4.55 0 1 0 0-9.1zM6.3 8.9a4.55 4.55 0 1 0 0 9.1 4.55 4.55 0 1 0 0-9.1zM17.7 8.9a4.55 4.55 0 1 0 0 9.1 4.55 4.55 0 1 0 0-9.1zM11 11.2c.35 3.4-.2 7.1-2.7 10.4h7.4c-2.5-3.3-3.05-7-2.7-10.4z"
  };
  function suit(k, s, col){
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + SUIT_D[k] + '" fill="' + col + '"/></svg>';
  }
  /* 手牌排成一把：n 張、牌寬 w、可用寬度 W，回傳每張的 left 與傾角 */
  function fan(n, w, W, o){
    o = o || {};
    const step = Math.min(w * .78, (W - w) / Math.max(1, n - 1));
    const total = w + step * (n - 1), x0 = (W - total) / 2;
    const out = [];
    for(let k = 0; k < n; k++){
      const t = n > 1 ? k / (n - 1) - .5 : 0;
      out.push({x:x0 + step * k, rot:(o.spread || 0) * t, dy:(o.arc || 0) * t * t * 4});
    }
    return out;
  }
  return {P:P, HAND:HAND, LEGAL:LEGAL, TRICK:TRICK, ROUND:ROUND, die:die, bidMark:bidMark, seg7:seg7, card:card, suit:suit, fan:fan};
})();
