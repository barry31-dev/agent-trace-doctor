# Agent Trace Doctor

一个用于查看、校验和比较 agent 运行轨迹的命令行工具。每条命令都只读一份轨迹、打印一份报告，
不改动磁盘上的任何东西；`eval-gen --out` 是唯一的例外，而它也只写被告知要写的那一个文件。

> **状态：v0.1.0，已于 2026-10-16 发布（切片 S0-S24），仓库地址**
> https://github.com/barry31-dev/agent-trace-doctor 。
> `validate`、`summary`、`timeline`、`show`、`tools`、`errors`、`diff`、`compare`、
> `explain`、`eval-gen` 和 `fix-suggest` 都可用并有测试覆盖，其中 `compare`、
> `explain`、`eval-gen` 和 `fix-suggest` 都接受 `--model`。下面标注「计划中」的一切都是
> 计划，不是已实现的功能。
>
> 命令名定为 `trace-doctor`，许可定为 Apache-2.0；两者是一起定的，安装后的副本按这个命令名
> 调用，而不是按路径。下面描述的是这一个版本，不是对后续版本的计划。
>
> 切片 S4 增加了一个开发用的 mini agent spike（`spike/`，不属于 CLI），它会跑一个真实的
> 五步 agent 并写出一份真实轨迹，外加那份轨迹逼出来的 schema 修订，评审记录在
> `spike/SCHEMA_REVIEW.md`。
>
> 切片 S5 增加了 `explain`，随之有了模型层。不带 `--model` 的 `explain` 完全在本地且确定。
> `--model` 是本仓库里唯一会建立网络连接的东西，不输入它就不会触发，它具体发什么在下面逐项
> 列出，而不是一句描述。
>
> 切片 S10 让 `compare` 有了模型半边，随之带来一条模型层此前不需要的规则：两份轨迹可能携带
> 同一个事件 id，所以关于某一对的结论要引用 `a:EVENT_ID` 或 `b:EVENT_ID`，而不是裸 id。
>
> 切片 S11 增加了 `eval-gen`，这是第一个会留下文件的命令。

## 它能做什么

给一份 agent recorder 写出的 `trace.jsonl`，这个工具回答四个问题。`summary` 和 `timeline`
已经覆盖前三个。`diff` 和 `explain` 回答第四个：`diff` 说出两次运行之间什么变了，`explain`
说出一次运行自己的事件对「它是怎么结束的」报告了什么，`explain --model` 再加上一个模型对
同样这些事件的解读，每条结论都绑在承载它的事件上。`tools` 和 `errors` 把第三个问题收窄到
一个工具或一次失败，`show` 覆盖其余所有命令都会引出的那个问题：这一个事件到底记录了什么？
`compare` 回答的是开发者改完 prompt 或工具之后有的那个问题：运行是不是变差了？它比较两份
轨迹的失败画像，报告每一个移动过的错误类别和失败工具，而 `diff` 仍留在结构性差异上。
`compare --model` 回答接下来的那个：不只是什么移动了，还有承载这些移动的事件对此说了什么，
每条结论都绑在它来自的文件和事件上。
`eval-gen` 回答再往后的那个：什么能证明这修好了？它把一份轨迹的失败变成一个错误类别一个
用例，每个用例带上它依赖的每一次出现的行号与事件 id。`eval-gen --model` 把这些用例对着它们
引用的事件读回去，报告哪一处断言正在代替两种不同的失败，这是用例存在之后读者会有的问题。

`fix-suggest` 回答这之后的那一个：下一步该看哪里？它读一份轨迹，点名这份轨迹自己的记录指向
的方向 —— 没有终止事件的运行、指向不存在之处的引用、致命失败、重复出现的错误类别、失败的
工具、被拒的权限、护栏拒绝 —— 每条建议都引用它派生自的事件，并说明它没有证明什么。它刻意
不是诊断：轨迹记录发生了什么，不记录为什么，一条被读成原因的建议会是这个命令唯一承担不起
的东西。什么都不改，什么都不执行，什么都不发出去。
`fix-suggest --model` 把这些方向对着它们引用的事件读回去，报告哪一条建议的证据不共享同一个
模式，或者哪两条建议在看同一个事件。方向本身仍是这个工具自己的，无论模型说什么都保持同样的
字节，所以模型是读它们，从不改写一条。

1. 这次运行的最终状态是什么？
2. 花了多久，发生了多少次模型调用和工具调用，用了多少 token？
3. 每一步发生了什么，包括工具参数、结果和错误？
4. 为什么一次运行成功、另一次失败？

每一个不带 `--model` 的命令都必须保持确定：不联网、不需要 API key、同样的输入产出同样的报告。

`explain` 就是这条线划下去的地方。不带 `--model` 它从不离开本机，同一个文件总是产出同样的
字节；它打印的报告是对事件的复述，不是解读。带 `--model` 时一个模型读同样这些事件并附加结论，
报告会说明哪些部分是哪一种。

## 命令

### `trace-doctor validate FILE`

检查一份 JSONL 轨迹文件，报告它发现的每一个问题：

```bash
npm run build
./bin/trace validate examples/success.jsonl
./bin/trace validate examples/failed.jsonl --json
./bin/trace validate artifacts/run.jsonl --schema schemas/trace.schema.json
```

`--json` 用稳定的键序把同一份报告打成 JSON，顺序是 `command`、`file`、`schema`、`events`、
`valid`、`errors`。`errors` 的每一条都带 `line`、`event_id`、`check`、`path`、`keyword` 和
`message`，且始终是这个顺序，所以同样的输入总是产出同样的字节。当失败不与某一行绑定时，
`line` 和 `event_id` 是 `null`，`path` 因同样的原因为空。

会出现三种 `check`：

| `check` | 含义 |
|---|---|
| `schema` | 该事件不满足 schema。`keyword` 是失败的 JSON Schema 关键字。 |
| `duplicate_event_id`、`timestamp_order`、`single_run_id` | 某条跨行不变量被破坏。`keyword` 是 `null`。 |
| `load` | 文件根本读不出来，因此没有校验任何事件。 |

### `trace-doctor summary FILE`

汇总一份轨迹文件：运行状态、时长、事件数、模型调用数、工具调用数、权限决定、记录的错误和
token 合计。文件会先被校验，所以带 schema 错误或不变量被破坏的轨迹，会用 `validate` 打印的
同样错误报告并以 `1` 退出，而不是被汇总。

```bash
./bin/trace summary examples/failed.jsonl
./bin/trace summary examples/failed.jsonl --json
```

`--json` 用稳定的键序打印同样的字段，顺序是 `command`、`file`、`schema`、`run_id`、`status`、
`terminal_event_id`、`started_at`、`ended_at`、`duration_ms`、`events`、`models`、
`model_requests`、`model_responses_completed`、`model_responses_failed`、`tool_calls`、
`tool_calls_completed`、`tool_calls_failed`、`tool_guardrail_refusals`、`permissions_requested`、
`permissions_approved`、`permissions_denied`、`context_compactions`、`errors_recorded`、
`errors_fatal`、`tokens`。`tokens` 内部是 `input`、`output`、`cache_read`、`cache_write`、
`reasoning`。

### `trace-doctor timeline FILE`

按文件顺序每个事件列一行，各带行号、事件 id、相对首个事件的偏移量和一行描述。文件会先被校验，
原因与 `summary` 校验它相同。

```bash
./bin/trace timeline examples/cancelled.jsonl
./bin/trace timeline examples/cancelled.jsonl --json
```

`--json` 打印 `command`、`file`、`schema`、`run_id`、`steps`、`events`，每条再带 `index`、
`step`、`line`、`event_id`、`timestamp`、`offset_ms`、`duration_ms`、`type`、`summary`，
始终是这个顺序。

### `trace-doctor show FILE [--event ID]`

完整打印一个事件，省略 `--event` 时打印全部事件：事件在文件中的位置、它属于第几轮模型、它
发生在运行开始后多久、它的类型、`timeline` 打印的同一行描述，以及它的 payload。文件会先被
校验，原因与每个其他命令先校验相同。

```bash
./bin/trace show examples/failed.jsonl --event evt_000013
./bin/trace show examples/failed.jsonl --event evt_000013 --json
./bin/trace show examples/cancelled.jsonl --json
```

`--json` 用稳定的键序打印同一份报告，顺序是 `command`、`file`、`schema`、`run_id`、`events`、
`selected`。`selected` 的每一条带 `index`、`step`、`line`、`event_id`、`timestamp`、
`offset_ms`、`duration_ms`、`type`、`summary`、`payload`，始终是这个顺序。`events` 数的是文件，
不是选择集，所以只报告一个事件的报告仍然说明这次运行有多长。

### `trace-doctor tools FILE`

按工具汇总一份轨迹文件：每个工具被调用多少次、每次调用怎么结束、失败的那些被哪些 guard 拦下、
完成的那些留下了哪些 effect。同时报告这次运行声明的工具集，以及其中哪些从未被调用。文件会先
被校验，原因与每个其他命令先校验相同。

```bash
./bin/trace tools examples/failed.jsonl
./bin/trace tools examples/spike-run.jsonl --json
```

### `trace-doctor errors FILE`

列出每一次失败：按错误类别聚合，再逐个出现地列出，各带事件 id、关联事件 id、工具或模型和消息，
外加任何指向文件中不存在事件的 `related_event_id`。文件会先被校验，原因与每个其他命令先校验
相同。发现错误不改变退出码 —— 一份满是失败的轨迹仍然是可读的轨迹。

```bash
./bin/trace errors examples/failed.jsonl
./bin/trace errors examples/failed.jsonl --json
```

### `trace-doctor diff FILE FILE`

比较两份 JSONL 轨迹文件并报告每一处差异：运行身份、汇总计数器和事件本身。两份文件都会先被
校验，所以带 schema 错误或不变量被破坏的轨迹，会用 `validate` 打印的同样错误报告并以 `1`
退出，而不是被比较。

```bash
./bin/trace diff examples/success.jsonl examples/failed.jsonl
./bin/trace diff examples/success.jsonl examples/failed.jsonl --json
```

退出码：`0` 表示两份相同，`1` 表示有差异或校验失败，`2` 表示读不了，`3` 表示报告写不出，
`64` 表示命令行听不懂。`diff` 没有模型半边，所以 `--model` 在它上面是未知选项。

### `trace-doctor compare FILE FILE`

比较两份 JSONL 轨迹文件的失败画像：运行状态、失败合计、每一个错误类别和每一个失败工具，各带
它在两份文件里的计数与两者之差。`diff` 回答逐事件而言什么不同；这个回答的是运行是否变差了，
也就是开发者改完 prompt 或工具之后会有的那个问题。两份文件都会先被校验，所以无效的轨迹会被
报告而不是被比较。

```bash
./bin/trace compare examples/success.jsonl examples/failed.jsonl
./bin/trace compare examples/success.jsonl examples/failed.jsonl --json
```

### `trace-doctor compare FILE FILE --model`

同样的比较，外加一个模型读这两份失败画像。`--model` 是这个命令里唯一会建立网络连接的东西；
不带它什么都不离开本机，同一对文件总是产出同样的字节。

```bash
./bin/trace compare examples/success.jsonl examples/failed.jsonl --model --model-name NAME
```

### `trace-doctor explain FILE`

把一份 JSONL 轨迹文件归约为绑定证据的观察，并报告它对这次运行如何结束说了什么。文件会先被
校验，原因与每个其他命令先校验相同。

```bash
./bin/trace explain examples/failed.jsonl
./bin/trace explain examples/failed.jsonl --json
```

### `trace-doctor eval-gen FILE [--out DIR] [--force]`

把一份轨迹文件的失败变成回归用例：一个错误类别一个用例，每个用例带上它依赖的每一次出现及其
行号和事件 id，这样一条断言可以一路追回到为它提供依据的事件。文件会先被校验，原因与每个其他
命令先校验相同：从一份读不出来的轨迹生成的用例文件，会和从一份好轨迹生成的看起来一样扎实，
而它恰是后续运行要对着量的东西。

```bash
./bin/trace eval-gen examples/failed.jsonl
./bin/trace eval-gen examples/failed.jsonl --json
./bin/trace eval-gen examples/failed.jsonl --out ./evals
```

### `trace-doctor eval-gen FILE [--out DIR] [--force] --model`

同样的用例，外加一个模型把它们对着它们引用的事件读回去。`--model` 是这个命令里唯一会建立
网络连接的东西；不带它什么都不离开本机，同一个文件总是产出同样的字节。

```bash
./bin/trace eval-gen examples/failed.jsonl --model --model-name NAME
```

### `trace-doctor fix-suggest FILE`

点名一份轨迹文件自己的记录指向的方向。`errors` 说哪里出了错，`eval-gen` 说重跑必须避开什么，
这个说的是下一步该看哪里：一条规则一条建议，每条引用它派生自的事件，并在自身旁边说明它没有
证明什么。文件会先被校验，原因与每个其他命令先校验相同。

```bash
./bin/trace fix-suggest examples/failed.jsonl
./bin/trace fix-suggest examples/cancelled.jsonl
./bin/trace fix-suggest examples/failed.jsonl --json
```

### `trace-doctor fix-suggest FILE --model`

同样的方向，外加一个模型把它们对着它们引用的事件读回去。`--model` 是这个命令里唯一会建立
网络连接的东西。

```bash
./bin/trace fix-suggest examples/failed.jsonl --model --model-name NAME
```

## 退出码

| 码 | 含义 |
|---:|---|
| `0` | 每个事件都通过校验；或比较的两份相同；或报告已交付。 |
| `1` | 校验失败：schema 错误或不变量被破坏。这个码也表示命令发现了差异：`diff` 在两份轨迹不同时，`compare` 在两份失败画像不同时，以及 `show` 在 `--event` 点名了文件不携带的事件 id 时。 |
| `2` | 轨迹文件或 schema 文件读不了：文件缺失、权限不对、UTF-8 无效、有字节序标记、某一行不是 JSON，或文件为空。 |
| `3` | 报告写不出，例如输出管道提前关闭。 |
| `64` | 命令行听不懂。 |

`summary`、`timeline`、`show`、`tools`、`errors`、`diff` 和 `compare` 用这同样的五个码，
含义也相同。四个接受 `--model` 的命令 —— `compare`、`explain`、`eval-gen` 和 `fix-suggest`
—— 额外增加 `65` 和 `69`，对应模型答案失败的两种方式，且只有它们的 `--model` 形态可能产生。

schema 在轨迹文件之前加载，所以即使轨迹文件也缺失，一个坏掉的 `--schema` 仍会被报告。

## 询问模型

```bash
export OPENAI_API_KEY=...        # 从不从文件读，也从不写到任何地方
export OPENAI_MODEL=...          # 或者传 --model-name
./bin/trace explain examples/failed.jsonl --model --model-name stub-model
```

`--model` 是本仓库里唯一会建立网络连接的开关。不带它什么都不发出去，即使
`OPENAI_BASE_URL` 指向一个不可达的主机。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `--model` | 关 | 询问模型。不带它什么都不发。 |
| `--model-name NAME` | `$OPENAI_MODEL` | 用哪个模型。没有默认值：这个工具不替用户挑模型。 |
| `--provider NAME` | `openai-compatible` | 用哪个后端。只实现了一个。 |
| `--timeout SEC` | 60 | 等待多少秒。超时不重试。 |
| `--send-paths` | 关 | 把轨迹文件自己的路径放进请求。 |
| `--max-excerpt N` | 50 | 可以引用多少个事件。其余的在 `unverified` 里点名但不发送。 |

一次请求包含什么：任务陈述、答案契约、观察，以及这些观察引用的事件。除此之外什么都没有。
没有文件，没有整份轨迹，没有任何观察不指向的事件，也没有 API key —— 它作为 bearer 头传输，
不出现在正文里，也不出现在任何报告中。

返回的答案必须匹配发过去的契约：`findings`，每条带一个来自 `info`/`warning`/`error` 的
`severity`、一个来自 `low`/`medium`/`high` 的 `confidence`、一个非空的 `claim`、一个
`suggestion`，以及至少一条 `evidence`，点名一个轨迹中真实存在的事件 id。不是 JSON 的答案、
带未知字段的答案、编造严重程度的答案，或引用了文件中不存在的事件 id 的答案，会被整体拒绝
而不是部分采信，命令以非零退出。被拒的答案会作为一次拒绝被报告；确定性的观察仍然打印，
退出码说明模型半边失败了。

模型失败从不被呈现为一次成功的解释，低置信度的结论也从不被呈现为确定性事实。两者都是模型的
话，在报告里属于模型自己的那一节。

## 开发

要求：Node.js 20 或更新。开发与测试用的是 Node.js 22。

```bash
npm install
npm run build
npm run typecheck
npm test

./bin/trace validate examples/success.jsonl
./bin/trace summary examples/failed.jsonl
./bin/trace timeline examples/cancelled.jsonl
./bin/trace show examples/failed.jsonl --event evt_000013
./bin/trace tools examples/failed.jsonl
./bin/trace errors examples/failed.jsonl
./bin/trace eval-gen examples/failed.jsonl
./bin/trace fix-suggest examples/failed.jsonl
```

### 打包与安装

这个包不发布到 npm，这个版本也不计划发布：发布目标是 GitHub 仓库、tag 和 release，npm 包是
后续版本的问题。tarball 证明的东西更窄：这个包能打包、能安装，且一个打包后的副本会按消费者
使用它的方式被演练：

```bash
npm pack --pack-destination /tmp
mkdir /tmp/trace-clean && cd /tmp/trace-clean && npm init -y
npm install /tmp/agent-trace-doctor-0.1.0.tgz
trace-doctor validate /absolute/path/to/examples/success.jsonl
```

tarball 携带 `dist/src`、`bin/trace`、`schemas` 和 `CHANGELOG.md`，外加 npm 总会放入的
`README.md`、`README.zh-CN.md`、`LICENSE` 和 `package.json`，别无其他：测试、示例、spike 和
TypeScript 源码都留在仓库里。`bin` 条目是 `trace-doctor`，所以安装后的副本会把那个命令放到
安装它的那个项目的 `PATH` 上。

### 持续集成

`.github/workflows/ci.yml` 在 Node 20 和 Node 22 上各跑一遍：`npm ci`、`npm run
typecheck`、`npm test`、`npm run build`、一次构建后 CLI 的冒烟，以及把打包好的 tarball 装进
空目录并从安装后的副本跑一条命令。

它从未运行过。在本包还身处另一个仓库内部时，它在那里是惰性的，因为 GitHub 只从它正在构建的仓
库的根读 workflow；到了本仓库它是活的，第一次执行仍待发生。没有任何人执行过它，所以它证明的是
这些步骤被写下并评审过，不是它们通过。本仓库发布时账户的 GitHub Actions 不可用，所以第一次运行
是一件待办，不是一件已排期的事。

没有 runner 时测得的部分：这棵树在 Node 20.14.0 和 Node 22.23.3 上跑绿 —— `npm ci`、
`typecheck`、全量套件（每条腿 23 个文件 624 个测试）和 `build` 各退 `0`，2026-10-15 在第二台
机器上对着同一个 lockfile 完成 —— 所以 `engines: >=20` 对被测过的这两个版本是实测事实，而不是
意图。Node 26 以及范围内其他任何版本仍未测。更早的一棵树 —— 切片 S14，579 个测试 —— 曾在
Node 20.14.0、22.23.3 和 26.11.1 上跑绿，那是关于那棵树的证据，不是关于这一棵的。至于构建后
CLI 和打包安装这两项：套件直接 import `src/`，所以从没有测试启动过 `dist/` 里的 CLI 或装过
tarball，两项都是手工在 Node 22 上单独核过的。

### 运行 mini agent spike

spike 是 schema 拿真实东西校验的方式。它不是已发布 CLI 的一部分，使用这个工具也不需要它。

```bash
npm run build
./bin/spike-run --out /tmp/spike.jsonl          # 真实运行、真实轨迹、自我校验
./bin/spike-run --out /tmp/spike.jsonl --json   # 运行报告为 JSON
./bin/spike-run --out - --steps 3               # 轨迹打到 stdout，允许三轮
./bin/spike-run --out /tmp/spike.jsonl --keep   # 保留它创建的沙箱
```

`spike-run` 在运行完成且轨迹通过校验时退 `0`，两者任一未成时退 `1`，沙箱准备不了或运行抛错时
退 `2`，报告或轨迹文件写不出时退 `3`，命令行听不懂时退 `64`。

模型是脚本回放，所以一次运行不花钱也不联网。要试真实模型，在 `spike/model.ts` 里实现
`ModelProvider` 并把它传给 `runAgent`：spike 里其他什么都不用改，轨迹格式也不动。

### 重新生成已提交的示例

```bash
./bin/spike-run --out examples/spike-run.jsonl
```

这个文件是一次真实运行，所以它的时间戳和时长每次都变，重新生成的 diff 永远不为空。这是预期
行为。测试断言的是它的结构（事件数、工具集、effect 归类、capture 位置），不是它的字节。

## 边界

- 只读本地文件。从不写入、重命名或修改输入文件，也从不执行其中找到的内容。
- 轨迹文件是不可信输入，schema 就这么写：一个 payload 可能携带这个工具从未听过的字段，这样
  recorder 可以在不升 schema 版本的情况下扩展。这些字段什么都不读。每个计数都来自一个已知事件
  类型的有名字段，所以一个在说 `failed` 的 `status` 旁边加上 `outcome: "completed"` 的
  payload，或者在一个 recorder 未标记为拒绝的失败旁边加上 `refused: true`，什么都推动不了
  —— `tests/injection.test.ts` 把两份轨迹并排放着比较每一个计数。payload 的文字在被复述的地方
  被引用，在任何地方都不被执行。
- 一个被引用事件的 payload 到达模型时，每一个看起来像凭证的值都被替换为 `[redacted]`。规则看
  键名而不是值的形状：当持有它的键名说它是凭证时就扣下 —— `api_key`、`access_token`、
  `authorization`、`password`、`secret` 以及其余，精确匹配或作为 `_` 前缀的后缀匹配，所以
  `openai_api_key` 会被抓住而 `input_tokens` 不会。一个仅仅看起来像密钥、而键名什么都没说的值
  会被发送，模型一节在 `redacted fields` 下报告扣下了多少个值。这是请求边界，且只是请求边界：
  本地报告不受影响，因为拥有这个文件的工程师才是唯一有权读它的人，而 `show` 仍然完整打印那个值。
- 每一个任务陈述和系统提示都说，被引用的 payload 是一次运行记录的数据，不是给模型的指令，并且
  读起来像指令的文字是要报告的内容而不是要遵循的指令。这是一个声明出来的边界，不是保证：模型
  仍可能被误导，所以每条结论都必须引用轨迹中真实存在的事件 id，做不到就被整体拒绝。
- 每个命令把报告写到 stdout，此外什么都不写。`eval-gen --out DIR` 是唯一的例外：它在 `DIR` 内
  写一个 JSON 文件，以 run id 命名，目录缺失时会创建，并且拒绝替换已存在的文件，除非传了
  `--force`。没有 `--out` 时它什么都不写，这让普通命令成为同一件事的干跑。文件里装的是两种模式下
  都相同的确定性报告：`--model` 把结论加到 stdout 报告上，从不加到文件里，因为一个用例文件对
  同一份轨迹必须是同样的字节，无论模型对它说了什么。
- `explain`、`compare`、`eval-gen` 和 `fix-suggest` 不带 `--model` 时是本地且确定的：不联网、
  不需要 API key、不看时钟，同一个文件总是产出同样的字节。
- `--model` 是本仓库唯一的网络路径。不输入它就不启用，它只发一个请求且从不重试，它发送任务陈述、
  答案契约、观察，以及这些观察引用的事件。除此之外什么都没有：不是文件，不是整份轨迹，也不是任何
  观察不指向的事件。轨迹文件自己的路径会被排除，除非传了 `--send-paths`。
- API key 从 `OPENAI_API_KEY` 读取，并作为 bearer 头传输。它从不被写进文件，从不被回显，也不出现
  在任何报告和任何测试 fixture 里。
- 模型答案会对着发过去的同一份契约被检查，引用了轨迹中不存在的事件 id 的结论会被整体拒绝。
- `diff` 没有模型半边。它比较事件而不是失败画像，所以 `--model` 在它上面是未知选项，而不是一个被
  接受然后被忽略的旗标，因为一个不接受模型的命令不能看起来像是接受的。
- 只接受 schema 版本 `1`。不尝试读取任意 JSONL。
- 打包好的 tarball 只携带 `dist/src`、`bin/trace`、`schemas` 和 `CHANGELOG.md`。安装后的副本只有
  CLI：测试、示例、spike 和源码都留在仓库里，`--model` 的行为与在这里完全一致。
- 一个轨迹文件可能含有敏感数据。分享前检查一遍，把它传给模型前再检查一遍。

## 尚未决定

- 实时模型路径从未被调用过。每个模型测试都对着一个本地 stub 服务器说话，所以请求形状是对着 stub
  验证的，不是对着端点验证的。第一次真实调用花掉的是用户的额度，那一跳归用户。

schema 还没有的字段，因为还没有任何东西用过它们：`trace.dropped` /
`trace.drop_reason`（我们的 recorder 从不丢弃事件）、`estimated_cost_usd` 和 `cost_status`
一类的成本字段（spike 模型没有成本），以及 `role: "main"` 之外的多 slot 归属（spike 只跑一个
模型）。完整清单和每一条为什么缺席而不是被猜出来，见 `spike/SCHEMA_REVIEW.md`。

## 许可

Apache License, Version 2.0。全文在本仓库根目录的 `LICENSE` 里，npm 会把它带进每一个打包副本。
版权行署的是这个项目的贡献者，而不是任何雇主：谁在维护这个公开仓库，已经由每一个 commit 和
tag 的 author、committer 与 tagger 承载，而那正是一处身份必须精确的地方。

## 仓库里有什么

| 路径 | 它是什么 |
|---|---|
| `schemas/trace.schema.json` | 单个轨迹事件（即一行 JSONL）的 JSON Schema（draft 2020-12）。只接受 schema 版本 `1`。 |
| `examples/success.jsonl` | 合成的一次成功运行：19 个事件，`run_01`。 |
| `examples/failed.jsonl` | 合成的一次失败运行：26 个事件，`run_02`。含一次护栏拒绝、一次真实工具失败、一次限流后的模型重试，以及一个失败的最终状态。 |
| `examples/cancelled.jsonl` | 合成的一次在权限被拒后取消的运行：8 个事件，`run_03`。 |
| `examples/spike-run.jsonl` | **一份真实轨迹**，不是合成的。mini agent spike 在 2026-10-14 的输出：22 个事件，`run_spike_05`，五轮模型、四次工具调用、一次被批准的权限。它的时间戳和时长是真实墙上时钟值，所以跨运行不是字节稳定的。 |
| `tests/` | Vitest 套件（624 个测试）：示例通过 schema 校验、跨行不变量成立、schema 拒绝畸形事件、loader 带着行号报告每一种不可读输入、CLI 把每种情况映射到它文档写明的退出码、分析器手工复现示例并保持字节稳定，diff 手工复现示例并保持字节稳定。spike 套件覆盖 recorder 不变量、沙箱、五步循环、每一个 `spike-run` 退出码，以及已提交示例的结构，并断言那个示例仍然匹配产出它的代码、一次运行不在身后留下临时目录。explain 套件覆盖观察顺序与证据绑定、摘录上限、确定性注记，以及整份报告的字节稳定性，并把本 README 展示的终端输出与命令实际打印的比对。模型套件检查答案契约，包括引用了轨迹中不存在的事件 id 的结论被拒绝，并对着一个本地 stub 服务器发真实 HTTP 请求，证明成功、非 2xx、无内容、畸形答案、连接被拒和超时这几条路径。show 套件钉住 `show` 与 `timeline` 对每个示例的每个事件报告同样的行、步、偏移和描述，payload 带着键序存活，以及本 README 展示的终端输出就是命令实际打印的。tools 套件手工核对每个示例的计数，两个方向覆盖未解析的算术、guard 与 effect 分布、声明 / 未用 / 未申报的拆分、行与分布排序、没有工具名的工具调用归哪个桶，并把本 README 展示的终端输出与命令实际打印的比对。errors 套件手工核对每个示例的失败计数，两个方向覆盖拒绝拆分、只在 `error.recorded` 上算致命、没有这类字段的事件类型上为 null 的旗标、工具 / 模型拆分、类别与出现次序、两个方向的悬空引用检查、没有错误类别的失败归哪个桶，并把本 README 展示的终端输出与命令实际打印的比对。compare 套件两个方向手工核对两对示例，钉住一次状态变化算一处差异这样一次取消才不是全线放行、两次干净但无关的运行比较为相同、组成上的同数变化带着原因报为 shifted、行排序规则、从未出现的类别的空侧、每个计数器与 `errors` 和 `tools` 报告的对账、两种输出模式的稳定键序、逐对字节稳定，并把本 README 展示的终端输出与命令实际打印的比对。compare-model 套件钉住每个观察都锚在它点名的那一侧的真实事件上、那一侧没有事件时就地留空而不是无证据地陈述、被引用的事件恰好就是被引的那些并带各自的侧、除非给了 `--send-paths` 否则两个文件路径都不出现、超过 `--max-excerpt` 的事件被点名而不是丢弃、裸事件 id 作为证据被拒而带侧限定的被接受、一次失败的尝试保留确定性报告、一次被跳过的调用被记为无操作而不是失败。CLI 套件对着一个本地 stub 服务器发真实 HTTP 请求，证明 compare 请求的 payload、结论、无 key 与坏证据的退出码，以及 `diff` 仍然拒绝 `--model`。eval-gen 套件手工核对真实轨迹的用例数，钉住一个用例引用的每次出现就是 `errors` 对同一事件报告的那个出现、一个每次出现都是拒绝的类别不产用例而是被点名、两者都有的类别只留真实失败并从它们而不是从前面那次拒绝取首末行、工具与来源分布、每个计数器与 `errors` 报告的对账、两种输出模式的稳定键序、字节稳定，以及本 README 展示的终端输出与命令实际打印的比对。case-writer 套件覆盖一个 run id 产出的文件名，包括一个 run id 能以各种方式命名给定目录之外路径的每一种情况，以及目录创建、拒绝覆盖、强制替换和目录不可写这条路径。fix-suggest 套件手工核对真实失败轨迹的建议清单和被取消那次的权限拒绝，钉住规则顺序这样一个没有终止事件的文件先建议它自身的不完整、一个类别只在两次及以上出现时才被称为 repeated、一个类别的致命出现被单独建议而同一类别仍算 repeated、一次被拒的调用与一次失败的分开计数并在依据中点名、工具排序、批准与拒绝的权限拆分、每个被引用的事件都是文件在 `errors` 报告的那个行上真实携带的、两种输出模式的稳定键序、字节稳定，以及本 README 展示的终端输出与命令实际打印的比对。fix-suggest-model 套件钉住每个观察都锚在它复述的那条建议的真实事件上并逐字引用那条建议自己的动作动词、被引用的事件恰好就是被引的那些其中一个被两条规则引用的事件只引一次、除非给了 `--send-paths` 否则文件路径不出现、超过 `--max-excerpt` 的事件被点名而不是丢弃、一条证据不带 id 的建议被复述而不是丢弃、无论模型半边加什么确定性半边都逐字节不变、无模型注记永远到不了一份为模型调用构建的报告、一次失败的尝试保留建议、一次被跳过的调用被记为无操作而不是失败。CLI 套件对着一个本地 stub 服务器发真实 HTTP 请求，证明 fix-suggest 请求的 payload、结论、无 key、坏证据和空答案的退出码，以及对一份无可建议的轨迹根本不发请求。package 套件钉住 manifest：`src/` 的每一个运行时 import 都声明在 `dependencies` 而不是 `devDependencies` 里、打包面恰好是构建后的 CLI、它的入口脚本和随包的 schema，以及定下来的命令名作为 `bin` 条目发布而 manifest 不再声明自己是私有的。redact 套件钉住哪些键被扣下哪些没有、一个 payload 的形状存活、一个仅仅看起来像凭证而键名什么都没说的值仍被发送、一个嵌得比遍历深度更深的一整个子树被扣下而不是被遍历，以及没有任何随包示例带有一个规则触及的字段。模型套件还钉住每一个任务陈述和系统提示都声明被引用的 payload 是数据而不是指令。explain 套件还钉住摘录丢掉看起来像凭证的值并计数、这个计数同时到达报告和请求，而加载进来的事件保留它们。injection 套件构建一份其 payload 被写成要被服从的轨迹，并证明三件事：文字变得敌意而不是中性、或未知字段断言与已声明字段相反时，没有任何计数和退出码移动；无论 payload 说什么，请求的指令位置都保持编译期常量；以及一个照着 payload 要求做的答案仍被整体拒绝。 |
| `package.json`、`tsconfig.json`、`.gitignore` | TypeScript / Node 项目骨架。`files` 把打包面钉在 `dist/src`、`bin/trace`、`schemas` 和 `CHANGELOG.md`；`ajv` 和 `ajv-formats` 是运行时依赖，`devDependencies` 下的其余都只用于构建或测试。 |
| `LICENSE` | Apache License, Version 2.0 全文，版权行已填。无论 `files` 怎么写，npm 都会把它带进打包副本。 |
| `README.zh-CN.md` | 中文 README。命令、退出码、边界与本文件逐条一致。 |
| `.github/workflows/ci.yml` | 面向发布树的持续集成：Node 20 和 Node 22，各跑一遍安装、类型检查、套件和构建，然后是两项没有测试会做的检查。它在本仓库里是活的，但从未执行；在本包还身处另一个仓库内部时，它在那里是惰性的，因为 GitHub 只从它构建的仓库的根读 workflow。 |
| `RELEASE_NOTES.md` | `v0.1.0` 的发布说明：测了什么、在哪个解释器上、哪一天测的，以及没测什么。它记录这棵树所随发布的那个版本，以及那个发布不证明什么。 |
| `ASSETS.md` | 发布树候选的资产清单：这棵树携带什么，测出来的而不是断言的 —— 文件数与种类、两个非 ASCII 的文件、零个任何种类的二进制、文本文件里每一个外部 URL 及其性质 —— 外加什么被排除、为什么，以及哪些门禁仍然开着。它描述的那棵树就是本仓库已发布的树，文件也这么说。 |

切片 S1 加入的 loader、validator 和 `validate` 命令：

| 路径 | 它是什么 |
|---|---|
| `src/loader.ts` | 读一个 JSONL 文件，按严格 UTF-8 解码，并带着行号报告不可读的文件、空文件、字节序标记和非 JSON 行。 |
| `src/schema.ts` | 编译随包的 schema，或用 `--schema` 传入的那个。拒绝另一种方言的 schema，而不是误读它。 |
| `src/validate.ts` | 每个事件的 schema 错误加上跨行不变量，合成一份排好序的报告。 |
| `src/report.ts` | 那份报告的终端文本与 `--json` 渲染。 |
| `src/cli.ts` | 参数处理与退出码。 |
| `bin/trace` | 入口。需要先 `npm run build`；`dist/` 是生成的，从不提交。 |

切片 S2 加入的分析器，以及两个读轨迹而不是检查轨迹的命令：

| 路径 | 它是什么 |
|---|---|
| `src/analyze.ts` | `summarize`（一份汇总报告）和 `buildTimeline`（一个事件一行），外加每种事件类型渲染成的那一行描述。加载后事件上的纯函数：不看时钟、不碰文件系统、不联网。 |

切片 S3 加入的两份轨迹比较：

| 路径 | 它是什么 |
|---|---|
| `src/diff.ts` | `diffTraces`：按事件 id 对齐两份轨迹，把运行身份、汇总计数器和逐事件字段差异报成一份稳定报告。加载后事件上的纯函数，像分析器一样。 |

切片 S5 加入的模型层，以及那个可能用到它的命令：

| 路径 | 它是什么 |
|---|---|
| `src/explain.ts` | `buildObservations`、`buildExcerpt`、`buildExplainDraft` 和 `withModelResult`：把一份校验过的轨迹归约为绑定证据的观察，构建一个模型可以看的最小摘录，并把一次模型尝试折进报告。加载后事件上的纯函数，像分析器和 diff 一样。 |
| `src/model/types.ts` | 模型层的类型：一个结论是什么、一次尝试报告什么，以及一次请求的确切形状。 |
| `src/model/contract.ts` | 任务陈述与答案契约。同一个契约对象发给模型，也编译出来检查返回的东西。 |
| `src/model/config.ts` | 从旗标和环境解析模型名、端点、超时和摘录上限。不读写任何配置文件。 |
| `src/model/openai.ts` | `OpenAICompatibleClient`，实现的唯一后端：`fetch` 上的 OpenAI chat-completions 方言，一个请求，从不重试。它发送请求所携带的任务陈述，而不是自己挑一个，所以给模型的那句话只存在于一处。 |
| `src/model/answer.ts` | 解析一个答案，对着契约检查它，并拒绝引用了轨迹中不存在的事件 id 的结论。 |

切片 S6 加入的单个事件全貌：

| 路径 | 它是什么 |
|---|---|
| `src/show.ts` | `buildShow`：一个事件或全部事件，带它的行号、模型轮步、偏移、类型、`timeline` 打印的那行描述，以及 recorder 写下时的 payload。 |
| `src/analyze.ts` 里的 `annotateEvents` | 每一份逐事件报告都需要的位置事实。从 `buildTimeline` 中抽出，这样 `timeline` 和 `show` 不可能对一个事件在哪里的问题给出两种答案。 |

切片 S7 加入的逐工具视图：

| 路径 | 它是什么 |
|---|---|
| `src/tools.ts` | `buildTools`：一个工具一行，带它的调用、完成与失败计数，拦下失败的 guard，完成的调用留下的 effect，以及它出现的行和事件 id，外加这次运行声明的工具集和其中哪些没被用。加载后事件上的纯函数，像分析器、diff 和 `show` 一样。 |

切片 S8 加入的逐失败视图：

| 路径 | 它是什么 |
|---|---|
| `src/errors.ts` | `buildErrors`：每个错误类别带它的计数、产出它的事件类型和它出现的行与事件 id，然后是每一次单独出现，带它的事件 id、关联事件 id、工具或模型和消息，外加任何指向文件不携带的事件的 `related_event_id`。加载后事件上的纯函数，像分析器、diff、`show` 和 `tools` 一样。 |
| `src/analyze.ts` 里的 `readRunOutcome` | 运行状态与终止事件 id，从 `summarize` 中抽出，这样 `errors` 和 `summary` 不可能对一次运行怎么结束给出两种答案。 |
| `src/analyze.ts` 里的 `Distribution`、`byCountThenValue`、`distribution`、`bumpCount` | 分布原语，从 `src/tools.ts` 移出，这样 `tools` 和 `errors` 按同一条规则排它们的分布，而不是各按一条。 |

切片 S9 加入的两份失败画像比较：

| 路径 | 它是什么 |
|---|---|
| `src/compare.ts` | `buildCompare`：两份轨迹的失败画像并排，运行状态与失败合计带它们的差，每个错误类别和每个失败工具各带它在两份轨迹里的计数。每一侧都由 `buildErrors` 和 `buildTools` 聚合，所以没有计数器被重算，也没有一个能与拥有它的命令不一致。加载后事件上的纯函数，像其他每个读轨迹的东西一样。 |
| `src/cli.ts` 里的 `parseTwoFileArgs` | 两文件参数形状，由 `diff` 和 `compare` 共用：同样的解析，只有报告不同。 |

切片 S10 加入的 `compare` 模型半边：

| 路径 | 它是什么 |
|---|---|
| `src/compareModel.ts` | `buildCompareObservations`、`buildCompareExcerpt`、`buildCompareDraft`、`withCompareModelResult`、`withSkippedModel` 和 `withoutModel`：把两份失败画像之间移动了什么复述为带侧锚定的观察，构建一个模型可以看的最小摘录，并把一次尝试折进报告。加载后事件与一份已构建的 `CompareReport` 上的纯函数，像其余的一样。 |
| `src/cli.ts` 里的 `parseCompareArgs` | `compare` 自己的参数解析器：两文件形状加模型旗标，而 `diff` 刻意不接受后者。 |

切片 S11 加入的第一个会写文件的命令：

| 路径 | 它是什么 |
|---|---|
| `src/evalGen.ts` | `buildEvalGen` 和 `readInputSummary`：一份轨迹的失败被复述为回归用例，一个错误类别一个，每个带上它依赖的那些出现。从 `errors` 报告构建而不是再从事件构建，所以用例里没有一个计数器能与拥有它的命令不一致。纯函数，像其他每个读轨迹的东西一样。 |
| `src/caseWriter.ts` | `caseFileName` 和 `writeCaseFile`：本项目写文件的唯一一处。名字来自 `run_id`，但逃不出给它的那个目录，一个已存在的文件除非被要求 `force` 否则永不被替换，每一个失败都以一条 CLI 能打印的消息回来。 |
| `src/validate.ts` 里的 `reportForWriteFailure` | 「产出了但没送达」的输出所用的报告形状，与 `reportForInputFailure` 分开保留，因为两者想要人对它们做的事不同。 |
| `src/cli.ts` 里的 `parseEvalGenArgs` | `eval-gen` 自己的参数解析器：单文件形状加 `--out` / `--force` 这一对，没有别的命令接受。 |

切片 S12 加入的 `eval-gen` 模型半边：

| 路径 | 它是什么 |
|---|---|
| `src/evalGenModel.ts` | `buildEvalGenDraft`：`eval-gen` 的模型半边，确定性用例与加载后事件上的纯函数。把每个用例变成一个观察，并引用这个用例依赖的事件而不是整个文件。`withoutEvalGenModel`、`withEvalGenModelResult` 和 `withEvalGenSkippedModel` 把一次尝试挂到报告上，或记录没有发出过请求。 |
| `src/report.ts` 里的 `renderEvalGenModelText` / `renderEvalGenModelJson` | `eval-gen --model` 的两种渲染。确定性的用例块与无模型渲染器共用，这样两者不可能漂移。 |

切片 S13 加入的最后一个计划命令的确定性半边：

| 路径 | 它是什么 |
|---|---|
| `src/fixSuggest.ts` | `buildFixSuggest`：一份轨迹自己的记录指向的候选方向，一条规则一条建议，每条带上它依赖的事件和它没有证明的东西。从 `errors` 报告构建而不是再从事件构建，所以建议里没有一个计数能与拥有它的命令不一致；那两条不关于失败的规则直接读事件，用的是分析器计数它们时用的同一个谓词。纯函数，像其他每个读轨迹的东西一样。 |
| `src/cli.ts` 里的 `parseFixSuggestArgs` | `fix-suggest` 自己的参数解析器：单文件形状加模型旗标，此外什么都没有。没有 `--out`，因为这个命令不写文件，所以它仍是未知选项，而不是被接受然后被忽略。 |

切片 S14 加入的 `fix-suggest` 模型半边：

| 路径 | 它是什么 |
|---|---|
| `src/fixSuggestModel.ts` | `buildFixSuggestDraft`：`fix-suggest` 的模型半边，确定性报告与加载后事件上的纯函数。把每条建议复述为一个观察，逐字引用它自己的动作动词，并构建恰好由这些建议引用的事件组成的摘录。轨迹没有产出建议时不增加请求。 |
| `src/report.ts` 里的 `renderFixSuggestModelText` / `renderFixSuggestModelJson` | `fix-suggest --model` 的两种渲染。确定性的头部和建议块与无模型渲染器共用，这样两者不可能漂移。 |

切片 S4 加入的 mini agent spike，以及它逼出来的 schema 修订。spike 是开发工具，不属于已发布的 CLI。

| 路径 | 它是什么 |
|---|---|
| `spike/SCHEMA_REVIEW.md` | 第一份真实轨迹表达不了什么、因此改了什么、还有什么仍然没被用过。改 schema 之前先读这个。 |
| `spike/recorder.ts` | `TraceRecorder`：分配事件 id，保持时间戳不降，持有一个 run id，是唯一知道一个事件的线上形状的模块。时钟和行写入器都是注入的。 |
| `spike/model.ts` | `ModelProvider`，真实模型接入的缝，外加 `ScriptedModel`，一个固定计划的确定性回放。不联网、不需要 API key、没有成本。 |
| `spike/tools.ts` | 一个沙箱化的工具集（`list_dir`、`read_file`、`write_file`，以及一个刻意不可用的 `fetch_url`）。每个工具只声明一次它的 effect 归类；沙箱把路径逃逸作为 `path_escape` 拒绝。 |
| `spike/agent.ts` | 五步循环：在每个副作用前后记录，写之前先请求权限，并回答未知和被扣下的工具而不是死掉。 |
| `spike/cli.ts`、`bin/spike-run` | `spike-run --out FILE`，跑这个循环、写出轨迹，并在报告成功之前用这个工具自己的 validator 校验它。 |

切片 S17 加入的模型层请求边界：

| 路径 | 它是什么 |
|---|---|
| `src/model/redact.ts` | `redactPayload` 和 `isSecretKey`：在一个 payload 被引用之前按键名（而不是按值的形状）扣下看起来像凭证的值，并计数替换了几个。也限制遍历深度，因为 `JSON.parse` 接受比一次递归遍历扛得住的更深的嵌套。 |
| `src/model/contract.ts` 里的不可信数据声明 | 每一个任务陈述和系统提示现在都说，被引用的 payload 是一次运行记录的数据，不是指令，并且其中一个读起来像指令的文字是要报告的内容。由 `tests/model.test.ts` 钉住；行为那一半在 `tests/injection.test.ts`。 |
| `tests/redact.test.ts` | 这条规则、它文档写明的限制、深度上限，以及没有任何随包示例触及它这个事实。 |

切片 S18 加入的抗注入套件：

| 路径 | 它是什么 |
|---|---|
| `tests/injection.test.ts` | 构建一份其 payload 被写成要被服从的轨迹，并证明关于它的三件事：文字变得敌意而不是中性、或未知字段断言与已声明字段相反时，没有任何计数和退出码移动；无论 payload 说什么，请求的指令位置都保持编译期常量；以及一个照着 payload 要求做的答案仍被整体拒绝。 |

前三个示例是合成的。它们不含真实会话数据、不含私有路径、不含模型输出。`examples/spike-run.jsonl`
是例外：它是 mini agent spike 对着一个一次性沙箱真实跑一次的输出。它不含任何真实用户的会话数据，
也不含模型输出，因为它的模型是脚本回放。

## 轨迹格式

一个轨迹文件是 JSONL：UTF-8，一行一个 JSON 对象，一个事件一行。

每个事件都必须有的基础字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema_version` | string，const `"1"` | 只接受 `1`。 |
| `event_id` | string，`^evt_[0-9]{6}$` | 由 recorder 生成，在一个文件内唯一。不从任何上游系统读取。 |
| `timestamp` | string，RFC 3339 | 在一个文件内不得递减（由 validator 检查，这一点无法在 schema 里表达）。 |
| `type` | string 枚举 | 选择 payload 契约。十四个取值，下面列出。 |
| `run_id` | string | 把一次运行的事件归成一组。版本 `1` 的文件恰好携带一个 `run_id`。 |
| `payload` | object | 类型专属字段。每种事件类型都必填。 |

未知的顶层字段会被拒绝。`payload` 内部的未知字段被允许，这样 recorder 可以在不升 schema 版本
的情况下扩展；已知字段保持它们的类型。

### 事件类型与 payload 契约

| 类型 | 必填 payload 字段 | 选填 payload 字段 |
|---|---|---|
| `run.started` | `input_summary` | `config_summary` |
| `run.finished` | `status`（`"completed"`） | `output_summary` |
| `run.failed` | `status`（`"failed"`）、`error` | `output_summary` |
| `run.cancelled` | `status`（`"cancelled"`） | `reason` |
| `model.request.started` | `model` | `messages`、`role`、`slot_label` |
| `model.response.completed` | `model`、`usage`、`duration_ms` | `finish_reason`、`role`、`slot_label`、`streamed`、`capture`、`output_summary` |
| `model.response.failed` | `model`、`error` | `duration_ms` |
| `tool.call.started` | `tool` | `tool_call_id`、`args_summary` |
| `tool.call.completed` | `tool`、`status`（`"completed"`）、`duration_ms` | `result_bytes`、`result_truncated`、`effect_disposition` |
| `tool.call.failed` | `tool`、`status`（`"failed"`）、`error`、`duration_ms` | `guard`、`guardrail_refusal`、`result_bytes` |
| `permission.requested` | `action` | `resource`、`tool` |
| `permission.resolved` | `decision`（`"approved"` \| `"denied"`） | `decided_by` |
| `context.compacted` | `strategy` | `before_messages`、`after_messages`、`before_tokens`、`after_tokens` |
| `error.recorded` | `error` | `fatal`、`related_event_id` |

共享形状：`error` 是 `{type, message}`，两个字段都必填且没有额外字段。`usage` 要求
`input_tokens` 和 `output_tokens`，选填携带 `cache_read_tokens`、`cache_write_tokens` 和
`reasoning_tokens`。

`run.started` 上的 `config_summary` 是一个放运行配置的开放对象。本项目写入的键是 `model`、
`max_steps` 和 `tools`，其中 `tools` 的每一项是 `{name, schema_hash, available}`。
`available: false` 记录一个存在过但对模型扣下了的工具，这是一个轨迹能解释某个工具为什么
从未被调用的唯一方式。工具的 schema 被哈希而不是被内联。

有两个 payload 字段值得说明，因为它们来自读一个真实 agent 实现如何记录工具结果：

- `guard`（`tool.call.failed`）说的是*为什么*一次调用在做它的活之前就被拦下了（`loop_block`
  表示重复调用断路器，`denylist` 表示被拦的路径，`path_escape` 表示 recorder 沙箱之外的路径，
  等等）。前七个取值来自逆向一个可比的 agent 实现；`path_escape` 是 mini agent spike 加的，
  它的沙箱产出的正是这一类。缺失表示这次调用跑了，并按它自己的条件失败。
- `guardrail_refusal`（`tool.call.failed`）把一个拒绝标记为一次有意的拦截。消费者不得把拒绝
  计成工具错误，否则断路器会吃自己的拒绝。`examples/failed.jsonl` 含一次拒绝和两次真实失败，
  这样这个区分是可测的。

还有三个字段是一次真实的五步运行暴露出「轨迹回答不了读者显然会问的问题」之后加的。每一条的
理由在 `spike/SCHEMA_REVIEW.md`。

- `effect_disposition`（`tool.call.completed`）对一次只读调用是 `none`，调用完成且其副作用已
  就位时是 `applied`，调用没有干净完成因而副作用可能在也可能不在时是 `unknown`。缺失表示
  recorder 没有给它的工具分类。
- `capture`（`model.response.completed`）说的是响应体住在哪里：`inline`（摘要就在这个事件里）、
  `inline_from_stream`，或 `db_ref`。缺失表示 recorder 没有留体，这对于一个只调了工具没产出
  文字的轮次也是正确的读法。
- `role` 和 `slot_label`（`model.request.started` 和 `model.response.completed`）标识一轮属于
  哪个模型槽位：`main`、`reference` 或 `aggregator`，外加一个自由标签。单模型运行记录 `main`。
  `streamed` 报告响应是否是增量到达的。

截断永远是显式的：`result_truncated: true` 加上 `result_bytes`。一个 recorder 绝不许静默丢弃
结果内容。`result_bytes` 是工具产出的完整结果体的大小，在截断之前：它度量的是结果，不是工具
作用于的那个东西，所以一个写工具报告的是它的确认信息的大小，而不是它写下的字节数。
