# 中文算力情报证据服务

该服务帮助研究与产业团队整理中文算力及人工智能资讯中的量化事实。每项候选事实保留原文位置、来源文章和抽取时的文章版本，分析人员可以复核候选项、处理口径冲突，并生成带证据定位的简报。

## 环境与命令

运行环境为 Node.js `22.23.4`。业务流程使用 Node 内置 HTTP 与 SQLite 模块，TypeScript 编译器及 Node 类型定义由锁文件固定。安装依赖后可运行：

```sh
npm test
npm run build
npm run demo
```

演练读取 `fixtures/compute-brief.json` 中的本地合成文章，在临时数据库中完成导入、复核和简报生成。正式服务使用 `INTELLIGENCE_DB` 指定数据库文件，默认值为 `./var/intelligence.sqlite`。可通过 `HOST` 与 `PORT` 设置监听地址，默认仅绑定 `127.0.0.1:8090`。

## HTTP 接口

- `POST /v1/documents` 导入或修订一篇文章，正文包含 `id`、`title`、`sourceUrl`、`publishedAt` 和 `body`。
- `GET /v1/documents?limit=50&offset=0` 分页浏览当前文章版本和待复核候选数量。
- `GET /v1/documents/:id` 查看文章当前版本及其抽取候选项。
- `GET /v1/observations?decision=pending` 按复核状态查找当前有效候选项。
- `GET /v1/review-queue?limit=100&offset=0` 按待处理冲突和上下文缺项排列复核队列，并返回分页位置。
- `GET /v1/observations/:id/context` 查看原文邻句和同指标的其他当前来源。
- `POST /v1/observations/:id/review` 提交复核决定，并携带 `expectedRevision`、`decision` 与 `reviewer`。
- `PATCH /v1/observations/:id/candidate` 校订抽取候选项；每次改动都会保留前后版本并回到待复核状态。
- `GET /v1/observations/:id/history` 查看复核事件历史。
- `GET /v1/conflicts` 查看当前有效材料中的未解决口径冲突。
- `POST /v1/briefs` 生成并保存简报，可选传入 `topic` 与 `since`。
- `GET /v1/briefs/:id` 读取简报及其是否因后续导入或复核而过期。
- `GET /health` 返回服务与数据库状态。

候选事实包括指标名称、主体、数值、单位、时间、范围、来源归属、原句字符区间和上下文完整度提示。来源没有说明某个条件时，字段保持未知；提示只指出缺项，不替分析人员补写事实。文章更正会创建新版本，旧版本仍可用于追溯，但不再参与当前冲突判断。未解决冲突不会作为确定事实发布。对旧修订号提交复核会返回冲突错误。

## 持久化

SQLite 保存文章版本、事实观察、复核事件和简报快照。每次文章修订、复核决定和简报生成均在事务中更新工作区修订号；已保存简报会据此显示新鲜或过期状态。数据库目录由使用者负责设置访问权限和备份策略。

仓库样本为本地合成内容，不代表真实机构统计或报道原文。服务不会访问新闻网站，也不会调用在线模型。
