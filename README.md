# animation

## Entry Points
- HTML: `index.html`
- CSS: `style.css`
- JS entry (main runtime): `js/animation.js`

JavaScriptの読み込み順は `index.html` に記載の以下です。

1. `js/animation-utils.js`
2. `js/animation.js`
3. `js/cursor-controller.js`

## JS Responsibilities
- `js/animation-utils.js`
  - 定数、設定値、共通ユーティリティ、図形生成
- `js/animation.js`
  - アニメーション本体、フェーズ遷移、描画、リサイズ、タイマー進行
- `js/cursor-controller.js`
  - マウス追従カーソル、クリック入力、進行トリガー

## Tuning
- 各ステージの滞在時間: `STAGE_AUTOPLAY` (`js/animation-utils.js`)
- フェーズ個別時間: `PHASE_DURATIONS` (`js/animation-utils.js`)
- 色設定: `COLORS`, `RED_P` (`js/animation-utils.js`)
