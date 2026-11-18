# 简约翻译 · PaddleOCR 接口插件

这是一个为简约翻译（Kiss Translator）接入 PaddleOCR 的外部接口插件。它可以调用飞桨 AI Studio 的 PP-OCRv6 云端 API，内置常用的结果下载域名，并将识别出的文字和坐标交给简约翻译。需要翻译时，简约翻译调用你配置的翻译 API 获取译文。

[简约翻译](https://github.com/fishjar/kiss-translator) · [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)

## 使用条件

- 最低版本为 Kiss Translator 浏览器扩展 2.2.5。本插件使用接口插件 API 1。
- 一个有效的 AI Studio Access Token。[令牌管理](https://aistudio.baidu.com/account/accessToken)
- 插件接受 PNG、JPEG 和 WebP 图片。扩展限制每次上传的请求正文为 8 MiB，图片和随附的表单字段合计都要计入。接近上限时可先缩小图片。[插件资源预算](https://github.com/fishjar/kiss-translator-plugins/blob/main/docs/plugin-development-guide.md#84-执行资源与预算)

## 安装与配置

1. 打开 Kiss Translator 的 **接口插件**。可从外部插件目录安装，也可输入本 GitHub 仓库的根地址，或导入 GitHub Releases 中的版本化 ZIP。
2. 进入 **服务配置 → 添加 → 插件接口**，添加 **PP-OCRv6 文字识别**。填入自己的 **AI Studio Access Token** 并保存。
3. 在 **基本设置 → 禁用Origin名单** 中另起一行，添加 `https://paddleocr.aistudio-app.com`。
4. 在 **服务配置** 中用一张图片测试，再到 **图片翻译 → 文本识别服务（OCR / VLM）** 选择这项服务。

### 配置项

| 设置 | 填写方式 |
| --- | --- |
| AI Studio Access Token | 必填，填令牌字符串本身。 |
| 其他结果下载域名 | 可留空。飞桨返回新的存储域名时，按提示填一个包含 `https://` 的完整域名。 |
| 识别模型 | 固定使用 PP-OCRv6，服务列表显示 PaddleOCR。 |

## 更新

先在 **接口插件** 中更新插件，再到 **服务配置** 为正在使用的 OCR 服务创建升级后的实例。确认已复制的设置（包括令牌），保存并测试，再让图片翻译使用这个新版服务。旧实例可以保留。[服务升级说明](https://github.com/fishjar/kiss-translator-plugins/blob/main/docs/plugin-development-guide.md#123-升级)

## 接口与数据

图片会上传到飞桨，在云端处理。插件向 `https://paddleocr.aistudio-app.com/api/v2/ocr/jobs` 提交图片并查询任务状态。任务完成后，插件用飞桨签发的链接下载 JSONL 结果，将文字、文字框坐标和可用的置信度交给 Kiss Translator。只有提交和查询请求携带 AI Studio 令牌。[AI Studio 异步任务协议](https://ai.baidu.com/ai-doc/AISTUDIO/fml7mozw5) · [官方 API 支持的 OCR 模型](https://www.paddleocr.ai/latest/version3.x/inference_deployment/serving/paddleocr_official_api/typescript.html#_3)

插件已内置 `paddleocr-store.bj.bcebos.com` 和 `paddleocr-store-1.bj.bcebos.com` 至 `paddleocr-store-9.bj.bcebos.com`。飞桨在这组域名之间切换时，插件会自动下载结果。

## 常见问题

- **提交或查询任务时出现 HTTP 401 / 403**。核对服务配置中的 AI Studio 令牌。遇到 403 时，也检查「禁用Origin名单」是否单独一行填了 `https://paddleocr.aistudio-app.com`。
- **下载识别结果时出现 HTTP 403**。重新发起识别，以获取新的签名链接。
- **提交或查询任务时出现 HTTP 429**。检查飞桨当日解析配额，待配额恢复后再试。[飞桨配额与错误码](https://ai.baidu.com/ai-doc/AISTUDIO/Xmjclapam)
- **等待云端 OCR 结果超时**。插件提交后轮询约 45 秒。若飞桨长时间排队，可稍后再试。重试会提交新的任务。
- **服务测试通过，图片翻译失败**。确认图片翻译选中了刚测试的服务，同时检查该服务是否已经升级到最新的接口插件版本。
- **提示填写其他结果下载域名**。确认该域名确属飞桨的结果存储后，只填提示中的 `https://域名`，保存后重试。结果链接中的路径和签名参数应保密。

## 版本记录

| 版本 | 变化 |
| --- | --- |
| 1.0.8 | 修复扩展缺少 `URL` 时无法下载结果的问题，并区分鉴权、配额和结果链接报错。 |
| 1.0.7 | 补齐 README、MIT 许可证和 GitHub 自动发现说明。发布 ZIP 包含许可证。 |
| 1.0.6 | 加入服务图标，服务列表的简短名称显示为 PaddleOCR。 |
| 1.0.5 | 内置 10 个飞桨结果存储域名。 |
| 1.0.4 | 修复部分扩展环境中的异步轮询等待。 |
| 1.0.3 | 首次内置飞桨结果存储域名，并为其他域名提供配置提示。 |
| 1.0.2 | 兼容不同格式的飞桨任务编号。 |
| 1.0.1 | 增加带有请求阶段的 HTTP 错误提示。 |
| 1.0.0 | 首个版本，支持 PP-OCRv6 图片文字与坐标识别。 |

## 发布与自动发现

维护者可在仓库根目录运行 `node --test tests/recognize-text.test.cjs`（Node.js 22 或更高）。这些离线测试使用模拟响应，覆盖结果下载、域名权限、错误提示、轮询超时和结果截断，无需填写令牌。

1.0.8 已通过官方插件包校验。在 Chrome 中使用 Kiss Translator 2.2.5 发布包的脚本执行器和模拟 API 响应，已验证任务排队、轮询、下载及文字坐标返回。本次复核未使用真实 AI Studio 账号。发布前可在扩展内用一张带文字的图片验证文字与框的位置，再检查实际图片翻译是否使用了新版服务。

1. 将此目录的内容放到一个公开、未归档的独立 GitHub 仓库。Kiss Translator 会排除 Fork 和已归档仓库。默认分支根目录应包含 `manifest.json`、`recognize-text.js` 和 `assets/logo.png`。
2. 在仓库首页点击 **About** 旁的齿轮，在 **Topics** 中加入 `kiss-translator-plugin`，然后保存。[GitHub Topic 设置](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics#adding-topics-to-your-repository)
3. 在 Releases 发布与 `manifest.json` 版本一致的版本化 ZIP，包根目录包含 `manifest.json`、脚本、图标和 `LICENSE`。修改已发布的安装包时递增版本号。
4. 发布后检查仓库是否出现在 GitHub 的 Topic 页面，再刷新 Kiss Translator 的外部插件目录。还可以直接用公开仓库的根地址测试安装和更新。[GitHub Topic 页面](https://github.com/topics/kiss-translator-plugin) · [Kiss Translator 外部插件发现](https://github.com/fishjar/kiss-translator-plugins/blob/main/docs/plugin-development-guide.md#126-外部插件发现)

## 反馈与许可

欢迎通过本仓库的 Issues 报告问题或提出改进建议。反馈时可附上 Kiss Translator 和插件版本、触发步骤以及已去除令牌和结果链接签名的报错信息。

项目代码和文档采用 [MIT 许可证](LICENSE)。PaddleOCR 名称和图标仅用于标识所连接的服务，归相应权利人所有。本项目是社区适配器。
