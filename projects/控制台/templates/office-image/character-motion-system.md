# 等距角色运动系统 · 设计方案

> 2026-07-08 老板要求:后续很多员工都要"走到各种位置"的走动功能,需系统化的行走函数+动画衔接。本文是方案,待老板拍板后实现。

## 目标
一套**通用**的角色行走+动画衔接系统:任何角色(秘书/员工/董事长)能从任意格走到任意格,自动选朝向、播脚步、到位后无缝衔接动作(idle/打字/递接/汇报),并支持多角色**时间线过场**(如秘书交接动画)。一次做好,所有角色复用。

## 一、坐标与投影(复用现有 office-assemble)
- 世界坐标:等距格 `(i, j)` 用**浮点**(支持亚格平滑移动),`z`=高度。
- 投影(单一真相): `screen = (ox + (i-j)*64, oy + (i+j)*32)`(标准 128×64 网格)。
- 角色屏幕位 = `grid_to_screen(char.i, char.j) - char.anchor`(anchor=脚底中心)。

## 二、角色动画素材规格(每个"会走"的角色一套)
| 状态 | 内容 | 生成方式 |
|---|---|---|
| `idle` | 站/坐待机 | gemini 单帧 + meowa animate 循环 |
| `walk_<dir>` | 按朝向的脚步循环,**4 主向**(↖↗↘↙)起步,可扩 8 向,每向 4-6 帧 | meowa `character-multi-view`(八向 sprite)+ `animate`(每向 walk 循环) |
| `action_<x>` | 接文件/递/打字/汇报,各 1 段 | gemini 姿势 + animate |
- 产物统一:`artifacts/characters/<角色>/<state>/frame_NN.png`,透明底,**统一锚点=脚底中心**(关键:所有 sprite 锚点一致,切换不跳)。

## 三、朝向系统(移动向量→sprite)
移动方向 `(Δi, Δj)` 决定朝向,等距 4 主向:
- `Δi>0` → **SE ↘**;`Δj>0` → **SW ↙**;`Δi<0` → **NW ↖**;`Δj<0` → **NE ↗**(斜向取主分量,或用 8 向)。
- 选 `walk_<dir>` sprite。

## 四、核心 API(拟实现)
```python
class Character:
    i, j          # 当前世界格(浮点)
    state, dir    # idle/walk/action + 朝向
    frame         # 当前帧索引
    sprites       # {state_dir: [帧...]}
    anchor        # (ax, ay) 脚底锚点

def walk(char, path, speed):        # path=[(i,j),...] 多点路径
    for seg in zip(path, path[1:]):
        dir = direction_of(seg)     # 由 Δi,Δj 定朝向
        char.state, char.dir = 'walk', dir
        while not reached(char, seg[1]):
            char 向 seg[1] 移 speed   # 位置插值
            char.frame = walked_dist // step % len(walk_frames)  # 脚步随距离推进(防打滑)
            yield snapshot(char)
    char.state = 'idle'

def action(char, name, hold):       # idle→action→idle
    char.state = f'action_{name}'
    for _ in range(hold): yield snapshot(char)

class Timeline:                     # 多角色多动作编排
    tracks = [(t0, t1, char, motion), ...]   # motion=walk(path)/action/idle
    def render(scene_bg, chars):
        for t in range(0, T):
            frame = scene_bg.copy()
            for c in sorted(chars, key=lambda c: c.i + c.j):   # 深度排序(遮挡)
                frame.paste(c.current_sprite(), project(c) - c.anchor)
            emit(frame)                                        # → 序列/gif
```

## 五、渲染管线(每帧)
1. 场景背景(地板+家具,静态,office-assemble 出)。
2. 各角色**按 depth `i+j` 排序**(远先画→近后画):正确遮挡(秘书走到桌前→桌遮她的腿)。
3. 每角色贴当前 `(state,dir,frame)` 帧到 `grid_to_screen(pos) - anchor`。
4. 逐帧合成 → 过场 gif / 序列 PNG(app 端播)。

## 六、交接动画(即用本系统编排,验证方案)
```
Timeline:
 0.0-2.0s  walk(秘书, [入口格, 桌前格], speed)      # 朝 NW 走近, 播 walk 循环
 2.0-3.5s  idle(秘书) + action(董事长,'turn')       # 站定 + 董事长转向
 3.5-5.0s  action(董事长,'hand')+action(秘书,'take')# 递+接, 文件袋道具跟手
 5.0-7.0s  walk(秘书, [桌前格, 入口格], speed)       # 收下, 反向走开
```

## 七、分期(建议)
- **P1 验证(先做)**:秘书 idle + walk(4 主向)+ 手工编 Timeline 出交接过场,跑通"行走+衔接+遮挡"。
- **P2 通用化**:抽成 Character/walk/Timeline 库(`tools/char_motion.py`),员工复用(每员工只需一套 walk sprite)。
- **P3 引擎驱动**:状态接真实引擎(任务完成→触发汇报过场;员工被派活→走到工位)。

## 八、成本与难点(交底)
- **素材**:每"会走"角色要 4(或 8)向 walk sprite——meowa `character-multi-view`+`animate`,每角色多次生成(有额度成本)。员工多时用"1 套走路 sprite 换头/换衣"复用降本。
- **遮挡动态重排**:走动时 depth 变,每帧重排序(已在渲染管线解决)。
- **脚步-位移同步**:frame 按走过距离推进(非按时间),防"脚打滑"。
- **锚点统一**:所有 sprite 脚底锚点必须一致,否则切状态/朝向会跳。

## 九、与现有的关系
- 复用:office-assemble 的 grid_to_screen/两遍渲染/自动锚点。
- 新增:`tools/char_motion.py`(Character/walk/Timeline)+ 每角色 walk sprite 集。
- 不影响:现有 idle 动画(董事长/员工)照常,walk 是新增能力。
