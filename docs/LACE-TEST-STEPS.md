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

## B. 浏览器投票（需要本地 proof server，页面在 M4 完成后才有）

8. **本地 proof server**（Lace 不支持在浏览器里生成证明，必须由本机生成）。需要 Docker：
   ```bash
   docker run --rm -p 6300:6300 midnightntwrk/proof-server:8.1.3 midnight-proof-server -v
   ```
   打开 http://localhost:6300/health ，能看到 OK 就说明启动成功。
   Lace 设置 → Midnight → Proof server 选 **Local (http://localhost:6300)**。
9. **开发页面（含 `/proof-server` 代理）**：需要 Node.js 22+ 和 git。
   ```bash
   git clone -b wave3 https://github.com/hycorange/nightpoll.git && cd nightpoll
   npm ci
   npm run dev -w @nightpoll/ui      # 在 http://localhost:5173 打开；/proof-server 会转发到 localhost:6300
   ```
   ⚠️ **当前状态**：浏览器投票页面（Join → Register → Vote）属于里程碑 M4，**还没做完**。现在只能做 A 部分。M4 完成后，这里会写明具体页面网址和按钮。
10. 投票时的 Lace 弹窗应该是 **“确认交易/Approve transaction”**，网络 **Preview**，来源 `localhost:5173`，并且**不收取手续费或只有极少的 DUST**（手续费由 relayer 代付）。只在 Preview 上点 Approve。
11. **发回给我**：页面上显示的 tx hash（64 位十六进制），以及 Lace 弹窗的截图。

## 未验证的关键点

- 文档表明 Lace 的 `balanceUnsealedTransaction(tx, { payFees: false })` 可以在**不付手续费**的情况下封好交易，然后由 relayer 用 `balanceFinalizedTransaction(['dust'])` 补上 DUST 手续费并提交。**这一点还没有用真实的 Lace 验证过**；本地链上已经验证过 SDK 版本的同一流程（见 WAVE3-PLAN.md §7）。如果 Lace 不支持，退路是：仍由本地 proof server 生成证明，但由页面里的 SDK 负责封装交易，Lace 只负责授权。
