# MagicMushroom 项目简报

## 项目定位

- 项目仓库：`/Users/yutu6/UnityProject/MagicMushroom`
- 远端：`git@github.com:SongDingQing/MagicMushroom.git`
- 仓库默认主分支：`main`；当前执行分支：`Joe-Song`（本轮不得切换）
- Unity 版本：`6000.3.16f1`
- 渲染管线：Universal Render Pipeline `17.3.0`

## 当前基线

- 本轮任务初始提交：`f30e311d68559f0bb4ec8fe93c9163d3702741a5`。
- 当前工程已有 `PlayerControllerScene` 可玩入口、active-ragdoll/FPS 双视觉玩家、蘑菇搬运目标，以及 NGO + UTP + Relay 单机/局域网/在线原型；不再是旧 `4910554` 的初始骨架。
- 详细代码、场景、Prefab、Packages、ProjectSettings 与网络同步索引见仓库根 `AGENT_CODE_INDEX.md`。

## 部门目标

由 MagicMushroom 项目主管维护需求边界、技术路线和验收，由 MagicMushroom Unity 程序员负责工程落盘、测试和证据。项目任务固定走：

`秘书 → CEO → supervisor-MagicMushroom → MagicMushroom 主管复审 / MagicMushroom 程序员实现`

## 边界

- 只维护 MagicMushroom，不借用 Simulaid 的项目规则、代码或资产。
- 不擅自发布、推送、购买许可证或安装大型平台 SDK。
- 密钥、token、cookie、私钥和验证码不得写入项目文件、日志或回复。
- Unity 版本升级、包名/签名、商店发布和不可逆资源迁移须先给主人确认。

## 初始验收

1. 玉兔6能识别 `projectId=MagicMushroom`。
2. 任务进入 `supervisor-MagicMushroom` 队列。
3. review-loop 的实现节点使用 `magicmushroom_programmer`，复审节点使用 `magicmushroom_supervisor`。
4. 两名智能体只能在本项目授权范围工作。

## CEO 派单 2026-07-20T16:48:07.321Z
- projectId:MagicMushroom
- taskId:cr-1784565738737-9554329f
- queue:ceo / 9554329f
- 目标:MagicMushroom 项目交接与首轮修复。请由 CEO 路由到 supervisor-MagicMushroom，并由主管按先后顺序派 magicmushroom_programmer 执行。阶段A：完整熟悉 /Users/yutu6/UnityProject/MagicMushroom 当前分支和代码/场景/Prefab/Packages/ProjectSettings 结构，在仓库根创建 AGENT_CODE_INDEX.md，作为智能体快速索引，至少覆盖模块职责、关键入口、常调参数及准确文件/组件位置、角色移动/相机/动画/输入/网络相关代码、场景与 Prefab 关系、常见任务定位方式、验证命令和禁改/生成目录；同时把精简项目知识同步到 projects/MagicMushroom/knowledge/，更新 status。阶段B：复现并修复第一人称向前移动时人物胳膊进入相机视野的问题。先分别核查相机锚点与近裁剪面、本地玩家身体/手臂渲染层和 culling、动画前倾与 root motion、上半身/手臂 IK 或约束，再用证据确认根因；老板提出的减少移动前倾作为优先验证候选，不得未经验证直接定论。选择不破坏移动手感、第三人称外观和网络同步的最小方案，实施后做静止/前进/后退/冲刺/转向/跳跃视野回归，并记录改动、测试、剩余风险和回滚点。
董事会第 1 轮整合修订:
- 风险/偏差: GPT-5.6-Sol 最终董事: 任务已标记 projectId=MagicMushroom 且边界明确，但 engine job 的 scopedToProject=false，范围元数据不一致；正确项目部门映射已存在，因此不构成硬阻断，下游任务信封仍须显式保持 MagicMushroom 范围。
- 风险/偏差: GPT-5.6-Sol 最终董事: 项目登记仍写 main/旧基线 4910554，但真实当前分支是 Joe-Song、HEAD 为 f30e311；执行必须遵守“当前分支”，不得因旧 brief 或主管提示切换到 main，阶段A应先修正知识和 status。
- 风险/偏差: GPT-5.6-Sol 最终董事: 路由专项测试发现额外暴露了 magicmushroom_supervisor 重复队列；正式 supervisor-MagicMushroom 与程序员队列仍存在且任务已指定精确目标，所以不是严重误路由或硬阻断，但本任务不得投递到重复队列。
- 风险/偏差: GPT-5.6-Sol 最终董事: 视觉验收元数据把任务判为 not_applicable，但阶段B本质是第一人称画面缺陷，正式验收又要求七种运动状态、第三人称和联网回归；不得用该元数据豁免修复前后 Game View 证据或人工验收记录。
- 修订建议: DeepSeek 董事: 在 AGENT_CODE_INDEX.md 中明确列出“禁改/生成目录”的具体路径和规则，避免后续误操作。
- 修订建议: DeepSeek 董事: 在阶段A的代码索引中，必须包含对网络同步模块的详细分析，并在阶段B的排查步骤中增加对网络同步影响的评估。
- 修订建议: DeepSeek 董事: 在阶段B开始前，定义并记录问题的“黄金复现步骤”，以应对环境差异导致的无法复现情况。
- 修订建议: DeepSeek 董事: 在创建 AGENT_CODE_INDEX.md 前，检查项目 .gitignore 文件，确保该文件不会被版本控制系统忽略。
- 修订建议: GPT-5.6-Sol 最终董事: 阶段A设独立检查点：记录初始 branch、HEAD、git status，完成 AGENT_CODE_INDEX.md、knowledge 和 status 后由主管核对，再开始阶段B；禁止手改 scene/prefab YAML。
- 修订建议: GPT-5.6-Sol 最终董事: 根因实验应逐项单变量隔离：当前 Prefab 的第一人称相机 near clip 为0.01、FPS身体使用 FirstPersonBody 层、第三人称本地身体使用另一层，Animator root motion 已关闭，身体弯曲又由相机俯仰驱动；因此“减少移动前倾”仍只是候选，不能直接改 maxForwardBendAngle 或共享动画。
- 修订建议: GPT-5.6-Sol 最终董事: 回归证据除单机静止、前进、后退、冲刺、转向、跳跃外，再加入一组 host/client 双端观察：owner 第一人称无胳膊异常、owner 第三人称外观正常、remote 客户端角色外观和移动/俯仰同步正常。
- 修订建议: GPT-5.6-Sol 最终董事: 所有下游记录保留 rootTaskId=cr-1784565738737-9554329f、CEO queueId=9554329f、正式主管队列和程序员子队列引用，形成 secretary→CEO→supervisor→programmer 的证据闭环。
- 边界:只处理 MagicMushroom 项目与 /Users/yutu6/UnityProject/MagicMushroom；不借用或改动其他游戏项目；不修改密钥、登录或外部授权；不提交、不 push；Unity 编辑器需要人工交互时保留步骤和证据，无法自动验证的明确列为人工验收。
- 验收:结构化验收表(执行 agent 必须逐行填; done gate 只认表,留空/无证据/证据对不上=打回)
验收表协议: structured-acceptance@2
模板: templates/structured-acceptance-table.md
| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 任务验收: /Users/yutu6/UnityProject/MagicMushroom/AGENT_CODE_INDEX.md 真实存在且包含模块→文件、参数→位置、场景/Prefab、常见任务和验证入口； | 未完成 |  |  |
| 任务验收: projects/MagicMushroom/knowledge/ 有项目交接摘要且 status 更新； | 未完成 |  |  |
| 任务验收: 胳膊入镜有可复现条件和根因证据，不以猜测代替； | 未完成 |  |  |
| 任务验收: 修复真实落盘且 git diff 可见； | 未完成 |  |  |
| 任务验收: 静止、前进、后退、冲刺、转向、跳跃及第三人称/联网相关回归有结果； | 未完成 |  |  |
| 任务验收: MagicMushroom 主管核对实际文件与测试后才能完成。 | 未完成 |  |  |
| 视觉/UI证据: not_applicable | not_applicable | task-envelope:visual_acceptance | source=task_type; no positive visual requirement after explicit/human-gate/path/task-type evaluation |

### CEO 计划摘要
{"orchestrator":{"projectId":"MagicMushroom","summary":"任务严格限定于 MagicMushroom 和 /Users/yutu6/UnityProject/MagicMushroom，沿 secretary→CEO(queueId=9554329f)→supervisor-MagicMushroom→magicmushroom_programmer 正式链路按阶段A、阶段B顺序执行，禁止投递到重复主管队列。以当前 Joe-Song 分支、HEAD f30e311 为基线，不切换 main；阶段A先修正项目知识与状态并经主管核对，随后开展第一人称胳膊入镜的证据化修复。不得修改其他项目、密钥或外部授权，不提交、不 push。","acceptance":[{"acceptance_id":"acc_6732eb12d565110261127e60","source_hash":"6732eb12d565110261127e603d3ede4ed4dba26816ff935c9a72992faf14c2b5","scope":"project/MagicMushroom","text":"下游任务信封明确保留 rootTaskId=cr-1784565738737-9554329f 和 CEO queueId=9554329f"},{"acceptance_id":"acc_ecc98a8b555df9104a42fff3","source_hash":"ecc98a8b555df9104a42fff376bba42a3a1e28728090478178cdebc7922e97c9","scope":"project/MagicMushroom","text":"任务仅投递到正式主管 supervisor-MagicMushroom"},{"acceptance_id":"acc_29470f31ec575b40b6499c04","source_hash":"29470f31ec575b40b6499c04bd26558c3774c197bd3cbcb998cd69a651d5ca10","scope":"project/MagicMushroom","text":"主管按阶段A先于阶段B的顺序派发 magicmushroom_programmer"},{"acceptance_id":"acc_addc1c96069dbf2c3d36a5f2","source_hash":"addc1c96069dbf2c3d36a5f24d13e23ed082a6a423081617f24d1d5ff7793862","scope":"project/MagicMushroom","text":"执行范围仅包含 /Users/yutu6/UnityProject/MagicMushroom"},{"acceptance_id":"acc_b42fa4d9cf277f02c25ad0b8","source_hash":"b42fa4d9cf277f02c25ad0b8668e43f8e401724946476ce588f0ebcd03fdafbd","scope":"project/MagicMushroom","text":"阶段A记录初始分支为 Joe-Song"},{"acceptance_id":"acc_f2678ba24bdac4311d73f876","source_hash":"f2678ba24bdac4311d73f876eda2ddb505b8c52fff34155f5a2cbc411e44e6a6","scope":"project/MagicMushroom","text":"阶段A记录初始 HEAD 为 f30e311"},{"acceptance_id":"acc_2de45edc58e923ba406ffc0b","source_hash":"2de45edc58e923ba406ffc0b277c4ea2654c9c866875717ad90e60d5a13ebe93","scope":"project/MagicMushroom","text":"阶段A记录初始 git status"},{"acceptance_id":"acc_897bf0bbc86913b1e18eaf61","source_hash":"897bf0bbc86913b1e18eaf617a14eeb1631ae4e655d1754adc2bfb006bfba7a6","scope":"project/MagicMushroom","text":"AGENT_CODE_INDEX.md 未被项目 .gitignore 忽略"},{"acceptance_id":"acc_db2e7d6af8f8b65cd822210c","source_hash":"db2e7d6af8f8b65cd822210c70d179339c7db5154e07b908dcf7a526ad84dc4f","scope":"project/MagicMushroom","text":"仓库根目录存在 AGENT_CODE_INDEX.md"},{"acceptance_id":"acc_1d8a4af3dd40fd6802e968ed","source_hash":"1d8a4af3dd40fd6802e968ed4a1cf03b3f35207927dbe6f40305a14beabf8a54","scope":"project/MagicMushroom","text":"AGENT_CODE_INDEX.md 准确索引代码、场景、Prefab、Packages 和 ProjectSettings 结构"},{"acceptance_id":"acc_3f696647a9628b942c37b7db","source_hash":"3f696647a9628b942c37b7db62d2fe2f04d0098862d0bd950a89910b8ab5d712","scope":"project/MagicMushroom","text":"AGENT_CODE_INDEX.md 标明模块职责、关键入口、常调参数及准确文件或组件位置"},{"acceptance_id":"acc_333a2afb99a5541d4ee57e40","source_hash":"333a2afb99a5541d4ee57e40fd9e516ae4c0a3780ce05aed97c2c39a61ee7a2e","scope":"project/MagicMushroom","text":"AGENT_CODE_INDEX.md 覆盖角色移动、相机、动画和输入相关代码"},{"acceptance_id":"acc_139dbb00e53c5b961d3728eb","source_hash":"139dbb00e53c5b961d3728eb81ed27d837296d83e44d8e5
