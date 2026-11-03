'use strict';
/**
 * Windows 打包脚本（electron-packager → dist/BiliFound-win32-x64/BiliFound.exe）
 *
 *   node tools/build-win.js            # 打包
 *   node tools/build-win.js --zip      # 打包并把产物压成 zip
 *
 * 依赖：
 *   - node_modules/electron 已就位（Electron 38.8.6 win32-x64）
 *   - Electron 的官方 zip 放在仓库外的缓存目录（默认 E:\ai\杂\Za New\BiliFound\.electron-cache），
 *     走 electronZipDir 复用，避免再下一次 100MB
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'dist');
const ZIP_DIR = process.env.BILIFOUND_ELECTRON_ZIP_DIR
  || path.resolve(ROOT, '..', '.electron-cache');

const packager = require('electron-packager');

// 版本号统一从 package.json 读，避免打包产物和 exe 资源里的版本对不上
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const ignore = [
  /^\/build($|\/)/,
  /^\/tools($|\/)/,
  /^\/dist($|\/)/,
  /^\/dist-installer($|\/)/,
  /^\/docs($|\/)/,
  /^\/\.npm-cache($|\/)/,
  /^\/\.eb-cache($|\/)/,
  /^\/\.electron-cache($|\/)/,
  /^\/\.probe-profile($|\/)/,
  /^\/node_modules\/electron($|\/)/,
  /^\/node_modules\/electron-packager($|\/)/,
  /^\/node_modules\/electron-builder($|\/)/,
  /^\/node_modules\/app-builder-lib($|\/)/,
  /^\/node_modules\/dmg-builder($|\/)/,
  /^\/node_modules\/\.bin($|\/)/,
  /npm-install\.log$|probe\.log$|smoke\.log$|eb\d*\.log$|zipfinal\.log$/,
];

async function main() {
  const zip = path.join(ZIP_DIR, `electron-v38.8.6-win32-x64.zip`);
  if (!fs.existsSync(zip)) {
    console.warn(`[warn] 没找到 Electron zip：${zip}`);
    console.warn('       会走在线下载（需要网络），或设置 BILIFOUND_ELECTRON_ZIP_DIR 指向 zip 所在目录');
  }
  fs.mkdirSync(OUT, { recursive: true });

  const [appPath] = await packager({
    dir: ROOT,
    out: OUT,
    name: 'BiliFound',
    platform: 'win32',
    arch: 'x64',
    icon: path.join(ROOT, 'build', 'icon.ico'),
    appVersion: VERSION,
    appCopyright: 'Copyright © 2026 styzn',
    win32metadata: {
      CompanyName: 'styzn',
      FileDescription: 'BiliFound · 哔哩哔哩桌面客户端',
      ProductName: 'BiliFound',
      InternalName: 'BiliFound',
      OriginalFilename: 'BiliFound.exe',
      ApplicationUserModelId: 'com.styzn.bilifound',
    },
    overwrite: true,
    prune: true,
    asar: false,
    electronZipDir: fs.existsSync(zip) ? ZIP_DIR : undefined,
    ignore,
    verbose: true,
  });

  console.log(`\n[done] ${appPath}`);
  const exe = path.join(appPath, 'BiliFound.exe');

  // build/ 整体不进包（里面有测试截图），但运行时要用图标：复制到包内 assets/
  const appAssets = path.join(appPath, 'resources', 'app', 'assets');
  fs.mkdirSync(appAssets, { recursive: true });
  for (const name of ['icon.ico', 'icon.png']) {
    const from = path.join(ROOT, 'assets', name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(appAssets, name));
  }

  // 面向用户的说明文件放到 exe 旁边
  const readme = path.join(ROOT, 'docs', '使用说明.txt');
  if (fs.existsSync(readme)) fs.copyFileSync(readme, path.join(appPath, '使用说明.txt'));

  console.log(`[done] ${exe}  ${(fs.statSync(exe).size / 1024 / 1024).toFixed(1)} MB`);

  // 资源自检：图标相关文件、app 源码、hls.js 必须在包里
  const required = [
    'resources/app/main.js',
    'resources/app/renderer/index.html',
    'resources/app/renderer/app.js',
    'resources/app/node_modules/hls.js/dist/hls.min.js',
    'resources/app/assets/icon.ico',
    'resources/app/assets/icon.png',
  ];
  for (const rel of required) {
    const p = path.join(appPath, rel);
    console.log(`${fs.existsSync(p) ? '[ok]  ' : '[missing]'} ${rel}`);
  }

  if (process.argv.includes('--zip')) {
    const zipOut = path.join(OUT, `BiliFound-${VERSION}-win32-x64.zip`);
    if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut);
    console.log('\n[zip] 正在压缩…');
    execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Compress-Archive -Path '${appPath}\\*' -DestinationPath '${zipOut}' -CompressionLevel Optimal`,
    ], { stdio: 'inherit' });
    console.log(`[zip] ${zipOut}  ${(fs.statSync(zipOut).size / 1024 / 1024).toFixed(1)} MB`);
  }
}

main().catch((err) => {
  console.error('[build failed]', err);
  process.exit(1);
});
