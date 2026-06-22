# インストール不要・ブラウザだけで動く「2Dマーカー生成・確認ツール」を作りました

QRコードやARでよく見る四角いマーカー（ArUco / AprilTag）。それを **作って・印刷して・カメラでかざすだけで認識**できる、ブラウザ完結のツール「**2DMarkerTool**」を公開しました。アプリのインストールも会員登録も不要、**映像は外部に送られません**。

- 触ってみる 👉 https://akichika.github.io/2DMarkerTool/

![アプリ画面](https://raw.githubusercontent.com/akichika/2DMarkerTool/main/docs/screenshots/01-generate-aruco.png)

## なにができるの？

ひとことで言うと「**2次元コードの生成と、カメラでのリアルタイム認識**」です。

- 🧩 **作る**: ArUco / AprilTag / QR / **バーコード（JANなど）** を生成して、PNG・SVG・印刷・まとめてZIP保存
- 🎥 **読む**: カメラにかざすと、種類・ID・位置・大きさを表示。**「全自動」**なら何のコードかも自動で判別
- 🧊 **乗せる**: マーカーの上に **立方体や読み込んだ3Dモデル**をリアルタイムで表示（ARっぽい重畳）
- 🌐 **俯瞰する**: カメラとマーカーの位置関係を **3Dの空間**でぐりぐり見られる
- 📱 スマホでも動く・**インストールしてオフライン**でも使える（PWA）

| カメラ認識 | 3Dで重ねる | 3D空間で確認 |
|---|---|---|
| ![](https://raw.githubusercontent.com/akichika/2DMarkerTool/main/docs/screenshots/05-scan-fill.png) | ![](https://raw.githubusercontent.com/akichika/2DMarkerTool/main/docs/screenshots/08-model-overlay.png) | ![](https://raw.githubusercontent.com/akichika/2DMarkerTool/main/docs/screenshots/07-world-view.png) |

## どんなときに便利？

- ロボットやドローンの **位置合わせ用マーカー**をサッと用意したい
- 工作・展示・イベントで **AR的な演出**を手軽に試したい
- **在庫やラベルのバーコード/QR**を生成・確認したい
- AR開発の前に「**マーカーがちゃんと認識されるか**」を素早く検証したい

## こだわったところ

- **プライバシー**: すべて端末内で処理。カメラ映像はどこにも送りません
- **手軽さ**: ビルドもインストールも不要。URLを開くだけ
- **見やすいUI**: フラットで角ばったデザイン、アイコン中心、カメラ・結果・3Dを自由にレイアウト
- **多言語＆テーマ**: 日本語/英語/中国語/スペイン語、ライト/ダーク/ハイコントラスト、システム追従
- **暗い場所対策**: 明るさ・コントラストを自動／手動で調整して認識率アップ

![このアプリについて](https://raw.githubusercontent.com/akichika/2DMarkerTool/main/docs/screenshots/11-about.png)

## 使い方（かんたん）

1. サイトを開く 👉 https://akichika.github.io/2DMarkerTool/
2. 「生成」タブでマーカーを作って印刷／別の画面に表示
3. 「認識」タブで **カメラ開始** → マーカーをかざす
4. 表示モードを「3D姿勢」にしたり、「3Dモデル」で好きな形を乗せて遊ぶ

> スマホは「ホーム画面に追加」でアプリのように使えます。

## これから

機能のリクエストや不具合報告、大歓迎です。ソースコードも公開しているので、改造・Pull Request もぜひ。

- リポジトリ: https://github.com/akichika/2DMarkerTool
- 作者: akichika 👉 https://x.com/akichika

最後まで読んでいただきありがとうございました！「いいな」と思ったら、ぜひ実際にマーカーをかざして遊んでみてください 🎥✨
