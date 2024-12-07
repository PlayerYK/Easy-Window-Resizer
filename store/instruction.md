# Chrome extension: Easy Window Resizer
做一款自动调整浏览器尺寸的插件。

点击扩展图标,展开 popup 页面，插件功能都在 popup 页面中。

列出最近使用的尺寸。
每种尺寸点击应用后，调整浏览器尺寸。
用户可以选择预定义尺寸,也可以自定义尺寸。
预定义尺寸、自定义尺寸、最近使用尺寸都可以删除。


技术细节：
- 用Chrome插件API实现。
- 使用 manifest v3。
- 使用 chrome.storage.sync API 保存用户的配置。