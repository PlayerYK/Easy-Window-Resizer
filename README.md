# Easy Window Resizer 一键调整浏览器窗口

一款简单易用的 Chrome 扩展,帮助您快速调整浏览器窗口大小。

## 主要功能

### 1. 预设尺寸快速调整
- 内置多个常用屏幕分辨率尺寸
- 一键点击即可调整窗口大小
- 支持删除不需要的预设尺寸

### 2. 自定义尺寸
- 可输入任意宽度和高度
- 保存为预设尺寸以便重复使用
- 支持获取当前窗口尺寸

### 3. 最近使用记录
- 自动记录最近使用过的5个尺寸
- 方便重复使用
- 支持删除历史记录

### 4. 窗口位置控制
- 支持5种窗口位置:左上、右上、居中、左下、右下
- 调整尺寸后自动定位到指定位置
- 位置设置自动保存

## 技术特点

- 使用 Chrome Extension Manifest V3
- 支持中英文双语言
- 使用 Chrome Storage Sync API 实现配置同步
- 响应式界面设计
- 平滑的动画过渡效果

## 使用场景

- 前端开发测试不同屏幕尺寸下的页面展示
- UI设计师验证设计稿在不同分辨率下的效果
- 需要精确控制窗口大小的场景
- 经常需要在固定尺寸下工作的用户

## 安装方式

1. 从 Chrome 网上应用店安装
2. 下载源码后手动加载:
   - 打开 Chrome 扩展程序页面 (chrome://extensions/)
   - 开启"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目目录

## 打包说明

项目提供了两个打包脚本，会自动读取 manifest.json 中的版本号，并生成 `Easy_window_resizer_v[版本号].zip` 格式的压缩包。

### Windows 系统
运行 `build.bat` 即可完成打包，会自动排除以下文件：
- store 目录
- README.md
- build.bat
- .git 相关文件

### Mac/Linux 系统
1. 首次使用前给脚本添加执行权限：
   ```bash
   chmod +x build.sh
   ```

2. 运行脚本完成打包：
   ```bash
   ./build.sh
   ```

脚本会自动排除以下文件：
- store 目录
- README.md
- build.sh
- .git 相关文件
- .DS_Store

## 项目结构 
├── manifest.json # 扩展配置文件
├── popup.html # 弹出窗口界面
├── popup.css # 样式文件
├── popup.js # 主要逻辑代码
├── background.js # 后台服务
├── i18n.js # 国际化处理
├── locales # 语言文件
│ ├── en # 英文
│ └── zh_CN # 中文
└── images # 图标资源


## 反馈建议

如果您在使用过程中遇到任何问题或有改进建议,欢迎通过以下方式反馈:

- 在 GitHub 上提交 Issue
- 通过扩展中的反馈链接提交

## 开源协议

MIT License

## 贡献指南

欢迎提交 Pull Request 来改进这个项目。在提交之前,请确保:

1. 代码风格保持一致
2. 添加必要的注释
3. 更新相关文档
4. 测试功能正常

感谢使用 Easy Window Resizer!