# MagicMushroom 项目交接摘要

更新：2026-07-21  
工程：`/Users/yutu6/UnityProject/MagicMushroom`  
当前基线：`Joe-Song` / `f30e311d68559f0bb4ec8fe93c9163d3702741a5`  
Unity：`6000.3.16f1`

## 当前事实

- 工程已不是 `main@4910554` 的 Unity 初始骨架。当前可玩入口是
  `Assets/Scenes/PlayerControllerScene.unity`，也是唯一启用的 build scene。
- 已使用 Unity Netcode for GameObjects 2.13.0、Unity Transport 2.7.3、Multiplayer
  Services 2.2.3 和 Relay/Authentication；支持单机、局域网直连与 Relay。
- 当前玩家源是 `Assets/Resources/Networking/ActiveRagdollPlayer.prefab`。它包含
  TargetRig、PhysicalRig、不可见 AnimationSource、第三人称视觉、FPS 视觉和子相机。
- 移动由 `ActiveRagdollCapsuleRootController` 驱动，当前 prefab 参数为速度 2.6、
  加速度 22、刹车 30。Active-ragdoll 当前只消费 WASD；输入资产虽然有 Jump/Sprint，
  但此玩家控制器未实现跳跃/冲刺状态。
- 第一人称相机锚定稳定 `TargetRoot`；`Char_Camera` near clip 为 0.01。FPS 身体是
  `FirstPersonBody`(9)，本地第三人称身体是 `LocalPlayerBody`(10)。Prefab 序列化 mask
  排除 10、保留 9 和远端 `PlayerBody`(8)；本轮最小修复在 owner 运行时额外排除 9，
  防止物理绑定 FPS 胳膊穿过近裁剪面，同时不改远端身体、第三人称层或同步包。
- Animator root motion 关闭。视角俯仰会由 `HeadLookAtController` 驱动
  Spine/Chest 弯曲，并把颈部位移同步给 FPS 相机；owner 的 move/root/view pitch 和
  hips/双手 pose 通过 owner RPC → server validation → NetworkVariable 呈现给 remote。

## 首读与定位

1. 仓库 `AGENTS.md`
2. 仓库 `AGENT_CODE_INDEX.md`（完整模块、参数、场景/Prefab、网络和验证索引）
3. `projects/MagicMushroom/status.md`
4. 当前任务信封与本任务产物
5. `ProjectSettings/ProjectVersion.txt`、`Packages/manifest.json`

第一人称/胳膊问题从以下路径开始：

- camera：`SimpleThirdPersonCameraFollow.cs`
- visual/layer/network player：`MagicMushroomActiveRagdollPlayerController.cs`
- body pitch bend：`HeadLookAtController.cs`
- arm targets/constraints：`RagdollHandController.cs`、`HandIKController.cs`、
  `AnimationRiggingIKSetup.cs`
- serialized truth：`Assets/Resources/Networking/ActiveRagdollPlayer.prefab`（只读核查；
  禁止手改 YAML）

## 当前验证入口

- Unity 版本：`/Applications/Unity/Hub/Editor/6000.3.16f1/Unity.app/Contents/MacOS/Unity -version`
- 工程 gate：batchmode 执行 `MagicMushroomGameplayIntegrationValidator.Validate`
- Play Mode：打开 `PlayerControllerScene`；离线跑视野，再用 direct host/client 双端验证。
- 任何编辑器验证先获取 `magicmushroom.unity-editor` 锁；不得提交或 push。

## 稳定边界

- 不切回 `main`，不借用 Simulaid 规则或资产。
- 不手改 Scene/Prefab/Animator YAML，不改 `.meta` GUID。
- `Library/Temp/Obj/Logs/UserSettings/Build/Builds` 等为生成目录，不作为源码修改。
- 保持视觉层、第三人称外观、owner/server authority、remote pitch/hand pose 同步；
  不能用改共享动画或移动参数来掩盖仅第一人称可见性问题。

## 本轮任务链与证据入口

- rootTaskId：`cr-1784565738737-9554329f`；CEO queueId：`9554329f`。
- 正式主管：`supervisor-MagicMushroom / 73922255`；实现角色：
  `magicmushroom_programmer`；当前实现节点：`cr-1784568939856-73922255`。
- 阶段 A 独立复核：
  `artifacts/task-results/cr-1784568939856-73922255/phase-a-checkpoint-audit.md`。
- 阶段 B 根因、修复、验证与回滚：
  `artifacts/task-results/cr-1784568939856-73922255/implementation-handoff.md`。
