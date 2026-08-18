# 竹知了 · 传统竹蝉仿真网页游戏

一根竹签，一片薄竹片——掌心搓动竹签让竹片高速旋转，竹片切割空气发生气动颤振，发出类似夏天蝉鸣的「嗡嗡」声。本游戏用 WebAudio 实时合成这一声音：**音调与响度由实时转速连续驱动，转速下降声音自然衰歇，无任何预录音频**。

## 运行

- 直接双击打开 `index.html`（所有代码均为原生 JS/CSS，无外部依赖，离线可用）
- 或本地起服务：`node tools/serve.mjs` 后访问 http://127.0.0.1:8734

## 上线分享（给朋友玩）

本游戏是**纯静态站点**（无后端、无构建），任选一种免费静态托管即可：

| 方案 | 步骤 | 国内访问 |
| --- | --- | --- |
| **Netlify Drop**（最快） | 打开 https://app.netlify.com/drop ，把整个 `bamboo-cicada` 文件夹拖进去，几秒后得到一个 https://xxx.netlify.app 链接，直接发给朋友 | 一般 |
| **GitHub Pages** | 新建仓库 → 上传全部文件 → Settings → Pages → 选分支部署 → https://用户名.github.io/仓库名 | 一般（可能被墙） |
| **Vercel / Cloudflare Pages** | 注册 → 导入项目文件夹 / 拖拽上传 → 自动部署 | 一般 |
| **Gitee Pages**（国内快） | 新建仓库上传 → 服务 → Gitee Pages 部署 → https://用户名.gitee.io/仓库名 | 好 |
| **对象存储静态托管** | 腾讯云 COS / 阿里云 OSS 上传文件并开启「静态网站托管」，或七牛云等 | 好（需实名） |
| **局域网直连**（临时） | 手机和电脑连同一 Wi-Fi：`node tools/serve.mjs 8734`，然后手机浏览器访问 `http://电脑IP:8734` | 仅局域网 |

注意：声音需要一次点击/触摸后才能播放（浏览器自动播放策略，游戏已自动处理）；成绩纪录存在各人自己浏览器的 localStorage 里。

## 玩法

| 操作 | 说明 |
| --- | --- |
| 桌面：鼠标 | 按住竹签，绕它快速画圈搓动（也可快速来回拖拽） |
| 移动端：触摸 | 同上；另外支持**重力感应摇一摇**（iOS 首次需点「开启摇一摇」授权） |
| 玩法一 随意把玩 | 自由玩耍，实时 RPM / 蝉鸣强度表 |
| 玩法二 鸣叫挑战 | 连续鸣叫计时，跌破阈值 0.5 秒即中断；阶梯成就 + 最佳纪录 |
| 玩法三 极速挑战 | 20 秒内冲击峰值转速；阶梯成就 + 最佳纪录 |

纪录保存在浏览器 localStorage（本机）。

## 声音合成（WebAudio，零音频文件）

- **颤振音**：一对失谐锯齿波（周期波表，15 次谐波）+ 亚八度「嗡」体，经随基频滑动的低通滤波成型
- **每转一圈的振幅调制**：LFO 频率 = 实时转速，模拟竹片每圈拍击空气的起伏
- **气流噪声**：白噪声经带通，响度随转速平方衰减
- 所有参数每帧用 `setTargetAtTime` 平滑过渡：转速降 → 音调连续下滑、响度自然衰减 → 低于阈值（286 RPM）无声

## 物理模型

`applyRub`（画圈搓动，含机械增益）与 `applyShake`（摇动冲量）注入角速度；`stepSpin` 用半步中点法积分恒定摩擦 + 线性粘滞 + 平方空气阻力三项衰减；转速低于阈值即停止颤振。一次猛搓可持续嗡嗡约 5~7 秒。

## 自检与验证

- 物理单元测试：`node test/physics.test.mjs`
- 音频引擎控制逻辑测试（Node 端 WebAudio 模拟器，跑真实 audio.js）：`node test/audio.mock.test.mjs`
- 浏览器内自检（物理 / 交互管线 / 实时音频）：访问 `?selftest=1`，结果写入页面
- 无头浏览器验证与截图：`powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Action all`
  （selftest / shot-desktop / shot-mobile / shot-buzz；页面布局报告见 `?layout=1`）

## 目录

```
index.html        页面骨架（含「一千万以内最好的玩具」标语）
css/style.css     宣纸 + 竹木 + 朱砂印章风格
js/physics.js     旋转物理（纯函数）
js/audio.js       WebAudio 合成引擎
js/game.js        游戏主逻辑（交互/渲染/玩法/纪录）
js/selftest.js    浏览器内自检 / 自动搓动 / 布局报告
tools/            serve.mjs 静态服务器、verify.ps1 无头验证
test/             物理与音频引擎单元测试
```
