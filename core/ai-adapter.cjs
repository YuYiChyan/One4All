'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const specification = fs.readFileSync(path.join(__dirname, '../docs/ADAPTER-SPEC.md'), 'utf8');

function completionEndpoint(value) {
  const url = new URL(value || 'https://api.openai.com/v1');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('请填写 HTTP(S) 接口地址；登录密钥请填在 API Key 中');
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname) pathname = '/v1';
  if (!pathname.endsWith('/chat/completions')) pathname += '/chat/completions';
  url.pathname = pathname;
  return url.href;
}
function parseCandidate(text) {
  let cleaned = String(text).trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const result = JSON.parse(cleaned);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('模型应返回一个适配候选 JSON 对象');
  if (!Array.isArray(result.files)) throw new Error('候选缺少 files 列表');
  const seen = new Set();
  result.files = result.files.map(file => {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') throw new Error('候选文件格式不正确');
    const name = file.path;
    if (!name || name.includes('\\') || name.includes(':') || name.includes('\0') || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..') || seen.has(name.toLowerCase())) throw new Error('候选文件路径须在草稿目录内且不能重名：' + name);
    seen.add(name.toLowerCase()); return { path:name, content:file.content };
  });
  const manifest = result.manifest && typeof result.manifest === 'object' && !Array.isArray(result.manifest) ? result.manifest : {};
  if (manifest.id && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(manifest.id)) throw new Error('适配器 id 只能包含小写字母、数字和连字符');
  const entry = manifest.entry || 'adapter.cjs';
  if (typeof entry !== 'string' || !/\.(?:cjs|mjs|js)$/i.test(entry) || entry.includes('\\') || entry.includes(':') || entry.startsWith('/') || entry.split('/').some(part => !part || part === '..' || part === '.') || !seen.has(entry.toLowerCase()) && result.files.length) throw new Error('适配候选缺少 JavaScript 入口文件');
  result.manifest = { ...manifest, entry, verification:'unverified' };
  result.capabilities = Array.isArray(result.capabilities) ? result.capabilities : [];
  result.report = result.report && typeof result.report === 'object' && !Array.isArray(result.report) ? result.report : { summary:String(result.report || '') };
  result.report.verification = 'unverified';
  result.candidateReady = seen.has(entry.toLowerCase());
  return result;
}

function createAiAdapter({ dataRoot, encryptString, decryptString, getPackageContext = () => null, fetchImpl = globalThis.fetch } = {}) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new TypeError('dataRoot must be an absolute path');
  fs.mkdirSync(dataRoot, { recursive:true });
  const configFile = path.join(dataRoot, 'ai-config.json');
  let stored = {}, apiKey = '';
  const requests = new Set();
  function cancelGeneration() { const count=requests.size; for(const controller of requests)controller.abort(); return {cancelled:count>0,count}; }
  async function withCancellation(operation) {
    const controller=new AbortController();requests.add(controller);
    let abort;
    const cancelled=new Promise((_,reject)=>{abort=()=>reject(new Error('操作已取消，可重新生成或测试连接'));controller.signal.addEventListener('abort',abort,{once:true});});
    try { return await Promise.race([operation(controller.signal),cancelled]); }
    finally { requests.delete(controller);controller.signal.removeEventListener('abort',abort); }
  }
  try { stored = JSON.parse(fs.readFileSync(configFile,'utf8')); } catch {}
  if(typeof stored.apiKey==='string')apiKey=stored.apiKey;
  if (stored.encryptedKey && decryptString) try { apiKey = decryptString(Buffer.from(stored.encryptedKey,'base64')); } catch {}
  function config() { return { baseURL:stored.baseURL || 'https://api.openai.com/v1', model:stored.model || '',maxOutputTokens:stored.maxOutputTokens??null, keyConfigured:!!apiKey||!!stored.encryptedKey, keyPersistence:stored.encryptedKey?'encrypted':apiKey?'local':'none' }; }
  function saveConfig(input = {}) {
    const baseURL = String(input.baseURL ?? stored.baseURL ?? 'https://api.openai.com/v1').trim();
    completionEndpoint(baseURL);
    const model = String(input.model ?? stored.model ?? '').trim();
    let nextKey = apiKey;
    if (input.clearApiKey === true) nextKey = '';
    else if (typeof input.apiKey === 'string' && input.apiKey.trim()) nextKey = input.apiKey.trim();
    const outputLimit=input.maxOutputTokens===undefined?stored.maxOutputTokens:input.maxOutputTokens;
    const maxOutputTokens=outputLimit===null||outputLimit===''||outputLimit===undefined?null:Number(outputLimit);
    if(maxOutputTokens!==null&&(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1))throw new Error('输出上限请填正整数，或留空使用服务商默认值');
    const next = {...stored, baseURL, model,maxOutputTokens };
    const replacingKey=typeof input.apiKey==='string'&&!!input.apiKey.trim();
    if(input.clearApiKey===true){delete next.encryptedKey;delete next.apiKey;}
    else if(nextKey){
      let encrypted=false;if(encryptString&&decryptString)try{next.encryptedKey=Buffer.from(encryptString(nextKey)).toString('base64');delete next.apiKey;encrypted=true;}catch{}
      if(!encrypted&&(!stored.encryptedKey||replacingKey)){next.apiKey=nextKey;delete next.encryptedKey;}
    }
    fs.writeFileSync(configFile, JSON.stringify(next,null,2), {mode:0o600});
    stored = next; apiKey = nextKey; return config();
  }
  const redact = value => apiKey ? String(value).split(apiKey).join('[REDACTED]') : String(value);
  async function call(messages, maxTokens, signal) {
    signal.throwIfAborted();
    const settings = config();
    if (!settings.model) throw new Error('请填写模型名称');
    if(stored.encryptedKey&&!apiKey)throw new Error('之前保存的系统加密密钥暂时无法读取。可重新填写 API Key 后重试；原记录仍保留。');
    const headers = { 'Content-Type':'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const response = await fetchImpl(completionEndpoint(settings.baseURL), {
      method:'POST', headers, body:JSON.stringify({ model:settings.model, messages, max_tokens:maxTokens }),
      signal
    });
    const raw = await response.text();signal.throwIfAborted();
    let body;
    try { body = JSON.parse(raw); } catch { throw new Error('API 返回的内容不是 JSON（HTTP ' + response.status + '）'); }
    if (!response.ok) throw new Error('API 请求失败（HTTP ' + response.status + '）：' + redact(body.error?.message || body.message || '请检查地址、模型和密钥'));
    if(body.choices?.[0]?.finish_reason==='length')throw new Error('模型输出达到服务端长度上限，适配文件尚未完整返回。请调整输出上限或缩小本次需求后重试。');
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('API 响应缺少 choices[0].message.content');
    return { content:redact(content), model:body.model || settings.model, usage:body.usage || null };
  }
  async function testConnection() {
    return withCancellation(async signal=>{const result = await call([{role:'user',content:'Reply only with OK.'}],16,signal);
      return { ok:true, model:result.model, response:result.content.slice(0,200) };});
  }
  function generate(input = {}) { return withCancellation(signal=>generateDraft(input,signal)); }
  async function generateDraft({ packageId, instructions = '', context = '' },signal) {
    if (typeof packageId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(packageId)) throw new Error('请选择已登记的品牌或设备包');
    const packageContext = await getPackageContext(packageId,{signal});signal.throwIfAborted();
    const requestContext = { packageId, packageContext:packageContext || {evidenceStatus:'missing',note:'尚无已解包接口资料，请结合用户补充资料实现并说明缺口。'}, instructions:String(instructions), userContext:typeof context === 'string' ? context : JSON.stringify(context) };
    const contextText = JSON.stringify(requestContext,null,2);
    const result = await call([
      {role:'system',content:'你正在为 One4All 编写设备适配候选。遵循用户在 instructions 中填写的适配需求，并结合 userContext 补充资料；packageContext 是下载包中提取的接口证据。以下规范说明输出 JSON 和运行接口契约，不替代用户的项目要求。只返回一个 JSON 对象，不包含额外说明，文件内容为源码文本。如实说明尚未实现或未验证的部分，缺少接口资料时列出 missingEvidence，不把模拟成功写成设备实测成功。\n\n'+specification},
      {role:'user',content:contextText}
    ],config().maxOutputTokens??undefined,signal);signal.throwIfAborted();
    const candidate = parseCandidate(result.content);
    if (!candidate.manifest.id) candidate.manifest.id = packageId + '-candidate';
    if (!candidate.manifest.version) candidate.manifest.version = '0.1.0';
    const id = new Date().toISOString().replace(/[:.]/g,'-') + '-' + packageId + '-' + crypto.randomBytes(3).toString('hex');
    const directory = path.join(dataRoot,'adapter-drafts',id);
    fs.mkdirSync(directory,{recursive:true});
    for (const file of candidate.files) {
      const target = path.join(directory,file.path);
      fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,file.content);
    }
    const draft = { id, directory, packageId, model:result.model, createdAt:new Date().toISOString(), manifest:candidate.manifest, capabilities:candidate.capabilities, report:candidate.report, candidateReady:candidate.candidateReady, files:candidate.files.map(file=>file.path), verification:'unverified', usage:result.usage };
    fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(candidate.manifest,null,2));
    fs.writeFileSync(path.join(directory,'draft.json'),JSON.stringify(draft,null,2));
    fs.writeFileSync(path.join(directory,'request-context.json'),redact(contextText));
    return draft;
  }
  return Object.freeze({ config, saveConfig, testConnection, generate, cancelGeneration });
}

module.exports = { createAiAdapter, completionEndpoint, parseCandidate };
