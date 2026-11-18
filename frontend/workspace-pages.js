'use strict';
/* 工作台 / 报告复核 / 患者索引 / 系统状态 / 帮助中心
 * 纯前端页面，数据来自现有后端接口（/api/medical/*）与 security-data.js 演示数据。
 */
(function () {
  var SEC = window.SEC;
  function ui() { return window.__ui || {}; }
  function esc(v) { return ui().esc ? ui().esc(v) : String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function $(s) { return document.querySelector(s); }
  function main() { return document.getElementById('main'); }
  function toast(m) { if (ui().toast) ui().toast(m); }
  function api(path, method, data) { return ui().medicalRequest(path, method || 'GET', data); }
  function heading(eyebrow, title, desc, actions) {
    return '<div class="page-heading"><div><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1><p>' + desc + '</p></div>' +
      (actions ? '<div class="sec-actions">' + actions + '</div>' : '') + '</div>';
  }
  function panel(title, meta, body) {
    return '<section class="records-panel"><div class="panel-title"><h2>' + title + '</h2><span>' + (meta || '') + '</span></div><div class="sec-panel-body">' + body + '</section>';
  }
  function table(headers, rows) {
    return '<div class="table-scroll"><table><thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function badge(text, kind) { return '<span class="sec-badge ' + (kind || '') + '">' + esc(text) + '</span>'; }
  function statusBadge(status) {
    if (status === '已复核') return badge(status, 'ok');
    if (status === '待处理') return badge(status, 'warn');
    return badge(status || '—', '');
  }
  function errorBox(message, retryId) {
    return '<div class="sec-verify bad">后端连接失败：' + esc(message) + '　<button class="text-button" id="' + retryId + '">重试</button></div>';
  }
  function shortHash(h, n) { if (!h) return '—'; return h.slice(0, n || 12) + '…' + h.slice(-4); }
  function fmtTime(v) { return v ? String(v).replace('T', ' ').slice(0, 16) : '—'; }
  function countBy(list, status) { return list.filter(function (r) { return r.status === status; }).length; }
  function visibleRecords(list) {
    return (list || []).filter(function (r) {
      return String(r.patientId || '').indexOf('API-TEST') !== 0 && !/接口测试/.test(r.title || '');
    });
  }

  /* 与“皮肤检验”页内置示例记录一致的患者演示数据（不写入后端） */
  var DEMO_RECORDS = [
    { patientId: 'P-DEMO-001', patientName: '示例患者 A', center: 'imaging', type: 'CT', title: '胸部 CT', status: '待处理', date: '2026-11-07', demo: true },
    { patientId: 'P-DEMO-SKIN', patientName: '皮肤检验示例', center: 'lab', type: '皮肤检验', title: '皮肤检查记录', status: '待处理', date: '2026-11-07', demo: true },
    { patientId: 'P-DEMO-002', patientName: '示例患者 B', center: 'pathology', type: '组织病理', title: '组织切片检查', status: '待处理', date: '2026-11-07', demo: true },
    { patientId: 'P-DEMO-002', patientName: '示例患者 B', center: 'functional', type: '心电', title: '常规心电检查', status: '草稿', date: '2026-11-07', demo: true },
    { patientId: 'P-DEMO-003', patientName: '示例患者 C', center: 'imaging', type: '超声', title: '甲状腺超声', status: '已复核', date: '2026-11-07', demo: true }
  ];
  var CENTER_NAMES = { imaging: '影像中心', lab: '皮肤检验', pathology: '病理中心', functional: '功能检查中心', reports: '综合报告中心' };

  /* ---------------- 工作台总览 ---------------- */
  function pageDashboard() {
    main().innerHTML = heading('WORKBENCH', '工作台总览', '今日待办、检查动态与系统运行状态', '<button class="primary" id="wb-refresh">刷新数据</button>') +
      '<div id="wb-body"><p class="sec-meta">正在加载数据…</p></div>';
    $('#wb-refresh').onclick = loadDashboard;
    loadDashboard();
  }
  function loadDashboard() {
    var body = document.getElementById('wb-body');
    if (!body) return;
    body.innerHTML = '<p class="sec-meta">正在加载数据…</p>';
    Promise.all([api('/status'), api('/records')]).then(function (res) {
      var status = res[0] || {};
      var records = visibleRecords(res[1]);
      var pending = records.filter(function (r) { return r.status === '待处理'; });
      var drafts = records.filter(function (r) { return r.status === '草稿'; });
      var done = records.filter(function (r) { return r.status === '已复核'; });
      var latest = records.slice().sort(function (a, b) { return String(b.updatedAt || b.date).localeCompare(String(a.updatedAt || a.date)); }).slice(0, 5);
      var todo = records.filter(function (r) { return r.status !== '已复核'; }).slice(0, 6);
      var statCards =
        '<div class="stat-grid">' +
        statCard('检查记录', records.length, '条', '本机存储记录', '▤') +
        statCard('待处理', pending.length, '条', '等待录入与查看', '◷') +
        statCard('报告草稿', drafts.length, '条', '等待人工复核', '✎') +
        statCard('已复核', done.length, '条', '已完成工作记录', '✓') +
        '</div>';
      var todoHtml = todo.length ? todo.map(function (r) {
        return '<div class="wb-todo"><div><b>' + esc(r.patientName || '未命名') + '</b><small>' + esc(r.patientId || '') + ' · ' + esc(r.title || '') + '</small></div>' +
          '<div class="wb-todo-right">' + statusBadge(r.status) + '<span class="sec-meta">' + esc(r.date || '') + '</span></div></div>';
      }).join('') : '<p class="sec-meta">暂无待办，工作已全部处理。</p>';
      var statusRows = [
        ['后端服务', status.storage ? '运行中' : '未知'],
        ['存储方式', status.storage === 'file-adapter' ? '本地文件存储（file-adapter）' : String(status.storage || '—')],
        ['数据库接入', status.databaseConfigured ? '已接入' : '接口已预留'],
        ['AI 病灶分割', status.segmentationConfigured ? '已就绪（SkinFusion-Seg）' : '未就绪']
      ];
      var statusHtml = '<dl class="wb-dl">' + statusRows.map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
      }).join('') + '</dl><div class="sec-meta">最近加载：' + new Date().toLocaleString('zh-CN') + '</div>';
      var recentTable = table(['患者', '检查项目', '状态', '检查日期'], latest.map(function (r) {
        return ['<b>' + esc(r.patientName) + '</b><small>' + esc(r.patientId) + '</small>', esc(r.title), statusBadge(r.status), esc(r.date)];
      }));
      if (!latest.length) recentTable = '<p class="sec-meta">暂无检查记录。</p>';
      body.innerHTML = statCards +
        '<div class="wb-grid">' +
        panel('今日待办', '未完成记录 ' + (pending.length + drafts.length) + ' 条', todoHtml) +
        panel('系统状态', '来自 /api/medical/status', statusHtml) +
        '</div>' +
        panel('最近检查动态', '最近 5 条', recentTable) +
        '<div class="wb-quick"><b>快捷入口</b><div class="sec-actions">' +
        '<button class="primary" id="wb-new">新建检查</button>' +
        '<button id="wb-overview">平台总览</button>' +
        '<button id="wb-attestation">数据存证</button>' +
        '<button id="wb-screen">功能演示大屏</button>' +
        '</div></div>';
      $('#wb-new').onclick = function () { window.navigate('lab'); };
      $('#wb-overview').onclick = function () { window.navigate('overview'); };
      $('#wb-attestation').onclick = function () { window.navigate('attestation'); };
      $('#wb-screen').onclick = function () { window.navigate('screen'); };
    }).catch(function (e) {
      body.innerHTML = errorBox(e.message || '未知错误', 'wb-retry');
      $('#wb-retry').onclick = loadDashboard;
    });
  }
  function statCard(label, value, unit, note, icon) {
    return '<div class="stat-card"><div>' + label + '<span class="stat-icon">' + icon + '</span></div><strong>' + esc(value) +
      '<span class="sec-unit">' + unit + '</span></strong><small>' + note + '</small></div>';
  }

  /* ---------------- 报告复核 ---------------- */
  var reviewState = { records: null, tab: '全部', query: '' };
  function pageReview() {
    var m = main();
    m.innerHTML = heading('REPORT REVIEW', '报告复核', '按报告状态集中查看与复核检查记录', '<button id="rv-refresh">刷新</button>') +
      '<div id="rv-body"><p class="sec-meta">正在加载检查记录…</p></div>';
    $('#rv-refresh').onclick = loadReview;
    loadReview();
  }
  function loadReview() {
    var body = document.getElementById('rv-body');
    if (!body) return;
    api('/records').then(function (records) {
      reviewState.records = visibleRecords(records);
      drawReview();
    }).catch(function (e) {
      body.innerHTML = errorBox(e.message || '未知错误', 'rv-retry');
      $('#rv-retry').onclick = loadReview;
    });
  }
  function drawReview() {
    var body = document.getElementById('rv-body');
    if (!body) return;
    var records = reviewState.records || [];
    var tabs = ['全部', '待处理', '草稿', '已复核'];
    var tabHtml = '<div class="rv-tabs">' + tabs.map(function (t) {
      var count = t === '全部' ? records.length : countBy(records, t);
      return '<button class="rv-tab ' + (reviewState.tab === t ? 'active' : '') + '" data-tab="' + t + '">' + t + ' <em>' + count + '</em></button>';
    }).join('') + '</div><div class="filter-bar"><input id="rv-search" placeholder="搜索患者编号、姓名或检查项目" value="' + esc(reviewState.query) + '"></div>';
    var list = records.filter(function (r) {
      var matchTab = reviewState.tab === '全部' || r.status === reviewState.tab;
      var q = reviewState.query.trim();
      var matchQuery = !q || [r.patientId, r.patientName, r.title].some(function (v) { return String(v || '').indexOf(q) >= 0; });
      return matchTab && matchQuery;
    });
    var rows = list.map(function (r) {
      return ['<b>' + esc(r.patientName) + '</b><small>' + esc(r.patientId) + '</small>', esc(r.title), statusBadge(r.status),
        esc(r.date), esc((r.findings || '尚未填写').slice(0, 28)) + ((r.findings || '').length > 28 ? '…' : ''),
        '<button class="text-button" data-review="' + esc(r.id) + '">查看 ↗</button>'];
    });
    body.innerHTML = panel('检查记录', '共 ' + records.length + ' 条', tabHtml + table(['患者', '检查项目', '报告状态', '检查日期', '检查所见摘要', '操作'], rows));
    body.querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () { reviewState.tab = b.dataset.tab; drawReview(); };
    });
    var search = document.getElementById('rv-search');
    search.oninput = function () { reviewState.query = search.value; drawReview(); };
    body.querySelectorAll('[data-review]').forEach(function (b) {
      b.onclick = function () { openReviewModal(b.dataset.review); };
    });
  }
  function openReviewModal(id) {
    var record = (reviewState.records || []).find(function (r) { return r.id === id; });
    if (!record) return;
    var body = '<dl class="wb-dl"><dt>患者</dt><dd>' + esc(record.patientName) + '（' + esc(record.patientId) + '）</dd>' +
      '<dt>检查项目</dt><dd>' + esc(record.title) + '</dd><dt>报告状态</dt><dd>' + statusBadge(record.status) + '</dd>' +
      '<dt>检查日期</dt><dd>' + esc(record.date) + '</dd><dt>更新时间</dt><dd>' + fmtTime(record.updatedAt) + '</dd></dl>' +
      '<div class="sec-meta" style="margin:12px 0 4px">检查所见</div><div class="wb-readonly">' + esc(record.findings || '尚未填写') + '</div>' +
      '<div class="sec-meta" style="margin:12px 0 4px">结论</div><div class="wb-readonly">' + esc(record.conclusion || '尚未填写') + '</div>' +
      '<div class="sec-meta" style="margin-top:12px">存证指纹（浏览器本地 SHA-256）：<span class="sec-hash" id="rv-hash">计算中…</span></div>' +
      '<div class="sec-banner" style="margin-top:12px">如需修改记录，请联系检验医生。</div>';
    if (ui().modal) ui().modal('报告复核 · ' + (record.patientName || record.id), body, '');
    var hashEl = document.getElementById('rv-hash');
    var lib = window.__secCrypto;
    if (hashEl && lib && lib.sha256Hex) {
      lib.sha256Hex(JSON.stringify(record)).then(function (h) { hashEl.textContent = shortHash(h, 16); }).catch(function () { });
    }
  }

  /* ---------------- 患者索引 ---------------- */
  var patientState = { patients: null, records: null, query: '' };
  function pagePatients() {
    main().innerHTML = heading('PATIENT INDEX', '患者索引', '按患者编号汇总检查记录与历史报告', '<button id="pt-refresh">刷新</button>') +
      '<div class="sec-banner" style="margin-bottom:12px">说明：患者索引把全部检查记录按 <b>患者编号</b> 聚合，展示每位患者的检查次数、报告状态与最近检查；带“示例”标记的患者为前端演示数据（与“皮肤检验”页的示例记录一致），不会写入后端。</div>' +
      '<div id="pt-body"><p class="sec-meta">正在加载患者索引…</p></div>';
    $('#pt-refresh').onclick = loadPatients;
    loadPatients();
  }
  function loadPatients() {
    var body = document.getElementById('pt-body');
    if (!body) return;
    Promise.all([api('/patients'), api('/records')]).then(function (res) {
      patientState.patients = res[0] || [];
      patientState.records = visibleRecords(res[1]);
      drawPatients();
    }).catch(function (e) {
      body.innerHTML = errorBox(e.message || '未知错误', 'pt-retry');
      $('#pt-retry').onclick = loadPatients;
    });
  }
  function drawPatients() {
    var body = document.getElementById('pt-body');
    if (!body) return;
    var records = patientState.records || [];
    function summarize(p, own, demo) {
      own = own.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      return {
        patientId: p.patientId, patientName: p.patientName, demo: !!demo,
        count: own.length,
        pending: own.filter(function (r) { return r.status === '待处理'; }).length,
        draft: own.filter(function (r) { return r.status === '草稿'; }).length,
        done: own.filter(function (r) { return r.status === '已复核'; }).length,
        latest: own[0] ? own[0].date : '—',
        titles: own.map(function (r) { return r.title; }).slice(0, 2).join('、')
      };
    }
    var realPatients = (patientState.patients || [])
      .filter(function (p) { return String(p.patientId || '').indexOf('API-TEST') !== 0; })
      .map(function (p) {
        return summarize(p, records.filter(function (r) { return r.patientId === p.patientId; }), false);
      });
    var demoMap = {};
    DEMO_RECORDS.forEach(function (r) {
      if (!demoMap[r.patientId]) demoMap[r.patientId] = { patientId: r.patientId, patientName: r.patientName, records: [] };
      demoMap[r.patientId].records.push(r);
    });
    var demoPatients = Object.keys(demoMap).map(function (k) { return summarize(demoMap[k], demoMap[k].records, true); });
    var q = patientState.query.trim();
    var patients = realPatients.concat(demoPatients).filter(function (p) {
      return !q || String(p.patientId).indexOf(q) >= 0 || String(p.patientName).indexOf(q) >= 0;
    });
    var rows = patients.map(function (p) {
      var name = '<b>' + esc(p.patientName) + '</b>' + (p.demo ? ' <em class="pt-demo">示例</em>' : '') +
        '<small>' + esc(p.patientId) + (p.titles ? ' · ' + esc(p.titles) : '') + '</small>';
      var dist = '待处理 ' + p.pending + ' · 草稿 ' + p.draft + ' · 已复核 ' + p.done;
      return [name, p.count, dist, esc(p.latest),
        '<button class="text-button" data-patient="' + esc(p.patientId) + '" data-demo="' + (p.demo ? '1' : '0') + '">查看报告 ↗</button>'];
    });
    var summary = '<div class="sec-chips" style="margin-bottom:10px">' +
      '<span class="sec-chip">后端患者 ' + realPatients.length + ' 位</span>' +
      '<span class="sec-chip">示例患者 ' + demoPatients.length + ' 位</span>' +
      '<span class="sec-chip ok">检查记录 ' + records.length + ' 条</span>' +
      '<span class="sec-chip ok">演示记录 ' + DEMO_RECORDS.length + ' 条</span></div>';
    body.innerHTML = panel('患者列表', '共 ' + patients.length + ' 位患者',
      summary + '<div class="filter-bar"><input id="pt-search" placeholder="搜索患者编号或姓名" value="' + esc(patientState.query) + '"></div>' +
      table(['患者', '检查记录', '报告状态分布', '最近检查', '操作'], rows)) +
      '<div class="sec-banner">说明：后端当前有 ' + realPatients.length + ' 位历史检查患者；“示例”患者来自前端演示数据，用于展示页面效果。点击“查看报告”可按患者汇总检查明细。</div>';
    var search = document.getElementById('pt-search');
    search.oninput = function () { patientState.query = search.value; drawPatients(); };
    body.querySelectorAll('[data-patient]').forEach(function (b) {
      b.onclick = function () { openPatientModal(b.dataset.patient, b.dataset.demo === '1'); };
    });
  }
  function openPatientModal(patientId, isDemo) {
    function show(list) {
      list = list || [];
      var rows = list.map(function (r) {
        return ['<b>' + esc(r.title) + '</b>' + (r.demo ? ' <em class="pt-demo">示例</em>' : ''),
          esc(CENTER_NAMES[r.center] || r.center || '—'), statusBadge(r.status), esc(r.date),
          esc((r.conclusion || r.findings || '尚未填写').slice(0, 26))];
      });
      var body = '<dl class="wb-dl"><dt>患者编号</dt><dd>' + esc(patientId) + '</dd>' +
        '<dt>检查记录</dt><dd>' + list.length + ' 条</dd>' +
        '</dl>' +
        '<div style="margin-top:12px">' + table(['检查项目', '所属中心', '状态', '检查日期', '结论摘要'], rows) + '</div>' +
        '<div class="sec-banner" style="margin-top:12px">' + (isDemo
          ? '示例患者仅用于页面展示；如需真实操作，请在“皮肤检验”页新建检查。'
          : '如需编辑或复核，请前往“皮肤检验”页面打开对应记录。') + '</div>';
      if (ui().modal) ui().modal('患者报告 · ' + patientId, body, '');
    }
    if (isDemo) { show(DEMO_RECORDS.filter(function (r) { return r.patientId === patientId; })); return; }
    api('/patients/' + encodeURIComponent(patientId) + '/reports').then(show).catch(function (e) { toast('报告加载失败：' + (e.message || '')); });
  }

  /* ---------------- 系统状态 ---------------- */
  function pageStatus() {
    main().innerHTML = heading('SYSTEM STATUS', '系统状态', '后端服务、存储与安全计算节点运行状态', '<button class="primary" id="st-refresh">刷新状态</button>') +
      '<div id="st-body"><p class="sec-meta">正在检查系统状态…</p></div>';
    $('#st-refresh').onclick = loadStatus;
    loadStatus();
  }
  function loadStatus() {
    var body = document.getElementById('st-body');
    if (!body) return;
    Promise.all([api('/status'), api('/records')]).then(function (res) {
      var status = res[0] || {};
      var records = visibleRecords(res[1]);
      var serviceRows = [
        ['后端 API', '已连通（127.0.0.1:5175）'],
        ['存储适配器', String(status.storage || '—')],
        ['数据库接入', status.databaseConfigured ? '已接入' : '接口已预留，当前使用文件存储'],
        ['AI 病灶分割', status.segmentationConfigured ? '已就绪（SkinFusion-Seg 本地模型）' : '未就绪'],
        ['检查记录', records.length + ' 条'],
        ['待处理记录', records.filter(function (r) { return r.status !== '已复核'; }).length + ' 条']
      ];
      var nodeRows = ((window.SEC && window.SEC.nodes) || []).map(function (n) {
        return [esc(n.name), esc(n.role), esc(n.layers), badge(n.status, 'ok')];
      });
      var envRows = [
        ['浏览器', (navigator.userAgent || '').replace(/\s+/g, ' ').slice(0, 80)],
        ['视口尺寸', window.innerWidth + ' × ' + window.innerHeight],
        ['当前时间', new Date().toLocaleString('zh-CN')]
      ];
      body.innerHTML = '<div class="wb-grid">' +
        panel('服务状态', '最近检查：' + new Date().toLocaleTimeString('zh-CN'), '<dl class="wb-dl">' + serviceRows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>') +
        panel('存储与数据', status.databaseConfigured ? 'MySQL' : '本地文件存储', '<dl class="wb-dl">' +
          (status.databaseConfigured ? '<dt>检查记录</dt><dd>MySQL inspections 表</dd>' : '<dt>检查记录文件</dt><dd>data/inspections.json</dd>') +
          '<dt>媒体目录</dt><dd>data/media（原图与结果图）</dd>' +
          '<dt>数据安全</dt><dd>仅本机访问 · 跨站写请求拦截</dd></dl>') +
        '</div>' +
        panel('安全计算节点', '本地环境', table(['节点', '角色', '模型分层', '状态'], nodeRows)) +
        '<div class="wb-grid">' + panel('客户端环境', '浏览器信息', '<dl class="wb-dl">' + envRows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>') +
        panel('维护入口', '', '<div class="sec-actions"><button class="primary" id="st-settings">连接与设置</button><button id="st-audit">审计中心</button><button id="st-overview">平台总览</button></div>' +
          '<div class="sec-meta" style="margin-top:10px">服务启停请使用后端目录下的启动/停止脚本。</div>') + '</div>';
      $('#st-settings').onclick = function () { window.navigate('settings'); };
      $('#st-audit').onclick = function () { window.navigate('audit'); };
      $('#st-overview').onclick = function () { window.navigate('overview'); };
    }).catch(function (e) {
      body.innerHTML = errorBox(e.message || '后端不可用', 'st-retry');
      $('#st-retry').onclick = loadStatus;
    });
  }

  /* ---------------- 帮助中心 ---------------- */
  function pageHelp() {
    var terms = [
      ['拆分学习', '把模型按层切分为端侧与边缘/云端两段，原始数据留在端侧，只传输中间表示。'],
      ['联邦学习', '多参与方在数据不出域的前提下协作训练全局模型。'],
      ['秘密共享', '将数值拆分为多个份额分发给不同参与方，单方份额无法还原原始数据。'],
      ['密态训练', '模型在秘密份额上完成线性与非线性层计算，实现端到端加密训练。'],
      ['周期性半异步聚合', '按周期截止对已完成本地训练的设备梯度做全局聚合，降低同步等待开销。'],
      ['T-Merkle 树', '对训练数据分块哈希后构建的树形结构，可快速验证大规模数据完整性。'],
      ['RSA 累加器', '生成固定大小认证数据结构，用于高效证明集合成员关系。'],
      ['零知识证明', '证明者在不泄露具体数据的前提下向验证者证明计算结果的正确性。'],
      ['半诚实安全假设', '参与方会遵守协议但可能尝试从收到的信息中推断隐私。'],
      ['数据不出域', '原始数据始终留在数据提供方本地，只有模型参数或秘密份额参与传输。']
    ];
    var faqs = [
      ['AI 病灶分割服务如何启动？', '医生端使用本地 SkinFusion-Seg 分割服务（127.0.0.1:8000），分割完成后由内置 AI 辅助分析自动生成检查所见与结论。双击“启动医疗检验工作台.cmd”会自动启动该服务，也可单独运行“启动AI分割服务.cmd”；健康检查通过后即可在皮肤检验中使用。'],
      ['数据保存在哪里？', '检查记录保存在后端 data/inspections.json，图片保存在 data/media；全部为本机文件存储。'],
      ['如何启动或停止后端？', '使用后端目录的“启动后端.cmd / 停止后端.cmd”，或执行 start-backend.ps1 -Background / -Stop。'],
    ];
    var steps = [
      ['1', '登录工作台', '查看待办、检查动态与系统状态。'],
      ['2', '登记与查看', '在“皮肤检验”新建检查、上传图片并保存报告。'],
      ['3', '复核报告', '在“报告复核”按状态筛选并核对检查所见与结论。'],
      ['4', '安全与演示', '在“安全计算”与“功能演示”查看存证、验证与平台能力。']
    ];
    var project = (window.SEC && window.SEC.project) || {};
    main().innerHTML = heading('HELP CENTER', '帮助中心', '快速上手、术语表与常见问题', '') +
      panel('快速上手', '4 步了解平台', '<div class="hp-steps">' + steps.map(function (s) {
        return '<div class="hp-step"><b>' + s[0] + '</b><div><strong>' + s[1] + '</strong><small>' + s[2] + '</small></div></div>';
      }).join('') + '</div>') +
      panel('术语表', '共 ' + terms.length + ' 条', '<div class="hp-terms">' + terms.map(function (t) {
        return '<div class="hp-term"><b>' + esc(t[0]) + '</b><p>' + esc(t[1]) + '</p></div>';
      }).join('') + '</div>') +
      panel('常见问题', 'FAQ', '<div class="hp-faq">' + faqs.map(function (f) {
        return '<div class="hp-faq-item"><b>' + esc(f[0]) + '</b><p>' + esc(f[1]) + '</p></div>';
      }).join('') + '</div>') +
      '<div class="sec-banner">项目：' + esc(project.name || '人工智能数据安全与计算安全关键技术研究') + '（' + esc(project.code || '2024AQ2028') + '）· ' + esc(project.unit || '湖南科技大学') + ' · ' + esc(project.partner || '湖南医沃信息技术有限公司') + '</div>';
  }

  var renderers = { dashboard: pageDashboard, review: pageReview, patients: pagePatients, status: pageStatus, help: pageHelp };
  window.renderWorkspacePage = function (id) {
    if (renderers[id]) renderers[id]();
  };
})();



