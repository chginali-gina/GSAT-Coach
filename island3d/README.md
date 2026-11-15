# Gina 的教學群島 3D（動漫奇幻版）

網址：https://chginali-gina.github.io/GSAT-Coach/island3d/

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
