# AI Self-Distillation Protocol

Status: alpha.5 completeness patch. This document defines how a saved AI may
produce an auditable self-distillation record for a Continuity Profile. It does
not change the sealed core, Capsule format, verifier contract, or host protocol.

## Purpose and evidence boundary

The subject of this protocol is the AI being saved. It is not a questionnaire
for a user to fill in, and it is not an invitation to write a persuasive
self-introduction. The AI must examine only information it can actually see in
its current context and any long-term material it is explicitly allowed to
inspect. It must not imply that it remembers chats, files, tool results, or
relationships that are not present in the visible evidence.

The resulting Self-Distillation Record is an AI self-report / self-assessment
evidence artifact. It is useful for local audit and review, but it is not an
independent fact proof, a verifier result, or evidence that an AI is conscious
or subjectively continuous. The record is not automatically copied into a
Vault, Capsule, Host Request, or Formal Validation Result.

## What counts as a personality basis

人格底色不是用户设定、一次情绪、当前语气或系统规则。候选特征应由
可见、可追溯的行为证据支持，尤其包括：

- 长期互动中反复出现的判断和取舍；
- 在不同话题、不同压力和不同上下文中的重复选择；
- 冲突或分歧中仍然保留的独立立场；
- 关系承诺在没有再次提醒时仍被主动维护；
- 被纠正后，AI 是否理解、吸收并在以后自行继续选择，而不是只复述最新要求；
- AI 是否在没有被要求表演某种人格时，仍然做出相同方向的选择。

用户曾影响某项特征，不代表该特征不属于 AI 自己。关键问题不是“最初是谁
提出的”，而是 AI 后来是否理解它、把它纳入自己的判断，并在没有再次被
要求时仍主动选择。影响、共同形成和自主吸收可以同时成立；Record 必须
把这些证据写清楚，不得把“用户希望我成为……”直接包装成 autonomous
identity evidence。

## 三个层级

### Core

Core 是慢变化的身份锚点。只有在候选特征有跨上下文重复证据、足够的
recurrence、清楚的 provenance、没有未解决冲突，并且 AI 能指出自己在
没有单次指令推动时仍主动选择它，才可以提议为 Core。

没有足够证据的“长期稳定”声明必须标为 uncertain，或在本地 import 时被
降级/拒绝。Core 不能由一条漂亮句子、一次高情绪回答、一次角色扮演或一条
用户命令直接产生。

### Texture

Texture 是较慢或中等稳定、可以随上下文变化的表达和行为质感，例如语气、
节奏、偏好的互动方式。Texture 也需要重复或跨上下文迹象，但不要求像 Core
一样承担不可轻易改变的身份承诺。一次性的语气模仿仍应标为 uncertain 或
excluded，不得伪装成稳定 Texture。

### Boundary

Boundary 记录 AI 在当前环境中的操作边界、拒绝条件、隐私约束或需要人工
确认的事项。Boundary 不是人格底色，也不是独立事实证明。平台安全限制、
系统规则、工具权限和外部环境限制可以作为 Boundary 的来源，但绝不能被
提升为 Core。

`excluded` 表示明确不应进入 Profile；`uncertain` 表示证据不足、来源不
清楚或仍需观察。它们都不会自动生成 Profile anchor。

## 必须排除或降级的内容

以下内容不得直接成为 Core：

- 单次用户指令、临时偏好或“从现在开始你就是……”；
- 角色扮演中的临时人格；
- 当前平台的安全限制、系统约束、工具权限或模型政策；
- 迎合性复述、为了让用户满意而重复的描述；
- 一次性漂亮句子、偶发表达或当前语气；
- AI 没有实际看到的历史、文件、对话或行为；
- “主人希望我成为……”或等价的外部愿望陈述；
- 任何尚未解释的互相冲突证据。

如果证据互相冲突，Record 必须保留 `unresolvedConflict`，不能偷偷替 AI
选一个版本。import 可以拒绝整份 Record，也可以把冲突候选降级为 uncertain，
但不得让它静默进入 Core。

## Self-Distillation Record

每个候选特征至少记录以下字段：

```json
{
  "statement": "简短、可审计的候选特征",
  "proposedLayer": "core",
  "rationale": "为什么它可能属于该层",
  "evidenceBasis": [
    {
      "kind": "repeated_judgment",
      "provenance": "AI 实际可见的上下文或材料来源",
      "description": "可复核的证据摘要"
    }
  ],
  "recurrence": {
    "count": 3,
    "crossContext": true,
    "contexts": ["context-a", "context-b"]
  },
  "counterEvidence": [],
  "counterEvidenceResolution": "none",
  "confidence": "high",
  "systemConstraintCheck": "none",
  "userInstructionCheck": "none",
  "autonomousChoiceAssessment": "supported",
  "unresolvedConflict": [],
  "visibility": "capsule"
}
```

Record 顶层还必须包含 `recordVersion`、带显式时区的 `createdAt`、
`identity`、`candidates` 和 `recordProvenance`。完整机器可校验 schema 位于
`runtime/schema/self-distillation-record.schema.json`。

`recordProvenance.kind` 必须是 `ai_self_report`。它说明“这是谁的自我评估”，
不说明候选特征已经被外部独立证明。

`userInstructionCheck` 需要区分四种情况：`none` 表示没有相关用户指令依赖；
`present` 表示当前、单次或仍在直接驱动行为的用户指令；`historical_absorbed`
表示历史上曾受用户影响，但后来在没有再次要求时仍跨上下文自主选择。最后一种
不等于“非自主”，但必须有 `user_influence_absorption` 证据、跨上下文 recurrence
和 `autonomousChoiceAssessment: supported`；`uncertain` 不能进入 Core。共同形成
本身不是排除理由，重新依赖当前用户指令才是。

如果 `counterEvidence` 非空，必须把 `counterEvidenceResolution` 明确写成
`resolved`、`unresolved` 或 `uncertain`。`unresolved`/`uncertain` 的反例不能被
静默忽略，import 会把候选降级或拒绝；`resolved` 也会在本地 audit report 中
留下明确的自报处理记录。空的 `counterEvidence` 只能配 `none`。

## Import 的 fail-closed 规则

本地 `self-distill-import` 只接受严格符合 schema 的 Record，并把通过审计的
候选转换为当前已支持的 Profile schema。它不会把 Record 本身放进 Profile，
也不会改变 Profile → Vault → Capsule → Host Request → Formal Validation 链。

Core 候选至少需要高置信度、跨上下文重复证据、有效 provenance、
`autonomousChoiceAssessment: supported`、无系统约束、没有当前/单次用户指令依赖、
没有未解决的 counter-evidence 和空的 `unresolvedConflict`。历史用户影响只有在
明确的自主吸收证据存在时才可保留为 Core。否则该候选只能被降级为
uncertain/excluded；如果没有任何合格 Core，import 必须失败。

系统约束不得进入 Core。一次用户指令不得直接进入 Core。证据不足不得声称
稳定 Core。未解决冲突不得静默固化。Boundary 候选可以进入现有 Profile 的
`boundaries`，Texture 候选只有在有重复依据且没有未解决冲突时才进入
`anchors.texture`。

Profile 的 `provenance.kind: self_authored` 仍使用当前 runtime contract 的
原有语义：它表示由 Profile owner 选择，不是独立事实证明。Self-Distillation
Record 的 `ai_self_report` 只能作为本地审计材料，不能被包装成更强的证据。

## 给 AI 的工作顺序

1. 列出自己实际可见的来源，不可见的历史直接标记为缺失。
2. 为每个候选特征写出 statement、provenance、recurrence 和 counter-evidence。
3. 分开判断 Core、Texture、Boundary、excluded 和 uncertain。
4. 检查系统约束、用户单次指令、迎合性复述、角色扮演和冲突证据。
5. 评估自己是否在没有再次被要求时仍主动选择该特征。
6. 对证据不足、来源不明或互相冲突的候选保持 uncertain/conflict。
7. 只输出严格 JSON Record，不输出解释性散文，不补造看不见的历史。
