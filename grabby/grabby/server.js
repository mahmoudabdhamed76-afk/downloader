// ============================================================
//  Grabby — محمّل الفيديوهات (يوتيوب / فيس بوك وغيرهم)
//  باك إند Node.js 22+ بصفر مكتبات npm — بيشغّل yt-dlp + ffmpeg
// ============================================================
'use strict';

const http = require('node:http');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 7654;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 عشان نوصله من الموبايل على نفس الشبكة
const TMP_ROOT = path.join(os.tmpdir(), 'grabby');
fs.mkdirSync(TMP_ROOT, { recursive: true });

// --- الأدوات المرفقة جوّه فولدر bin (نسخة محمولة، من غير تثبيت) ---
const IS_WIN = process.platform === 'win32';
const BIN = path.join(__dirname, 'bin');
function bundled(name) {
  const exe = path.join(BIN, IS_WIN ? name + '.exe' : name);
  return fs.existsSync(exe) ? exe : null;
}
function ffmpegLoc() {
  return bundled('ffmpeg') ? ['--ffmpeg-location', BIN] : [];
}
// دعم الكوكيز (يحل مشكلة "تأكيد إنك مش بوت" على السيرفرات السحابية)
// إما عبر متغيّر COOKIES_TXT (محتوى الملف) أو ملف cookies.txt جنب البرنامج
function cookiesPath() {
  if (process.env.COOKIES_TXT) {
    const p = path.join(os.tmpdir(), 'grabby-cookies.txt');
    try { if (!fs.existsSync(p)) fs.writeFileSync(p, process.env.COOKIES_TXT); return p; } catch {}
  }
  const local = path.join(__dirname, 'cookies.txt');
  return fs.existsSync(local) ? local : null;
}
function cookiesArgs() {
  const c = cookiesPath();
  return c ? ['--cookies', c] : [];
}
// أول IP محلي (للوصول من الموبايل)
function lanIP() {
  const ifs = os.networkInterfaces();
  for (const name in ifs) for (const i of ifs[name]) {
    if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return '127.0.0.1';
}

// كل مهمة تحميل بتتسجل هنا
/** @type {Map<string, any>} */
const jobs = new Map();

// ---------- أدوات مساعدة ----------
function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

// بنحدد الأمر الصح حسب نظام التشغيل (ويندوز بيستخدم yt-dlp.exe لو موجود جنبه)
function ytDlpCmd() {
  return process.env.YTDLP || bundled('yt-dlp') || 'yt-dlp';
}

// التأكد إن الأدوات متثبتة
function checkTool(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim().split('\n')[0]);
    });
  });
}

// تحويل اختيار الجودة لصيغة yt-dlp
function formatArgs(quality) {
  switch (quality) {
    case 'audio':
      return ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
    case '480':
      return ['-f', 'bv*[height<=480]+ba/b[height<=480]/b', '--merge-output-format', 'mp4'];
    case '720':
      return ['-f', 'bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4'];
    case '1080':
      return ['-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4'];
    case 'best':
    default:
      return ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'];
  }
}

// ---------- المسارات ----------
const routes = {
  // فحص توفّر الأدوات
  async 'GET /api/check'(req, res) {
    const ytdlp = await checkTool(ytDlpCmd(), ['--version']);
    const ffmpeg = await checkTool(bundled('ffmpeg') || 'ffmpeg', ['-version']);
    send(res, 200, { ytdlp, ffmpeg });
  },

  // رابط الوصول من الموبايل (نفس الشبكة)
  'GET /api/net'(req, res) {
    send(res, 200, { url: `http://${lanIP()}:${PORT}` });
  },

  // جلب معلومات الفيديو قبل التحميل
  async 'POST /api/info'(req, res) {
    const { url } = await readBody(req);
    if (!url || !/^https?:\/\//i.test(url)) return send(res, 400, { error: 'الرابط غير صالح' });

    const args = ['-J', '--no-warnings', '--no-playlist', ...cookiesArgs(), url];
    execFile(ytDlpCmd(), args, { maxBuffer: 1024 * 1024 * 64, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message).split('\n').find((l) => /ERROR/i.test(l)) || 'تعذّر قراءة الرابط';
        return send(res, 502, { error: cleanErr(msg) });
      }
      let info;
      try { info = JSON.parse(stdout); } catch { return send(res, 502, { error: 'رد غير مفهوم من المحرك' }); }

      // أحياناً بيرجّع entries (بلاي ليست) — ناخد أول عنصر
      if (info.entries && info.entries.length) info = info.entries[0];

      const thumb = info.thumbnail || (info.thumbnails && info.thumbnails.at(-1)?.url) || '';
      send(res, 200, {
        title: info.title || 'بدون عنوان',
        uploader: info.uploader || info.channel || info.uploader_id || '',
        duration: info.duration || 0,
        thumbnail: thumb,
        extractor: info.extractor_key || info.extractor || '',
        url,
      });
    });
  },

  // بدء التحميل
  async 'POST /api/start'(req, res) {
    const { url, quality } = await readBody(req);
    if (!url || !/^https?:\/\//i.test(url)) return send(res, 400, { error: 'الرابط غير صالح' });

    const id = crypto.randomUUID();
    const dir = path.join(TMP_ROOT, id);
    fs.mkdirSync(dir, { recursive: true });

    const args = [
      '--no-warnings', '--no-playlist', '--newline',
      '--progress-template', '@@%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
      ...formatArgs(quality),
      ...ffmpegLoc(),
      ...cookiesArgs(),
      '-o', path.join(dir, '%(title).180B.%(ext)s'),
      url,
    ];

    const proc = spawn(ytDlpCmd(), args, { windowsHide: true });
    const job = { id, dir, status: 'running', percent: 0, downloaded: 0, total: 0, speed: 0, eta: 0, file: null, error: null, clients: [] };
    jobs.set(id, job);

    let stderrTail = '';
    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (line.startsWith('@@')) parseProgress(job, line.slice(2));
      }
    });
    proc.stderr.on('data', (c) => { stderrTail = (stderrTail + c).slice(-2000); });

    proc.on('close', (code) => {
      if (code === 0) {
        // ندوّر على الملف الناتج
        const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.part') && !f.endsWith('.ytdl'));
        // نفضّل ملف الفيديو/الصوت النهائي (أكبر حجم)
        let best = null, bestSize = -1;
        for (const f of files) {
          const s = fs.statSync(path.join(dir, f)).size;
          if (s > bestSize) { bestSize = s; best = f; }
        }
        job.file = best;
        job.total = bestSize;
        job.percent = 100;
        job.status = best ? 'done' : 'error';
        if (!best) job.error = 'انتهى التحميل لكن لم يُعثر على ملف';
      } else {
        job.status = 'error';
        job.error = cleanErr((stderrTail.split('\n').find((l) => /ERROR/i.test(l)) || 'فشل التحميل').trim());
      }
      broadcast(job);
      job.clients.forEach((c) => c.end());
      job.clients = [];
    });

    send(res, 200, { id });
  },

  // بث التقدّم عبر SSE
  'GET /api/progress'(req, res, u) {
    const id = u.searchParams.get('id');
    const job = jobs.get(id);
    if (!job) return send(res, 404, { error: 'مهمة غير موجودة' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(snapshot(job))}\n\n`);
    if (job.status === 'done' || job.status === 'error') return res.end();
    job.clients.push(res);
    req.on('close', () => { job.clients = job.clients.filter((c) => c !== res); });
  },

  // تنزيل الملف النهائي للمتصفح
  'GET /api/file'(req, res, u) {
    const id = u.searchParams.get('id');
    const job = jobs.get(id);
    if (!job || !job.file) return send(res, 404, { error: 'الملف غير جاهز' });
    const full = path.join(job.dir, job.file);
    if (!fs.existsSync(full)) return send(res, 404, { error: 'الملف غير موجود' });

    const stat = fs.statSync(full);
    const encoded = encodeURIComponent(job.file);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
    });
    fs.createReadStream(full).pipe(res);
  },

  // إلغاء التحميل
  async 'POST /api/cancel'(req, res) {
    const { id } = await readBody(req);
    const job = jobs.get(id);
    if (job && job.proc) try { job.proc.kill('SIGKILL'); } catch {}
    if (job) { job.status = 'error'; job.error = 'تم الإلغاء'; }
    send(res, 200, { ok: true });
  },
};

function parseProgress(job, payload) {
  const [d, t, te, sp, eta] = payload.split('|').map((x) => (x === 'NA' || x === '' ? null : Number(x)));
  job.downloaded = d || job.downloaded;
  job.total = t || te || job.total;
  job.speed = sp || 0;
  job.eta = eta || 0;
  if (job.total > 0) job.percent = Math.min(99.9, (job.downloaded / job.total) * 100);
  broadcast(job);
}

function snapshot(job) {
  return {
    status: job.status, percent: job.percent, downloaded: job.downloaded,
    total: job.total, speed: job.speed, eta: job.eta,
    file: job.file, error: job.error,
  };
}

function broadcast(job) {
  const line = `data: ${JSON.stringify(snapshot(job))}\n\n`;
  job.clients.forEach((c) => { try { c.write(line); } catch {} });
}

function cleanErr(msg) {
  return String(msg).replace(/^.*ERROR:\s*/i, '').replace(/\[[^\]]+\]\s*/g, '').trim() || 'حدث خطأ';
}

// ---------- إنشاء الخادم ----------
const INDEX_PATH = path.join(__dirname, 'index.html');
function loadIndex() {
  try {
    return fs.readFileSync(INDEX_PATH);
  } catch {
    return Buffer.from(
      '<!doctype html><meta charset="utf-8"><div style="font-family:sans-serif;direction:rtl;padding:40px;text-align:center">' +
      '<h2>⚠️ ملف index.html مش موجود في النشر</h2>' +
      '<p>اتأكد إن <b>index.html</b> مرفوع في نفس مجلد <b>server.js</b> في المستودع.</p></div>'
    );
  }
}
if (!fs.existsSync(INDEX_PATH)) {
  console.log('  ⚠️  index.html مش موجود جنب server.js — الواجهة مش هتظهر لحد ما ترفعه.');
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${u.pathname}`;

  if (key === 'GET /') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(loadIndex()); }

  const handler = routes[key];
  if (handler) { try { return await handler(req, res, u); } catch (e) { return send(res, 500, { error: String(e.message) }); } }

  send(res, 404, { error: 'غير موجود' });
});

// تنظيف الملفات المؤقتة الأقدم من ساعتين (مهم للنسخة السحابية)
setInterval(() => {
  try {
    for (const name of fs.readdirSync(TMP_ROOT)) {
      const p = path.join(TMP_ROOT, name);
      try { if (Date.now() - fs.statSync(p).mtimeMs > 2 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true }); } catch {}
    }
  } catch {}
}, 30 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`\n  ✅ Grabby شغّال!`);
  console.log(`  • على الكمبيوتر:  http://127.0.0.1:${PORT}`);
  console.log(`  • على الموبايل (نفس الواي فاي):  http://${lanIP()}:${PORT}\n`);
  checkTool(ytDlpCmd(), ['--version']).then((v) => {
    if (!v) console.log('  ⚠️  yt-dlp مش موجود — شغّل SETUP.bat مرة واحدة عشان ينزّله جوّه فولدر bin');
    else console.log(`  • yt-dlp: ${v}`);
  });
  checkTool(bundled('ffmpeg') || 'ffmpeg', ['-version']).then((v) => {
    if (!v) console.log('  ⚠️  ffmpeg مش موجود — شغّل SETUP.bat (مطلوب لدمج الجودة العالية و MP3)');
  });
});
