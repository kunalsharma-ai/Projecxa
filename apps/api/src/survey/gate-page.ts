import { PROVIDERS } from './captcha';
import { Question } from './questions';
import type { GateView } from './survey.service';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function renderQuestion(section: string, q: Question, i: number): string {
  const name = `${section}.${q.id}`;
  const v = q.validation ?? {};
  const data = [
    `data-section="${section}"`,
    `data-qid="${esc(q.id)}"`,
    `data-type="${q.type}"`,
    `data-required="${q.required ? 1 : 0}"`,
    v.min !== undefined ? `data-min="${v.min}"` : '',
    v.max !== undefined ? `data-max="${v.max}"` : '',
    v.integer ? 'data-integer="1"' : '',
    v.minSelect !== undefined ? `data-min-select="${v.minSelect}"` : '',
    v.maxSelect !== undefined ? `data-max-select="${v.maxSelect}"` : '',
    v.minLength !== undefined ? `data-min-length="${v.minLength}"` : '',
    v.maxLength !== undefined ? `data-max-length="${v.maxLength}"` : '',
    v.format ? `data-format="${v.format}"` : '',
  ].filter(Boolean).join(' ');
  const legend = `<legend><span class="qn">${i + 1}.</span> ${esc(q.text)}${q.required ? '' : ' <span class="opt-tag">(optional)</span>'}</legend>${q.help ? `<p class="help">${esc(q.help)}</p>` : ''}`;
  let body = '';
  const opts = q.options ?? [];
  switch (q.type) {
    case 'single':
      body = opts.map((o) => `<label class="opt"><input type="radio" name="${esc(name)}" value="${esc(o.id)}"><span>${esc(o.label)}</span></label>`).join('');
      break;
    case 'multi':
      body = opts.map((o) => `<label class="opt"><input type="checkbox" name="${esc(name)}" value="${esc(o.id)}"${o.exclusive ? ' data-exclusive="1"' : ''}><span>${esc(o.label)}</span></label>`).join('');
      if (v.minSelect || v.maxSelect) body = `<p class="help">${v.minSelect && v.maxSelect ? `Choose ${v.minSelect} to ${v.maxSelect}.` : v.minSelect ? `Choose at least ${v.minSelect}.` : `Choose up to ${v.maxSelect}.`}</p>${body}`;
      break;
    case 'dropdown':
      body = `<select name="${esc(name)}" aria-label="${esc(q.text)}"><option value="">Select…</option>${opts.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}</select>`;
      break;
    case 'number':
      body = `<input type="number" inputmode="${v.integer ? 'numeric' : 'decimal'}" name="${esc(name)}" aria-label="${esc(q.text)}"${v.min !== undefined ? ` min="${v.min}"` : ''}${v.max !== undefined ? ` max="${v.max}"` : ''}${v.integer ? ' step="1"' : ' step="any"'}>`;
      break;
    case 'text':
      body = `<input type="${v.format === 'email' ? 'email' : 'text'}" name="${esc(name)}" aria-label="${esc(q.text)}" maxlength="${v.maxLength ?? 500}" autocomplete="off">`;
      break;
    case 'grid':
      body = (q.rows ?? [])
        .map(
          (r) => `<div class="grow" data-row="${esc(r.id)}"><div class="glabel">${esc(r.label)}</div><div class="gopts">${opts
            .map((o) => `<label class="pill"><input type="radio" name="${esc(`${name}.${r.id}`)}" value="${esc(o.id)}"><span>${esc(o.label)}</span></label>`)
            .join('')}</div></div>`,
        )
        .join('');
      break;
  }
  return `<fieldset class="q" ${data}>${legend}${body}<p class="qerr" role="alert" hidden></p></fieldset>`;
}

/** Inner HTML of the human check; also rebuilt in the browser after a wrong answer. */
function renderHuman(h: NonNullable<GateView['human']>, imageUrl: string): string {
  const q = `<legend id="hq">${esc(h.question)}</legend>`;
  const err = '<p class="qerr" id="herr" role="alert" hidden></p>';
  switch (h.kind) {
    case 'choice':
      return `${q}<div id="hopts">${(h.options ?? []).map((o) => `<label class="opt"><input type="radio" name="human" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('')}</div>${err}`;
    case 'image':
      return `${q}<img id="himg" class="cimg" src="${esc(imageUrl)}" alt="Characters to type" width="220" height="70"><input id="ha" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" aria-labelledby="hq">${err}`;
    case 'widget':
      return `${q}<div class="${PROVIDERS[h.style as 'turnstile' | 'hcaptcha'].className}" data-sitekey="${esc(h.siteKey ?? '')}" data-callback="pxCaptcha" data-expired-callback="pxCaptchaExpired"></div>${err}`;
    default:
      return `${q}<input id="ha" type="text" inputmode="numeric" autocomplete="off" maxlength="3" aria-labelledby="hq">${err}`;
  }
}

/**
 * Respondent gate page. Neutral (no PROJEXA or client branding), phone-first, needs JavaScript.
 * Steps, in order: human check → gate survey → prescreener. Signals the project turned on
 * (language, time zone, fingerprint) and the background captcha are collected meanwhile.
 * Everything is posted to /g/:token, which runs every check and returns where to go next.
 */
export function renderGatePage(view: GateView, nonce: string): string {
  const steps: { id: string; title: string; intro: string; html: string }[] = [];
  if (view.human) {
    steps.push({
      id: 'human',
      title: 'Quick check',
      intro: 'Please answer this to show you are not a robot.',
      html: `<fieldset class="q" id="hbox">${renderHuman(view.human, `/g/${encodeURIComponent(view.token)}/captcha.svg?a=${view.human.attemptsLeft}`)}</fieldset>`,
    });
  }
  if (view.gateQuestions.length) steps.push({ id: 'gate', title: 'About you', intro: 'A few questions before the survey starts.', html: view.gateQuestions.map((q, i) => renderQuestion('gate', q, i)).join('') });
  if (view.prescreen.length) steps.push({ id: 'prescreen', title: 'A few more questions', intro: 'These help us check the survey is right for you.', html: view.prescreen.map((q, i) => renderQuestion('prescreen', q, i)).join('') });

  const cfg = JSON.stringify({ captcha: view.captcha, collect: view.collect, steps: steps.map((s) => s.id), human: view.human ? { kind: view.human.kind, style: view.human.style } : null }).replace(/</g, '\\u003c');
  const total = steps.length;
  const stepHtml = steps
    .map(
      (s, i) => `<section class="step" data-step="${s.id}"${i ? ' hidden' : ''}>${total > 1 ? `<p class="prog">Step ${i + 1} of ${total}</p>` : ''}<h1>${s.title}</h1><p class="intro">${s.intro}</p>${s.html}
<button type="button" class="next">${i === total - 1 ? 'Start survey' : 'Continue'}</button></section>`,
    )
    .join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Survey</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;--bg:#f5f7fb;--card:#fff;--ink:#111827;--muted:#6b7280;--line:#e5e7eb;--brand:#2563eb;--brand-ink:#fff;--bad:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#121a2f;--ink:#e5e7eb;--muted:#9ca3af;--line:#243049;--brand:#60a5fa;--brand-ink:#0b1020;--bad:#f87171}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
main{width:100%;max-width:36rem;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
h1{font-size:1.25rem;margin:0 0 4px}.intro{margin:0 0 20px;color:var(--muted)}.prog{margin:0 0 6px;font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
fieldset{border:0;margin:0 0 22px;padding:0;min-width:0}legend{font-weight:600;margin-bottom:8px;padding:0}.qn{color:var(--muted);font-weight:500}.opt-tag,.help{color:var(--muted);font-weight:400;font-size:.875rem}.help{margin:-4px 0 8px}
.opt{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer}
.opt:has(input:checked),.pill:has(input:checked){border-color:var(--brand);box-shadow:0 0 0 1px var(--brand)}input[type=radio],input[type=checkbox]{accent-color:var(--brand);width:18px;height:18px;flex:none}
input[type=text],input[type=number],input[type=email],select{width:100%;font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:10px;padding:10px 12px}
input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.grow{border-top:1px solid var(--line);padding:10px 0}.glabel{font-size:.95rem;margin-bottom:6px}.gopts{display:flex;flex-wrap:wrap;gap:6px}
.pill{display:flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:999px;padding:6px 10px;font-size:.875rem;cursor:pointer}
button{width:100%;border:0;border-radius:10px;padding:12px 16px;font:inherit;font-weight:600;background:var(--brand);color:var(--brand-ink);cursor:pointer}
button:disabled{opacity:.6;cursor:progress}.spin{width:28px;height:28px;border:3px solid var(--line);border-top-color:var(--brand);border-radius:50%;animation:s 1s linear infinite;margin:8px auto 16px}
@keyframes s{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.spin{animation:none}}
.cimg{display:block;width:100%;max-width:330px;height:auto;border:1px solid var(--line);border-radius:10px;margin-bottom:10px;background:#f8fafc}
.qerr,.err{color:var(--bad);font-size:.875rem;margin:6px 0 0}.q.bad legend{color:var(--bad)}[hidden]{display:none!important}
</style></head><body><main>
<noscript><h1>Please turn on JavaScript</h1><p class="intro">This survey needs JavaScript to start.</p></noscript>
<form id="f" hidden novalidate>
${stepHtml}
<section class="step" data-step="wait"${total ? ' hidden' : ''}><div class="spin" role="status" aria-label="Loading"></div><h1>Starting your survey</h1><p class="intro">This takes a few seconds.</p></section>
<p class="err" id="err" role="alert" hidden></p>
</form>
${view.human?.kind === 'widget' ? `<script nonce="${nonce}" src="${PROVIDERS[view.human.style as 'turnstile' | 'hcaptcha'].script}" async defer></script>` : ''}
<script type="application/json" id="cfg">${cfg}</script>
<script nonce="${nonce}">
(function(){
var cfg=JSON.parse(document.getElementById('cfg').textContent);var f=document.getElementById('f');f.hidden=false;var err=document.getElementById('err');
var FORMATS={letters:/^[\\p{L}\\p{M}' .-]+$/u,digits:/^\\d+$/,alphanumeric:/^[\\p{L}\\p{N} ]+$/u,email:/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/,postal:/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/,phone:/^\\+?[0-9 ()-]{6,20}$/};
function hex(b){return Array.prototype.map.call(new Uint8Array(b),function(x){return ('0'+x.toString(16)).slice(-2)}).join('')}
function sha(s){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))}
function zeros(b){var a=new Uint8Array(b),n=0;for(var i=0;i<a.length;i++){if(a[i]===0){n+=8;continue}var v=a[i];while(!(v&128)){n++;v<<=1}break}return n}
async function solve(c){for(var n=0;n<5e7;n++){if(zeros(await sha(c.challenge+':'+n))>=c.bits)return n}return -1}
function canvas(){try{var c=document.createElement('canvas');c.width=240;c.height=60;var x=c.getContext('2d');x.textBaseline='top';x.font='16px Arial';x.fillStyle='#f60';x.fillRect(100,1,62,20);x.fillStyle='#069';x.fillText('Sampledge \\u{1F50D} 2026',2,15);x.fillStyle='rgba(102,204,0,.7)';x.fillText('Sampledge \\u{1F50D} 2026',4,17);return c.toDataURL()}catch(e){return ''}}
function gl(){try{var g=document.createElement('canvas').getContext('webgl');var d=g&&g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):''}catch(e){return ''}}
var tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(e){}
var work=(async function(){var out={};
 if(cfg.collect.languages)out.languages=navigator.languages&&navigator.languages.length?Array.prototype.slice.call(navigator.languages):[navigator.language];
 if(cfg.collect.timezone)out.timezone=tz;
 if(cfg.collect.fingerprint)out.fingerprint=hex(await sha(JSON.stringify([navigator.userAgent,navigator.languages,navigator.platform,navigator.hardwareConcurrency,navigator.deviceMemory,screen.width,screen.height,screen.colorDepth,window.devicePixelRatio,tz,canvas(),gl()])));
 if(cfg.captcha)out.nonce=await solve(cfg.captcha);
 return out})();
function post(path,body){return fetch(location.pathname+path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})}
function fail(){err.textContent='Something went wrong. Please check your connection and try again.';err.hidden=false}
function show(id){Array.prototype.forEach.call(f.querySelectorAll('.step'),function(s){s.hidden=s.getAttribute('data-step')!==id});window.scrollTo(0,0);var first=f.querySelector('.step[data-step="'+id+'"] input,.step[data-step="'+id+'"] select');if(first&&id!=='wait')first.focus({preventScroll:true})}
// "None of these" clears other choices, and choosing another clears it.
f.addEventListener('change',function(e){var t=e.target;if(t.type!=='checkbox'||!t.checked)return;var box=t.closest('fieldset');Array.prototype.forEach.call(box.querySelectorAll('input[type=checkbox]'),function(o){if(o!==t&&(t.dataset.exclusive||o.dataset.exclusive))o.checked=false})});
function readQ(fs){var type=fs.dataset.type,req=fs.dataset.required==='1',name=fs.dataset.section+'.'+fs.dataset.qid,d=fs.dataset,v,msg='';
 if(type==='single'){var c=fs.querySelector('input:checked');v=c?c.value:''}
 else if(type==='multi'){v=Array.prototype.map.call(fs.querySelectorAll('input:checked'),function(i){return i.value});
  if(v.length&&d.minSelect&&v.length<+d.minSelect)msg='Choose at least '+d.minSelect+'.';if(d.maxSelect&&v.length>+d.maxSelect)msg='Choose no more than '+d.maxSelect+'.'}
 else if(type==='dropdown'){v=fs.querySelector('select').value}
 else if(type==='number'){var raw=fs.querySelector('input').value.trim();v=raw===''?'':Number(raw);
  if(raw!==''){if(!isFinite(v))msg='Enter a number.';else if(d.integer&&v%1)msg='Enter a whole number.';else if(d.min!==undefined&&v<+d.min)msg='Enter '+d.min+' or more.';else if(d.max!==undefined&&v>+d.max)msg='Enter '+d.max+' or less.'}}
 else if(type==='text'){v=fs.querySelector('input').value.trim();
  if(v){if(d.minLength&&v.length<+d.minLength)msg='Enter at least '+d.minLength+' characters.';else if(d.maxLength&&v.length>+d.maxLength)msg='Enter at most '+d.maxLength+' characters.';else if(d.format&&FORMATS[d.format]&&!FORMATS[d.format].test(v))msg='Check the format of your answer.'}}
 else if(type==='grid'){v={};var missing=false;Array.prototype.forEach.call(fs.querySelectorAll('.grow'),function(r){var c=r.querySelector('input:checked');if(c)v[r.dataset.row]=c.value;else missing=true});if(missing&&Object.keys(v).length)msg='Answer every row.';if(missing&&!Object.keys(v).length)v={}}
 var empty=v===''||(Array.isArray(v)&&!v.length)||(v&&typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v).length);
 if(!msg&&empty&&req)msg='Please answer this question.';
 var e=fs.querySelector('.qerr');e.textContent=msg;e.hidden=!msg;fs.classList.toggle('bad',!!msg);
 return {ok:!msg,empty:empty,value:v}}
var answers={gate:{},prescreen:{}};
function collect(stepId){var ok=true,firstBad=null;Array.prototype.forEach.call(f.querySelectorAll('.step[data-step="'+stepId+'"] fieldset[data-qid]'),function(fs){var r=readQ(fs);if(!r.ok){ok=false;firstBad=firstBad||fs}else if(!r.empty)answers[fs.dataset.section][fs.dataset.qid]=r.value});if(firstBad)firstBad.scrollIntoView({block:'center'});return ok}
var idx=0,busy=false,widgetToken='';
window.pxCaptcha=function(t){widgetToken=t;var he=document.getElementById('herr');if(he)he.hidden=true};window.pxCaptchaExpired=function(){widgetToken=''};
async function next(){if(busy)return;err.hidden=true;var id=cfg.steps[idx];
 if(id==='human'){var he=document.getElementById('herr'),k=cfg.human.kind,ans='';
  if(k==='choice'){var c=f.querySelector('input[name=human]:checked');ans=c?c.value:''}else if(k==='widget'){ans=widgetToken}else{ans=document.getElementById('ha').value.trim()}
  if(!ans){he.textContent=k==='widget'?'Please complete the check.':k==='choice'?'Please choose an answer.':'Please type your answer.';he.hidden=false;return}
  busy=true;try{var r=await post('/human',{answer:ans});busy=false;if(r.location)return location.replace(r.location);
   if(!r.ok){var h=r.human;document.getElementById('hq').textContent=h.question;
    if(k==='choice'){var box=document.getElementById('hopts');box.textContent='';h.options.forEach(function(o){var l=document.createElement('label');l.className='opt';var i=document.createElement('input');i.type='radio';i.name='human';i.value=o;var s=document.createElement('span');s.textContent=o;l.appendChild(i);l.appendChild(s);box.appendChild(l)})}
    else if(k==='image'){document.getElementById('himg').src=location.pathname+'/captcha.svg?a='+h.attemptsLeft;document.getElementById('ha').value=''}
    else if(k==='widget'){widgetToken='';try{(window.turnstile||window.hcaptcha).reset()}catch(e){}}
    else{document.getElementById('ha').value=''}
    he.textContent=(k==='widget'?'The check did not pass. Please try again':'That is not right. Try this one')+' ('+h.attemptsLeft+' '+(h.attemptsLeft===1?'try':'tries')+' left).';he.hidden=false;return}}
  catch(e){busy=false;return fail()}}
 else if(!collect(id))return;
 idx++;if(idx<cfg.steps.length)return show(cfg.steps[idx]);
 submit()}
async function submit(){busy=true;show('wait');
 try{var body=await work;body.answers=answers;var j=await post('',body);if(!j.location)throw new Error('no location');location.replace(j.location)}
 catch(e){busy=false;idx=Math.max(0,cfg.steps.length-1);if(cfg.steps.length)show(cfg.steps[idx]);fail();if(!cfg.steps.length){var b=document.createElement('button');b.type='button';b.textContent='Try again';b.onclick=function(){b.remove();submit()};f.appendChild(b)}}}
Array.prototype.forEach.call(f.querySelectorAll('.next'),function(b){b.addEventListener('click',next)});
f.addEventListener('submit',function(e){e.preventDefault();next()});
if(!cfg.steps.length)submit();else show(cfg.steps[0]);
})();
</script></main></body></html>`;
}
