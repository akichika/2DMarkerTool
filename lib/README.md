# lib/ — 同梱ライブラリ

外部 CDN の仕様変更・障害（例: docs.opencv.org のボット判定による 403）でアプリが動かなくなるのを防ぐため、
依存ライブラリをバージョン固定で同梱しています。`index.html` はまずここから読み込み、
OpenCV.js のみ失敗時に CDN（jsDelivr → unpkg）へフォールバックします。

| ファイル | バージョン | 取得元 | ライセンス |
|---|---|---|---|
| `opencv.js` | OpenCV 4.8.0（@techstark/opencv-js 4.8.0-release.10） | https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.8.0-release.10/dist/opencv.js | Apache-2.0 |
| `three.min.js` | three.js r128 | https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js | MIT |
| `OrbitControls.js` / `GLTFLoader.js` / `OBJLoader.js` | three@0.128.0 examples/js | https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/ | MIT |
| `jszip.min.js` | JSZip 3.10.1 | https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js | MIT / GPLv3 |
| `qrcode.min.js` | qrcode-generator 1.4.4 | https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js | MIT |
| `JsBarcode.all.min.js` | JsBarcode 3.11.6 | https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js | MIT |

## 更新するとき

1. 上の取得元 URL のバージョンを書き換えてダウンロードし、同じファイル名で置き換える
2. `index.html` のスクリプト URL のクエリ（`?v=`）と `sw.js` の `CACHE` を上げる
3. OpenCV.js を更新したら、アプリ起動時のログに「機能が見つかりません」系の警告が出ないか確認する
   （`app.js` の互換レイヤー `cvCompat()` が API 名の違いを吸収し、無い機能だけを無効化します）
