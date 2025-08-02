export const store = {
  cmd: "",
  result: "",
  expiresAt: 0, // タイムスタンプ（UNIX秒）で保持
  timeoutSec: 60, // コマンド有効期限（秒）
};
