<div align="center">

# 🩺 Skill 体检中心

**给你的 AI Skill 做一次全面体检——就算你第一次写 Skill，也看得懂结果。**

上传一个 Skill 文件夹或压缩包，浏览器本地把它从头到尾扫一遍，从 6 个维度打分，
用大白话告诉你哪里好、哪里能更好，并给出可执行的改进建议。

[**🌐 在线体验 · Live Demo**](https://boringlxy.github.io/aihealthcenter/)

![Pages](https://img.shields.io/badge/GitHub%20Pages-online-2ea44f?logo=github)
![Made with](https://img.shields.io/badge/built%20with-vanilla%20JS-f7df1e?logo=javascript&logoColor=black)
![No backend](https://img.shields.io/badge/backend-none-blue)
![Privacy](https://img.shields.io/badge/files-never%20leave%20your%20browser-brightgreen)

</div>

---

## ✨ 这是什么

「Skill 体检中心」是一个**纯前端、零后端**的 Skill 质量评估工具。

写好一个 AI Skill 之后，你很难判断它到底“够不够好”——文件齐不齐、AI 会不会在对的时候想起它、
是靠脚本干实事还是靠模型瞎猜、危险操作有没有先问一句……这些都很难自己评估。

把 Skill 拖进来，它会像一份体检报告一样，一项一项讲清楚。

## 🚀 快速开始

**方式一：直接用（推荐）**

打开 👉 **https://boringlxy.github.io/aihealthcenter/** ，把 Skill 文件夹或 `.zip` 拖进去即可。

**方式二：本地运行**

本项目是纯静态站点，没有构建步骤。克隆后用任意静态服务器打开：

```bash
git clone https://github.com/Boringlxy/aihealthcenter.git
cd aihealthcenter

# 用任意一种方式起个本地服务器
python3 -m http.server 8000
# 然后浏览器打开 http://localhost:8000
```

> 直接双击 `index.html` 也能跑，但用本地服务器体验更完整（文件夹上传等能力更稳定）。

## 🧭 使用方法

1. **投喂 Skill**：拖入文件夹 / 选择 `.zip` / 或直接粘贴 `SKILL.md` 文本
2. **开始体检**：点「开始体检」，本地扫描并打分
3. **看报告**：总分（/5.0）+ 五维雷达图 + 逐项点评 + 发现的问题 + 改进建议
4. **导出**：一键导出 **Markdown 报告** 或 **报告长图**，方便分享归档

> 🔒 **隐私说明**：所有分析都在你的浏览器里完成，Skill 文件**不会上传到任何服务器**。
> 图片等二进制资源只统计不读取，只读取文本内容。

## 📊 六大体检维度

| 维度 | 一句话 | 看什么 | 权重 |
|------|--------|--------|:----:|
| 🦴 骨架齐全 | 该有的文件在不在 | 结构完整度、必需文件是否齐全 | 0.17 |
| 🔍 能被找到 | AI 会不会想起用它 | 触发描述是否清晰、可被检索 | 0.17 |
| 🔧 能干实事 | 靠脚本还是靠瞎猜 | 是否有可执行工具/脚本支撑 | 0.17 |
| 🛡️ 安全可控 | 危险操作先问一句 | 高危操作是否有确认/防护 | 0.17 |
| 📖 好读好维护 | 新人看不看得懂 | 可读性、可维护性 | 0.17 |
| ✨ 写得地道 | 够不够专业 | 是否符合最佳实践、专业度 | 0.15 |

总分 = 各维度得分 × 权重之和，满分 5.0。

## 🛠️ 技术栈

- **原生 HTML / CSS / JavaScript**，无框架、无构建步骤
- [JSZip](https://stuk.github.io/jszip/) —— 浏览器端解压 `.zip`（通过 CDN 引入）
- Canvas —— 绘制五维雷达图
- 玻璃拟态（Glassmorphism）UI + Noto Sans SC 字体

## 📁 项目结构

```
.
├── index.html      # 页面结构
├── style.css       # 样式（玻璃拟态 UI）
├── app.js          # 核心逻辑：扫描、六维打分、报告生成
├── assets/         # 插画与报告配图
├── LEGAL.md        # 法律免责声明
└── README.md
```

## 🤝 参与贡献

欢迎 Issue 与 PR：

1. Fork 本仓库
2. 新建分支 `git checkout -b feat/your-feature`
3. 提交改动 `git commit -m "feat: ..."`
4. 推送并发起 Pull Request

评分规则、维度权重、UI 都可以讨论优化——如果你对某一维度的判定标准有更好想法，非常欢迎。

## 📄 声明

代码注释以中文为准，详见 [LEGAL.md](./LEGAL.md)。
