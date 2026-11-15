# Gina 的教學群島 3D（動漫奇幻版）

網址：https://chginali-gina.github.io/GSAT-Coach/island3d/

## 怎麼玩
- 先選角色、輸入暱稱
- 電腦：方向鍵或 WASD 走路；手機：左下角搖桿
- 也可以直接點地面或點島，角色會自己走過去
- 靠近島，島主會開口；走進島下方發光的傳送陣就登島（電腦按 E 也可以）
- 右上角任務列會指向下一座還沒蓋章的島，左上角是小地圖

## 新增角色
在 `data/islands.json` 的 `characters` 裡，把角色的 `locked` 改成 `false`，並加上 `walk`（全身去背圖）與 `badge`（頭像）路徑。

## 資料夾
- `index.html`、`style.css`、`js/main.js`：網頁與 3D 程式，平常不用改
- `data/islands.json`：每座島的內容（島主、教材、資源連結、題目、配樂）
- `img/`：16 座浮島、魔女露娜、地面材質
- `audio/`：大廳序曲與各海域的登島樂章

## 常見修改
- **改教材或題目**：編輯 `data/islands.json`。題目的 `answer` 從 0 開始數。
- **加影片**：在某座島加一行 `"video": { "type": "youtube", "id": "影片ID" },`
- **換島的圖**：把新圖存成同名的 `img/島代號.webp`。
- **開放建設中的島**：把 `nopq` 的 `status` 改成 `open`，補上教材、資源和題目。

## 進度存在哪
學生的名字和島章只存在自己裝置的瀏覽器（localStorage），不會上傳。
