# Tada 图标设计候选

> 最终选择：第二版的 `02-seal` 作为默认图标（05-signet 保留为内置选项）；第一版 A/B/C 的四个配色版本
> 没有单独堆进内置列表，而是合并成「经典对勾」的可调色板。详见
> [`v2/README.md`](v2/README.md)。


判断尺寸是 16 / 24px：所有候选都渲染到深、浅两种任务栏底色上对比。
评审图：`preview.html`（512/128/48/32/24/16）、`final-sheet.png`、`zoom-*.png`（像素放大）。

## 设计约束

- 1024 × 1024 viewBox，纯几何，无文字、无字体依赖。
- 满幅底色板（PWA maskable 需要），关键图形收在半径 410 的安全圆内
  （Android maskable 的 80% 安全区）。
- 颜色取自应用自己的调色板：品牌蓝 `#2563EB`、列表黄 `#F5B400`、
  深色底 `#16213E` / 墨色 `#17181C`。
- 只保留一个视觉焦点：对勾或字母，无渐变、无阴影，避免 16px 糊成一团。

## 最终候选

| 文件 | 方案 | 取舍 |
|---|---|---|
| `A-gold.svg` | 金底 + 墨色对勾 | 16px 最清楚，深/浅底都显眼；暖色呼应「Tada」的完成感。与现有蓝色主色不同。 |
| `B-navy.svg` | 深藏蓝底 + 金色对勾 | 更沉稳；深色任务栏上底色几乎消失，只剩金色对勾。 |
| `C-blue.svg` | 品牌蓝底 + 金色对勾 | 与应用现有蓝色一致，金色作为高光；蓝金互补，小尺寸对比略弱于 A。 |
| `D-t.svg` | 品牌蓝底 + 白色小写 t | 品牌字母方向，最不像「又一个待办 App」；语义最弱，脚部曲线在 16px 会收成一个点。 |
| `E-gold-blue.svg` | 金底 + 品牌蓝对勾 | 备选；品牌蓝做勾，但对比度只有约 2.9:1。 |

## 已否决的探索（保留原因，避免重走）

| 文件 | 想法 | 否决原因 |
|---|---|---|
| `v0-current.svg` | 现有蓝色对勾 | 可用，但就是待办应用的默认答案。 |
| `v1` / `v6` / `v5` / `v14` | 同一对勾的配色轮换 | 收敛成 A/B/C/E。 |
| `v2-escape-blue.svg` | 对勾冲出打开的复选框 | 128px 有故事，24px 以下框线和勾互相干扰。 |
| `v3` / `v11` / `v22` / `v23` | 小写 t，脚部上挑 | 16px 可读，但脚部圆弧过重会变成一团。 |
| `v24-t-flat.svg` | 小写 t，平脚 | 最干净的一版 t，收进 D。 |
| `v17` / `v18` | t 的脚改成直线/折线 | 像闪电，失去「t」的识别。 |
| `v4-flag-blue.svg` | 对勾挂在旗杆上 | 读成「K」或「拐杖」。 |
| `v7-two-tone.svg` | 双色对勾 | 接缝在 24px 以下变脏。 |
| `v9` / `v10` | 手写笔触式渐细对勾 | 顶点几何失败，出现缺口和破面。 |
| `v12` / `v13` | t 的深色/金色版本 | 随 t 方向一起否决。 |

## 复现

```bash
# 候选的深/浅底尺寸矩阵
python3 make-compact.py 00-current.svg A-gold.svg B-navy.svg C-blue.svg D-t.svg

# 带 macOS 圆角、圆形 maskable 预览的总览图
python3 make-sheet.py 00-current.svg A-gold.svg B-navy.svg C-blue.svg D-t.svg

# 正式的 512→16 评审页
python3 ~/.claude/skills/app-icon-design/scripts/preview-page.py \
  00-current.svg A-gold.svg B-navy.svg C-blue.svg D-t.svg \
  -o preview.html --title 'Tada 图标候选'
```

## 定稿后

1. 把选中的 SVG 内容写进 `web/public/icons/maskable-source.svg`（满幅、无圆角）。
2. 同步 `web/public/favicon.svg`（同图形 + 圆角，`rx≈232` / 1024）。
3. 在 `web/` 下跑 `npm run icons` 重新生成 192/512/maskable/apple-touch。
4. 如选用非蓝色底，把 `web/src/styles.css` 的 `.brand-mark` 底色/图标色改成与图标一致。
