# 素数有限域多项式分解与不可约证书后端

在小规模素数有限域 **Fₚ** 上对一元多项式做**确定性完全分解**，并为每个声称不可约的因子生成基于 **Frobenius 模幂 + 最大公因式（Rabin 判据）** 的、可独立核验的证书。

- 纯 **TypeScript + Node.js**，数据库使用 Node 内置 `node:sqlite`（无需原生编译）。
- HTTP 服务使用内置 `node:http`，**零第三方运行时依赖**（仅开发期 `typescript`、`@types/node`）。
- 只做后端：REST API 与命令行（CLI）。
- 不依赖 Docker、WSL、付费服务或任何在线计算代数系统；有限域与多项式算法全部自行实现。
- 支持 Windows 本地直接运行，可配置端口，数据目录位于项目内 `data/`。

## 数学范围与公开限制

| 项目 | 取值 |
| --- | --- |
| 受支持素数 | 白名单 `2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47` |
| 多项式次数上限 | 60（`MAX_DEGREE`） |
| 操作预算 | 默认 4,000,000 次当量运算，超出报 `BUDGET_EXCEEDED` |
| 系数表示 | 升幂数组 `[c₀,c₁,…,cₖ]`，统一模 p 约简，去除尾随零 |
| 大整数 | API/存储中系数一律以 **字符串** 传输 |

合数模数、白名单外素数、除零、非法次数、预算耗尽分别返回**不同错误码**，不混淆。
本服务不处理有理数/实根区间，不做浮点运算。

## 多项式与语义约定

- **零多项式**：系数全零，规范表示为 `[]`，没有首项系数，也不生成分解报告（`kind=ZERO`）。
- **非零常数**：次数 0，无非常数因子，返回其常数与 `kind=CONSTANT`。
- **非常数多项式**：返回
  - `leading_coefficient`：原多项式首项系数（字符串）；
  - `factors`：全部**首一**不可约因子及重数，按「次数升序、系数高次到低次字典序」确定排序；
  - `complete=true` 表示已完全分解；若预算导致残留未拆开的余因子，则 `complete=false` 且给出 `residual_coeffs`，**不会**把余因子冒充为不可约。
- 乘以任意非零标量**不改变**首一因子（只改变 `leading_coefficient`）；系数加 p 不改变结果；尾随零与输入顺序被规范化。

## 关键算法

均位于 `src/core/`：

- `finiteField.ts`：Fₚ 的加、减、乘、模逆（扩展欧几里得）、除、幂。
- `polynomial.ts`：多项式加/减/乘、带余除法、GCD、首一化、形式导数、模幂 `a^e mod m`、p 次根。
- `squarefree.ts`：平方自由分解。**特征 p 下导数恒为零时**，识别 `f = gᵖ`，抽取 p 次根并把重数乘以 p 传播，绝不把“导数为零”误判为“无重根”。
- `irreducible.ts`：**Rabin 不可约判据**与证书。
- `factorize.ts`：Rabin 预检 → 不同度分解（DDF）→ 等度分解（EDF）。EDF 对 d=1 直接枚举根，奇素数用 Cantor–Zassenhaus（`T^((pᵈ-1)/2)`），p=2 用绝对迹 `Tr(T)=T+T²+…+T^{2^{d-1}}`；随机性来自输入与算法版本派生的确定性 LCG，可复现。
- `verify.ts`：**独立核验器**，不信任报告自报结论，重新执行全部运算。

### 不可约证书使用的数学条件（写入报告 `condition_zh`）

设 f 是 Fₚ 上首一 n 次多项式。f 不可约，当且仅当：

1. 对 n 的**每个素除子 q**，`gcd(f, x^{p^{n/q}} − x) = 1`；
2. `x^{p^n} ≡ x (mod f)`，即 `x^{p^n} − x` 除以 f 的余式为零。

证书记录每个 q 对应的指数与实测 GCD 次数（必须为 0），以及最终 Frobenius 余式为零。次数为 1 的首一多项式平凡不可约。

### 独立核验逐项检查

`POST /api/verify` 或 CLI `verify` 会：

1. 校验 p 为受支持素数；
2. 规范化并校验系数、次数；
3. 拒绝零多项式/非零常数作为分解对象；
4. 对每个声称因子**重新运行 Rabin**（乘积正确但因子可约的伪造证书在此被拒，错误码 `REDUCIBLE_FACTOR`）；
5. 校验重数为正整数、因子两两互异；
6. 重建 `lc · Π fᵢ^{eᵢ}`，逐系数比对原多项式（`PRODUCT_MISMATCH` 时拒绝）；
7. 校验排序规则。

## 快速开始（Windows / PowerShell）

前置：Node.js ≥ 22（开发环境为 Node 25，使用内置 SQLite）。

```powershell
npm install
npm run build
npm test
npm run demo
npm start                 # 默认 http://localhost:8787
$env:PORT=9000; npm start # 自定义端口
```

数据文件默认写入项目内 `data/gfpoly.sqlite`（可用环境变量 `GF_DATA_DIR` 改目录，`PORT` 改端口）。

## CLI

```powershell
node dist/cli/index.js factor 3 "1,0,1"                 # F_3 上 x^2+1，生成报告
node dist/cli/index.js list                              # 列出报告
node dist/cli/index.js verify <report-id>                # 独立核验
node dist/cli/index.js get <report-id>                   # 查看完整报告（含逐因子证据）
node dist/cli/index.js export <report-id>                # 导出 JSON 到 data/
node dist/cli/index.js demo                              # 完整分解 + 逐因子证明 + 篡改失败
node dist/cli/index.js serve 8787                        # 启动 API
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/api/polynomials/factor` | 导入并分解，写入原多项式、域参数、算法版本、报告 |
| GET | `/api/reports` | 列出报告 |
| GET | `/api/reports/:id` | 查看报告 |
| GET | `/api/reports/:id/verify` | 对已存报告做独立核验 |
| POST | `/api/verify` | 直接核验调用方提交的报告（篡改演示，不依赖数据库） |

分解请求示例：

```json
{ "p": 3, "coeffs": ["1", "0", "1"] }
```

PowerShell 调用：

```powershell
$body = '{"p":3,"coeffs":["2","2","0","2","1"]}'
Invoke-RestMethod -Uri http://localhost:8787/api/polynomials/factor -Method Post -ContentType 'application/json' -Body $body
```

错误以 `{ "error": "<CODE>", "message": "..." }` 返回，例如
`COMPOSITE_MODULUS`、`MODULUS_NOT_SUPPORTED`、`DIVISION_BY_ZERO`、
`ILLEGAL_DEGREE`、`BUDGET_EXCEEDED`、`INVALID_CERTIFICATE`。

## SQLite 表

- `polynomials`：原多项式（p、规范化系数、时间）；
- `field_params`：域参数；
- `algorithm_versions`：算法版本（随报告保存，旧报告重启后仍可按原载荷复核）；
- `reports`：完整分解报告 JSON、完成标志、算法版本。

## 测试覆盖

`npm test`（15 项）覆盖：

- F₂/F₃/F₅ 上**全部**次数 ≤4 首一多项式，Rabin 判定与独立暴力试除枚举**逐一**一致（不只验证乘积重建）；
- 不可约二次、不可约三次；完全分裂；多重因子；混合重数；
- 小特征 p=2 导数恒为零（平方与四次幂，重数正确传播为 2 与 4）；
- 乘非零标量不变、系数加 p 不变、输入重排规范化；
- 合数模数、除零、零多项式、非零常数语义；
- **乘积正确但含可约因子的假证书被拒绝**，篡改重数被拒绝；
- 报告关闭数据库重开后仍可独立复核；大整数经字符串传输约简。

## 限制与合理假设

- 仅支持上述白名单素数与 60 次以内多项式，属于明确的“小规模、已验证”范围。
- EDF 使用由输入派生的确定性伪随机源，结果可复现；极端输入若在尝试次数内未找到分裂会返回预算错误而非给出错误结论。
- 系数虽以字符串传输，但要求为整数（Fₚ 元素）；非整数会被拒绝。
