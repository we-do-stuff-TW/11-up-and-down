# 開房頁設計原型（2026-09-11）

開一桌之後、還沒發牌之前的那一頁。現在線上跑的是 `docs/index.html` 裡的 `netOv`
面板（`paintNet()`），這裡是要拿來換掉它的設計。**三案並排，定案 C。**

## 跑起來

```sh
cd design/room
python3 -m http.server 8770
open http://127.0.0.1:8770/          # 對照表
open http://127.0.0.1:8770/c.html    # 定案
```

`c.html` 底下那排切換器是原型才有的：**開房／設定**、**房主／客人**。
也可以直接掛參數：`?set`、`?guest`、`?nodev`（把切換器藏起來，`phone.html` 用這個）。

## 改

改 `*.def`，`/*==HTML==*/` 之前是 CSS、之後是 HTML，然後

```sh
python3 build.py c.def        # 產生 c.html；不給檔名就三案全build
```

共用的底有兩層：`_tokens.css` 是色票，原封不動抄自 `docs/index.html` 的 `:root`；
`_base.css` 把桌色覆寫成**大廳那張空桌的灰**（`trump === null` → `paintTable()` 的
`TABLE_NONE {h:250,c:.014}`、`hs=1` 所以 `L=.285`），另外放共用零件（頭像、字標、
銅色 CTA、絨面顆粒）。規則的文案跟選項跟 `docs/index.html` 的 `RULE_UI` 對齊，
別在這裡自己發明新講法。

## 截圖

```sh
python3 shot.py "c-room=http://127.0.0.1:8770/c.html" "c-set=http://127.0.0.1:8770/c.html?set"
python3 shot.py "big@1520x1380=http://127.0.0.1:8770/index.html"    # @寬x高
```

**手機寬不能直接截**：Chrome headless 會把視窗夾到最小 500px 寬（`--window-size=390,844`
出來的 `innerWidth` 還是 500），媒體查詢不會照你想的觸發。改用 `phone.html`——一頁塞
三個 390 寬的 iframe，iframe 有自己的 viewport，斷點才是真的。

## 三案

| | 桌子 | 規則在哪 | 設定長什麼樣 |
|---|---|---|---|
| **A 圍桌** | 橢圓木框＋絨布，房號刻在桌面中央 | 右欄一行一條 | 右欄長大成 470px，桌子縮小變暗留在視野裡 |
| **B 滿版牌桌** | 填滿整頁、左右被畫面裁掉，人沿上下兩道弧坐 | 浮在桌上的一塊玻璃 | 桌子退到後面，置中一張大規則卡 |
| **C 座位表** ✅ | 不做木頭跟絨布，一張銅線線稿 | 右欄印刷品（leader dots） | 同一張紙翻面，整頁變規則表 |

選 C 的理由：跟大廳同一個register——灰、hairline 分隔不用面、Bodoni、整頁只有
一顆銅色 CTA。A 跟 B 比較像牌桌本體的延伸，跟大廳擺在一起會像兩個設計師畫的。

## C 的幾個決定

- **房號**是頁面正中央 84px 的 Bodoni，不是角落的小標籤——這一頁的任務就是把四個字給朋友。
- **空位**是虛線圓＋「等人進來」，滑上去才變「放一個 AI」。那是房主的權限，客人看不到。
- **客人沒有設定頁**：規則整份已經在右欄唯讀看得到，再開一頁只是同一份東西再講一次。
  客人跟房主只差三處——「設定」變成「房主決定」、副標換一句、底下的銅色開始換成
  一顆呼吸的點寫「等 Francis 按開始」。
- **牌數／最多每人／總局數**在設定頁是 sticky 的，捲到哪都看得到改規則的後果。
- 手機：座位表縮成上半頁（橢圓 300×260、房號 46px、頭像在上名字在下），規則接在
  一條 hairline 底下，開始 sticky 在螢幕底；設定頁兩欄併一欄。

## 還沒做

接進 `docs/index.html`。線路是現成的：`createRoom()` / `joinRoom()` / `api("cfg")` /
`api("start")` / `api("addai")` / `api("unseat")`，規則欄直接吃 `RULE_UI` 跟
`ruleReadout()` 的同一份資料，介面跟引擎才不會各說各話。
