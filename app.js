/* GT‑Bot PWA: фронтенд */
const $ = sel => document.querySelector(sel);
const tpl = $('#rowTpl').content;

const state = {
  cfg: {
    baseUrl: localStorage.getItem('gt.baseUrl') || 'https://gtbotproxy.onrender.com',
    token:   localStorage.getItem('gt.token')   || '',
    dust:    parseFloat(localStorage.getItem('gt.dust') || '1') || 1,
    method:  localStorage.getItem('gt.method')  || 'fifo',
  },
  prices: {},
  rows: []
};

function fmtNum(n, d=8){
  const x = Number(n);
  if (!isFinite(x)) return '—';
  return x.toLocaleString(undefined, {maximumFractionDigits:d});
}
function round2(n){ return Math.round((Number(n)+Number.EPSILON)*100)/100; }
function nowStr(){
  return new Date().toLocaleString();
}

function setStatus(msg, isErr=false){
  const box = $('#status');
  if (!msg){ box.classList.add('hidden'); box.textContent=''; return; }
  box.textContent = msg;
  box.classList.toggle('error', !!isErr);
  box.classList.remove('hidden');
}

function saveCfg(){
  const baseUrl = $('#baseUrl').value.trim().replace(/\/+$/,'');
  const token   = $('#proxyToken').value.trim();
  const dust    = parseFloat($('#dustThreshold').value || '1') || 1;
  const method  = $('#avgMethod').value;
  state.cfg = { baseUrl, token, dust, method };
  localStorage.setItem('gt.baseUrl', baseUrl);
  localStorage.setItem('gt.token', token);
  localStorage.setItem('gt.dust', String(dust));
  localStorage.setItem('gt.method', method);
  setStatus('Настройки сохранены.');
}

function loadCfgToForm(){
  $('#baseUrl').value     = state.cfg.baseUrl;
  $('#proxyToken').value  = state.cfg.token;
  $('#dustThreshold').value = state.cfg.dust;
  $('#avgMethod').value   = state.cfg.method;
}

function loadDemoCfg(){
  $('#baseUrl').value = 'https://gtbotproxy.onrender.com';
  $('#proxyToken').value = '';
  $('#dustThreshold').value = '1';
  $('#avgMethod').value = 'fifo';
  saveCfg();
}

async function fetchJson(url){
  const headers = {'Accept':'application/json'};
  if (state.cfg.token) headers['X-Proxy-Token'] = state.cfg.token;
  const t0 = performance.now();
  const r = await fetch(url, { headers });
  const ms = Math.round(performance.now() - t0);
  let text = await r.text();
  try {
    const json = text ? JSON.parse(text) : {};
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { ok:true, json, ms };
  } catch(e){
    return { ok:false, err:e.message, http:r.status, body:text, ms };
  }
}

async function getBalance(){
  const base = state.cfg.baseUrl;
  return await fetchJson(base + '/v1/bybit/account/balance');
}

async function getPrices(symbols){
  if (!symbols.length) return {};
  const base = state.cfg.baseUrl;
  const url = base + '/v1/bybit/prices?symbols=' + encodeURIComponent(symbols.join(','));
  const r = await fetchJson(url);
  if (r.ok && r.json && r.json.data) return r.json.data;
  return {};
}

async function getAvg(symbol){
  const base = state.cfg.baseUrl;
  const q = new URLSearchParams({
    symbol,
    category:'spot',
    days:'730',
    method: state.cfg.method || 'fifo'
  }).toString();
  const url = base + '/v1/bybit/avg?' + q;
  const r = await fetchJson(url);
  if (r.ok && (r.json.ok===true || r.json.retCode===0) && r.json.avg !== undefined){
    return Number(r.json.avg) || 0;
  }
  // fallback: empty
  return 0;
}

async function refresh(){
  setStatus('Загружаю баланс…');
  $('#refresh').disabled = true;
  try{
    const bal = await getBalance();
    if (!bal.ok){ throw new Error(`Баланс: ${bal.err||bal.http}`); }
    const coins = ((bal.json && bal.json.result && bal.json.result.list && bal.json.result.list[0] && bal.json.result.list[0].coin) || []);

    // собрать список символов и расчёт свободных USDT
    let freeUSDT = 0;
    const items = [];
    for (const c of coins){
      const coin = String(c.coin||'').toUpperCase();
      const qty  = Number(c.availableToWithdraw ?? c.walletBalance ?? c.equity ?? 0) || 0;
      const usdV = Number(c.usdValue||0) || 0;
      if (coin === 'USDT'){
        const wd = Number(c.availableToWithdraw ?? c.availableBalance ?? c.totalAvailableBalance ?? c.cashBalance ?? 0) || 0;
        freeUSDT = wd>0 ? wd : Number(c.walletBalance ?? c.equity ?? 0) || 0;
        continue;
      }
      if (!qty && !usdV) continue;
      items.push({ coin, symbol: coin+'USDT', qty, usdV });
    }

    // получаем рыночные цены батчем
    const symbols = items.map(x => x.symbol);
    setStatus('Получаю рыночные цены…');
    const priceMap = await getPrices(symbols);

    // основная корзина (>= dust)
    const dust = state.cfg.dust || 1;
    const main = [];
    for (const it of items){
      let market = Number(priceMap[it.symbol] || 0);
      if (!market && it.qty && it.usdV) market = it.usdV / it.qty;
      const cost = it.usdV ? it.usdV : (market && it.qty ? market*it.qty : 0);
      if (cost >= dust) main.push({ ...it, market, cost });
    }

    // средние считаем параллельно, но ограничим одновременные запросы
    setStatus('Считаю средние (может занять время)…');
    const limit = 3;
    let i = 0;
    async function worker(){
      while (i < main.length){
        const idx = i++;
        const s = main[idx].symbol;
        main[idx].avg = await getAvg(s);
      }
    }
    await Promise.all(Array.from({length:limit}, worker));

    // посчитать PnL
    let total = 0;
    for (const r of main){
      const avg = Number(r.avg||0);
      const mkt = Number(r.market||0);
      const qty = Number(r.qty||0);
      const val = Number(r.cost||0);
      total += val;
      r.pnlPct = (avg>0 && mkt>0) ? ( (mkt-avg)/avg*100 ) : 0;
      r.pnlUsd = (avg>0 && qty>0 && mkt>0) ? ( (mkt-avg)*qty ) : 0;
    }

    // рендер
    render(main, freeUSDT, total);
    setStatus('Готово.');
  }catch(e){
    console.error(e);
    setStatus('Ошибка: ' + e.message, true);
  }finally{
    $('#refresh').disabled = false;
  }
}

function render(rows, freeUSDT, totalUsd){
  $('#freeUsdt').textContent = fmtNum(round2(freeUSDT), 2);
  $('#totalUsd').textContent = fmtNum(round2(totalUsd + freeUSDT), 2);
  $('#updatedAt').textContent = 'Обновлено: ' + nowStr();

  const tb = $('#portfolio tbody');
  tb.innerHTML = '';
  const sorted = rows.slice().sort((a,b)=> (b.cost||0)-(a.cost||0));

  for (const r of sorted){
    const tr = document.importNode(tpl, true);
    tr.querySelector('.sym').textContent = r.symbol;
    tr.querySelector('.qty').textContent = fmtNum(r.qty, 8);
    tr.querySelector('.avg').textContent = r.avg ? fmtNum(r.avg, 10) : '—';
    tr.querySelector('.mkt').textContent = r.market ? fmtNum(r.market, 10) : '—';
    tr.querySelector('.val').textContent = fmtNum(round2(r.cost||0), 2);

    const pnlp = tr.querySelector('.pnlp');
    const pnlu = tr.querySelector('.pnlu');
    pnlp.textContent = r.avg ? fmtNum(r.pnlPct, 2) : '—';
    pnlu.textContent = r.avg ? fmtNum(round2(r.pnlUsd), 2) : '—';

    if (r.avg){
      if (r.pnlUsd > 0){ pnlp.classList.add('green'); pnlu.classList.add('green'); }
      else if (r.pnlUsd < 0){ pnlp.classList.add('red'); pnlu.classList.add('red'); }
    }

    tb.appendChild(tr);
  }
}

/* UI */
$('#saveCfg').addEventListener('click', saveCfg);
$('#loadDemo').addEventListener('click', loadDemoCfg);
$('#refresh').addEventListener('click', refresh);
$('#clearCache').addEventListener('click', async () => {
  if ('caches' in window){
    const names = await caches.keys();
    await Promise.all(names.map(n => caches.delete(n)));
    setStatus('Кеш очищен.');
  }
});

/* PWA install prompt */
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#installBtn').hidden = true;
});

/* SW */
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js');
  });
}

/* init */
loadCfgToForm();
