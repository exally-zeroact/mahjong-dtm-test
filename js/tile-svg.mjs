/* tile-svg.js — ★自前の牌の絵（SVG）★（待ち読み・点数計算・手と鍵盤で同じ絵）
 * 見本＝memory/mahjong_tataki_2026-11-20/machi.html（v11.1・司さん 11-20「本物の配牌と同じように」で描き直した絵）を
 * そのまま部品にした。並びは本物の牌と同じ（萬子＝上に漢数字・下に赤の萬／筒子の丸の並び／索子の竹の並び・1索は鳥／字牌）。
 * 色は css/app.css の :root の --t-* だけ（SVG の fill に var() を書く）。他社の絵・配色・名前は写していない。
 * 面 60×80・下に厚み 8＝viewBox 0 0 60 88（縦横 3:4 ＋厚み）。
 * 名前：'1m'…'9m'・'0m'＝赤5（'0p'・'0s'）・'1z'…'7z'（東南西北白發中）。
 */
const NS='http://www.w3.org/2000/svg';
const RED='var(--t-aka)', GRN='var(--t-midori)', BLU='var(--t-ao)', INK='var(--t-kuro)', MEN='var(--t-men)';
const KAN=['','一','二','三','四','伍','六','七','八','九'];
function dot(x,y,r,c){ // 筒子の丸：外の輪＋中の輪＋芯
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x}" cy="${y}" r="${r*0.72}" fill="${MEN}"/><circle cx="${x}" cy="${y}" r="${r*0.52}" fill="${c}"/><circle cx="${x}" cy="${y}" r="${r*0.2}" fill="${MEN}"/>`;
}
function stick(x,y,c,h=20,rot=0){ // 索子の竹：節が3つ
  const w=7.4;
  return `<g transform="rotate(${rot} ${x} ${y})"><rect x="${x-w/2}" y="${y-h/2}" width="${w}" height="${h}" rx="3.2" fill="${c}"/>`+
    `<rect x="${x-w/2-0.6}" y="${y-0.9}" width="${w+1.2}" height="1.8" rx="0.9" fill="${c}"/>`+
    `<rect x="${x-0.6}" y="${y-h/2+2.5}" width="1.2" height="${h-5}" fill="${MEN}" opacity=".55"/></g>`;
}
export function face(code){
  const n=code[0]==='0'?5:+code[0], s=code[1], aka=code[0]==='0';
  let g='';
  if(s==='m'){
    g+=`<text x="30" y="34" text-anchor="middle" font-family="Yu Mincho,Hiragino Mincho ProN,serif" font-weight="700" font-size="26" fill="${aka?RED:INK}">${KAN[n]}</text>`;
    g+=`<text x="30" y="68" text-anchor="middle" font-family="Yu Mincho,Hiragino Mincho ProN,serif" font-weight="700" font-size="28" fill="${RED}">萬</text>`;
  } else if(s==='p'){
    const P={
      1:[[30,40,18,'X']],
      2:[[30,21,12.5,GRN],[30,59,12.5,BLU]],
      3:[[15,16,10,BLU],[30,40,10,RED],[45,64,10,GRN]],
      4:[[17,22,11.5,BLU],[43,22,11.5,GRN],[17,58,11.5,GRN],[43,58,11.5,BLU]],
      5:[[15,17,10,BLU],[45,17,10,GRN],[30,40,10,RED],[15,63,10,GRN],[45,63,10,BLU]],
      6:[[18,15,9.5,GRN],[42,15,9.5,GRN],[18,41,9.5,RED],[42,41,9.5,RED],[18,66,9.5,RED],[42,66,9.5,RED]],
      7:[[13,11,7.5,GRN],[30,19,7.5,GRN],[47,27,7.5,GRN],[18,47,8.5,RED],[42,47,8.5,RED],[18,68,8.5,RED],[42,68,8.5,RED]],
      8:[[19,11,8.6,BLU],[41,11,8.6,BLU],[19,30,8.6,BLU],[41,30,8.6,BLU],[19,50,8.6,BLU],[41,50,8.6,BLU],[19,69,8.6,BLU],[41,69,8.6,BLU]],
      9:[[12.5,14,8.2,BLU],[30,14,8.2,BLU],[47.5,14,8.2,BLU],[12.5,40,8.2,RED],[30,40,8.2,RED],[47.5,40,8.2,RED],[12.5,66,8.2,GRN],[30,66,8.2,GRN],[47.5,66,8.2,GRN]]
    }[n];
    for(const [x,y,r,c] of P){
      if(c==='X'){ // 1筒：大きい花の丸
        g+=`<circle cx="30" cy="40" r="20" fill="${GRN}"/><circle cx="30" cy="40" r="17" fill="${MEN}"/>`;
        for(let k=0;k<12;k++){const a=k*Math.PI/6;g+=`<circle cx="${30+12.5*Math.cos(a)}" cy="${40+12.5*Math.sin(a)}" r="2.6" fill="${BLU}"/>`;}
        g+=`<circle cx="30" cy="40" r="8" fill="${RED}"/><circle cx="30" cy="40" r="5" fill="${MEN}"/><circle cx="30" cy="40" r="3" fill="${RED}"/>`;
      } else g+=dot(x,y,r,(aka?RED:c));
    }
  } else if(s==='s'){
    const S={
      2:[[30,21,GRN],[30,59,GRN]],
      3:[[30,21,GRN],[18,59,GRN],[42,59,GRN]],
      4:[[18,21,GRN],[42,21,GRN],[18,59,GRN],[42,59,GRN]],
      5:[[13,21,GRN],[47,21,GRN],[30,40,RED],[13,59,GRN],[47,59,GRN]],
      6:[[14,21,GRN],[30,21,GRN],[46,21,GRN],[14,59,GRN],[30,59,GRN],[46,59,GRN]],
      7:[[30,14,RED],[14,40,GRN],[30,40,GRN],[46,40,GRN],[14,66,GRN],[30,66,GRN],[46,66,GRN]],
      9:[[14,14,GRN],[30,14,RED],[46,14,GRN],[14,40,GRN],[30,40,RED],[46,40,GRN],[14,66,GRN],[30,66,RED],[46,66,GRN]]
    };
    if(n===1){ // 1索：鳥（自前の形）
      g+=`<path d="M22 58 Q14 40 26 30 Q34 24 38 30 Q44 40 36 52 Q32 60 22 58Z" fill="${GRN}"/>`+
         `<path d="M36 30 Q40 18 46 20 Q42 24 42 30Z" fill="${GRN}"/>`+
         `<circle cx="44" cy="20" r="4.2" fill="${RED}"/><path d="M47.5 19 L53 20.5 L47.5 22Z" fill="var(--t-kuchibashi)"/>`+
         `<path d="M22 58 Q14 66 10 72 M24 58 Q20 68 18 74 M27 57 Q27 67 26 74" stroke="${BLU}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`+
         `<path d="M27 40 Q31 44 35 40" stroke="${MEN}" stroke-width="1.6" fill="none"/>`+
         `<line x1="30" y1="58" x2="30" y2="66" stroke="${RED}" stroke-width="1.8"/><line x1="34" y1="56" x2="35" y2="65" stroke="${RED}" stroke-width="1.8"/>`;
    } else if(n===8){ // 8索：上はＭ・下はＷ
      g+=stick(10,21,GRN,30)+stick(50,21,GRN,30)+stick(23,21,GRN,30,20)+stick(37,21,GRN,30,-20);
      g+=stick(10,59,GRN,30)+stick(50,59,GRN,30)+stick(23,59,GRN,30,-20)+stick(37,59,GRN,30,20);
    } else {
      const h=(n>=7)?23:30;
      for(const [x,y,c] of S[n]) g+=stick(x,y,(aka?RED:c),(n<=4)?33:h);
    }
  } else { // 字牌
    const Z={1:['東',INK],2:['南',INK],3:['西',INK],4:['北',INK],5:['',''],6:['發',GRN],7:['中',RED]}[n];
    if(n===5) g+=`<rect x="12" y="14" width="36" height="52" rx="3" fill="none" stroke="var(--t-haku)" stroke-width="2.4"/>`;
    else g+=`<text x="30" y="54" text-anchor="middle" font-family="Yu Mincho,Hiragino Mincho ProN,serif" font-weight="800" font-size="40" fill="${Z[1]}">${Z[0]}</text>`;
  }
  return g;
}
export function tileSVG(code, w, label) {
  const h = w * 88 / 60;
  return `<svg class="tile" xmlns="${NS}" width="${w}" height="${h}" viewBox="0 0 60 88" role="img" aria-label="${label || code}">` +
    `<rect x="0.5" y="6" width="59" height="81.5" rx="6" fill="var(--t-se)"/>` +
    `<rect x="0.5" y="0.5" width="59" height="81" rx="6" fill="var(--t-men)" stroke="var(--t-fuchi)" stroke-width="1"/>` +
    `<rect x="2.5" y="2.5" width="55" height="77" rx="4.5" fill="none" stroke="var(--t-uchi)" stroke-width="1"/>` +
    face(code) + `</svg>`;
}
