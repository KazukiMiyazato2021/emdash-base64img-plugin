---
title: spikes
tags:
  - spike
---

# spikes

> [!warning] ここに置いたコードはコミットしない
> `spikes/` はスパイク(使い捨ての検証)の作業場所。`.gitignore` で、この README 以外を git 管理から外している。

- 1 つのスパイクにつき 1 つのディレクトリを作る(例: `spikes/canvas-webp/`)。
- 結果は、スパイクのタスクノート(`tasks/T05-*.md` など)の「結果」に、根拠レベル付きで書く。
- 再現に必要なコードは、`docs/` の知見ノートにコードブロックで載せる。
- スパイクで独自の `package.json` を使う場合は、そのディレクトリの中で `npm install` する。ルートの workspaces には含めない。
