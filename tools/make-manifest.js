'use strict';
/**
 * 生成更新清单 latest.json
 *
 *   node tools/make-manifest.js --version 1.3.0 \
 *     --file dist-installer/BiliFound-1.3.0-Setup-x64.exe \
 *     --base https://example.com/bilifound \
 *     --portable dist-installer/BiliFound-1.3.0-Portable-x64.exe \
 *     --notes "修复 xxx；新增 yyy" --out latest.json
 *
 * --base   静态托管目录（URL 由 base + 文件名拼出来）
 * --url    直接给完整下载地址（给了就不看 --base）
 * --file   本地安装包，用来算 size 与 sha256
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function describe(file, explicitUrl) {
  if (!file) return null;
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`找不到文件：${abs}`);
  const stat = fs.statSync(abs);
  return {
    name: path.basename(abs),
    size: stat.size,
    sha256: await sha256(abs),
    url: explicitUrl || '',
  };
}

(async () => {
  const version = arg('version');
  if (!version) {
    console.error('缺少 --version，例如 --version 1.3.0');
    process.exit(1);
  }
  const base = arg('base').replace(/\/+$/, '');
  const out = arg('out', 'latest.json');
  const notes = arg('notes', '');
  const publishedAt = arg('publishedAt', new Date().toISOString().slice(0, 10));

  const setup = await describe(arg('file'), arg('url'));
  const portable = await describe(arg('portable'), arg('portableUrl'));

  const join = (rel) => (base ? `${base}/${encodeURIComponent(rel)}` : '');

  const manifest = {
    version,
    notes,
    publishedAt,
    url: setup ? (setup.url || join(setup.name)) : '',
    ...(setup ? { size: setup.size, sha256: setup.sha256 } : {}),
  };
  if (portable) {
    manifest.portableUrl = portable.url || join(portable.name);
    manifest.portableSize = portable.size;
    manifest.portableSha256 = portable.sha256;
  }

  fs.writeFileSync(path.resolve(out), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`已写入 ${path.resolve(out)}`);
  console.log(JSON.stringify(manifest, null, 2));
})().catch((e) => {
  console.error(String(e && e.message));
  process.exit(1);
});
