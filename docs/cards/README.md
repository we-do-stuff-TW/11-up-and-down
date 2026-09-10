# 宮廷牌人像

J／Q／K 十二張的雙頭人像，來源是 Wikimedia Commons 上 Dmitry Fomin 繪製的
「English pattern」撲克牌（CC0 公有領域）：

https://commons.wikimedia.org/wiki/File:English_pattern_king_of_spades.svg 等十二個檔案

處理方式（`index.html` 之外沒有建置流程，這裡記下來以便重做）：

1. `svgo --multipass` 壓縮。
2. 用瀏覽器量每個頂層元素的外框，拿掉整牌白底外框、角標＋角花的複合路徑、原圖的 L 形框線，
   只留人像；`viewBox` 裁到原圖人像框 `30 30 300 480`。
3. 五色重新對應到牌面配色：黑 → `#1A1714`、紅 → `#A32B25`、黃 → `#C9A552`、藍 → `#4A5188`、白 → `#FBF8F1`。

牌面上的角標、花色、A、牌背都是 `index.html` 自己畫的，跟這些檔案無關。
