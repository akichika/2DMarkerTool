# ブラウザだけで ArUco/AprilTag/QR/バーコードを生成＆AR認識する「2DMarkerTool」を作った

OpenCV.js と Three.js で、**マーカーの生成**から**カメラ認識・3D姿勢推定・3Dワールド表示・ARモデル重畳**までを、**ビルド不要・素のHTML/CSS/JS**で実装した Web アプリ「**2DMarkerTool**」を公開しました。映像は端末内で完結し、外部送信しません。

- 🌐 公開サイト: https://akichika.github.io/2DMarkerTool
- 💻 リポジトリ: https://github.com/akichika/2DMarkerTool

![生成タブ](https://raw.githubusercontent.com/akichika/2DMarkerTool/main/docs/screenshots/01-generate-aruco.png)

## できること

- **生成**: ArUco（4×4〜7×7）/ AprilTag / QR / **1Dバーコード（JAN/EAN/UPC/CODE128 等）** を PNG・SVG・印刷・ZIP一括
- **認識**: 「全自動」で全種別を自動判別。2D枠 / 塗りつぶし＋大ID / **3D姿勢（AR重畳）**
- **3Dワールドビュー**: カメラとマーカーの相対姿勢を CG 表示（スケール・距離・デバイス姿勢追従）
- **ARモデル重畳**: 指定 ID のマーカー上にプリミティブや glTF/OBJ を表示（色・テクスチャ・ライブプレビュー）
- 多言語（日英中西）・4テーマ・PWA・低照度補正

| 2D枠 | 3D姿勢 | 3Dワールド |
|---|---|---|
| ![](https://raw.githubusercontent.com/akichika/2DMarkerTool/main/docs/screenshots/04-scan-2d.png) | ![](https://raw.githubusercontent.com/akichika/2DMarkerTool/main/docs/screenshots/06-scan-3d-pose.png) | ![](https://raw.githubusercontent.com/akichika/2DMarkerTool/main/docs/screenshots/07-world-view.png) |

## 技術スタック

| 用途 | ライブラリ |
|---|---|
| マーカー検出・姿勢推定 | OpenCV.js 4.8 |
| 3D（AR重畳・ワールド・モデル） | Three.js r128（OrbitControls / GLTFLoader / OBJLoader） |
| QR 生成 / バーコード生成 | qrcode-generator / JsBarcode |
| ZIP 一括 | JSZip |

## 実装でハマったところ・知見

### 1. `cv.VideoCapture` のフレーム取得が 0px になる

`cv.VideoCapture` は `video.width` / `video.height`（HTML属性）を見るため、CSS でサイズ指定した `<video>` だと **0 になって何も取れません**。手動で canvas に描いて `getImageData` する方式に変更して解決しました。

```js
procCtx.drawImage(video, 0, 0, w, h);
matFrame.data.set(procCtx.getImageData(0, 0, w, h).data);
cv.cvtColor(matFrame, matGray, cv.COLOR_RGBA2GRAY);
```

### 2. マーカー生成で `borderBits=0` が例外を投げる

`generateImageMarker(id, size, mat, 0)` は例外になるので、常に `borderBits=1` で生成し、**白い余白（クワイエットゾーン）は `cv.copyMakeBorder` で付与**しました。SVG はビット配列から `<rect>` を組み立てています。

### 3. バーコード検出は「わずかなブラー」で安定する

`cv.barcode_BarcodeDetector` は、合成画像のようなシャープすぎるエッジだと検出・復号に失敗しがちです。**3×3 の軽い GaussianBlur** をかけると EAN-13/EAN-8/UPC が安定して復号できました（実写は元々平滑なので影響軽微）。

```js
cv.GaussianBlur(detInput, matBar, new cv.Size(3, 3), 0);
const ok = barcodeDetector.detect(matBar, pts);
const text = barcodeDetector.detectAndDecode(matBar);
```

### 4. QR/バーコードは「縮小しすぎ」で復号できない

タグ検出は速度重視で最大幅 800px に縮小していますが、QR/バーコードは細部が潰れると復号できません。**コード系だけ 1280px**まで許容し、`detectMulti` が失敗したら単一 `detectAndDecode` でフォールバックします。

### 5. 「全自動」の高速化

全種別を毎フレーム走査すると重いので、

- 未検出時は **ArUco 4 辞書と AprilTag 4 ファミリーを1フレームおきに交互走査**
- 検出したら **その種別に固定**（見失うまで）
- **QR とバーコードはフレームごとに交互実行**し、結果を数フレーム保持

としてFPSを確保しました。

### 6. 姿勢推定の座標変換（OpenCV → Three.js）

`cv.solvePnP`（`SOLVEPNP_IPPE_SQUARE`、バーコードは矩形なので `IPPE`）＋ `cv.Rodrigues` で回転行列を得て、Three.js の行列へ **y, z を反転**して渡します。

```js
obj.matrix.set(
  R[0],  R[1],  R[2],  t[0],
 -R[3], -R[4], -R[5], -t[1],
 -R[6], -R[7], -R[8], -t[2],
  0,     0,     0,     1
);
```

### 7. 3Dモデルを「マーカーを底面」にして立てる

読み込んだモデルは Y-up が多いので、**原点中心化 → X軸まわり90°回転（Y-up→Z-up=マーカー法線）→ 底面を z=0 へ持ち上げ**て正規化し、マーカー一辺(mm)に合わせて自動スケールします。正四面体は「底面がマーカー、底面三角の頂点が +X」になるよう頂点を手で定義しました。

![モデル重畳＋プレビュー](https://raw.githubusercontent.com/akichika/2DMarkerTool/main/docs/screenshots/08-model-overlay.png)

## 設計メモ

- **完全クライアントサイド**（プライバシー）。Service Worker で初回以降オフライン動作
- レイアウトはカメラ／検出結果／3Dワールド／3Dモデルの**4ペインを横・縦・タブで自由配置**、各ペインの高さはカメラ基準で統一
- i18n は `STRINGS` オブジェクト＋`data-i18n` 属性。テーマは CSS 変数＋`[data-theme]`

## ライセンス

- 本体: MIT © akichika
- OpenCV.js (Apache-2.0) / Three.js (MIT) / JSZip (MIT・GPLv3) / qrcode-generator (MIT) / JsBarcode (MIT)
- AprilTag © AprilRobotics（BSD-2-Clause）、「QR Code」は DENSO WAVE の登録商標

## おわりに

「印刷したマーカーをかざすと、その場で種類・ID・座標・3D姿勢が分かり、好きな3Dモデルを乗せられる」ツールを、インストール不要のブラウザだけで実現できました。Pull Request・Issue 歓迎です 🙌

作者: akichika（https://x.com/akichika ）
