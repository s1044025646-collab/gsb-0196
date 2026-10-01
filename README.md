# 素数域多项式分解与不可约证书后端

这是一个只包含后端的 Windows 本地示例，使用 TypeScript、Node.js 和内置 `node:sqlite`。服务面向小规模素数有限域上的一元多项式，完成规范化、分解、重数提取、不可约性证书生成、独立核验、持久化和导出。

## 范围与限制

- 支持模数：`2, 3, 5, 7, 11, 13`；其他模数明确返回 `COMPOSITE_MODULUS` 或不支持，不做通用素性证明。
- 最大输入次数：`12`，由 `src/config.ts` 公开配置；超限返回 `INVALID_DEGREE`。
- 默认预算：`500000` 个内部运算计费单位；预算耗尽返回 `BUDGET_EXCEEDED`，不会把未拆开的余因子宣称为不可约。
- 系数使用从常数项开始的升幂数组，例如 `[1,0,1]` 表示 `1 + x^2`。
- API JSON 中大整数以字符串传输；内部使用 JavaScript `bigint`。
- 不处理有理数实根区间，不依赖或调用外部计算代数系统、Docker、WSL 或在线 API。

## 数学说明

实现位于 `src/finiteField.ts` 与 `src/factor.ts`：

- 自行实现有限域加、减、乘、非零逆元、多项式带余除法、多项式 GCD 和模幂。
- 因子统一首一化；非一原多项式的首项系数单独保存在 `leadingCoefficient`。
- 分解确定性使用不同度 Frobenius 提取，再在相同度数组中用确定性候选序列执行 Cantor–Zassenhaus 风格拆分。
- 平方自由处理正确区分 `f' = 0`：此时只接受形如 `g(x)^p` 的多项式，抽取 `p` 次根并把重数乘上 `p`。
- 因子排序先按次数，再按从高次到低次的系数字典序；重数合并后输出。

每个非常数因子 `f`（次数 `n`）的证书写入：

1. `f` 在 `F_p[x]` 中是首一非常数多项式。
2. 对 `n` 的每个素因子 `q`，`gcd(f, x^(p^(n/q)) - x) = 1`。
3. `x^(p^n) ≡ x (mod f)`，等价地 `gcd(f, x^(p^n)-x)=f`。

核验器在 `src/report.ts` 中重新执行这些 Frobenius 模幂和 GCD，不因为数据库或报告中已有因子列表就通过。它还检查域参数、系数模约简、次数、首项系数、重数、因子唯一性和重建乘积。

## 准备

```powershell
node --version
npm install
```

要求 Node.js 提供 `node:sqlite`；本机已在 Node.js v25.5.0 验证。

## 构建、测试、启动和演示

```powershell
npm run build
npm test
npm start
npm run demo
```

可配置端口和项目内数据目录：

```powershell
$env:PORT="3100"
$env:DATA_DIR=(Join-Path (Get-Location) "data")
npm start
```

默认数据库路径是 `data/factorization.db`。

## HTTP API

### 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

### 分解

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/factor `
  -ContentType 'application/json' `
  -Body '{"prime":"2","coefficients":["1","1","1"]}'
```

响应包含：

- `report.leadingCoefficient`
- `report.factors[].factor` 与 `multiplicity`
- 每个因子的 `certificate.checks`
- `sha256`
- 立即执行的独立 `verification`

### 核验任意报告

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/verify `
  -ContentType 'application/json' `
  -Body (Get-Content -Raw report.json)
```

### 列表、读取、导出和篡改演示

```text
GET /api/reports
GET /api/reports/{id}
GET /api/reports/{id}/export
GET /api/reports/{id}/tamper-demo
```

## CLI

```powershell
npm run cli -- factor 2 "[1,1,1]"
npm run cli -- list
npm run cli -- export <id> report.json
npm run cli -- tamper <id> tampered.json
npm run cli -- verify tampered.json
```

零多项式和非零常数：

```powershell
npm run cli -- factor 2 "[0,0]"
npm run cli -- factor 5 "[7]"
```

## 数据库表

`src/store.ts` 创建并维护：

- `domain_parameters`：受支持素数、次数上限、算法版本。
- `polynomials`：原多项式输入和规范表示。
- `factorization_reports`：完整 JSON 报告、算法版本、完成状态和 SHA-256。
- `verification_events`：独立核验事件，包括篡改失败。

重启后使用 `GET /api/reports/{id}` 或省略输出文件执行 `npm run cli -- export <id>` 重新导出并核验。

## 错误语义

- `COMPOSITE_MODULUS`：模数不在受支持的小素数集合。
- `ZERO_DIVISOR`：尝试对零求逆或用零多项式做除数。
- `INVALID_DEGREE`：次数超过上限或多项式语义不允许。
- `BUDGET_EXCEEDED`：预算不足，结果只能视为未完成。
- `INVALID_INPUT`：JSON、系数、重数或报告结构不合法。

## 已验证场景

测试覆盖不可约二次和三次、完全分裂、多重因子、混合重数、特征 2/3 下导数为零的 `p` 次根、非零标量归一化、系数加模数不变、输入重排规范化、假证书拒绝和 SQLite 重启后复核。
