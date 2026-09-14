# 0003 立體牌桌仿真度：把六層效果接進 docs/index.html

**狀態**：完成（2026-09-14 開、同日做完；報告見 [`agent/reports/0001-3d-fidelity/`](../reports/0001-3d-fidelity/README.md)、決策見 [ADR 0001](../adr/0001-3d-post-processing.md)）

## 目標

一句話：把 `design/fidelity` 原型裡 Francis 定案的六層效果接進 `docs/index.html` 的 3D 呈現層，
讓立體牌桌從「乾淨的 CG」變成「拍出來的牌桌」，而且不動既有的牌局邏輯與 2D 版。

## 定案（2026-09-14，Francis 在原型上逐項切過）

比較頁：<https://claude.ai/code/artifact/420cc32e-700a-4c91-9fcc-f786b6e79acc>
（原始檔 `design/fidelity/`，跑法與九層的細節見那裡的 README）

**要做的六層**

| 層 | 內容 |
|---|---|
| 軟陰影 | `VSMShadowMap`、`radius 4`、`blurSamples 12`、`bias 0`／`normalBias .02` |
| 接觸陰影 AO | GTAOPass，`radius .85`／`scale 2.0`／`samples 16`；開了就把假的 AO 貼片關掉 |
| 暗角＋顆粒 | 自寫 ShaderPass，`vig .22`、`amount .034`，暗部多顆粒亮部少，放在 OutputPass 之後 |
| 靜止時精算 | 抖動取樣累積 24 格；壁爐的火只要求重畫、不重置累積 |
| 材質微結構 | 牌＝亞麻壓紋（`clearcoat` ＋ `clearcoatNormalMap`）＋層疊側邊；桌布＝絨毛法線＋方向性高光；木沿＝導管孔＋銅鑲線；骰子＝法線凹點 |
| 幾何細節 | 椅子＝滾邊／釘扣凹陷／收分的腳／木扶手蓋／各歪一點；牌庫＝每張錯開；手牌＝微微拱起；書＝深淺前後不一 |

**不做的三層**（原型裡留著，程式結構要讓它們日後開得起來）

- **燈罩＝面光源**（RectAreaLight）：頂燈維持一個點。
- **光暈**（bloom）。
- **景深**（bokeh）：房間維持整個清楚。

## 步驟

1. **接線的殼**：`build()` 之後多一段後處理層（EffectComposer ＋ RenderPass ＋ GTAO ＋ OutputPass ＋ 顆粒），
   `frame()` 的 `S.r.render(...)` 換成走 composer；`resize()` 要一起 `setSize`。
   沒有 composer（手機降級、或建不起來）時走原本那條 `S.r.render(...)`，不能整層垮掉。
2. **靜止精算**：`frame()` 的 dirty flag 之外多一條「畫面不動時繼續疊」的路；累積用兩張 HalfFloat target。
   火的 tick 不重置累積。`UD.REDUCED` 時不疊。
3. **軟陰影**：`build()` 改 `shadowMap.type` 與 `lamp.shadow.*`；`resize()` 裡的 `mapSize` 分岔要一起改。
4. **材質微結構**：新增三張法線圖（亞麻、絨毛、木孔）與牌側邊的層疊貼圖，掛到
   `feltMat`／`woodMat`／`paper()`／`dieFaceMat()`；銅鑲線多一圈 Torus 進 `table` 群組。
   `paper()` 是牌面／牌背共用的入口，改一處兩邊都到。
5. **幾何細節**：`buildRoom()` 的 `chair()` 換成補細節的版本；`buildBooks()` 的 instance 矩陣加深淺前後；
   `sync()` 裡牌庫那 18 張加每張的偏移；手牌的 `cardGeo` 多一個拱度參數。
6. **降級**：一支 `fxTier()` 決定這台機器吃幾層（見下），設定頁多一個「畫質」選項可覆寫。
7. **驗證**：截圖對照 A／定案組；`deno run -A scripts/ui_test.ts` 與 `end_test.ts` 要全過
   （這兩支會開真的立體牌桌）。

## 降級（草案，實測後定）

AO 是六層裡最貴的一層（多一次深度法線 pass ＋ 16 取樣 ＋ 去雜訊）。草案：

| 檔 | 誰 | 開哪幾層 |
|---|---|---|
| 高 | 桌機／`boxW > 900` 且量到的每格時間 < 12 ms | 六層全開 |
| 中 | 平板、較慢的桌機 | 軟陰影＋材質＋幾何＋顆粒＋精算，AO 關（退回假的 AO 貼片） |
| 低 | 手機、或 `UD.REDUCED` | 材質＋幾何（幾乎免費的兩層），後處理整條不建 |

實際門檻要用 `frame()` 量到的毫秒數自己降檔，不靠 UA 猜。

## DoD

- [x] 立體牌桌六層全開。2D 版的算繪路徑一行沒動；共用的只有設定頁多出來的「畫質」那一列。
- [~] 手機自動降檔已做（> 26 ms 降一檔，只降不升）。**桌機的絕對毫秒數還沒在真 GPU 上量**——無頭 Chrome 走 swiftshader，量到的數字只能看相對大小。
- [x] 五支全過（含 `net_test.ts`），另加 `i18n_scan.ts` 平面／立體兩種都過。
- [x] `ui_test`／`end_test` 打完整場走過這些路徑；三檔各自開局打三墩截圖確認。
- [x] `agent/reports/0001-3d-fidelity/`，已登記。
- [x] PROGRESS 已更新；ADR 0001 已補。

## 風險 / 已知的坑

原型上量到的（細節在 `design/fidelity/README.md`）：

- `THREE.PCFSoftShadowMap` 在 three 0.186 已被移除，只印 warning 就退回硬邊；要用 VSM。
- GTAO 的預設半徑在這個場景等於沒開（牌只有 `.007` 厚）。
- Bloom 的 threshold 是色調映射前的線性亮度（這次不做 bloom，但別踩）。
- 亞麻壓紋只給 `normalMap` 看不見，要靠 clearcoat 的掠射光澤。
- 壓紋節距要避開取樣極限，不然是摩爾紋不是布。
- 火的 tick 會把「靜止精算」的累積一直打掉。
- **共平面**：新增的銅鑲線、牌側邊貼圖都貼在既有面附近，小心 [[updown-3d-coplanar-lines]] 那類深度打架。
