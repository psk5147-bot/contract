/* Contract draft v1. Local-only; load AFTER the application's classic scripts.
 * No database/network/photo/credential access. Strict allowlists, bounded JSON,
 * transactional restore, optimistic cross-tab conflict detection.
 */
(function () {
  'use strict';
  if (window.ContractDraft) return;
  const KEY = 'hwacheon.contract.draft.v1';
  const MAX = 240000, AGE = 30 * 86400000, WAIT = 550;
  const FIELDS = ['c_date','b_name','b_reg','b_addr','b_rep','deposit','btiming',
    'd_month','d_day','d_within','d_custom','asper'];
  const PENDING = ['i_nm','i_sp','i_qt','i_unit','i_unit_custom','i_pr','i_nt'];
  const ITEM = ['nm','sp','qt','unit','pr','prFmt','nt'];
  const FORM = ['ctype',...FIELDS,'items','sangcha','art5','art8','asis'];
  let timer = null, paused = 0, blocked = false, seen = null;
  let suppressed = null, persisted = null, boot = null;
  let listMode = false, parked = null, identityEpoch = 0, lastWriteStep = 0;
  const activeStep = () => {
    const active = document.querySelector('.step.active');
    return active ? Number(active.id.replace(/^s/,'')) : 0;
  };
  const inList = () => listMode || activeStep() === 6;
  const identity = () => ({editId:window._curEditId || null,docNo:window._curDocNo || '',
    depEdited:window._depEdited === true,lastSavedSig:window._lastSavedSig == null ? null : window._lastSavedSig});
  const el = id => document.getElementById(id);
  const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
  const fail = () => { throw new Error('Invalid local draft'); };
  function record(o, keys) {
    if (!o || typeof o !== 'object' || Array.isArray(o) ||
        Object.getPrototypeOf(o) !== Object.prototype) fail();
    if (Object.keys(o).length !== keys.length || !keys.every(k => own(o,k))) fail();
    for (const k of Object.keys(o)) if (!keys.includes(k)) fail();
  }
  function text(v, limit = 4000) {
    // Existing renderItems/buildSum use innerHTML: never restore markup there.
    if (typeof v !== 'string' || v.length > limit || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail();
    return v;
  }
  function choice(v, list) { if (!list.includes(v)) fail(); return v; }
  function bool(v) { if (typeof v !== 'boolean') fail(); return v; }
  function numeric(v) { text(v,32); if (!/^[\d,]*$/.test(v)) fail(); return v; }
  function field(id,v) {
    text(v);
    const node = el(id);
    if (!node || node.type === 'password' || node.type === 'file') fail();
    if (node.tagName === 'SELECT' && !Array.from(node.options).some(o => o.value === v)) fail();
    if (id === 'deposit' || id === 'i_pr') numeric(v);
    if (id === 'i_qt' && v !== '' && !/^\d{1,8}$/.test(v)) fail();
    if (id === 'd_custom' && v !== '' && !/^(?:[1-9]|[12]\d|3[01])$/.test(v)) fail();
    if (id === 'c_date' && v !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail();
      const date = new Date(v+'T00:00:00Z');
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== v) fail();
    }
    return v;
  }
  function form(d) {
    record(d, FORM);
    const o = {};
    o.ctype = choice(d.ctype,['sell','buy']);
    FIELDS.forEach(k => { o[k] = field(k,d[k]); });
    if (!Array.isArray(d.items) || d.items.length > 100) fail();
    o.items = d.items.map(it => {
      record(it,ITEM);
      const out = {};
      ITEM.forEach(k => { out[k] = text(it[k], k === 'nt' ? 4000 : 1000); });
      if (!out.nm.trim() || !/^\d{1,8}$/.test(out.qt) || !/^\d{0,16}$/.test(out.pr)) fail();
      // Display amount is derived, not trusted HTML or inconsistent cached text.
      const expected = out.pr ? Number(out.pr).toLocaleString() : '포함';
      if (out.prFmt !== expected || !Number.isSafeInteger(Number(out.pr || '0'))) fail();
      return out;
    });
    o.sangcha = choice(d.sangcha,['상차도 조건','구매자 상차 조건','']);
    o.art5 = choice(d.art5,['single','double']);
    o.art8 = bool(d.art8); o.asis = bool(d.asis);
    return o;
  }
  function validate(d) {
    record(d,['version','savedAt','form','pending','meta']);
    if (d.version !== 1 || !Number.isSafeInteger(d.savedAt) || d.savedAt < 1 || d.savedAt > Date.now()+300000) fail();
    const f = form(d.form), p = {};
    record(d.pending,PENDING); PENDING.forEach(k => { p[k] = field(k,d.pending[k]); });
    record(d.meta,['step','editId','docNo','depEdited','lastSavedSig']);
    const m = d.meta;
    if (!Number.isInteger(m.step) || m.step < 0 || m.step > 5) fail();
    if (m.editId !== null && (typeof m.editId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(m.editId))) fail();
    text(m.docNo,160);
    if (m.lastSavedSig !== null) {
      if (typeof m.lastSavedSig !== 'string' || m.lastSavedSig.length > MAX) fail();
      form(JSON.parse(m.lastSavedSig));
    }
    return {version:1,savedAt:d.savedAt,form:f,pending:p,meta:{step:m.step,editId:m.editId,
      docNo:m.docNo,depEdited:bool(m.depEdited),lastSavedSig:m.lastSavedSig}};
  }
  function capture() {
    const p = {};
    PENDING.forEach(k => { p[k] = el(k).value; });
    const current = activeStep();
    if (current >= 0 && current <= 5) lastWriteStep = current;
    // s6 is a list, never a sixth contract stage. A list snapshot is read-only.
    const step = current === 6 ? lastWriteStep : current;
    const meta = inList() && parked && parked.epoch === identityEpoch ? parked.meta : identity();
    return validate({version:1,savedAt:Date.now(),form:getFormData(),pending:p,
      meta:{step,...meta}});
  }
  const content = d => JSON.stringify({form:d.form,pending:d.pending});
  const state = d => JSON.stringify({form:d.form,pending:d.pending,meta:d.meta});
  function blank(d) {
    const f = d.form;
    return !d.meta.editId && !d.meta.docNo && !d.meta.lastSavedSig && f.ctype === 'sell' &&
      ['b_name','b_reg','b_addr','b_rep','d_month','d_custom'].every(k => !f[k]) &&
      !f.items.length && (!f.deposit || f.deposit === '0') &&
      f.btiming === '상차 후 출발 전' && f.d_day === '말일' && f.d_within === '이내' &&
      f.asper === '없음' && f.sangcha === '상차도 조건' && f.art5 === 'single' && f.art8 && !f.asis &&
      PENDING.every(k => k === 'i_unit' ? d.pending[k] === '대' : !d.pending[k]);
  }
  function status(message, action) {
    let node = el('contract-draft-status');
    if (!node) { node = document.createElement('div'); node.id = 'contract-draft-status';
      node.setAttribute('role','status'); document.body.appendChild(node); }
    node.textContent = message;
    if (action) {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = '임시보관 복원'; button.addEventListener('click',() => restore()); node.appendChild(button);
      const discard = document.createElement('button'); discard.type = 'button';
      discard.textContent = '임시보관 삭제'; discard.addEventListener('click',() => {
        if (window.confirm('이 기기의 임시보관을 삭제할까요? 현재 작성 화면은 유지됩니다.')) clear();
      }); node.appendChild(discard);
    }
  }
  function read() {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null && raw.length > MAX) fail();
    return raw;
  }
  function schedule() {
    if (paused || blocked || inList()) return;
    clearTimeout(timer); timer = setTimeout(flush,WAIT);
  }
  function flush() {
    clearTimeout(timer); timer = null;
    if (paused || blocked || inList()) return false;
    try {
      const d = capture(), sig = content(d), st = state(d);
      if (read() !== seen) { blocked = true; status('다른 탭의 임시보관 변경을 발견했습니다. 현재 화면은 유지됩니다.',true); return false; }
      if (sig === suppressed || st === persisted || (blank(d) && seen === null)) return true;
      const raw = JSON.stringify(d); if (raw.length > MAX) fail();
      window.localStorage.setItem(KEY,raw); seen = raw; persisted = st;
      status('이 기기에 자동 임시보관됨 · '+new Date(d.savedAt).toLocaleTimeString('ko-KR'));
      return true;
    } catch (_) { status('임시보관을 사용할 수 없습니다. 작성 내용은 현재 화면에 유지됩니다.'); return false; }
  }
  function clear() {
    clearTimeout(timer); timer = null;
    try {
      // Do not silently erase another tab's newer draft.
      if (read() !== seen) { blocked = true; status('다른 탭의 임시보관은 삭제하지 않았습니다. 현재 화면은 유지됩니다.',true); return false; }
      window.localStorage.removeItem(KEY); seen = null; blocked = false; persisted = null;
      try { suppressed = content(capture()); } catch (_) { suppressed = null; }
      status('로컬 임시보관을 비웠습니다.'); return true;
    } catch (_) { status('임시보관 삭제가 차단되었습니다. 현재 화면은 유지됩니다.'); return false; }
  }
  function apply(d) {
    const f = d.form;
    // Set identity explicitly, including null, so new/edit IDs cannot bleed across.
    window._curEditId = d.meta.editId; window._curDocNo = d.meta.docNo;
    window._depEdited = d.meta.depEdited; window._lastSavedSig = d.meta.lastSavedSig;
    setType(f.ctype); items = f.items.map(it => ({...it}));
    FIELDS.forEach(k => { el(k).value = f[k]; });
    renderItems(); calcAll(); _goRaw(1); _goRaw(d.meta.step);
    // _goRaw(4) calls initArt5, resetting BOTH clauses. Restore them AFTER navigation.
    initArt5();
    art5 = f.ctype === 'buy' ? 'double' : f.art5;
    if (f.ctype !== 'buy') pickArt5(art5);
    pickArt8(f.art8); pickAsis(f.asis); pickSangcha(f.sangcha);
    el('deposit').value = f.deposit; calcBal();
    PENDING.forEach(k => { el(k).value = d.pending[k]; });
    el('i_unit_custom').style.display = d.pending.i_unit === '직접입력' ? 'block' : 'none';
    updateDelivery(); updateAsNote();
    if (d.meta.step === 5) _goRaw(5); // refresh summary AFTER restoring legal/deposit state
  }
  function restore(automatic = false) {
    let before;
    try {
      const raw = read(); if (!raw) { status('복원할 임시보관이 없습니다.'); return false; }
      const d = validate(JSON.parse(raw)); before = capture();
      if (automatic && (!blank(before) || Date.now()-d.savedAt >= AGE)) return false;
      if (!automatic && !blank(before) && !window.confirm('현재 작성 내용을 이 기기의 임시보관으로 바꿀까요?')) return false;
      paused++;
      try { apply(d); } catch (error) { try { apply(before); } catch (_) {} throw error; }
      finally { paused--; }
      identityEpoch++; parked = null; listMode = false;
      seen = raw; blocked = false; suppressed = null; persisted = state(capture());
      status('이 기기의 작성 내용을 복원했습니다. 계약서는 전송/저장하지 않았습니다.'); return true;
    } catch (_) { status('임시보관 형식이 올바르지 않거나 사용할 수 없습니다. 현재 화면을 유지합니다.'); return false; }
  }
  function wrap(name) {
    const original = window[name]; if (typeof original !== 'function') return;
    window[name] = function (...args) {
      try {
        const result = original.apply(this,args);
        if (result && typeof result.then === 'function') {
          return result.then(value => { schedule(); return value; }, error => { schedule(); throw error; });
        }
        schedule(); return result;
      } catch (error) { schedule(); throw error; }
    };
  }
  // No generic form scanning: credentials, OCR images, AI state never enter storage.
  ['input','change'].forEach(event => document.addEventListener(event,e => {
    if (e.target && [...FIELDS,...PENDING].includes(e.target.id)) schedule();
  }));
  ['setType','renderItems','calcAll','calcBal','pickSangcha','pickArt5','pickArt8','pickAsis',
    'initArt5','_goRaw','go','addItem','delItem'].forEach(wrap);
  function enterList() {
    if (inList()) { clearTimeout(timer); timer = null; return; }
    // Flush BEFORE original switchTab resets the edit identity or activates s6.
    flush();
    parked = {epoch:identityEpoch,meta:identity()};
    listMode = true; clearTimeout(timer); timer = null;
  }
  const originalTab = window.switchTab;
  if (typeof originalTab === 'function') window.switchTab = function (t,...args) {
    if (t === 'list') {
      enterList();
      return originalTab.call(this,t,...args);
    }
    const keep = inList()
      ? (parked && parked.epoch === identityEpoch ? parked.meta : null)
      : identity();
    const result = originalTab.call(this,t,...args);
    listMode = false; parked = null;
    if (keep) {
      window._curEditId = keep.editId; window._curDocNo = keep.docNo;
      window._depEdited = keep.depEdited; window._lastSavedSig = keep.lastSavedSig;
    }
    schedule(); return result;
  };
  const originalList = window.showList;
  if (typeof originalList === 'function') window.showList = function (...args) {
    enterList(); return originalList.apply(this,args);
  };
  const originalLoad = window.loadAndEdit;
  if (typeof originalLoad === 'function') window.loadAndEdit = async function (id,...args) {
    if (!inList()) flush();
    // Invalidate parked identity BEFORE asynchronous lookup. Never attach the old
    // contract ID to a different loaded form, even if the forms happen to match.
    const prior = parked, epoch = ++identityEpoch;
    parked = null; clearTimeout(timer); timer = null; paused++;
    try {
      const result = await originalLoad.call(this,id,...args);
      if (identityEpoch === epoch) {
        if (activeStep() !== 6 && window._curEditId === id) listMode = false;
        else if (prior && activeStep() === 6) parked = {epoch,meta:prior.meta};
      }
      return result;
    } catch (error) {
      if (identityEpoch === epoch && prior && activeStep() === 6) parked = {epoch,meta:prior.meta};
      throw error;
    } finally { paused--; schedule(); }
  };
  const originalSave = window.saveContract;
  if (typeof originalSave === 'function') window.saveContract = async function (item,id) {
    // Preserve original arguments, ID, result, errors and PDF numbering policy.
    const result = await originalSave.apply(this,arguments);
    try {
      const saved = JSON.stringify(form(item.formData));
      const current = capture();
      if (JSON.stringify(current.form) === saved) clear();
      else flush(); // user typed while the real save was pending: keep newer work
    } catch (_) { schedule(); }
    return result;
  };
  const originalNew = window.newContract;
  if (typeof originalNew === 'function') window.newContract = function (...args) {
    let current;
    try { current = capture(); } catch (_) {}
    if ((!current || !blank(current)) && !window.confirm('작성 중인 내용을 지우고 새 계약서를 시작할까요?')) return;
    // Stop a queued autosave from recreating the discarded draft.
    clearTimeout(timer); timer = null; paused++;
    identityEpoch++; parked = null;
    let result;
    try {
      result = originalNew.apply(this,args);
      PENDING.forEach(k => { el(k).value = k === 'i_unit' ? '대' : ''; });
      el('i_unit_custom').style.display = 'none';
    } finally { paused--; }
    clear(); return result;
  };
  window.addEventListener('pagehide',flush);
  document.addEventListener('visibilitychange',() => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('storage',e => {
    if (e.key !== KEY && e.key !== null) return;
    clearTimeout(timer); timer = null; blocked = true;
    status('다른 탭에서 임시보관이 변경되었습니다. 현재 화면은 유지됩니다.',true);
  });
  window.ContractDraft = {flush,clear,restore:() => restore(false)};
  try {
    listMode = activeStep() === 6;
    boot = capture(); seen = read();
    if (seen) {
      const cached = validate(JSON.parse(seen));
      if (Date.now()-cached.savedAt >= AGE) {
        blocked = true; status('30일 지난 임시보관입니다. 자동복원하지 않았습니다. 복원 또는 삭제를 선택하세요.',true);
      } else if (inList() || !blank(boot)) {
        blocked = true; status('작성 중인 화면을 유지했습니다. 별도 임시보관은 명시적으로 복원할 수 있습니다.',true);
      } else restore(true);
    } else status('입력 내용은 이 기기에만 자동 임시보관됩니다. 공용 기기 사용에 주의하세요.');
  } catch (_) {
    blocked = true; status('임시보관을 읽을 수 없습니다. 기존 작성 기능은 그대로 사용할 수 있습니다.');
  }
})();
