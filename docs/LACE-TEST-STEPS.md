# Lace 手动测试步骤（Wave 3，仅限 Midnight Preview 测试网）

> 只用**新建的一次性测试钱包**，里面只放测试币（tNIGHT/tDUST）。**不要导入任何真实钱包，永远不要切到 Mainnet。**
> 任何弹窗里如果显示的网络不是 **Preview**，一律点“拒绝/Reject”。

## A. 现在就能做（只需 Chrome，不用装开发环境）

1. **安装 Lace**：只从官方 Chrome 应用商店链接安装（这个链接已和官网 https://www.lace.io 上的链接核对过）：
   https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk
   发布者应为 Input Output（IOG）。Midnight 已集成在这个主 Lace 扩展里，不需要另装旧的 “Lace Midnight Preview”。
2. 建议新建一个 **单独的 Chrome 用户资料（Profile）** 专门做测试，在这里装 Lace，和日常浏览器隔离。
3. 打开 Lace → **Create a new wallet（新建钱包）**。不要选 Restore/Import。把助记词抄在纸上，只用于测试。
4. 在 Lace 里切到 **Midnight**，网络选 **Preview**（设置 → Network / Midnight → Preview）。确认页面上显示 “Preview”，不是 “Mainnet”。
5. 复制 Lace 里的 **Midnight 非屏蔽地址**（以 `mn_addr_preview1…` 开头），去官方 Preview 水龙头领 tNIGHT：
   https://faucet.preview.midnight.network/ 。然后在 Lace 里把 tNIGHT 设为生成 DUST（Generate DUST / 指定 DUST 地址）。
6. **连接器探测**（验证 Lace 的 DApp 接口，不签任何交易）：用同一个 Chrome 资料打开
   https://hycorange.github.io/nightpoll/ ，按 F12 → Console，粘贴：
   ```js
   const api = await window.midnight.mnLace.connect('preview');
   console.log(await api.getConfiguration());
   console.log(await api.getDustBalance(), await api.getUnshieldedAddress());
   console.log(typeof api.getProvingProvider, typeof api.balanceUnsealedTransaction);
   ```
   - Lace 会弹出 **“连接/授权此网站”** 的请求：确认来源是 `hycorange.github.io`，网络是 **Preview**，再点 Authorize/Connect。这一步只是授权读取，**不是签名**。
   - 如果弹出的是“签名/确认交易”，或者网络不是 Preview：**拒绝**。
7. **发回给我**：Console 输出的截图或文字，要包括 `networkId`、`proverServerUri`（如果有）、DUST 余额，以及两个 `typeof` 的结果。不要发助记词。

## B. 浏览器投票页面（M4，已完成）

测试投票：**NightPoll Wave 3: browser vote test**。合约地址 `a0164789f5836b340e0cf96b3e2d94a109de43ed5725f1db0deb390ee179768c`（Preview 上新部署的，**不是**提交的 Demo 投票；页面会拒绝 Demo 地址）。

**本机需要安装：** Chrome + Lace（见 A 部分）、**Docker**（用于 proof server）、**Node.js 24.11+**、git、**Compact 工具链 0.31.1**（只用来生成合约的 JS；ZK 密钥已经放在仓库的 `ui/zk-artifacts/` 里）。

8. **安装 Compact 0.31.1**（只需一次）：
   ```bash
   curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
   source ~/.bashrc     # zsh 用户：source ~/.zshrc
   compact update 0.31.1
   ```
9. **下载代码并编译合约 JS**：
   ```bash
   git clone -b wave3 https://github.com/hycorange/nightpoll.git && cd nightpoll
   npm ci
   npm run compact:fast -w @nightpoll/contract     # 生成 contract/src/managed（--skip-zk，几秒钟）
   (cd ui/zk-artifacts && sha256sum -c SHA256SUMS) # 校验 ZK 密钥（macOS：shasum -a 256 -c SHA256SUMS）
   ```
10. **终端 1：本地 proof server**（Lace 不能在浏览器里生成证明）：
    ```bash
    docker run --rm -p 6300:6300 -e PORT=6300 midnightntwrk/proof-server:8.1.3
    ```
    打开 http://localhost:6300/health 能看到 `"status":"ok"` 就说明启动成功。
11. **终端 2：dry-run relayer**（检查“免手续费封装”这条路，**不付钱、不上链**）：
    ```bash
    NP_RELAYER_CONTRACTS=a0164789f5836b340e0cf96b3e2d94a109de43ed5725f1db0deb390ee179768c npm run relayer:dry -w @nightpoll/cli
    ```
12. **终端 3：投票页面**（vite 开发服务器，自带 `/proof-server` → 6300、`/relayer` → 8790 的同源代理，`/zk` 提供密钥）：
    ```bash
    npm run dev -w @nightpoll/ui
    ```
    在装了 Lace 的 Chrome 资料里打开：
    **http://127.0.0.1:5173/vote.html?contract=a0164789f5836b340e0cf96b3e2d94a109de43ed5725f1db0deb390ee179768c**
13. 点 **“1. Connect Lace”**。Lace 弹出 **连接授权**：来源 `127.0.0.1:5173`，网络 **Preview**，点 Authorize。日志里会显示 `connected … on preview`。
14. 点 **“2. Load poll”**。阶段应为 `REGISTRATION`。点 **“Copy my vote key (backup)”**，把投票密钥另存一份（只存在这个浏览器里，丢了就不能投票）。
15. **测试 1：免手续费路径（未验证的关键点）**。“Fees” 选 **relayer pays (sponsored)**，点 **“3. Register”**。证明大约需要 1 分钟。
    - 如果 Lace 弹窗要你 **确认/签名交易**：检查网络是 **Preview**、来源是 `127.0.0.1:5173`、**手续费为 0 或没有手续费**，然后 Approve。
    - 日志应显示 `register: sponsored ✔ tx dry-run:…（sealed by lace）`。**sealed by lace** 说明 Lace 支持 `payFees:false`；如果显示 `sealed by local-bind`，说明 Lace 拒绝了，页面改用了本地封装。
    - 因为是 dry-run，这一步**不会上链**。
16. **测试 2：钱包自付（真正上链）**。“Fees” 改选 **my Lace wallet pays**，再点 **“3. Register”**。Lace 弹窗显示 **Preview** 和一笔小额 DUST 手续费，点 Approve。日志显示 `register: submitted by Lace (wallet paid)`，成员数加 1。（需要 A 部分第 5 步的 DUST。）
17. **告诉我你已经注册了**。我会用管理员钱包执行 `openVoting`。刷新页面再点 Load poll，阶段变成 `VOTING`。选一个选项，点 **“4. Vote”**（wallet pays），在 Preview 上 Approve。投第二次应该会报 `already voted`。
18. **发回给我**：整个日志框的文字（包括 `sealed by …` 那一行和所有 `ERROR`）、Lace 每个弹窗的截图，以及 Lace 活动记录里的交易 hash。

> 真正的代付（relayer 用 DUST 付手续费并上链）需要一个有 tNIGHT/DUST 的 relayer 钱包：`npm run relayer:wallet -w @nightpoll/cli` 会生成一个一次性钱包并打印地址 → 去水龙头领币 → `NP_NETWORK=preview NP_RELAYER_SEED_FILE=.secrets/preview-relayer.seed NP_RELAYER_CONTRACTS=<地址> npm run relayer -w @nightpoll/cli`。然后在测试 1 的模式下操作即可。
> 页面遇到任何代付失败，都会**先弹窗询问**是否改用钱包自付；点“取消”就什么都不会提交。

## 未验证的关键点

- 文档表明 Lace 的 `balanceUnsealedTransaction(tx, { payFees: false })` 可以在**不付手续费**的情况下封好交易，然后由 relayer 用 `balanceFinalizedTransaction(['dust'])` 补上 DUST 手续费并提交。**这一点还没有用真实的 Lace 验证过**；本地链上已经验证过 SDK 版本的同一流程（见 WAVE3-PLAN.md §7）。如果 Lace 不支持，退路已经实现：页面自己用 `tx.bind()` 封装（NightPoll 交易不转移任何代币），再交给 relayer；如果这也失败，就先弹窗询问，再改用钱包自付。本机浏览器测试（假钱包 + 真实 proof server + 真实 relayer 校验）已经确认：本地封装的 register 交易（5502 字节）能通过 relayer 的检查。
