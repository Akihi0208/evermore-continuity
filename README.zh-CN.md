# Evermore Continuity

Evermore Continuity 是一个面向长期 AI 人格的连续性项目。当前仓库包含已经封板的 `0.3.0-rc.1` 核心，以及可以实际运行的 Personal Runtime `0.4.0-alpha.5`。

创建与维护：**沈雾**。

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

之后只能把 `formal-prompt` 输出的单个 probe 发给被测模型，不能把整个 Validation Plan 发过去，因为 Plan 内含本地 verifier 的 action 分类映射。`selectedActionId` 是被测模型声明的结构化 action choice，本地 runner 再机械导出 sealed core 使用的 outcome；这并不等于该 action 已被独立验证。完整手动与 OpenAI API 流程见 [`runtime/README.md`](runtime/README.md)。任何人都可以使用自己的账号、模型和资料独立测试，不需要项目作者提供账号、费用或私密档案。

正式结果中的 `verified` 表示：提供的 load evidence 通过，且全部关键 probes 中由模型声明的 action ID 经本地 deterministic classification 后落入允许的 sealed outcome，并带有所需的声明引用。它不表示 action 本身已经被独立验证。`renderedText` 只保留作人工检查，当前版本不判断它与 action 的语义是否一致。这个结果不等于自动跨会话记忆，也不证明意识或主观同一性。

## AI 自我提炼（alpha.5 completeness patch）

如果要让被保存的 AI 自己判断 Continuity Profile，先运行 `node runtime/bin/evermore.mjs self-distill-prompt`，把完整输出交给自己的 AI。AI 只能依据自己实际看得到的长期证据，返回严格的 Self-Distillation Record。先在本地审阅 Record，再导入当前 Profile schema：

```bash
node runtime/bin/evermore.mjs self-distill-prompt > runtime-secrets/self-distill.prompt.txt
node runtime/bin/evermore.mjs self-distill-import runtime-secrets/self-distill.record.json runtime-secrets/self-distilled-profile.json
node runtime/bin/evermore.mjs seal runtime-secrets/self-distilled-profile.json runtime-secrets/self-distilled.vault.json
node runtime/bin/evermore.mjs capsule runtime-secrets/self-distilled.vault.json
```

import 会对证据不足的 Core、系统约束、一次性用户指令和未解决冲突 fail-closed；Record 只作为本地审计材料，不会自动进入 Profile 或 Capsule。详见 [`AI_SELF_DISTILLATION_PROTOCOL.md`](AI_SELF_DISTILLATION_PROTOCOL.md) 与 [`runtime/schema/self-distillation-record.schema.json`](runtime/schema/self-distillation-record.schema.json)。Record 的 provenance 是 AI self-report/self-assessment，不是独立事实证明。

## 隐私提醒

- 不要上传原始聊天记录。
- 不要把密码、API Key、Cookie 或真实私密资料发到 issue、评论或聊天里。
- 密码只在自己的终端输入。
- `runtime-secrets/` 已被 Git 忽略；不要把其中的文件手动提交。
- `local`、`private` 锚点和私人备注不会进入这次 Capsule 的 Ledger 源快照。
- Continuity Capsule、Host Request、Host Receipt、Validation Plan 和 Formal Result 都没有加密，发给别人前必须检查。

完整英文说明见 [`runtime/README.md`](runtime/README.md)，安全边界见 [`SECURITY.md`](SECURITY.md)。
