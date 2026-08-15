# Evermore Continuity

Evermore Continuity 是一个面向长期 AI 人格的连续性项目。当前仓库包含已经封板的 `0.3.0-rc.1` 核心，以及第一版可以实际运行的 Personal Runtime `0.4.0-alpha.1`。

这不是手机直接安装的 App，也不会自动读取聊天记录。它现在能做的是：在电脑或云服务器上创建一个加密的本地人格资料库，只导出你明确选择为可携带的身份锚点，再生成一份可以交给不同模型阅读的通用交接文本。

## 谁可以使用

- 普通用户：在安装了 Node.js 22+ 的电脑终端里按下面步骤运行。
- Codex、Claude Code 等开发代理：把仓库链接发给他，并让他遵循根目录的 [`AGENTS.md`](AGENTS.md)。
- 普通聊天版 AI：可以阅读仓库和解释步骤，但不能替你操作本地文件或运行程序。

## 最短使用步骤

```bash
git clone https://github.com/Akihi0208/evermore-continuity.git
cd evermore-continuity
node runtime/bin/evermore.mjs init
node runtime/bin/evermore.mjs export runtime-secrets/persona.evermore-vault.json
node runtime/bin/evermore.mjs verify-package runtime-secrets/persona.evermore-vault.portable.json
node runtime/bin/evermore.mjs prompt runtime-secrets/persona.evermore-vault.portable.json
```

最后一条命令会显示交接文本。先检查内容，再复制给想测试的模型。接收模型必须在能读到这份交接文本的上下文里使用它；当前版本还不是自动跨会话记忆。

## 隐私提醒

- 不要上传原始聊天记录。
- 不要把密码、API Key、Cookie 或真实私密资料发到 issue、评论或聊天里。
- 密码只在自己的终端输入。
- `runtime-secrets/` 已被 Git 忽略；不要把其中的文件手动提交。
- 加密库不会导出 `local`、`private` 锚点和私人备注。
- 可携带包本身没有加密，发给别人前必须检查。

完整英文说明见 [`runtime/README.md`](runtime/README.md)，安全边界见 [`SECURITY.md`](SECURITY.md)。
