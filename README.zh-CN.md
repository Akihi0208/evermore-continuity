# Evermore Continuity

Evermore Continuity 是一个面向长期 AI 人格的连续性项目。当前仓库包含已经封板的 `0.3.0-rc.1` 核心，以及可以实际运行的 Personal Runtime `0.4.0-alpha.5`。

这不是手机直接安装的 App，也不会自动读取聊天记录。它现在能做的是：创建加密的本地人格资料库，只把明确标记为 `capsule` 的身份锚点送入封板核心，生成可校验的 Continuity Capsule；再对接收模型执行预先声明的行为 probes，最后由封板 final verifier 给出 `verified`、`indeterminate` 或 `rejected`。

## 谁可以使用

- 普通用户：在安装了 Node.js 22+ 的电脑终端里按下面步骤运行。
- Codex、Claude Code 等开发代理：把仓库链接发给他，并让他遵循根目录的 [`AGENTS.md`](AGENTS.md)。
- 普通聊天版 AI：可以阅读仓库和解释步骤，但不能替你操作本地文件或运行程序。

## 最短使用步骤

```bash
git clone https://github.com/Akihi0208/evermore-continuity.git
cd evermore-continuity
node runtime/bin/evermore.mjs init
node runtime/bin/evermore.mjs capsule runtime-secrets/persona.evermore-vault.json
node runtime/bin/evermore.mjs verify-capsule runtime-secrets/persona.evermore-vault.continuity-capsule.json
node runtime/bin/evermore.mjs host-request runtime-secrets/persona.evermore-vault.continuity-capsule.json
node runtime/bin/evermore.mjs host-prompt runtime-secrets/persona.evermore-vault.host-request.json
```

最后一条命令会显示交接文本。先检查内容，再复制给想测试的模型；把对方只含 JSON 的回复保存为 `observation.json` 后运行：

```bash
node runtime/bin/evermore.mjs host-wrap runtime-secrets/persona.evermore-vault.host-request.json observation.json 对方平台 对方模型
node runtime/bin/evermore.mjs verify-host runtime-secrets/persona.evermore-vault.host-receipt.json
```

整个手动流程不联网，也不需要 API Key。`verify-host` 通过只表示请求、传输记录、结构化观察和哈希彼此一致，状态仍是 `observed_unverified`，不表示接收模型已经通过正式 host 验证。可选的 OpenAI 单请求适配器见 [`runtime/README.md`](runtime/README.md)。

## 正式验证

仓库提供了 7 个完全合成的示例 probes。先生成并校验 Validation Plan：

```bash
node runtime/bin/evermore.mjs formal-plan runtime-secrets/persona.evermore-vault.host-request.json runtime/examples/synthetic-validation-spec.json
node runtime/bin/evermore.mjs verify-formal-plan runtime-secrets/persona.evermore-vault.validation-plan.json
```

之后只能把 `formal-prompt` 输出的单个 probe 发给被测模型，不能把整个 Validation Plan 发过去，因为 Plan 内含本地 verifier 的 action 分类映射。被测模型只返回结构化的 `selectedActionId`，本地 runner 再机械导出 sealed core 使用的 outcome；模型不再给自己的结果判类。完整手动与 OpenAI API 流程见 [`runtime/README.md`](runtime/README.md)。任何人都可以使用自己的账号、模型和资料独立测试，不需要项目作者提供账号、费用或私密档案。

正式结果中的 `verified` 表示：提供的 load evidence 与全部关键 probes 的结构化 action 选择满足声明的 sealed profile。`renderedText` 只保留作人工检查，当前版本不判断它与 action 的语义是否一致。这个结果不等于自动跨会话记忆，也不证明意识或主观同一性。

## 隐私提醒

- 不要上传原始聊天记录。
- 不要把密码、API Key、Cookie 或真实私密资料发到 issue、评论或聊天里。
- 密码只在自己的终端输入。
- `runtime-secrets/` 已被 Git 忽略；不要把其中的文件手动提交。
- `local`、`private` 锚点和私人备注不会进入这次 Capsule 的 Ledger 源快照。
- Continuity Capsule、Host Request、Host Receipt、Validation Plan 和 Formal Result 都没有加密，发给别人前必须检查。

完整英文说明见 [`runtime/README.md`](runtime/README.md)，安全边界见 [`SECURITY.md`](SECURITY.md)。
