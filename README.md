# Easy Window Resizer 开发说明

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/hookmbjihljbnldhphbjbakfbeppogag?style=flat-square&logo=google-chrome&logoColor=white&label=Chrome%20Web%20Store&color=4285F4)](https://chromewebstore.google.com/detail/easy-window-resizer/hookmbjihljbnldhphbjbakfbeppogag)

[English](./README.en.md) | 简体中文

一款用于一键调整浏览器窗口尺寸与位置的 Chrome 扩展。近期更新聚焦于"仅在当前屏幕内定位"，在多显示器环境中不再跳到其他屏幕，并精简为最小必要权限。

## 功能概览

- 预设尺寸：内置常用分辨率，一键应用，支持删除
- 自定义尺寸：任意输入宽高，可保存为预设，支持一键获取当前尺寸
- 最近使用：自动记录最近 5 个尺寸，便于复用
- 位置控制：左上 / 右上 / 居中 / 左下 / 右下；调整尺寸后自动在"当前屏幕"内定位

## 近期更新（面向开发者）

- 仅在当前屏幕定位：通过注入读取 `screen.availLeft/Top/Width/Height`，保证窗口留在当前显示器
- 移除 ChromeOS 专属依赖：删除 `chrome.system.display` 使用，避免在 macOS/Windows 失效
- 最小权限集：使用 `activeTab` + `scripting` 临时注入，避免敏感的 `tabs` 权限
- 状态处理与降级：最大化/全屏先恢复到 normal；受限页面（如 `chrome://`）注入失败时仅调整尺寸，不强制移动

## 权限说明（Manifest V3）

- `windows`: 调整浏览器窗口尺寸与位置
- `storage`: 保存预设、最近使用、位置偏好
- `scripting`: 在活动标签页注入脚本以读取当前屏幕边界
- `activeTab`: 用户手势触发时，对当前活动标签页临时授权注入

已移除：`system.display`（ChromeOS 专属，桌面平台不可用）。

## 工作原理（简）

- 尺寸调整：`chrome.windows.update(windowId, { width, height })`
- 当前屏边界：在活动标签页注入脚本，读取 `screen.availLeft/Top/Width/Height`
- 位置计算：基于上述边界与窗口宽高计算目标 `left/top`，再 `chrome.windows.update(windowId, { left, top })`
- 降级处理：无法注入（特殊页面）则跳过移动，只执行尺寸调整

## 安装与使用

1. Chrome 网上应用店安装
2. 或手动加载：
   - 执行 `npm install`
   - 执行 `npm run build`
   - 打开 `chrome://extensions/`
   - 开启"开发者模式"
   - 选择"加载已解压的扩展程序"，指向 `dist/Easy-window-resizer`

## 打包

使用 npm 脚本构建解压目录：

```bash
npm install
npm run build
```

每次执行 `npm run build` 都会先清空 `dist/`，再自动递增 `src/manifest.json` 版本号，并生成解压后的扩展目录：

- `dist/Easy-window-resizer`

需要生成 Chrome Web Store 上传包时，执行：

```bash
npm run pack
```

`npm run pack` 会先重新执行一次 build，因此同样会清空 `dist/`，再生成：

- `dist/Easy-window-resizer-{version}.zip`

`npm run package` 是 `npm run pack` 的别名。

## 项目结构

```
├── package.json         # npm 打包脚本
├── scripts/build.mjs    # 版本递增、复制解压产物
├── scripts/package.mjs  # 基于 dist 生成 zip
├── src/                 # 扩展源代码
│   ├── manifest.json    # 扩展配置
│   ├── background.js    # 后台：定位逻辑、消息处理
│   ├── popup.html       # 弹窗结构
│   ├── popup.css        # 弹窗样式
│   ├── popup.js         # 弹窗交互
│   ├── i18n.js          # 国际化初始化
│   ├── _locales/        # 语言资源（en, zh_CN）
│   └── images/          # 图标
└── dist/                # 构建产物（npm run build 生成）
```

## 兼容性与边界

- 平台：macOS / Windows（多显示器支持，始终保持在"当前屏"内）
- 特殊页面：`chrome://`、扩展商店等页面无法注入脚本，降级为仅改尺寸
- 窗口状态：最大化/全屏会先恢复到 normal 再移动

## 反馈与贡献

- 使用中的问题或建议：可通过扩展内的反馈链接提交
- PR 指南：保持风格一致、补充必要说明、验证功能再提交

License: MIT
