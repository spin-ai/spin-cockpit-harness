/**
 * electron-builder afterPack：保证 node-pty 的 spawn-helper 在打包产物里仍可执行。
 *
 * 不给 +x 时终端创建会直接失败：`terminal:create: Error: posix_spawnp failed.`
 * （源 checkout / CI 缓存里的权限位经常是 644）。
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const exe = context.packager?.appInfo?.productFilename;
  // macOS 的 appOutDir 下才是 .app 目录
  const appPath = context.electronPlatformName === "darwin" ? path.join(appOutDir, `${exe}.app`) : appOutDir;
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, "fix-pty-perms.mjs"), "--app", appPath], { encoding: "utf8" });
    process.stdout.write(out);
  } catch (err) {
    console.warn(`[after-pack] pty perms: ${String(err?.message || err)}`);
  }
};
