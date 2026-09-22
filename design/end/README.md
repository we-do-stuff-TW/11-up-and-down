# 收桌：三案 → 講台定案 → 講台三案 → **E 牌疊定案，已接進 docs/index.html**（2026-09-13）

牌局打完那一頁。**現在線上**（`3853ca1`／`87d2276`）是蓋在牌桌上的一張綠玻璃卡：
台上三階、三顆按鈕。Francis 看了兩個要求：**顏色統一成大廳那種感覺**、
**三個獲勝者用圖示或動畫展示會更有趣**。

第一件不是選擇題，三案都照做了：收桌從「牌桌上的對話框」改成**一頁**，跟登入、大廳、開房、
帳號／設定／規則同一張石板灰的紙（`_base.css` 那組 250 色相）、Bodoni 一句大字、線分隔不用面、
整頁只有一顆銅色按鈕（再來一局）。「返回房間／看計分表」退成大廳頁腳那種小字。
標題不再是「牌局結束」四個字，是**誰贏了**：「阿哲 贏了這一桌」「你贏了這一桌」「阿哲、你 平手」。

第二件才是三案的題目：**三個人怎麼站出來**。

## 跑起來

```sh
cd design/end
python3 -m http.server 8791
open http://127.0.0.1:8791/          # 對照表
open http://127.0.0.1:8791/a.html    # 原型；底下那排切換器是原型才有的
```

參數：`?tie` 第一名與第三名各兩個人同分、`?me` 你是第一名、`?solo` 對 AI 的單人局、`?nodev` 藏掉切換器。
切換器上的「重播」就是重新載入，動畫從頭跑一次。

## 改

改 `*.def`，`/*==HTML==*/` 之前是 CSS、之後是 HTML＋那一案自己的 script，然後 `python3 build.py a.def`
（不給檔名就三案全 build）。色票與零件直接讀 `../room/` 那一份，**不要在這裡複製第二份色票**。
`_top.html`／`_bottom.html` 是三案共用的殼（字標、標題、按鈕、切換器、假資料）；
資料與 `face()`／`sc()` 放在 `_top.html` 尾巴，因為三案自己的 script 在它後面才跑。

截圖：`cd shots && python3 ../shot.py "a=http://127.0.0.1:8791/a.html?nodev"`。
手機寬用 `phone.html`（一頁三個 390 的 iframe）。

## 三案

| | 什麼在動 | 名次靠什麼讀出來 | 同分怎麼站 | 代價 |
|---|---|---|---|---|
| **A 獎台** | 三階從地板升起，三→二→一，人在台階到位後才亮 | 高度 | 同一階上頭像疊著站、名字用「、」串 | 佔的高度最多；多人同分時名字會擠在一階上 |
| **B 翻牌** | 三張牌背朝上，第三名先翻、第二、最後冠軍 | 牌角的索引（寫的是名次不是點數） | 同一張牌上多個頭像 | 米色牌面是這一頁唯一亮的「面」，跟「不加新的面」有一點張力 |
| **C 獎章** | 名單一行一行進來、章蓋上去、分數從 0 跑到最後 | 章（第一名整枚銅色、二三名線描） | 同一列，名字用「、」串 | 最安靜，也最像現在那張表；「有趣」靠章跟數字跑 |

**A**──獎台是最不用解釋的名次圖：站得最高的贏。台階畫成線稿（hairline 邊、比地亮一階的面），
跟開房頁的橢圓座位表同一支筆；第一階頂邊是銅色的。升起的順序是三、二、一，最後上來的是冠軍。
2・1・3 的排法。

**B**──翻牌是這個遊戲自己的手勢：每局翻王牌、收桌翻名次。牌面是米色的紙（跟房號那四張牌位同一種），
角落的索引寫名次，中間站著那個人，第一名那張大一號、放中間、最後翻。翻的時候看得到牌背（線上那副的深紅格紋）。

**C**──不換形式，就是大廳／帳號頁那種印刷名單，多的是三枚 rosette 跟數字跑起來那一秒。
其餘的人也在單子上，退到後面淡一階（自己那一列亮回來）。分數用 CSS `@property` 讓數字本身被動畫，不靠 JS 逐幀改字。

## 三案都遵守的幾條

- **同一張紙**。地是 `_base.css` 的石板灰，不是牌桌的絨布；牌桌是酒紅時收桌也不會變色。
- **同分同名次、台上三階**：跟 `docs/index.html` 的 `showFinal()` 同一套算法，`?tie` 看得到。
- **動畫只用 transform／opacity**，曲線一律專案現成的 `--e-out`，沒有 ease-in。收桌一場一次，是「難得」那一級，
  所以整段可以到一秒多；但每個單元（一階升起、一張牌翻）都在 .5–.65 秒內。
- **`prefers-reduced-motion`**：位移與翻轉拿掉，只留淡入；C 的數字直接停在最後的值。
- 沒進前三的自己：A、B 底下補一行「你第 N / M · 分」（`.mine`），C 本來就在單子上。

## 講台三案（第二輪）

Francis 看完第一輪：「**講台不錯。再設計三個不同的講台設計放我挑選。**」所以 B 翻牌、C 獎章出局，
講台這條路再開三個——差別在**台子是什麼做的**：

| | 台子 | 什麼在動 | 跟誰同一支筆 | 代價 |
|---|---|---|---|---|
| **D 木階** | 實木三塊，頂面被頂燈打亮，名次刻在正面 | 三→二→一從地板升起 | 立體牌桌那間書房的胡桃木（`--wood`） | 石板灰的紙上放了三塊真的東西——最「物」 |
| **E 牌疊** | 疊起來的牌，最上面一張翻開寫名次 | 一輪一輪發牌，第一名那疊最後還在收 | 這副牌本身（牌背是線上那副的深紅格紋） | 最熱鬧；牌疊高度差沒有台階那麼一眼 |
| **F 聚光燈** | 沒有台子，三道光落在地上，名次寫在光裡 | 三→二→一開燈（亮、略暗、穩住） | 書房那盞頂燈、壁爐 | 名次靠亮度跟位置讀，不靠高度 |

A（線稿階梯）留在對照表最上面當出發點。三案共用 `_stage.css` 裡的 `.who`（台上那個人）跟 2・1・3 的排法。
`phone2.html` 是講台三案的 390 並排。`?tie`／`?me`／`?solo` 三案都吃。

## 接進去之後（E 定案）

- 收桌從 `.overlay .sheet` 換成 `<div class="pg end" id="endOv">`——掛 `.pg` 直接拿帳號／設定頁那張石板灰的地，
  不另立一套。三顆按鈕的 id（`endAgain`／`endBack`／`endClose`）沒動，頁腳多一顆 `endClose2` 跟右上角同一條路。
- 牌背用的是真的 `.back`（跟著當下那套牌面走），所以換牌面收桌也跟著換；`.cd` 自己給 `--cw/--ch` 讓 `.back` 量得到尺寸。
- 發牌的聲音接在 `showFinal()` 尾巴：`SFX.deal(張數, 秒數)` 跟畫面同一個節奏（13 張 × 75ms）。
- 沒有 `restarting` 以外的新狀態；再來一局／返回房間／看計分表三條路的邏輯一行沒動。
- 手機 390：開著換視窗大小驗過，標題一直在中間（`.end-mid` 是 flex 置中，不是量出來的）。

## G 頒獎：Thomas 爬上講台（2026-09-22，原型，未接進 `docs/index.html`）

Francis：「之前不是有一個 Thomas Sun 的大頭照嗎？能不能在最後排名畫面，看到那個大頭貼爬上講台、
從第三名頒發獎盃到第一名？幫大頭貼做一個細細的手腳。動畫本身是搞笑跟荒謬的。」

`g.def` → `g.html`：牌疊那一段跟 E 一字不差，多的是底下「頒獎」那一節。

```sh
cd design/end && python3 -m http.server 8793     # 8791 常被 design/fidelity 佔著
open http://127.0.0.1:8793/g.html
```

**照片**：`_tom.jpg` 是 symlink → `../thanks/_avatar.jpg`，跟 `design/thanks/` 同一個理由**不進版控**
（`.gitignore` 有列）。另一台電腦要看得先把照片放到 `design/thanks/_avatar.jpg`。

### 劇本（發完牌、名字亮起之後 0.6 秒開演；繞第二名 ≈ 12.5 秒、直達 ≈ 10.7 秒）

| 節拍 | 什麼事 |
|---|---|
| rise → walk | 從舞台右邊**地板底下**走樓梯上來（舞台底邊以下用 `clip-path` 切掉），獎盃高舉過頭 |
| crouch → jump1 → bump → slide | 第一跳不夠高，撞上第三名那疊（牌疊晃一下），貼著牌滑下來、腿蹬幾下 |
| putdown → backup → run → jump2 | 把獎盃放地上、退兩步、助跑、第二跳抓住牌邊 |
| hang → haul → stand3 | 吊著亂踢，爬上去，站直撣撣手 |
| look → reach → retract | 低頭：獎盃忘在地上——**右手像橡皮一樣伸長到地上**撿回來（`scaleY` 一條 1.5px 的線） |
| hop → land2 → look2 | 一跳**跳過頭**，落在第二名那疊，看看那張「2」、搔搔頭、看隔壁 |
| hop1 → land1 → present | 跳回第一名，踮腳把獎盃遞出去；獎盃飛到冠軍頭像旁邊，冠軍點頭 |
| bow → hold → unbow | 整個人從腳底往前折一個大鞠躬 |
| step → air → fall | 倒退一步踩空、在空中原地跑兩下、掉到牌疊**後面**（`z-index` 換到 -1，再被舞台底邊切掉） |

### 怎麼做的

- 角色：72px 圓形照片當頭、整個人再乘 `--k:1.4`（螢幕上頭 100px，比冠軍頭像 56px 大一倍——Francis 看過第一版說
  「整體畫面可以放大一些。大頭貼尤其。」，第二版再說「更荒謬的大」），四肢 1.5px 線（`--ink` 淺線＋ .7px 暗邊，落在米色牌面上也看得見），
  **手臂 80px 比頭還長**——舉起來才過得了頭頂、也才伸得到地上。獎盃是銅色線稿 SVG。
- **`scale` 要掛在 `.body`／獎盃的 svg 上，不能掛在管 y 的那一層**：個別屬性 `scale` 套在 `transform` 之後，
  掛在 `.ty` 會把 y 的位移也乘上 k（k＝1 時看不出來，1.25 就整個人站低、獎盃掉到地板底下）。
- 一條 WAAPI 主時間軸，14 條軌（x、y、身、雙腿、雙臂、頭、獎盃 x／y／轉、透明度、z）。
  **x 與 y 拆兩層**（`.tom` 管 x、`.ty` 管 y），跳起來才是真的拋物線：y 上去 ease-out、下來 ease-in、x 等速。
- 位置全部從 DOM 量（牌疊頂、地板線、冠軍 `.faces`），所以同分、手機寬（`--k:1.1`）都對。獎盃最後落在冠軍頭像**左邊**，他站右邊，不撞頭。
- 牌疊晃、冠軍點頭是另外三個小 `animate()`，用 `setTimeout` 對到節拍。
- `prefers-reduced-motion`：不演，直接站在第一名旁邊、獎盃在冠軍旁邊，淡進來。

### 原型切換器

`?tie` `?me` `?solo` 照舊；多了 **繞第二名**（`?direct` 關掉）、**慢動作**（`?slow` 0.35×）、
底下一條**時間軸拉桿**（拖就停格、「播」從那格接著跑）。截圖用 `?t=節拍名+秒`，例如 `?t=reach+.34`
（節拍名見上表；`shots/g_sheet2.png` 十八格就是這樣截的）。

### 音效（2026-09-22，Francis：「可以了。請做音效。」）

- 音效層**原封不動抄自 `docs/index.html`**：`python3 pull_sfx.py` → `_sfx.js.part`，build 時填進 `/*==SFX==*/`。
  尾巴多掛一行 `SFX._prim` 把合成原件（grain／thump／rhodes／cardLand／pack／sweep）露出來給原型用；
  正式版把「頒獎的聲音」那一段搬進音效層的 IIFE 裡就好，不需要 `_prim`。`docs/index.html` 改過音效要重跑 pull_sfx。
- 新的一顆 `SFX.gag(B, rate, {pan1,pan2,pan3})`：吃同一張節拍表，全部排在 AudioContext 的時間軸上（不是 setTimeout），
  跟畫面對得上毫秒；左右聲道跟著三疊牌的位置。
- 聲音的世界跟牌桌一樣：紙、絨布、木頭、rhodes。多了三顆卡通的——**滑笛**（撞牌滑下來、最後掉下去）、
  **橡皮 boing**（手臂彈回來）、**銅獎盃的叮**（放下、撿起、遞到）。「嗯？」是兩顆 rhodes 往上走四度，「喔。」往下。
  踩空那段是「啊喔」兩顆下行音＋在空中原地跑的乾拍聲（沒有地板，所以沒有低頻）。
- 瀏覽器要先有一次點擊才准出聲：原型切換器多一顆**「重播頒獎（有聲）」**，那一下就是解鎖。第一次自動開演是安靜的。
- 驗法（不用耳朵）：`node bounce_sfx.mjs "http://127.0.0.1:8793/g.html?nodev" out.json` 用 CDP 驅動 headless Chrome（Node 內建 WebSocket，不用裝東西） 跑 `SFX.bounce("gag", [TOM.B, 1, {...}], 秒)`，
  離線算成音訊、每 20ms 量 RMS 畫成 `shots/g_audio_env.png`（藍線是節拍）。峰值 0.35，沒爆音。

### 在外面看：發成 Artifact

`/usr/bin/python3 artifact.py g.html /tmp/g-artifact.html` 會把 build 好的原型轉成 Artifact 單檔（拆掉 html/head/body 殼、
頭像內嵌成 256px data URI、拿掉切換器裡連到其他案的死連結、切換器改成會換行），再用 Claude Code 的 Artifact 工具發佈。
Artifact 是私人的（只有 Francis 開得了），所以照片內嵌在裡面沒有「進公開 repo」的問題。
G 案：https://claude.ai/artifact/HwEWFprpoRmVrBCzhsAbVm（2026-09-22）

## 三個完全不一樣的方向：H 巨獸 · I 紙偶戲 · J 電玩（2026-09-22）

Francis 看完 G：「整個動畫和圖可以再更荒謬的大。動畫跟整體風格能否也給我三個完全不一樣的設計讓我挑選。」
三案各自一個 `.def`，同一套引擎（節拍表、WAAPI 軌、x／y 拆層、`?t=節拍名+秒`、拉桿、「重播頒獎（有聲）」、reduced-motion 定格、`--k`），
差別在角色的畫法、舞台的樣子、動作的語言、聲音的世界。都用 `artifact.py` 發成私人 Artifact 給人在外面的 Francis 看。

| | 什麼樣子 | 動作的語言 | 聲音 | Artifact |
|---|---|---|---|---|
| **G 頒獎**（基準，再放大） | 線描火柴人、頭 100px | 平滑、卡通物理 | 紙牌 Foley ＋ 滑笛／boing／叮 | https://claude.ai/artifact/HwEWFprpoRmVrBCzhsAbVm |
| **H 巨獸登陸** | 頭 252px 比三疊牌還寬、腿 34 手臂 130；頭頂聚光燈 | 每一步整頁震、踩扁第三名、鞠躬撞牌疊眼冒金星、仰倒出舞台（撞擊角度用幾何算） | 45–60Hz 重擊、低吼、玻璃震顫 | https://claude.ai/artifact/7ABngEgKQt8GDtBcVK7p15 |
| **I 紙偶戲** | 米色台口＋一排燈泡＋酒紅絨幕；紙偶（貼紙頭 150px、紙條手腳、銅釦關節、底下一根竿子） | `steps()` 一秒 11 格、掛竿擺盪；幕開→演→幕合→開縫偷看→幕開 | 木頭喀答、紙板啪、幕拖桿、卡祖笛小號角 | https://claude.ai/artifact/E2xCLdMZcpumhEm6bhUv42 |
| **J 復古電玩** | CRT 面板、掃描線、Press Start 2P、1ST／2ND／3RD 像素方塊；頭是 28×28 像素照片 150px | Mario 邏輯：頂方塊蹦金幣 +100、撿獎盃、WINNER! 閃、分數假跳 +999、跑過頭掉坑 | 全部 chiptune（方波／三角波） | https://claude.ai/artifact/YYBZhbpt8QrAH3wRfb7Rk7 |

對照表：`shots/h_sheet.png`、`i_sheet.png`、`j_sheet.png`（`j_sheet2.png` 是修完的）。J 的像素頭第一版太暗認不出臉，改 28×28、gamma 抬暗部、量化 8 階（`jz_head_crop.png`）。
給 Francis 在手機上挑的對照頁（四案停格＋網址）：https://claude.ai/artifact/JGPjXLgtMpo8tKN2co5zjx
三案都是 fork 併行做的（各自只動自己的 `.def` 與 `shots/` 前綴），沒 commit。
`bounce_sfx.mjs` 改成隨機埠：H 那一輪撞到別的 session 佔著 9333。

### 接進 `docs/index.html` 之前要 Francis 拍板

1. **照片會進公開 repo**：`docs/index.html` 有版控、也是部署出去的檔。放法有兩種：直接內嵌 base64（照片進 git 歷史、永遠拿不掉）；
   或放到 Supabase storage 之類的公開 URL 由前端載入（照片仍公開可見，但不在 repo 裡）。2026-09-15 對「特別感謝」那一塊決定先不放，同一張照片。
2. 挑哪一案（G／H／I／J），以及 G 的話繞不繞第二名（12.5 秒 vs 10.7 秒）。
3. ~~音效~~：做了（見上一節）。

### 已接進 `docs/index.html`（2026-09-22，Francis 挑 G）

- CSS 在 `.end-floor` 之後那一段（`.end-stage`／`.end-clip`／`.tom-*`）；HTML 把 `.stacks`＋`.end-floor` 包成 `#endStage`，
  角色與獎盃放在 `.end-clip` 裡（絕對定位、上與左右多留、底邊貼地板線、`overflow:clip`——不用 `clip-path`，
  因為 `.end-mid` 是 `overflow:auto`，clip-path 剪掉的部分還是會撐出捲軸）。
- JS：`endGag(dealEnd)` 接在 `showFinal()` 尾巴（`$("endOv").hidden = false` 之後才量得到位置）。
  收桌那一頁被關掉（`hidden`）就整段停：MutationObserver 看 `#endOv`，動畫取消、計時器清掉、`SFX.gagStop()`。
  再開（最終結果按鈕）會重新開演。台上不到三疊（同分併階）不演——沒有第三名可以爬。單人局（對 AI）也演。
- 音效：`SFX.gag`／`SFX.gagStop` 搬進音效層的 IIFE（整段走自己一顆 gain，關頁時壓到 0）。
- 測試接縫：`UD.gag`（＝endGag，有 `.seek(秒)`／`.B`／`.stop`）。驗收：`deno run -A scripts/gag_test.ts`（`DIM=3` 立體、`PHONE=1` 手機寬）
  ——打完一場 → 把分數改成十個不同的值逼出三疊 → 停在九個節拍截圖 → 驗沒橫向捲軸、關頁會停、重開會演；
  三種都跑過：`shots/live2_sheet.png`、`live3_sheet.png`、`live2p_sheet.png`。
  立體模式在 headless 打牌時本來就有三個 `needsUpdate` 的錯（頒獎開演前就在，`faceMat` 的圖集在 swiftshader 下少格），跟頒獎無關。
- **照片**：`docs/img/tom.jpg` 目前是 symlink → `design/thanks/_avatar.jpg`，**列在 `.gitignore`**。
  部署前 Francis 要決定：把真檔放進 `docs/img/`（進公開 repo）或改成外部公開網址（`.tom-head img` 的 `src`）。
