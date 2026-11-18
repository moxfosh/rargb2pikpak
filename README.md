# rargb2pikpak

在 Microsoft Edge 中把 `rargb.to` 的列表条目批量添加到 PikPak 云下载。可以从当前页自动转存到最后一页，也可以按关键词搜索后勾选指定条目。PikPak 在云端下载磁力链接指向的内容，电脑无需保存种子文件或下载其中的文件。

[在 Tampermonkey 中安装脚本](https://raw.githubusercontent.com/moxfosh/rargb2pikpak/main/rargb-pikpak.user.js) · [查看脚本源码](rargb-pikpak.user.js)

## 安装

1. 在 Edge 安装 Tampermonkey，并在扩展详情中开启「允许用户脚本」。若当前版本没有这个选项，按 Tampermonkey 的 Edge 指南启用用户脚本执行权限。[Edge 扩展商店](https://microsoftedge.microsoft.com/addons/detail/iikmkjmpaadaobahmlepeloendndfphd) · [Tampermonkey 权限说明](https://www.tampermonkey.net/faq.php?locale=zh&q=Q209)
2. 打开脚本安装链接，在 Tampermonkey 提示页点击「安装」或「更新」。如果 Edge 直接显示源码，可以下载 `.user.js` 文件，再从 Tampermonkey 管理面板的「实用工具 → 从文件导入」安装。
3. 在同一个 Edge 浏览器配置文件中登录 PikPak，并确认 Tampermonkey 可访问 `rargb.to` 和 `mypikpak.com`。[PikPak 网页版](https://mypikpak.com/drive/all)
4. 打开或刷新 RARGB 列表页，分页栏旁会显示「批量云下载到 PikPak」。没有分页栏时，按钮显示在页面右下角。也可以从 Edge 工具栏的 Tampermonkey 菜单打开同名入口。[打开 rargb.to](https://rargb.to/)

## 从当前页自动转存到最后一页

1. 打开 RARGB 首页、分类列表或关键词搜索结果。先在 RARGB 上设好所需的筛选条件和排序，再导航到要开始处理的页码。
2. 点击「批量云下载到 PikPak」，再点击「从当前页转存到最后一页」。
3. 保持 RARGB 和脚本打开的 PikPak 标签页。脚本读取当前列表的磁力链接，每批最多提交 10 条。处理完一页后，脚本沿 RARGB 的下一页链接继续，直到末页。
4. 在 RARGB 面板查看扫描页数、已提交条数和未取得磁力链接的条数。实际下载状态及保存结果以 PikPak 页面为准。[PikPak 网页版](https://mypikpak.com/drive/all)

自动模式使用 PikPak 云下载窗口显示的保存位置。同一次运行中，重复出现的 RARGB 条目只处理一次。需要中途结束时点击「停止」，已经提交的云下载任务会由 PikPak 继续处理。

## 按关键词搜索并挑选条目

1. 打开脚本面板，输入关键词和扫描页数，点击「搜索」。从 RARGB 的搜索结果页打开时，面板会自动带入当前关键词。
2. 勾选要转存的条目，点击「打开 PikPak 云下载」。脚本会把磁力链接逐行填入 PikPak 的云下载窗口，同时将这些链接复制到剪贴板。
3. 核对链接，按需点击「修改」选择保存文件夹，再点击「立即创建」。如果窗口未自动填入链接，可在 PikPak 点击「云下载」并直接粘贴。[PikPak 云下载说明](https://mypikpak.com/zh-CN/help-center/beginner_tutorial/save_content/margnet_link)

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| 看不到脚本按钮 | 刷新 RARGB 后打开 Tampermonkey 菜单，确认脚本已启用。如果菜单也没有入口，检查 Edge 的用户脚本权限和扩展的站点访问权限。 |
| 提示「PikPak 未就绪」 | 在同一个 Edge 配置文件中打开 PikPak，确认可以正常登录，且 Tampermonkey 能在 `mypikpak.com` 执行脚本。 |
| 某些条目未取得磁力链接 | 打开对应条目，检查详情页是否仍可访问并显示磁力链接。遇到 RARGB 的页面验证或请求频率限制时，处理提示后再运行。 |
| 提交时出现额度提示或批次中断 | 先查看 PikPak 的云下载状态，确认中断前最后一批的结果。核对后，从对应的 RARGB 页重新开始，或用手动勾选模式补交缺失条目。 |
| 已提交，尚未看到文件 | 检查 PikPak 的云下载任务及保存文件夹。任务提交后，下载和文件入库由 PikPak 处理。 |

## 实现与验证

- 脚本在 `rargb.to` 的列表和详情页读取磁力链接，通过 Tampermonkey 的脚本存储将本次任务交给 `mypikpak.com` 上的云下载界面。
- PikPak 使用浏览器已有的登录会话。脚本无需保存密码，也无需配置 WebDAV。
- 已在 Edge 模拟页面验证分页栏入口、关键词搜索、自动翻页、分批提交、末页停止和提交失败时暂停。实际 PikPak 账户已验证用单条磁力链接保存视频内容。
