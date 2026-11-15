'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPOSITORY = 'YuYiChyan/One4All';
const ISSUE_ROOT = 'https://github.com/' + REPOSITORY + '/issues';
const CHECKS = Object.freeze({
  dpi:'DPI 调节', dpiStages:'DPI 档位', pollRate:'回报率', lighting:'灯光与颜色',
  keymap:'按键映射', macro:'宏', battery:'电量读取', profile:'配置切换',
  persistence:'断开重连后设置保留', volume:'音量与静音', microphone:'麦克风控制',
  equalizer:'均衡器', rapidTrigger:'快速触发', actuation:'触发行程',
  debounce:'消抖设置', sleep:'休眠设置', connection:'连接与设备识别'
});

const publicText = value => String(value ?? '').trim();
const tableText = value => String(value).replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
function receiptRepository(receipt) {
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(receipt.repository || '')) return receipt.repository;
  // Older receipts have no repository field; their original URL is authoritative.
  try {
    const url = new URL(receipt.url), match = /^\/([^/]+\/[^/]+)\/issues(?:\/|$)/.exec(url.pathname);
    if (url.origin === 'https://github.com' && match) return match[1];
  } catch {}
  return null;
}
const sameRepository = (receipt, repository) => receiptRepository(receipt)?.toLowerCase() === repository.toLowerCase();
function createValidationFeedback({dataRoot,encryptString,decryptString,fetchImpl = globalThis.fetch,openExternal} = {}) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new TypeError('dataRoot must be an absolute path');
  fs.mkdirSync(dataRoot,{recursive:true});
  const configFile = path.join(dataRoot,'validation-config.json');
  const receiptsFile = path.join(dataRoot,'validation-receipts.json');
  let stored = {}, token = '', receipts = [];
  try { stored = JSON.parse(fs.readFileSync(configFile,'utf8')); } catch {}
  if(typeof stored.token==='string')token=stored.token;
  try { const data = JSON.parse(fs.readFileSync(receiptsFile,'utf8')); if (Array.isArray(data)) receipts = data; } catch {}
  if (stored.encryptedToken && decryptString) try { token = decryptString(Buffer.from(stored.encryptedToken,'base64')); } catch {}
  const prepared = new Map(), inFlight = new Map(), controllers = new Map();
  function cancelSubmission() { const count=controllers.size;for(const controller of controllers.values())controller.abort();return {cancelled:count>0,count}; }
  const config = () => ({repository:REPOSITORY,tokenConfigured:!!token||!!stored.encryptedToken,tokenPersistence:stored.encryptedToken?'encrypted':token?'local':'none'});
  function saveConfig(input = {}) {
    let nextToken = token;
    if (input.clearToken === true) nextToken = '';
    else if (typeof input.token === 'string' && input.token.trim()) nextToken = input.token.trim();
    if (/\s/.test(nextToken)) throw new Error('GitHub Token 中不能包含空白字符');
    const next = {...stored},replacingToken=typeof input.token==='string'&&!!input.token.trim();
    if(input.clearToken===true){delete next.encryptedToken;delete next.token;}
    else if(nextToken){
      let encrypted=false;if(encryptString&&decryptString)try{next.encryptedToken=Buffer.from(encryptString(nextToken)).toString('base64');delete next.token;encrypted=true;}catch{}
      if(!encrypted&&(!stored.encryptedToken||replacingToken)){next.token=nextToken;delete next.encryptedToken;}
    }
    fs.writeFileSync(configFile,JSON.stringify(next,null,2),{mode:0o600});
    stored = next; token = nextToken;
    return config();
  }
  function saveReceipt(receipt) {
    const next = [receipt,...receipts.filter(item => item.id !== receipt.id || !sameRepository(item,receipt.repository))];
    const temp = receiptsFile + '.tmp';
    fs.writeFileSync(temp,JSON.stringify(next,null,2),{mode:0o600});
    fs.renameSync(temp,receiptsFile); receipts = next;
  }
  function prepare(input = {}) {
    const model = input.model;
    if (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(model.id || '') || !model.name) throw new Error('请选择支持库中的具体型号');
    if (input.hardwareConfirmed !== true) throw new Error('请确认已在这款实物设备上完成所选功能的测试');
    const checks = [...new Set((Array.isArray(input.checks) ? input.checks : []).filter(id => Object.hasOwn(CHECKS,id)))].sort();
    if (!checks.length) throw new Error('请勾选至少一项实际测试通过的功能');
    const providerVersion = publicText(input.providerVersion,100);
    if (!providerVersion || /^(?:unknown|未知|未提供)$/i.test(providerVersion)) throw new Error('请填写本次测试使用的适配器版本');
    const redact = (value,length) => publicText(token ? String(value ?? '').split(token).join('[已隐藏凭据]') : value,length);
    const report = {
      modelId:model.id,modelName:redact(model.name,160),brand:redact(model.brand,60),
      provider:redact(model.support?.provider || model.source?.provider || model.brand,100),
      providerVersion:redact(providerVersion,100),firmware:redact(input.firmware,100),checks,notes:token?String(input.notes??'').split(token).join('[已隐藏凭据]'):String(input.notes??'')
    };
    // Only public catalog fields are selected; never copy the connected HID device object.
    const id = crypto.createHash('sha256').update(JSON.stringify({repository:REPOSITORY,report})).digest('hex');
    const title = '[设备验证] ' + report.modelName + ' · ' + report.providerVersion;
    const body = [
      '## 用户实机验证报告','',
      '| 项目 | 本次验证 |','| --- | --- |',
      '| 型号 | ' + tableText(report.modelName) + ' |',
      '| 支持库型号 ID | ' + report.modelId + ' |',
      '| 品牌 | ' + tableText(report.brand) + ' |',
      '| 适配器 | ' + tableText(report.provider) + ' |',
      '| 适配器版本 | ' + tableText(report.providerVersion) + ' |',
      '| 固件版本 | ' + tableText(report.firmware || '未填写') + ' |','',
      '### 实际测试通过的功能',...checks.map(id => '- [x] ' + CHECKS[id]),'',
      '我已在上述实物设备上测试所选功能，并确认这些功能正常。未勾选的功能不在本次确认范围内。',
      '', '### 备注',report.notes || '无','',
      '此报告只适用于以上型号与适配器版本；其他型号及未测试的功能仍待验证。',
      '', '<!-- one4all-validation:' + id + ' -->'
    ].join('\n');
    const url = ISSUE_ROOT + '/new?' + new URLSearchParams({title,body}).toString();
    const result = {...report,id,title,body,url,repository:REPOSITORY};
    prepared.set(id,result);
    return structuredClone(result);
  }
  function receiptBase(report) {
    return {id:report.id,repository:REPOSITORY,modelId:report.modelId,modelName:report.modelName,providerVersion:report.providerVersion,checks:report.checks,createdAt:new Date().toISOString()};
  }
  async function perform(report,{retry=false,signal}={}) {
    if(stored.encryptedToken&&!token)throw new Error('之前保存的系统加密 Token 暂时无法读取。可重新填写 Token 或改用浏览器；原记录仍保留。');
    const previous = receipts.find(item => item.id === report.id && sameRepository(item,REPOSITORY));
    if (previous?.submitted) return {...previous,duplicate:true};
    if (token && !retry && previous && ['pending','uncertain'].includes(previous.status)) return {...previous,status:'uncertain',submitted:false,retryAvailable:true,message:'上次提交未收到结果。可点击“重试提交”，也可在 GitHub 查看是否已收到报告。'};
    if (!token) {
      if (!openExternal) throw new Error('无法打开浏览器，请复制报告到 GitHub 提交');
      await openExternal(report.url);
      return {...receiptBase(report),mode:'browser',submitted:false,status:'awaiting-browser-submit',url:report.url,message:'已打开填写好的 GitHub Issue，请登录后在网页中提交。'};
    }
    const pending = {...receiptBase(report),mode:'api',submitted:false,status:'pending',url:ISSUE_ROOT};
    saveReceipt(pending);
    let response;
    try {
      response = await fetchImpl('https://api.github.com/repos/' + REPOSITORY + '/issues',{
        method:'POST',redirect:'error',headers:{Accept:'application/vnd.github+json','Content-Type':'application/json',Authorization:'Bearer ' + token,'X-GitHub-Api-Version':'2022-11-28'},
        body:JSON.stringify({title:report.title,body:report.body}),signal
      });
    } catch {
      saveReceipt({...pending,status:'uncertain'});
      throw new Error(signal?.aborted?'提交已取消。GitHub 可能已收到报告，可重试提交或到 Issues 查看。':'未收到 GitHub 的提交结果。可重试提交，或到仓库 Issues 查看报告。');
    }
    if (response.status !== 201) {
      saveReceipt({...pending,status:'failed'});
      const reasons = {401:'登录凭据无效，请重新设置 GitHub Token',403:'Token 没有提交权限，或 GitHub 暂时限制了请求；也可清除 Token 后改用网页提交',404:'Token 无法访问目标仓库；可清除 Token 后登录 GitHub 网页提交',410:'目标仓库已关闭 Issues',422:'GitHub 未接受报告，请稍后重试'};
      throw new Error(reasons[response.status] || 'GitHub 提交失败（HTTP ' + response.status + '）');
    }
    let data;
    try { data = await response.json(); } catch {}
    const issuePattern = new RegExp('^https://github\\.com/' + REPOSITORY + '/issues/[1-9][0-9]*$','i');
    if (!data || !Number.isSafeInteger(data.number) || !issuePattern.test(data.html_url || '')) {
      saveReceipt({...pending,status:'uncertain'});
      throw new Error('GitHub 已接受报告，但返回的报告链接不完整。可在 Issues 查看，也可重试提交。');
    }
    const receipt = {...pending,status:'submitted',submitted:true,url:data.html_url,number:data.number};
    saveReceipt(receipt); return receipt;
  }
  function submit(input) {
    const id = typeof input === 'string' ? input : input?.id;
    const report = prepared.get(id);
    if (!report) return Promise.reject(new Error('报告预览已失效，请重新打开验证表单'));
    if (inFlight.has(id)) return inFlight.get(id);
    const controller=new AbortController();controllers.set(id,controller);
    const promise = perform(report,{retry:input?.retry===true,signal:controller.signal}).finally(() => {inFlight.delete(id);controllers.delete(id);});
    inFlight.set(id,promise); return promise;
  }
  return {config,saveConfig,prepare,submit,cancelSubmission,list:() => structuredClone(receipts.map(receipt=>({...receipt,repository:receiptRepository(receipt)}))),checks:() => ({...CHECKS})};
}

module.exports = {createValidationFeedback,CHECKS,REPOSITORY};
