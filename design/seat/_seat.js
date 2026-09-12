const PIPS = {1:[5],2:[1,9],3:[1,5,9],4:[1,3,7,9],5:[1,3,5,7,9],6:[1,3,4,6,7,9]};
function die(v, sm){
  const c = "die" + (sm ? " sm" : "");
  if(v === null) return '<div class="'+c+' empty"><span class="num">?</span></div>';
  if(v === 0)   return '<div class="'+c+' zero"><span class="num">0</span></div>';
  const pips = n => PIPS[n].map(i =>
    '<span class="pip" style="grid-row:'+Math.ceil(i/3)+';grid-column:'+(((i-1)%3)+1)+'"></span>').join("");
  if(v > 6) return '<span class="dice"><div class="'+c+'">'+pips(6)+'</div>'+
                   '<div class="'+c+'">'+pips(v-6)+'</div></span>';
  return '<div class="'+c+'">'+pips(v)+'</div>';
}
const head = s => '<div class="seat-top"><span class="seat-name">' +
  '<span class="av">' + s.name[0] + '</span>' +
  '<span class="dot"></span>' + s.name + '</span></div>';
const wrap = (s, extra, body) => '<div class="seat ' + (s.me?"me ":"") + (s.on?"on ":"") + (extra||"") +
  '">' + head(s) + body + '</div>';

/* ── A · 倒數 ───────────────────────────────────────────── */
function A(s){
  let inner;
  if(s.bid === null){
    inner = '<div class="seat-row">' + die(null) + '<span class="a-wait">還沒叫</span></div>';
  }else{
    const d = s.bid - s.got, over = Math.max(0, s.got - s.bid);
    const cls = over ? " bust" : d === 0 ? " hit" : "";
    const body = over ? '<span class="word">多贏了 ' + over + '</span>'
               : s.bid === 0 ? '<span class="word">一墩都別要</span>'
               : d === 0 ? '<span class="word">別再贏了</span>'
               : '<span class="lab">還要贏</span><span class="big">' + d + '</span>';
    inner = '<div class="seat-row">' + die(s.bid) +
      '<span class="a-todo' + cls + '">' + body + '</span></div>';
  }
  const pct = s.bid ? Math.min(1, s.got / s.bid) : (s.bid === 0 ? (s.got ? 1 : 0) : 0);
  const bcls = s.bid === null ? "" : (s.got > s.bid ? " bust" : s.got === s.bid ? " hit" : "");
  const bar = '<span class="a-bar' + bcls + '"><i style="width:' + (pct*100) + '%"></i></span>';
  return wrap(s, "a-seat", inner + bar);
}

/* ── B · 拿／叫 ─────────────────────────────────────────── */
function B(s){
  if(s.bid === null)
    return wrap(s, "", '<div class="seat-row">' + die(null) +
      '<span class="b-pill mute">還沒叫</span></div>');
  const d = s.bid - s.got, over = Math.max(0, s.got - s.bid);
  const cls = over ? " bust" : d === 0 ? " hit" : "";
  const word = over ? "超 " + over : d === 0 ? "剛好" : "還差 " + d;
  return wrap(s, "", '<div class="seat-row">' +
    '<span class="b-frac' + cls + '"><span class="got">' + s.got + '</span>' +
    '<span class="sl">/</span><span class="bid">' + s.bid + '</span></span>' +
    '<span class="b-pill' + cls + '">' + word + '</span></div>');
}

/* ── C · 墩位 ───────────────────────────────────────────── */
function C(s){
  if(s.bid === null)
    return wrap(s, "", '<div class="seat-row">' + die(null) + '<span class="c-wait">還沒叫</span></div>');
  if(s.bid === 0 && s.got === 0)
    return wrap(s, "", '<div class="seat-row">' + die(0) +
      '<span class="c-none"><b></b>一墩都不要</span></div>');
  const over = Math.max(0, s.got - s.bid), d = s.bid - s.got;
  let h = "";
  for(let k = 0; k < s.bid; k++) h += '<u class="' + (k < s.got ? "got" : "") + '"></u>';
  for(let k = 0; k < over; k++) h += '<u class="over"></u>';
  return wrap(s, "", '<div class="seat-row">' + die(s.bid) +
    '<span class="c-slots' + (d === 0 && !over ? " done" : "") + '">' + h + '</span>' +
    (over ? '<span class="c-over">超 ' + over + '</span>' : "") + '</div>');
}

/* ── 現況 ───────────────────────────────────────────────── */
function OLD(s){
  const score = s.score || (s.me ? 5 : 12);
  let row2;
  if(s.bid === null) row2 = die(s.bid) + '<span class="aword">還沒叫</span>';
  else{
    const over = Math.max(0, s.got - s.bid), d = s.bid - s.got;
    let h = "";
    for(let k = 0; k < s.bid; k++) h += '<u class="' + (k < s.got ? "got" : "") + '"></u>';
    for(let k = 0; k < over; k++) h += '<u class="over"></u>';
    const word = s.bid === 0 && s.got === 0 ? "一墩都不要"
               : over > 0 ? "超 " + over : d > 0 ? "還差 " + d : "剛好";
    row2 = die(s.bid) +
      (s.bid || over ? '<span class="tally' + (d===0&&!over?" done":"") + '">' + h + '</span>' : "") +
      '<span class="aword' + (over?" bust":d===0?" hit":"") + '">' + word + '</span>';
  }
  return '<div class="seat ' + (s.me?"me ":"") + (s.on?"on ":"") + '">' +
    '<div class="seat-top"><span class="seat-name">' +
    '<span class="av">' + s.name[0] + '</span><span class="dot"></span>' + s.name + '</span>' +
    '<span class="seat-score">' + score + '</span></div>' +
    '<div class="seat-row">' + row2 + '</div></div>';
}

