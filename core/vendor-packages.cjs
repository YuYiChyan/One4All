'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const { Transform, Readable } = require('node:stream');
const { retry, abortable, abortReason, resourceUrl, safeResourcePath } = require('./resource-refresh-network.cjs');
const defaults = require('../catalog/vendors.json');
const execFileAsync = promisify(execFile);

function checkedUrl(value, allowedHosts) {
  // The selected catalogue entry supplies the source. Vendor/CDN host changes
  // do not require a second hardcoded allowlist to be released with the app.
  return resourceUrl(value);
}

function sourceFor(entry) {
  const source = entry.source;
  if (!['official','github'].includes(source?.type)) throw new Error('未知组件来源');
  checkedUrl(source.url);
  if(source.sha256&&!/^[a-f0-9]{64}$/i.test(source.sha256))throw Error('组件 SHA256 格式无效');
  return source;
}

function requestFile(url, allowedHosts, signal, visited = new Set()) {
  if (!visited.size) checkedUrl(url, allowedHosts);
  const current = resourceUrl(url);
  if (visited.has(current.href)) return Promise.reject(new Error('下载地址形成重定向循环'));
  visited.add(current.href);
  return new Promise((resolve, reject) => {
    const request = (current.protocol==='https:'?https:http).get(current, { signal, headers: { 'User-Agent': 'One4All-Desktop', Accept: 'application/octet-stream,*/*' } }, response => {
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.resume();
        try { if (!response.headers.location) throw Error('下载重定向缺少目标地址'); resolve(requestFile(new URL(response.headers.location, current).href, allowedHosts, signal, visited)); }
        catch (error) { reject(error); }
      } else if (response.statusCode !== 200) {
        response.resume(); reject(Object.assign(new Error('官网下载失败：HTTP ' + response.statusCode), {status:response.statusCode}));
      } else resolve({ stream: response, total: Number(response.headers['content-length']) || null, url: String(url) });
    });
    request.once('error', reject);
  });
}

async function defaultTransport(url, allowedHosts, signal) {
  // The desktop runtime uses Chromium's network stack and the user's system proxy.
  if (!process.versions.electron) return requestFile(url, allowedHosts, signal);
  const { net } = require('electron');
  checkedUrl(url, allowedHosts);
  let current = url; const visited = new Set();
  for (;;) {
    const parsed = resourceUrl(current);
    current = parsed.href;
    if (visited.has(current)) throw Error('下载地址形成重定向循环');
    visited.add(current);
    const response = await net.fetch(current, { signal, redirect:'manual' });
    if ([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw Error('下载重定向缺少目标地址');
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok || response.status !== 200) { await response.body?.cancel(); throw Object.assign(new Error('官网下载失败：HTTP ' + response.status), {status:response.status}); }
    return { stream:Readable.fromWeb(response.body), total:response.headers.get('content-encoding') ? null : Number(response.headers.get('content-length')) || null, url:current };
  }
}

function expandEnv(value) {
  return value.replace(/%([^%]+)%/g, (_, key) => process.env[key] || (key === 'ProgramFiles' ? 'C:/Program Files' : key === 'ProgramFiles(x86)' ? 'C:/Program Files (x86)' : ''));
}
function fileHash(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', data => hash.update(data)); stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}
function checkMagic(file, format) {
  const descriptor = fs.openSync(file, 'r');
  const bytes = Buffer.alloc(4);
  try { fs.readSync(descriptor, bytes, 0, 4, 0); } finally { fs.closeSync(descriptor); }
  if (format === 'exe' && bytes.subarray(0, 2).toString() !== 'MZ') throw new Error('下载结果不是 Windows 安装程序');
  if (format === 'zip' && bytes.readUInt32LE() !== 0x04034b50) throw new Error('下载结果不是 ZIP 安装包');
}

function createPackageManager({ dataRoot, onProgress = () => {}, openPath, openExternal, chooseInstaller, entries = defaults, transport = defaultTransport, runFile = execFileAsync, downloadRetries = 2, retryDelayMs = 500 } = {}) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new TypeError('dataRoot must be an absolute path');
  const root = path.resolve(dataRoot), downloads = path.join(root, 'downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const items = new Map(entries.map(entry => [entry.id, entry]));
  const operations = new Map(), progress = new Map(), errors = new Map();
  const get = id => { const value = items.get(id); if (!value) throw new Error('未登记的品牌模块'); return value; };
  function destination(entry) {
    const source = sourceFor(entry);
    if (path.basename(source.filename) !== source.filename || /[\\/:]/.test(source.filename)) throw new Error('下载文件名无效');
    return safeResourcePath(downloads, source.filename);
  }
  function readReceipt(entry) {
    const target = destination(entry);
    try {
      const receipt = JSON.parse(fs.readFileSync(target + '.json', 'utf8'));
      const source=sourceFor(entry);
      return receipt.id === entry.id && receipt.sourceUrl === source.url && receipt.bytes === fs.statSync(target).size && receipt.sha256 && (!source.sha256||source.sha256.toLowerCase()===receipt.sha256) ? receipt : null;
    } catch { return null; }
  }
  function installedPath(entry) { return (entry.installedExecutables || []).map(expandEnv).map(value => path.resolve(value)).find(value => fs.existsSync(value)) || null; }
  function status(id) {
    if (id === undefined) return Object.fromEntries([...items.keys()].map(key => [key, status(key)]));
    const entry = get(id), receipt = readReceipt(entry), installed = installedPath(entry), activity = progress.get(id);
    return { id, downloaded: !!receipt, installed: !!installed, adapterReady: false,
      state: activity?.state || (installed ? 'installed' : receipt ? 'downloaded' : 'available'),
      downloadPath: receipt ? destination(entry) : null, installedPath: installed,
      source: sourceFor(entry).type, progress: activity || null, error: errors.get(id) || null,
      bytes: receipt?.bytes || 0, sha256: receipt?.sha256 || null, downloadedAt: receipt?.downloadedAt || null };
  }
  function notify(id, value) { progress.set(id, value); try { onProgress(status(id)); } catch {} }
  function catalog() { return [...items.values()].map(entry => ({ ...entry, status: status(entry.id) })); }
  async function performDownload(id, signal, {force=false}={}) {
    const entry = get(id), source = sourceFor(entry), target = destination(entry), partial = target + '.partial';
    const previous = readReceipt(entry);
    if (!force && previous && await fileHash(target) === previous.sha256) { if(signal.aborted)throw abortReason(signal); progress.delete(id); errors.delete(id); return status(id); }
    errors.delete(id); notify(id, { state: 'downloading', received: 0, total: null, percent: null });
    try {
      return await retry(async () => {
      const response = await abortable(transport(source.url, source.allowedHosts, signal), signal, late => late.stream.destroy());
      const hash = crypto.createHash('sha256'); let received = 0, lastNotify = 0;
      const meter = new Transform({ transform(chunk, encoding, callback) {
        received += chunk.length; hash.update(chunk);
        if (Date.now() - lastNotify > 300) {
          lastNotify = Date.now(); notify(id, { state: 'downloading', received, total: response.total, percent: response.total ? Math.min(100, Math.round(received / response.total * 100)) : null });
        }
        callback(null, chunk);
      }});
      await pipeline(response.stream, meter, fs.createWriteStream(partial), { signal });
      if (response.total && received !== response.total) throw Object.assign(new Error('文件没有完整下载'),{code:'ERR_STREAM_PREMATURE_CLOSE'});
      checkMagic(partial, source.format);
      const sha256 = hash.digest('hex');
      if (source.sha256 && source.sha256.toLowerCase() !== sha256) throw new Error('组件版本与下载文件不一致');
      fs.renameSync(partial, target);
      const receipt = { id, sourceUrl: source.url, resolvedUrl: response.url, bytes: received, sha256, downloadedAt: new Date().toISOString() };
      fs.writeFileSync(target + '.json', JSON.stringify(receipt, null, 2));
      notify(id, { state: 'downloaded', received, total: received, percent: 100 });
      progress.delete(id); return status(id);
      }, {signal,retries:downloadRetries,retryDelayMs,onRetry:({attempt,error})=>notify(id,{state:'downloading',received:0,total:null,percent:null,attempt,message:'下载连接中断，正在重试：'+error.message})});
    } catch (error) {
      const failure=signal.aborted?abortReason(signal):error;
      errors.set(id, failure.message); notify(id, { state: signal.aborted?'cancelled':'error', message: failure.message }); throw failure;
    } finally { if(fs.existsSync(partial))fs.unlinkSync(partial); }
  }
  function download(id, options={}) {
    get(id);
    if (operations.has(id)) return operations.get(id).promise;
    const controller=new AbortController(),promise = performDownload(id,controller.signal,options).finally(() => operations.delete(id));
    operations.set(id, {promise,controller}); return promise;
  }
  function cancel(id) { get(id); const job=operations.get(id); if(job)job.controller.abort(Object.assign(Error('下载已取消'),{name:'AbortError'})); return {id,cancelled:!!job}; }
  async function openFile(file) {
    const result = await (openPath || require('electron').shell.openPath)(file);
    if (result) throw new Error(result);
  }
  async function install(id) {
    const entry = get(id), receipt = readReceipt(entry), target = destination(entry);
    if (!receipt) throw new Error('请先下载官方组件');
    if (await fileHash(target) !== receipt.sha256) throw new Error('下载文件已改变，请重新下载');
    checkMagic(target, sourceFor(entry).format);
    let executable = target;
    if (sourceFor(entry).format === 'zip') {
      const expanded = path.join(root, 'installers', id, receipt.sha256.slice(0, 16));
      fs.mkdirSync(expanded, { recursive: true });
      const quote = value => "'" + value.replace(/'/g, "''") + "'";
      const script = '$ErrorActionPreference = \'Stop\'; Expand-Archive -LiteralPath ' + quote(target) + ' -DestinationPath ' + quote(expanded) + ' -Force';
      await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
      const candidates = [], executables = [];
      const pattern = entry.installerNamePattern ? new RegExp(entry.installerNamePattern, 'i') : null;
      const walk = folder => { for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, item.name);
        if (item.isSymbolicLink()) continue;
        if (item.isDirectory()) walk(file);
        else if (item.isFile() && /\.exe$/i.test(item.name)) { executables.push(file); if(pattern?.test(item.name))candidates.push(file); }
      }};
      walk(expanded);
      if (candidates.length === 1) executable = candidates[0];
      else if (!candidates.length && executables.length===1) executable=executables[0];
      else if (chooseInstaller && executables.length) {
        const choices=candidates.length?candidates:executables,selected=await chooseInstaller(choices,{id,directory:expanded});
        if(!selected)return {...status(id),cancelled:true,installerStarted:false};
        if(!choices.includes(selected))throw Error('选择的安装程序不在当前解包目录中');
        executable=selected;
      } else { await openFile(expanded); return {...status(id),folderOpened:true,installerStarted:false,directory:expanded}; }
      checkMagic(executable, 'exe');
    }
    await openFile(executable);
    // Starting the vendor installer is not proof that installation completed.
    return { ...status(id), installerStarted: true };
  }
  async function openOfficial(id) {
    const entry = get(id), executable = installedPath(entry);
    if (executable) { await openFile(executable); return { launched: true, installedPath: executable }; }
    await (openExternal || require('electron').shell.openExternal)(entry.homepage);
    return { launched: false, openedWebsite: true, url: entry.homepage };
  }
  return Object.freeze({ catalog, status, download, cancel, install, openOfficial });
}

module.exports = { createPackageManager, checkedUrl, sourceFor, requestFile, defaultTransport };
