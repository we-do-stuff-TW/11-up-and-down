# 遊戲畫面改版 · 第一輪：四個方向（2026-10-09）

Francis：「手牌太小，手牌下方的留白太多」「希望能看看不一樣的感覺」。
一定要留：立體牌桌、丟骰子叫墩、現在的牌面。會覺得不對：太花看不清楚牌、像廉價手機小遊戲、太素沒有牌桌感。
（產品事實寫在 `.agents/context/PRODUCT.md`。）

比較頁（Artifact）：https://claude.ai/artifact/1Sjiv7gipR9iePWrpHAadu

## 四張示意圖

同一桌、同一刻：6 人、第 8 局、輪到我出第 3 墩（阿明 ♦10、Kelly ♦A、小美 ♣Q 已出）。資料在 `_kit.js`。

| 檔 | 方向 | 怎麼來的 |
|---|---|---|
| `a-call.html` | 群組通話 | impeccable 抽籤抽到的主案（seed 9b27936f，清單第 5 個），加上五個落選風格各借一條 |
| `b-mahjong.html` | 自動麻將桌 | 我自己排第一的方向 |
| `c-flap.html` | 翻牌看板 | 外來風格挑戰者，唯一沒被刷掉的 |
| `d-canon.html` | 撲克 app 的樣子 | 業界標準，固定放著當退路 |

**這些是示意圖，不是成品**：立體桌是 CSS 透視畫的平面，不是 three.js。牌面是真的——`cards.ts` 從 `docs/index.html`
平面模式把牌截下來（要等 `UD.courtsReady()`，不然人像是空框）。

## 跑

```sh
deno run -A shot.ts a-call.html b-mahjong.html c-flap.html d-canon.html   # 390×844、2 倍 → shots/
W=1280 H=900 deno run -A shot.ts compare.html                                # 其他寬度：環境變數 W、H
python3 build.py                                                             # compare.src.html ＋ shots/*.webp → compare.html（發佈用）
deno run -A cards.ts     # 真牌 → _raw/*.png（檔名是「黑桃K」這種），再轉成 cards/SK.webp：
for f in _raw/*.png; do n=$(basename "$f" .png | sed -e 's/黑桃/S/;s/紅心/H/;s/方塊/D/;s/梅花/C/'); cwebp -quiet -q 86 -resize 400 0 "$f" -o "cards/$n.webp"; done
```

headless Chrome 的視窗會被夾到最小 500 寬，所以 `shot.ts` 用 `Emulation.setDeviceMetricsOverride` 而不是 `--window-size`。
示意圖的 viewport 一定要 `width=device-width,initial-scale=1`：寫成 `width=390` 時，只要有一個元素超出 390，
手機模擬會把整頁縮到 0.92 倍（第一版就這樣，量出來 360 寬）。

## 狀態

**第一輪收掉了。** 他看完四個方向回：「其實現在的畫面不差，只是牌桌太亂太雜，覺得撲克牌等等需要大幅縮小，手牌不必。」
四個方向都不做；現在的長相保留，改成第二輪：只把立體桌上的東西縮小。

# 第二輪：桌上的東西縮小（2026-10-09）

對照頁（Artifact）：https://claude.ai/artifact/SrsfbGq34S4cK1Jo4Eaxfp

`tidy.ts` 用真的遊戲拍：開頁時在記憶體裡替 `docs/index.html` 打補丁（`docs/index.html` 本身不動），
每條補丁都要在原檔剛好找到一次，否則整支停下來。洗牌與電腦出牌各用固定種子，所以每種大小拍到的是同一副牌、同一墩。

一起縮的：別人手上的牌背、牌堆與王牌、檯面這一墩、贏到的墩、發牌時落在我面前那一疊、骰子（少縮一點）。
另外檯面這一墩的半徑跟著縮（`tight=1`），不然牌小了會散成一圈各自的點。沒動：手牌、名牌、資訊列、叫墩的金圈、平面模式。

```sh
deno run -A design/table/tidy.ts K=0.55 KD=0.75 tight=1 view=iphone   # view＝iphone｜ipad｜mac；K＝桌上縮成幾倍，KD＝骰子
# → design/table/tidy/<view>-<bid|play>-<tag>.png；對照頁用的 webp 在 tidy/img/（iPad 縮成 1230 寬、電腦 1800 寬）
```

同時開三個以上偶爾會撞到 Chrome 起不來（WebSocket 連不上），重跑那一個就好。

## 狀態

**他挑了（10-09）：「ipad、電腦原本的大小可以啊。我在說的是手機。手機七成。」** 名牌與平面模式照我的建議不動。
接著補一句：「只有手機需要縮小，其他都維持原本大小。」——指的是裝置，所以手機橫拿也縮。

已寫進 `docs/index.html`：`PHONE_TABLE_S = .70`、`PHONE_DICE_S = .85`，「手機」＝`isPhone()`：裝置螢幕短邊 < 600
（不看視窗：第一版用大廳那條「視窗寬 ≤ 760」，手機一橫拿就不縮、iPad mini 直拿 744 反而縮，被他這句話否掉）。
由 `resize()` 寫進 `S.tableS／S.diceS`，每個擺位函式乘它。

驗過的（`tidy.ts real=1`，截圖在 `tidy/*-real*.png`；`*-orig.png` 是改之前）：
- iPhone 直拿跟示範的「七成」逐像素比 0.00%；iPad、電腦跟「現在」比 ≤ 0.56%（雜訊）。
- iPhone 橫拿會縮；iPad mini 直拿、電腦把視窗拉到 560 寬都不縮，跟改之前逐像素一樣。
- 10 人局：這一墩不再蓋到「輪到你出牌」與骰子（現在的版本會蓋到，`tidy/iphone-play-k1-n10.png`）。
- 收墩、下一局發牌途中各拍幾格，沒有穿幫。
- engine／rules／ui／net／end 測試全過，`gag_test` DIM=3 PHONE=1 也過。

順帶看到、沒處理：手機橫拿時畫面本來就擠（頂列佔掉四分之一高，名牌壓在桌上），縮牌只鬆一點。
還沒 commit、沒推上線，等他說。