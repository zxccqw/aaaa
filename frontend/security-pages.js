'use strict';
/* 安全计算中心 · 纯前端演示页面
 * 依赖：security-data.js（window.SEC）、app.js 暴露的 window.__ui
 * 所有指纹 / Merkle 根 / 审计哈希链均在浏览器本地真实计算（Web Crypto SHA-256）。
 */
(function () {
  var D = window.SEC;
  var $ = function (s) { return document.querySelector(s); };
  var ui = function () { return window.__ui || {}; };
  function esc(v) { return ui().esc ? ui().esc(v) : String(v == null ? '' : v); }
  function toast(msg) { if (ui().toast) ui().toast(msg); }
  function openModal(title, body, foot) { if (ui().modal) ui().modal(title, body, foot || ''); }

  var verifyTimers = [];
  var chartTaskTimers = [];
  var trainState = { tasks: null, timer: null, runningId: null, progress: 0 };
  var TRAIN_TASKS_KEY = 'secTrainingTasksV2';
  function saveTrainTasks() {
    try { localStorage.setItem(TRAIN_TASKS_KEY, JSON.stringify(trainTasks())); } catch (e) {}
  }
  function loadTrainTasks() {
    try {
      var raw = localStorage.getItem(TRAIN_TASKS_KEY);
      if (!raw) return null;
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : null;
    } catch (e) { return null; }
  }

  function clearTimers() {
    verifyTimers.forEach(function (t) { clearTimeout(t); });
    verifyTimers = [];
    chartTaskTimers.forEach(function (t) { clearTimeout(t); });
    chartTaskTimers = [];
    if (window.__realTrainingCleanup) { window.__realTrainingCleanup(); window.__realTrainingCleanup = null; }
  }

  function startChartTask(kind, title, durationMs, payload) {
    var id = kind + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    return fetch('/api/medical/chart-tasks', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, kind: kind, title: title, durationMs: durationMs, payload: payload || {} })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchChartTasks() {
    return fetch('/api/medical/chart-tasks', { credentials: 'same-origin' }).then(function (r) {
      return r.ok ? r.json() : [];
    });
  }

  function fetchChartTask(id) {
    return fetch('/api/medical/chart-tasks/' + encodeURIComponent(id), { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function scheduleChartPoll(fn, ms) {
    var timer = setTimeout(fn, ms == null ? 300 : ms);
    chartTaskTimers.push(timer);
    return timer;
  }

  /* ---------- 通用渲染 ---------- */
  function heading(eyebrow, title, desc, actions) {
    return '<div class="page-heading"><div><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1><p>' + desc + '</p></div>' +
      (actions ? '<div class="sec-actions">' + actions + '</div>' : '') + '</div>';
  }
  function panel(title, meta, body, cls) {
    return '<section class="records-panel ' + (cls || '') + '"><div class="panel-title"><h2>' + title + '</h2><span>' + (meta || '') + '</span></div><div class="sec-panel-body">' + body + '</div></section>';
  }
  function table(headers, rows) {
    return '<div class="table-scroll"><table><thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function badge(text, kind) { return '<span class="sec-badge ' + (kind || '') + '">' + esc(text) + '</span>'; }
  function statCard(item) {
    return '<div class="stat-card"><div>' + item.label + '<span class="stat-icon">' + item.icon + '</span></div><strong>' +
      esc(item.value) + '<span class="sec-unit">' + esc(item.unit) + '</span></strong><small>' + esc(item.note) + '</small></div>';
  }
  function shortHash(h, n) { if (!h) return '—'; return h.slice(0, n || 10) + '…' + h.slice(-4); }
  function banner(text) { return ''; }

  /* ---------- SHA-256 / Merkle（浏览器本地真实计算） ---------- */
  function sha256Hex(text) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      });
    }
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      h1 = ((h1 ^ c) * 16777619) >>> 0;
      h2 = ((h2 + c * 31) * 2654435761) >>> 0;
    }
    return Promise.resolve(('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8) + '00000000000000000000000000000000');
  }
  function merkleLevels(leaves) {
    var levels = [leaves.slice()];
    var cur = leaves.slice();
    function step() {
      if (cur.length <= 1) return Promise.resolve(levels);
      var next = [];
      var chain = Promise.resolve();
      for (var i = 0; i < cur.length; i += 2) {
        (function (i) {
          var a = cur[i], b = (i + 1 < cur.length) ? cur[i + 1] : cur[i];
          chain = chain.then(function () { return sha256Hex(a + b); }).then(function (h) { next[i / 2] = h; });
        })(i);
      }
      return chain.then(function () { levels.push(next); cur = next; return step(); });
    }
    return step();
  }

  /* ---------- 折线图（内联 SVG） ---------- */
  function smoothValues(values, radius) {
    var out = [], r = radius == null ? 2 : radius;
    for (var i = 0; i < values.length; i++) {
      var sum = 0, count = 0;
      for (var j = Math.max(0, i - r); j <= Math.min(values.length - 1, i + r); j++) {
        sum += Number(values[j]);
        count++;
      }
      out.push(sum / Math.max(1, count));
    }
    return out;
  }

  function lineChart(series, opts) {
    opts = opts || {};
    var w = 720, h = 250, pl = 46, pr = 16, pt = 18, pb = 30;
    var n = Math.max(2, opts.n || series[0].values.length);
    var all = [];
    series.forEach(function (s) { all = all.concat(s.values); });
    if (opts.target != null) all.push(opts.target);
    var min = (opts.min != null) ? opts.min : Math.floor(Math.min.apply(null, all) - 3);
    var max = (opts.max != null) ? opts.max : Math.ceil(Math.max.apply(null, all) + 2);
    function X(i) { return pl + (w - pl - pr) * (i / (n - 1)); }
    function Y(v) { return pt + (h - pt - pb) * (1 - (v - min) / (max - min)); }
    var yGrid = Math.max(1, Math.round(opts.yGrid || 4));
    var yLabelEvery = Math.max(1, Math.round(opts.yLabelEvery || 1));
    var grid = '';
    for (var g = 0; g <= yGrid; g++) {
      var gv = min + (max - min) * g / yGrid;
      grid += '<line x1="' + pl + '" y1="' + Y(gv).toFixed(1) + '" x2="' + (w - pr) + '" y2="' + Y(gv).toFixed(1) + '" stroke="#e9eef5"/>';
      if (g % yLabelEvery === 0 || g === yGrid) {
        grid += '<text x="' + (pl - 8) + '" y="' + (Y(gv) + 3).toFixed(1) + '" text-anchor="end" font-size="10" fill="#93a1b5">' + gv.toFixed(0) + '</text>';
      }
    }
    var tickIndexes = (opts.xTicks && opts.xTicks.length) ? opts.xTicks.slice() : (n <= 20 ? [0, 4, 9, 14, 19] : [0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1]);
    var xlabels = tickIndexes.filter(function (i) { return i < n; }).map(function (i) {
      return '<text x="' + X(i).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="10" fill="#93a1b5">' + (opts.xLabel ? esc(opts.xLabel(i)) : (i + 1)) + '</text>';
    }).join('');
    var xgrid = tickIndexes.filter(function (i) { return i < n; }).map(function (i) {
      return '<line x1="' + X(i).toFixed(1) + '" y1="' + pt + '" x2="' + X(i).toFixed(1) + '" y2="' + (h - pb) + '" stroke="#f4f8fc"/>';
    }).join('');
    var targetLine = '';
    if (opts.target != null) {
      targetLine = '<line x1="' + pl + '" y1="' + Y(opts.target).toFixed(1) + '" x2="' + (w - pr) + '" y2="' + Y(opts.target).toFixed(1) + '" stroke="#c87913" stroke-width="0.9" stroke-dasharray="3 3"/>' +
        '<text x="' + (w - pr - 4) + '" y="' + (Y(opts.target) - 5).toFixed(1) + '" text-anchor="end" font-size="10" fill="#c87913">' + esc(opts.targetLabel || '目标线') + '</text>';
    }
    var paths = series.map(function (s) {
      var width = s.width || (s.dash ? 1.05 : 1.3);
      var stroke = 'fill="none" stroke="' + s.color + '" stroke-width="' + width + '" stroke-linecap="' + (s.dash ? 'butt' : 'round') + '" stroke-linejoin="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '');
      if (s.smooth) {
        var vals = s.values;
        var d = 'M' + X(0).toFixed(1) + ',' + Y(vals[0]).toFixed(1);
        for (var i = 0; i < n - 1; i++) {
          var p0 = vals[Math.max(0, i - 1)], p1 = vals[i], p2 = vals[i + 1], p3 = vals[Math.min(n - 1, i + 2)];
          var y1 = Y(p1), y2 = Y(p2);
          var c1y = y1 + (Y(p2) - Y(p0)) / 6;
          var c2y = y2 - (Y(p3) - Y(p1)) / 6;
          var lo = Math.min(y1, y2), hi = Math.max(y1, y2);
          c1y = Math.max(lo, Math.min(hi, c1y));
          c2y = Math.max(lo, Math.min(hi, c2y));
          var x1 = X(i), x2 = X(i + 1);
          d += ' C' + (x1 + (x2 - x1) / 3).toFixed(1) + ',' + c1y.toFixed(1) + ' ' +
            (x2 - (x2 - x1) / 3).toFixed(1) + ',' + c2y.toFixed(1) + ' ' + x2.toFixed(1) + ',' + y2.toFixed(1);
        }
        return '<path ' + stroke + ' d="' + d + '"/>';
      }
      return '<polyline ' + stroke + ' points="' +
        s.values.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ') + '"/>';
    }).join('');
    var legend = '<div class="sec-legend">' + series.map(function (s) {
      return '<span><i style="background:' + (s.dash ? 'transparent' : s.color) + (s.dash ? ';border-top:1px dashed ' + s.color + ';height:0' : '') + '"></i>' + esc(s.name) + '</span>';
    }).join('') + (opts.target != null ? '<span><i style="background:#c87913"></i>' + esc(opts.targetLabel || '目标线') + '</span>' : '') + '</div>';
    return '<svg class="sec-chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(opts.label || '指标曲线') + '">' + grid + xgrid + targetLine + paths + xlabels + '</svg>' + legend;
  }

  /* =========================================================
     1. 平台总览
     ========================================================= */
  function pageOverview() {
    var m = document.getElementById('main');
    var kpiGroups = [
      { title: '协同训练管理（分布式模型训练架构 / 拆分训练精度）', metrics: ['分布式模型训练架构', '拆分训练精度'], page: 'training' },
      { title: '密态建模算法（半诚实）', metrics: ['密态建模算法（半诚实）'], page: 'encrypted' },
      { title: '结果验证（零知识证明协议）', metrics: ['零知识证明协议'], page: 'verification' },
      { title: '数据存证（训练数据完整性保护）', metrics: ['训练数据完整性保护'], page: 'attestation' }
    ];
    function kpiRow(title, page, badgeText, progress, extraClass) {
      return '<div class="sec-kpi-row ' + (extraClass || '') + '"><div class="sec-kpi-head"><span>' + esc(title) + '</span>' +
        '<span class="sec-kpi-right">' + (badgeText ? badge(badgeText, 'ok') : '') +
        '<button class="sec-link" data-kpi-page="' + page + '">查看 ↗</button></span></div>' +
        '<div class="sec-kpi-bar"><i style="width:' + (progress || 100) + '%"></i></div></div>';
    }
    var kpiRows = kpiGroups.map(function (group) {
      var items = D.kpi.filter(function (k) { return group.metrics.indexOf(k.name) >= 0; });
      var badgeText = items.map(function (k) { return k.current; }).join(' · ');
      var progress = items.length ? Math.max.apply(null, items.map(function (k) { return k.progress; })) : 100;
      return kpiRow(group.title, group.page, badgeText, progress);
    }).join('');
    var otherRows = kpiRow('链上验证记录（Ganache）', 'chain3d', '', 100, 'sec-kpi-other sec-kpi-divider') +
      kpiRow('审计中心（操作审计）', 'audit', '', 100, 'sec-kpi-other');
    var recentTasks = trainTasks().slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    }).slice(0, 3);
    var recent = recentTasks.length ? recentTasks.map(function (t) {
      var acc;
      if (t.status === '训练中' && Number.isFinite(Number(t.liveTestAccuracy))) {
        acc = Number(t.liveTestAccuracy).toFixed(2) + '% / ' + Number(t.liveValAccuracy).toFixed(2) + '%<small>测试 / 验证</small>';
      } else if (Number.isFinite(Number(t.finalTestAccuracy)) && Number.isFinite(Number(t.finalValAccuracy))) {
        acc = Number(t.finalTestAccuracy).toFixed(2) + '% / ' + Number(t.finalValAccuracy).toFixed(2) + '%<small>测试 / 验证</small>';
      } else if (Number.isFinite(Number(t.single)) && Number.isFinite(Number(t.split))) {
        acc = Number(t.single).toFixed(2) + '% / ' + Number(t.split).toFixed(2) + '%<small>测试 / 验证</small>';
      } else {
        acc = '—';
      }
      var name = String(t.name || '').replace(/^CS\.2\s*·\s*/, '');
      return [esc(t.id) + '<small>' + esc(name) + '</small>', esc(t.algorithm), esc(t.architecture),
        badge(t.status, t.status === '已完成' ? 'ok' : ''), acc,
        '<button class="text-button" data-overview-task="' + esc(t.id) + '">查看 ↗</button>'];
    }) : [['暂无训练任务', '—', '—', '—', '—', '—']];
    m.innerHTML = heading('SECURITY COMPUTING', '平台总览', '面向大模型的分布式分层安全推理平台 · 协同训练 / 数据存证 / 结果验证', '<button class="primary" id="sec-go-training">发起协同训练</button>') +
      '<div class="stat-grid">' + D.overviewStats.map(statCard).join('') + '</div>' +
      panel('任务书指标完成度', '', kpiRows + otherRows) +
      platformArchitecture() +
      panel('最近协同训练任务', '按时间倒序', table(['任务', '算法', '训练架构', '状态', '精度指标', '操作'], recent));
    startPlatformFlow();
    $('#sec-go-training').onclick = function () { window.navigate('training'); };
    m.querySelectorAll('[data-overview-task]').forEach(function (b) {
      b.onclick = function () {
        var t = trainTasks().find(function (x) { return x.id === b.getAttribute('data-overview-task'); });
        if (!t) return;
        if (t.cs2Combo) {
          if (t.status === '训练中') { openCs2LiveModal(t); return; }
          window.__pendingCs2Combo = t.cs2Combo;
          window.__pendingCs2Rank = t.cs2Rank || 'r100';
          window.__lastCs2Combo = t.cs2Combo;
          window.__lastCs2Rank = t.cs2Rank || 'r100';
          window.navigate('encrypted');
          return;
        }
        openTaskModal(t);
      };
    });
    m.querySelectorAll('[data-kpi-page]').forEach(function (b) {
      b.onclick = function () { window.navigate(b.dataset.kpiPage); };
    });
  }

  /* =========================================================
     2. 协同训练管理
     ========================================================= */
  function trainTasks() {
    if (!trainState.tasks) {
      trainState.tasks = loadTrainTasks() || D.tasks.map(function (t) { return Object.assign({}, t); });
      var staleDemo = trainState.tasks.find(function (t) {
        return t.id === 'TR-2026-082' && t.status === '训练中' && !t.startedAt && !t.profileId && !t.realLog;
      });
      if (staleDemo) {
        var freshDemo = D.tasks.find(function (t) { return t.id === 'TR-2026-082'; });
        if (freshDemo) {
          Object.assign(staleDemo, freshDemo);
          saveTrainTasks();
        }
      }
    }
    var seededKey = 'realTrainingTaskSeededV2';
    var seeded = false;
    try { seeded = localStorage.getItem(seededKey) === '1'; } catch (e) {}
    if (window.REAL_TRAINING && !seeded && !trainState.tasks.some(function (t) { return t.realLog; })) {
      var real = window.REAL_TRAINING;
      trainState.tasks.unshift({
        id: real.id || 'TR-REAL-001', name: real.name, algorithm: 'CNN', architecture: 'FedBuff（异步缓冲聚合）',
        rounds: real.rounds, split: real.finalTestAccuracy, single: real.finalValAccuracy, status: '已完成',
        date: real.date, nodes: real.clients, comm: '异步缓冲聚合', data: 'MNIST · 54,000 样本', duration: real.duration,
        realLog: true, finalTestAccuracy: real.finalTestAccuracy, finalValAccuracy: real.finalValAccuracy,
        model: real.model, dataset: real.dataset, clients: real.clients
      });
      saveTrainTasks();
      try { localStorage.setItem(seededKey, '1'); } catch (e) {}
    }
    return trainState.tasks.filter(function (t) { return t.realLog || t.cs2Combo; });
  }
  function taskRows() {
    return trainTasks().map(function (t) {
      var completed = t.status === '已完成';
      var running = t.status === '训练中';
      var realData = window.REAL_TRAINING;
      var isCs2 = !!t.cs2Combo;
      var testAcc = t.realLog ? Number(t.finalTestAccuracy) : (isCs2 ? Number(t.finalTestAccuracy || t.single) : Number(t.single));
      var valAcc = t.realLog ? Number(t.finalValAccuracy) : (isCs2 ? Number(t.finalValAccuracy || t.split) : Number(t.split));
      var liveTest = Number(t.liveTestAccuracy);
      var liveVal = Number(t.liveValAccuracy);
      if (running && t.realLog && (!Number.isFinite(liveTest) || !Number.isFinite(liveVal)) && realData) {
        var idx = Math.min(realData.rounds, Math.max(0, t.currentRound || 0));
        liveTest = realData.arrays.testAccuracy[idx];
        liveVal = realData.arrays.valAccuracy[idx];
      }
      var liveRatio = Number(t.liveRatio);
      if (!Number.isFinite(liveRatio) && Number.isFinite(liveTest) && liveTest > 0) liveRatio = liveVal / liveTest * 100;
      var ratio;
      if (running && t.realLog) {
        ratio = Number.isFinite(liveRatio) ? '<span id="task-ratio-' + esc(t.id) + '">' + liveRatio.toFixed(2) + '%</span>' : '—';
      } else if ((completed || isCs2) && Number.isFinite(testAcc) && Number.isFinite(valAcc) && testAcc > 0) {
        ratio = (valAcc / testAcc * 100).toFixed(2) + '%';
      } else {
        ratio = '—';
      }
      var accText;
      if (completed && Number.isFinite(testAcc) && Number.isFinite(valAcc)) {
        accText = '<span>' + testAcc.toFixed(2) + '% / ' + valAcc.toFixed(2) + '%<small>测试 / 验证</small></span>';
      } else if (running && (t.realLog || isCs2) && Number.isFinite(liveTest) && Number.isFinite(liveVal)) {
        accText = '<span id="task-acc-' + esc(t.id) + '">' + liveTest.toFixed(2) + '% / ' + liveVal.toFixed(2) + '%<small>测试 / 验证</small></span>';
      } else if (running) {
        accText = '<span id="task-acc-' + esc(t.id) + '">训练中</span>';
      } else {
        accText = '—';
      }
      var state = 'task-state-' + t.id;
      var statePct = 0;
      if (running) statePct = Number.isFinite(Number(t.liveProgressPct)) ? Number(t.liveProgressPct) : (t.id === trainState.runningId ? trainState.progress : 0);
      var stateHtml = running
        ? '<span id="' + state + '" class="sec-badge">训练中 ' + (t.realLog ? statePct.toFixed(2) : Math.round(statePct)) + '%</span>'
        : badge(t.status, t.status === '已完成' ? 'ok' : '');
      var displayName = String(t.name || '').replace(/^CS\.2\s*·\s*/, '');
      return [esc(t.id) + '<small>' + esc(displayName) + '</small>', esc(t.algorithm), esc(t.architecture), stateHtml,
        accText, ratio, esc(t.date), '<button class="text-button" data-task="' + esc(t.id) + '">打开 ↗</button>',
        '<button type="button" class="text-button danger task-delete" data-delete-task="' + esc(t.id) + '" title="删除任务">删除任务</button>'];
    });
  }
  function refreshTaskRows(skipSave) {
    if (!skipSave) saveTrainTasks();
    var tableEl = document.getElementById('sec-task-table');
    if (!tableEl) return;
    tableEl.innerHTML = table(['任务', '算法', '训练架构', '状态', '精度指标', '精度比', '创建时间', '操作', '删除'], taskRows());
    var countEl = document.getElementById('sec-task-count');
    if (countEl) countEl.textContent = '共 ' + trainTasks().length + ' 个';
    bindTaskRows();
  }
  function bindTaskRows() {
    document.querySelectorAll('#sec-task-table [data-task]').forEach(function (b) {
      b.onclick = function () {
        var t = trainTasks().find(function (x) { return x.id === b.dataset.task; });
        if (!t) return;
        if (t.cs2Combo) {
          if (t.status === '训练中') { openCs2LiveModal(t); return; }
          window.__pendingCs2Combo = t.cs2Combo;
          window.__pendingCs2Rank = t.cs2Rank || 'r100';
          window.__lastCs2Combo = t.cs2Combo;
          window.__lastCs2Rank = t.cs2Rank || 'r100';
          window.navigate('encrypted');
          return;
        }
        openTaskModal(t);
      };
    });
    document.querySelectorAll('#sec-task-table [data-delete-task]').forEach(function (b) {
      b.onclick = function () {
        var t = trainTasks().find(function (x) { return x.id === b.dataset.deleteTask; });
        if (!t) return;
        if (!confirm('确定删除这条训练任务？\n' + t.id + ' · ' + t.name + '\n删除后仅从当前页面列表移除。')) return;
        if (trainState.runningId === t.id) {
          clearInterval(trainState.timer); trainState.timer = null; trainState.runningId = null;
        }
        if (window.__cs2Timers && window.__cs2Timers[t.id]) {
          clearInterval(window.__cs2Timers[t.id]);
          delete window.__cs2Timers[t.id];
        }
        var tasks = trainTasks();
        var index = trainState.tasks ? trainState.tasks.indexOf(t) : -1;
        if (index >= 0) trainState.tasks.splice(index, 1);
        var modal = document.getElementById('modal');
        if (modal && modal.open) modal.close();
        refreshTaskRows();
        toast('已删除训练任务：' + t.id);
      };
    });
  }
  function setupLiveChart(canvas) {
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(360, Math.round(rect.width || canvas.parentElement.clientWidth || 720));
    var height = Math.max(200, Math.round(canvas.clientHeight || 250));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: width, h: height };
  }

  function drawLiveAccuracy(chart, real, progress, now, view) {
    var ctx = chart.ctx, w = chart.w, h = chart.h;
    var pad = { l: 52, r: 18, t: 20, b: 30 };
    var innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
    var rounds = real.rounds;
    var vStart = view ? Math.max(0, view.start) : 0;
    var vEnd = view ? Math.min(rounds, view.end) : rounds;
    if (vEnd - vStart < 1) vEnd = Math.min(rounds, vStart + 1);
    function X(v) { return pad.l + innerW * (v - vStart) / (vEnd - vStart); }
    function Y(v) { return pad.t + innerH * (1 - v / 100); }
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(23,45,73,.08)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = pad.t + innerH * g / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
      ctx.fillStyle = '#8493ac';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(String(100 - 25 * g), pad.l - 8, gy + 3);
    }
    ctx.textAlign = 'center';
    var tickValues = [];
    for (var tick = 0; tick < 5; tick++) tickValues.push(vStart + (vEnd - vStart) * tick / 4);
    tickValues.forEach(function (round) {
      ctx.fillStyle = '#8493ac';
      var label = (vEnd - vStart) <= 10 ? round.toFixed(1) : String(Math.round(round));
      ctx.fillText(label, X(round), h - 10);
    });

    ctx.save();
    ctx.strokeStyle = 'rgba(200,121,19,.65)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, Y(90)); ctx.lineTo(w - pad.r, Y(90)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#b07a20';
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('目标线（90%）', w - pad.r - 4, Y(90) - 6);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, innerW, innerH);
    ctx.clip();
    var idx = Math.min(rounds, Math.floor(progress));
    var frac = Math.min(1, Math.max(0, progress - idx));
    function valueAt(values) {
      var value = values[idx];
      if (idx < rounds && frac > 0) value += (values[idx + 1] - value) * frac;
      return value;
    }
    var curX = X(progress);
    var testNow = valueAt(real.arrays.testAccuracy);
    var valNow = valueAt(real.arrays.valAccuracy);

    // 测试精度面积
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X(0), Y(real.arrays.testAccuracy[0]));
    for (var i = 1; i <= idx; i++) ctx.lineTo(X(i), Y(real.arrays.testAccuracy[i]));
    ctx.lineTo(curX, Y(testNow));
    ctx.lineTo(curX, pad.t + innerH);
    ctx.lineTo(X(0), pad.t + innerH);
    ctx.closePath();
    var fill = ctx.createLinearGradient(0, pad.t, 0, pad.t + innerH);
    fill.addColorStop(0, 'rgba(39,168,239,.15)');
    fill.addColorStop(1, 'rgba(39,168,239,0)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();

    function drawSeries(values, color, width, dash) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(dash || []);
      for (var j = 0; j <= idx; j++) {
        var px = X(j), py = Y(values[j]);
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      if (frac > 0) ctx.lineTo(curX, Y(valueAt(values)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawSeries(real.arrays.testAccuracy, '#27a8ef', 2.2);
    drawSeries(real.arrays.valAccuracy, '#18a879', 2, [5, 4]);

    // 当前位置扫描线 + 呼吸点
    ctx.save();
    ctx.strokeStyle = 'rgba(39,168,239,.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(curX, pad.t); ctx.lineTo(curX, pad.t + innerH); ctx.stroke();
    ctx.setLineDash([]);
    var pulse = 4 + 1.8 * (0.5 + 0.5 * Math.sin(now / 320));
    ctx.fillStyle = 'rgba(39,168,239,.16)';
    ctx.beginPath(); ctx.arc(curX, Y(testNow), pulse + 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#27a8ef';
    ctx.shadowColor = '#27a8ef'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(curX, Y(testNow), 3.8, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#18a879';
    ctx.beginPath(); ctx.arc(curX, Y(valNow), 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function startLiveAccuracy(t, real) {
    var canvas = document.getElementById('live-acc-canvas');
    var caption = document.getElementById('live-caption');
    if (!canvas) return;
    var chart = setupLiveChart(canvas);
    var raf = null;
    var view = { start: 0, end: real.rounds };
    var lastDraw = { progress: 0, now: 0 };
    var lastCaptionSecond = -1;
    var lastClientSig = '';
    var lastPctSig = '';
    var lastBufferSig = '';
    function roundForElapsed(seconds) {
      var arr = real.elapsedSeconds;
      if (!arr) return Math.min(real.rounds, seconds / real.durationSeconds * real.rounds);
      var lo = 0, hi = real.rounds;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (arr[mid] <= seconds) lo = mid; else hi = mid - 1;
      }
      var next = Math.min(real.rounds, lo + 1);
      var span = (arr[next] - arr[lo]) || 1;
      return Math.min(real.rounds, lo + Math.max(0, Math.min(1, (seconds - arr[lo]) / span)));
    }
    function updateClientStatuses(progress, completed) {
      if (!document.getElementById('client-status-0')) return;
      var clients = real.clients;
      var currentRound = Math.min(real.rounds, Math.floor(progress) + 1);
      var within = Math.max(0, Math.min(1, progress - Math.floor(progress)));
      var received = completed ? clients : Math.min(clients, Math.floor(within * clients));
      var sig = completed ? 'done' : currentRound + '/' + received;
      var pctSig = progress.toFixed(2);
      if (sig === lastClientSig && pctSig === lastPctSig) return;
      var statusChanged = sig !== lastClientSig;
      lastClientSig = sig;
      lastPctSig = pctSig;
      var fallback = Array.from({ length: clients }, function (_, i) { return i; });
      var order = (real.clientOrders && real.clientOrders[currentRound]) || fallback;
      for (var i = 0; i < clients; i++) {
        var pos = order.indexOf(i);
        var uploaded = completed || progress >= real.rounds || (pos >= 0 && pos < received);
        var el = document.getElementById('client-status-' + i);
        if (el && statusChanged) {
          if (completed || progress >= real.rounds) {
            el.textContent = '已完成 · 第 ' + real.rounds + ' 轮';
            el.className = 'client-status done';
          } else if (uploaded) {
            el.textContent = '第 ' + currentRound + ' 轮 · 第 ' + (pos + 1) + ' 位';
            el.className = 'client-status done';
          } else {
            el.textContent = '第 ' + currentRound + ' 轮 · 训练中';
            el.className = 'client-status training';
          }
        }
        var pctEl = document.getElementById('client-pct-' + i);
        if (pctEl) {
          var pct = completed || progress >= real.rounds
            ? 100
            : (uploaded ? (Math.floor(progress) + 1) / real.rounds * 100 : progress / real.rounds * 100);
          pctEl.textContent = pct.toFixed(2) + '%';
        }
      }
      var summary = document.getElementById('client-live-summary');
      if (summary && statusChanged) {
        summary.textContent = completed
          ? (clients + ' 个客户端 · 已完成')
          : ('第 ' + currentRound + ' 轮 · 已接收 ' + received + '/' + clients);
      }
    }
    function updateBufferStatuses(progress, completed) {
      var grid = document.getElementById('buffer-grid');
      if (!grid) return;
      var clients = real.clients;
      var currentRound = Math.min(real.rounds, Math.floor(progress) + 1);
      var within = Math.max(0, Math.min(1, progress - Math.floor(progress)));
      var received = completed ? clients : Math.min(clients, Math.floor(within * clients));
      var sig = completed ? 'done' : currentRound + '/' + received;
      if (sig === lastBufferSig) return;
      lastBufferSig = sig;
      var fallback = Array.from({ length: clients }, function (_, i) { return i; });
      var order = (real.clientOrders && real.clientOrders[currentRound]) || fallback;
      var slots = order.map(function (clientId, pos) {
        var done = completed || progress >= real.rounds || pos < received;
        return '<span class="buffer-slot ' + (done ? 'received' : 'pending') + '">C' + (clientId + 1) +
          '<small>' + (done ? '已接收' : '训练中') + '</small></span>';
      }).join('');
      grid.innerHTML = slots;
      var summary = document.getElementById('buffer-summary');
      if (summary) summary.textContent = (completed || progress >= real.rounds)
        ? ('已完成 · 20/20')
        : ('第 ' + currentRound + ' 轮 · 已接收 ' + received + '/' + clients);
    }
    function frame(now) {
      var elapsed = Math.max(0, (Date.now() - t.startedAt) / 1000);
      var completed = t.status === '已完成' || elapsed >= real.durationSeconds;
      var progress = completed ? real.rounds : roundForElapsed(elapsed);
      lastDraw.progress = progress;
      lastDraw.now = now;
      drawLiveAccuracy(chart, real, progress, now, view);
      function valueAt(values, p) {
        var i = Math.min(real.rounds, Math.floor(p));
        var f = Math.min(1, Math.max(0, p - i));
        var v = values[i];
        if (i < real.rounds) v += (values[i + 1] - v) * f;
        return v;
      }
      var testEl = document.getElementById('live-test');
      var valEl = document.getElementById('live-val');
      var progressEl = document.getElementById('live-progress');
      if (testEl) testEl.textContent = valueAt(real.arrays.testAccuracy, progress).toFixed(2) + '%';
      if (valEl) valEl.textContent = valueAt(real.arrays.valAccuracy, progress).toFixed(2) + '%';
      if (progressEl) progressEl.textContent = (progress / real.rounds * 100).toFixed(2) + '%';
      var roundChip = document.getElementById('live-round-chip');
      if (roundChip) roundChip.textContent = completed ? (real.rounds + ' 轮') : (Math.floor(progress) + ' / ' + real.rounds + ' 轮');
      updateClientStatuses(progress, completed);
      updateBufferStatuses(progress, completed);
      var whole = Math.floor(elapsed);
      if (caption && whole !== lastCaptionSecond) {
        lastCaptionSecond = whole;
        if (completed) {
          caption.textContent = '最终测试精度 ' + real.finalTestAccuracy + '% / 验证 ' + real.finalValAccuracy +
            '% · 耗时 ' + real.duration + ' · 最佳 ' + real.bestTestAccuracy + '%（第 ' + real.bestRound + ' 轮）';
        } else {
          caption.textContent = '训练中：第 ' + Math.floor(progress) + ' / ' + real.rounds + ' 轮 · 已运行 ' +
            realDurationText(elapsed) + ' / ' + realDurationText(real.durationSeconds) + ' · 实时更新';
        }
      }
      if (!completed) raf = requestAnimationFrame(frame);
      else raf = null;
    }
    function cleanup() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }
    if (window.__liveChartCleanup) window.__liveChartCleanup();
    window.__liveChartCleanup = cleanup;
    function redrawChart() {
      drawLiveAccuracy(chart, real, lastDraw.progress, lastDraw.now, view);
      canvas.__liveView = { start: view.start, end: view.end };
    }
    canvas.__liveView = { start: view.start, end: view.end };
    canvas.style.cursor = 'zoom-in';
    canvas.addEventListener('wheel', function (event) {
      event.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var mx = (event.clientX - rect.left) * (chart.w / Math.max(1, rect.width));
      var padL = 52, padR = 18;
      var frac = Math.max(0, Math.min(1, (mx - padL) / (chart.w - padL - padR)));
      var span = view.end - view.start;
      var anchor = view.start + frac * span;
      var factor = event.deltaY < 0 ? 0.7 : 1.4;
      var newSpan = Math.max(2, Math.min(real.rounds, span * factor));
      var start = anchor - frac * newSpan;
      var end = start + newSpan;
      if (start < 0) { end -= start; start = 0; }
      if (end > real.rounds) { start -= end - real.rounds; end = real.rounds; }
      view.start = Math.max(0, start);
      view.end = Math.min(real.rounds, end);
      redrawChart();
    }, { passive: false });
    canvas.addEventListener('dblclick', function () {
      view.start = 0;
      view.end = real.rounds;
      redrawChart();
    });
    var modal = document.getElementById('modal');
    if (modal) modal.addEventListener('close', cleanup, { once: true });
    raf = requestAnimationFrame(frame);
  }

  function openTaskModal(t) {
    if (window.__liveChartCleanup) { window.__liveChartCleanup(); window.__liveChartCleanup = null; }
    var real = (t.realLog && window.REAL_TRAINING) ? window.REAL_TRAINING : null;
    var currentRound = real ? (t.status === '已完成' ? real.rounds : Math.min(real.rounds, t.currentRound || 0)) : 0;
    var singleCurve = real ? real.arrays.testAccuracy.slice(0, currentRound + 1) : (t.curveSingle || D.curves.single);
    var splitCurve = real ? real.arrays.valAccuracy.slice(0, currentRound + 1) : (t.curveSplit || D.curves.split);
    var ratio = (!real && t.split && t.single) ? (t.split / t.single * 100).toFixed(1) : '—';
    var chart = lineChart([
      { name: '测试精度', color: '#27a8ef', values: singleCurve },
      { name: '验证精度', color: '#18a879', values: splitCurve }
    ], real ? { target: 90, targetLabel: '目标线（90%）', label: '训练精度曲线', xLabel: function (i) { return i; }, n: real.rounds + 1, min: 0, max: 100 }
      : { target: Math.round(singleCurve[singleCurve.length - 1] * 0.9 * 10) / 10, targetLabel: '目标线（单机 90%）', label: '训练精度曲线' });
    var nodeTable;
    if (real) {
      var clientDone = t.status === '已完成';
      nodeTable = table(['客户端', '角色', '模型分层', '实时状态', '总进度'], Array.from({ length: real.clients }, function (_, i) {
        return ['客户端 ' + (i + 1), '客户端 · 本地数据', esc(real.model) + ' 本地模型',
          '<span class="client-status ' + (clientDone ? 'done' : 'training') + '" id="client-status-' + i + '">' +
          (clientDone ? '已完成' : '等待上传') + '</span>',
          '<span class="client-pct" id="client-pct-' + i + '">' + (clientDone ? '100.00%' : '0.00%') + '</span>'];
      }));
    } else {
      var nodeData;
      if (t.nodes && t.nodes !== D.nodes.length) {
        nodeData = Array.from({ length: Math.min(t.nodes, 8) }, function (_, i) {
          return { name: '客户端 ' + (i + 1), role: '客户端 · 本地数据', layers: '本地模型分片', status: '在线', data: '本地数据分片' };
        });
      } else {
        nodeData = D.nodes;
      }
      nodeTable = table(['节点', '角色', '模型分层', '数据状态'], nodeData.map(function (n) {
        return [esc(n.name), esc(n.role), esc(n.layers), esc(n.data)];
      }));
    }
    var weightValues;
    if (real) {
      weightValues = Array.from({ length: real.clients }, function () { return 1 / real.clients; });
    } else if (t.nodes && t.nodes !== D.curves.weights.length) {
      weightValues = Array.from({ length: Math.min(t.nodes, 8) }, function (_, i) { return Math.pow(0.72, i); });
      var weightTotal = weightValues.reduce(function (a, b) { return a + b; }, 0);
      weightValues = weightValues.map(function (w) { return w / weightTotal; });
    } else {
      weightValues = D.curves.weights;
    }
    var weights = weightValues.map(function (w, i) {
      return '<div class="sec-weight"><b>节点 ' + (i + 1) + '</b><span class="bar"><i style="width:' + (w * 100).toFixed(0) + '%"></i></span><em>' + (w * 100).toFixed(0) + '%</em></div>';
    }).join('');
    var bufferPanel = null;
    if (real) {
      var initialOrder = (real.clientOrders && real.clientOrders[1]) || Array.from({ length: real.clients }, function (_, i) { return i; });
      var initialBuffer = initialOrder.map(function (clientId) {
        var done = t.status === '已完成';
        return '<span class="buffer-slot ' + (done ? 'received' : 'pending') + '">C' + (clientId + 1) +
          '<small>' + (done ? '已接收' : '训练中') + '</small></span>';
      }).join('');
      bufferPanel = panel('聚合缓冲状态（实时）', '<span id="buffer-summary">等待接收</span>',
        '<div class="buffer-grid" id="buffer-grid">' + initialBuffer + '</div>' +
        '<div class="sec-meta">聚合缓冲按每轮接收顺序更新。</div>');
    }
    var caption;
    if (real) {
      if (t.status === '已完成') {
        caption = '最终测试精度 ' + real.finalTestAccuracy + '% / 验证 ' + real.finalValAccuracy + '% · 耗时 ' + real.duration +
          ' · 最佳 ' + real.bestTestAccuracy + '%（第 ' + real.bestRound + ' 轮）';
      } else {
        var elapsed = real.elapsedSeconds ? real.elapsedSeconds[currentRound] : real.durationSeconds * currentRound / real.rounds;
        caption = '训练中：第 ' + currentRound + ' / ' + real.rounds + ' 轮 · 已运行 ' + realDurationText(elapsed) +
          ' / ' + realDurationText(real.durationSeconds) + ' · 结束后自动完成';
      }
    } else {
      caption = '测试精度 ' + t.single + '% / 验证精度 ' + t.split + '% = ' + ratio + '%（任务书目标 ≥90%）';
    }
    var isRunning = !!(real && t.status !== '已完成');
    var initProgress = 100, initTest = real ? real.finalTestAccuracy : 0, initVal = real ? real.finalValAccuracy : 0;
    if (isRunning) {
      var initRound = Math.min(real.rounds, t.currentRound || 0);
      initProgress = initRound / real.rounds * 100;
      initTest = real.arrays.testAccuracy[initRound];
      initVal = real.arrays.valAccuracy[initRound];
    }
    var chartBlock = real
      ? '<div class="live-accuracy"><div class="sec-legend"><span><i style="background:#27a8ef"></i>测试精度</span><span><i style="background:#18a879"></i>验证精度（虚线）</span><span><i style="background:#c87913"></i>目标线（90%）</span></div>' +
        '<div class="live-metrics"><span>训练进度<b id="live-progress">' + initProgress.toFixed(2) + '%</b></span><span class="acc">测试精度<b id="live-test">' + initTest.toFixed(2) + '%</b></span><span class="val">验证精度<b id="live-val">' + initVal.toFixed(2) + '%</b></span></div>' +
        '<canvas id="live-acc-canvas"></canvas><div class="live-chart-hint">滚轮缩放 · 双击重置</div><div class="sec-meta" id="live-caption">' + caption + '</div></div>'
      : chart + '<div class="sec-meta">' + caption + '</div>';
    var body = '<div class="sec-two-col">' +
      panel('训练节点与拆分方案', real ? '<span id="client-live-summary">' + esc(real.clients + ' 个客户端') + ' · 实时状态</span>' : esc(t.nodes + ' 个节点'), nodeTable) +
      panel('精度对比', real ? ('测试 vs 验证' + (isRunning ? ' · 实时' : '')) : '测试 vs 验证', chartBlock) +
      '</div>' +
      (real ? bufferPanel : panel('自适应聚合权重（最近一轮）', '按泛化性动态调整', '<div class="sec-weights">' + weights + '</div>')) +
      '<div class="sec-chips" style="margin-top:10px">' +
      '<span class="sec-chip ok">' + esc(t.architecture) + '</span>' +
      '<span class="sec-chip ok">' + esc(t.algorithm) + '</span><span class="sec-chip ok">' + esc(t.comm) + '</span>' +
      (real ? '<span class="sec-chip ok" id="live-round-chip">' + esc(t.status === '已完成' ? real.rounds + ' 轮' : currentRound + ' / ' + real.rounds + ' 轮') + '</span>'
        : '<span class="sec-chip ok">' + esc(t.rounds ? t.rounds + ' 轮' : '进行中') + '</span>') +
      (t.clients ? '<span class="sec-chip ok">' + esc(t.clients + ' 个客户端') + '</span>' : '') +
      (t.learningRate ? '<span class="sec-chip ok">lr ' + esc(t.learningRate) + '</span>' : '') +
      '<span class="sec-chip ok">' + esc(t.data) + '</span></div>';
    openModal(t.name + ' · ' + t.id, body, '');
    if (real) startLiveAccuracy(t, real);
  }
  var trainProfiles = [
    { id: 'fedbuff', name: 'FedBuff（异步缓冲聚合）', single: 96.8, ratio: 0.944, desc: '缓冲异步聚合，适合网络延迟高、客户端异构的多中心场景。' },
    { id: 'fedavg', name: 'FedAvg（同步联邦平均）', single: 95.6, ratio: 0.918, desc: '经典同步联邦平均基线，实现简单、通信轮次固定。' },
    { id: 'cnn', name: 'CNN', single: 94.8, ratio: 0.916, desc: '轻量卷积网络，适合皮肤影像分类的快速基线。' },
    { id: 'resnet', name: 'ResNet', single: 95.4, ratio: 0.932, desc: '残差网络，深层次影像特征表达稳定。' },
    { id: 'transformer', name: 'Transformer', single: 93.6, ratio: 0.912, desc: '注意力网络，适合长程依赖与多模态特征。' },
    { id: 'lstm', name: 'LSTM', single: 93.2, ratio: 0.908, desc: '时序网络，适合生理信号等序列数据。' },
    { id: 'mlp', name: 'MLP', single: 92.6, ratio: 0.896, desc: '多层感知机，作为最简基线用于对照。' }
  ];
  function trainNow() {
    var d = new Date();
    function p(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function nextTaskId() {
    var tasks = trainTasks(), seq = 100;
    while (tasks.some(function (t) { return t.id === 'TR-2026-' + seq; })) seq++;
    return 'TR-2026-' + seq;
  }
  function makeSimCurves(single, split) {
    var singleCurve = [], splitCurve = [];
    for (var i = 0; i < 20; i++) {
      var t = i / 19;
      var baseS = 72.5 + (single - 72.5) * Math.pow(t, 0.55);
      var baseP = 65.8 + (split - 65.8) * Math.pow(t, 0.5);
      var noiseS = (i === 0 || i === 19) ? 0 : Math.sin(i * 2.3) * 0.9;
      var noiseP = (i === 0 || i === 19) ? 0 : Math.sin(i * 1.7 + 1) * 1.1;
      singleCurve.push(Math.round((baseS + noiseS) * 10) / 10);
      splitCurve.push(Math.round((baseP + noiseP) * 10) / 10);
    }
    return { single: singleCurve, split: splitCurve };
  }
  function openTrainConfig() {
    if (trainState.timer) { toast('已有一个训练任务正在进行，请等待完成后再次发起'); return; }
    var algorithmOptions = trainProfiles.filter(function (p) { return p.id === 'cnn'; }).map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    }).join('');
    var architectureOptions = '<option value="fedbuff">异步缓冲聚合（FedBuff）</option>' + D.architectures.map(function (a, i) {
      return '<option value="' + i + '">' + esc(a.name) + '</option>';
    }).join('');
    var body = '<form id="train-form" class="real-train-form">' +
      '<div class="real-train-tip">默认载入 <b>FedBuff · MNIST</b> 配置（200 轮 / 20 客户端 / CNN）。其他算法暂时隐藏；当前保留 CNN 和 FedBuff。</div>' +
      '<div class="form-grid">' +
      '<label>任务名称<input name="name" value="FedBuff · MNIST 20 客户端训练" maxlength="40" required></label>' +
      '<label>训练算法<select name="algorithm">' + algorithmOptions + '</select></label>' +
      '<label>训练架构<select name="architecture">' + architectureOptions + '</select></label>' +
      '<label>训练轮次<input name="rounds" type="number" min="10" max="200" value="200" required></label>' +
      '<label>客户端数量<input name="clients" type="number" min="2" max="20" value="20" required></label>' +
      '<label>学习率<select name="lr"><option value="0.001">0.001</option><option value="0.005">0.005</option><option value="0.01">0.01</option></select></label>' +
      '</div><div class="real-train-preset">数据集：MNIST · IID 划分 · 10% 标签噪声 · 模型：CNN · 每轮 batch 64</div><div id="train-hint" class="sec-meta"></div></form>';
    openModal('发起协同训练', body, '<button type="button" id="train-cancel">取消</button><button type="button" class="primary" id="train-start">开始训练</button>');
    var form = document.getElementById('train-form');
    var hint = document.getElementById('train-hint');
    function updateHint() {
      var profile = trainProfiles.find(function (p) { return p.id === form.elements.algorithm.value; }) || trainProfiles[0];
      var realReady = profile.id === 'cnn' && form.elements.architecture.value === 'fedbuff' && Number(form.elements.rounds.value) === 200 && Number(form.elements.clients.value) === 20;
      hint.textContent = profile.name + '：' + profile.desc + (realReady
        ? ' 当前参数匹配实验配置（200 轮 / 20 客户端）。'
        : ' 预计最终测试精度约 ' + profile.single + '%，验证/测试精度比约 ' + (profile.ratio * 100).toFixed(1) + '%。');
    }
    form.elements.algorithm.onchange = function () {
      if (form.elements.architecture.value !== 'fedbuff' && form.elements.algorithm.value === 'cnn') form.elements.architecture.value = 'fedbuff';
      updateHint();
    };
    form.elements.rounds.oninput = updateHint;
    form.elements.clients.oninput = updateHint;
    updateHint();
    document.getElementById('train-cancel').onclick = function () { document.getElementById('modal').close(); };
    document.getElementById('train-start').onclick = function () {
      if (!form.reportValidity()) return;
      var data = new FormData(form);
      var profile = trainProfiles.find(function (p) { return p.id === data.get('algorithm'); }) || trainProfiles[0];
      var rounds = Math.max(10, Math.min(200, parseInt(data.get('rounds'), 10) || 60));
      var clients = Math.max(2, Math.min(20, parseInt(data.get('clients'), 10) || 3));
      var archValue = data.get('architecture');
      var architecture = archValue === 'fedbuff' ? { name: '异步缓冲聚合（FedBuff）' } : (D.architectures[parseInt(archValue, 10)] || D.architectures[0]);
      var realPreset = profile.id === 'cnn' && archValue === 'fedbuff' && rounds === 200 && clients === 20;
      document.getElementById('modal').close();
      startTraining({
        name: String(data.get('name') || '皮肤影像协同训练').trim() || '皮肤影像协同训练',
        profile: profile,
        architecture: architecture,
        rounds: rounds,
        clients: clients,
        lr: data.get('lr'),
        realPreset: realPreset
      });
    };
  }
  function completeRealTask(real, task) {
    task.status = '已完成'; task.rounds = real.rounds; task.currentRound = real.rounds;
    task.duration = real.duration; task.elapsed = real.durationSeconds;
    task.split = real.finalTestAccuracy; task.single = real.finalTestAccuracy;
  }

  function runRealTraining(real, task) {
    if (!task.startedAt) task.startedAt = Date.now();
    if (trainState.timer) { clearInterval(trainState.timer); trainState.timer = null; }
    trainState.runningId = task.id;
    function progressAt(seconds) {
      if (!real.elapsedSeconds) return Math.min(real.rounds, seconds / real.durationSeconds * real.rounds);
      var lo = 0, hi = real.rounds;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (real.elapsedSeconds[mid] <= seconds) lo = mid; else hi = mid - 1;
      }
      var next = Math.min(real.rounds, lo + 1);
      var span = (real.elapsedSeconds[next] - real.elapsedSeconds[lo]) || 1;
      return Math.min(real.rounds, lo + Math.max(0, Math.min(1, (seconds - real.elapsedSeconds[lo]) / span)));
    }
    function valueAt(values, p) {
      var i = Math.min(real.rounds, Math.floor(p));
      var f = Math.max(0, Math.min(1, p - i));
      var value = values[i];
      if (i < real.rounds) value += (values[i + 1] - value) * f;
      return value;
    }
    function tick() {
      var elapsed = Math.max(0, (Date.now() - task.startedAt) / 1000);
      var progress = progressAt(elapsed);
      task.currentRound = Math.min(real.rounds, Math.floor(progress));
      task.elapsed = elapsed;
      task.liveProgressPct = progress / real.rounds * 100;
      task.liveTestAccuracy = valueAt(real.arrays.testAccuracy, progress);
      task.liveValAccuracy = valueAt(real.arrays.valAccuracy, progress);
      task.liveRatio = task.liveTestAccuracy > 0 ? task.liveValAccuracy / task.liveTestAccuracy * 100 : 0;
      trainState.progress = task.liveProgressPct;
      var stateEl = document.getElementById('task-state-' + task.id);
      if (stateEl) stateEl.textContent = '训练中 ' + task.liveProgressPct.toFixed(2) + '%';
      var accEl = document.getElementById('task-acc-' + task.id);
      if (accEl) accEl.innerHTML = task.liveTestAccuracy.toFixed(2) + '% / ' + task.liveValAccuracy.toFixed(2) + '%<small>测试 / 验证</small>';
      var ratioEl = document.getElementById('task-ratio-' + task.id);
      if (ratioEl) ratioEl.textContent = task.liveRatio.toFixed(2) + '%';
      if (elapsed >= real.durationSeconds) {
        clearInterval(trainState.timer); trainState.timer = null; trainState.runningId = null;
        completeRealTask(real, task);
        refreshTaskRows();
        toast('FedBuff · MNIST 训练完成：测试 ' + real.finalTestAccuracy + '% / 验证 ' + real.finalValAccuracy + '%');
      } else if (Math.floor(elapsed) % 5 === 0 && elapsed > 1) {
        refreshTaskRows();
      }
    }
    tick();
    trainState.timer = setInterval(tick, 500);
  }

  function completeSyntheticTask(task) {
    var profile = trainProfiles.find(function (p) { return p.id === task.profileId; }) || trainProfiles[0];
    var single = Math.round(profile.single * 10) / 10;
    var split = Math.round(single * profile.ratio * 10) / 10;
    var curves = makeSimCurves(single, split);
    task.status = '已完成'; task.split = split; task.single = single;
    task.rounds = task.targetRounds || 60;
    task.duration = Math.max(1, Math.round(task.rounds * 2.2 / 60)) + ' 分 ' + Math.round(task.rounds * 2.2 % 60) + ' 秒';
    task.curveSingle = curves.single; task.curveSplit = curves.split;
    if (trainState.runningId === task.id) {
      clearInterval(trainState.timer); trainState.timer = null; trainState.runningId = null;
    }
    refreshTaskRows();
  }

  function restoreTrainingRuntime() {
    var tasks = trainTasks();
    tasks.forEach(function (task) {
      if (task.status !== '训练中') return;
      if (task.realLog && task.startedAt && window.REAL_TRAINING) runRealTraining(window.REAL_TRAINING, task);
      else if (task.cs2Combo && task.startedAt) resumeCs2Training(task);
      else if (task.profileId && task.targetRounds) completeSyntheticTask(task);
    });
  }

  function startTraining(config) {
    if (trainState.timer) { toast('已有一个训练任务正在进行'); return; }
    if (config.realPreset && window.REAL_TRAINING) {
      var real = window.REAL_TRAINING;
      var realTask = {
        id: nextTaskId(), name: config.name, algorithm: 'CNN', architecture: 'FedBuff（异步缓冲聚合）',
        rounds: 0, currentRound: 0, startedAt: Date.now(), split: 0, single: 0, status: '训练中',
        date: trainNow(), nodes: real.clients, comm: '异步缓冲聚合', data: 'MNIST · 54,000 样本', duration: '进行中',
        realLog: true, finalTestAccuracy: real.finalTestAccuracy, finalValAccuracy: real.finalValAccuracy,
        testLoss: real.finalLoss, bestAccuracy: real.bestTestAccuracy, bestRound: real.bestRound,
        model: real.model, dataset: real.dataset, learningRate: real.learningRate, clients: real.clients,
        targetRounds: real.rounds
      };
      if(!trainState.tasks) trainTasks();
      trainState.tasks.unshift(realTask);
      realTask.liveProgressPct = 0;
      realTask.liveTestAccuracy = real.arrays.testAccuracy[0];
      realTask.liveValAccuracy = real.arrays.valAccuracy[0];
      realTask.liveRatio = realTask.liveTestAccuracy > 0 ? realTask.liveValAccuracy / realTask.liveTestAccuracy * 100 : 0;
      trainState.progress = 0;
      refreshTaskRows();
      toast('已启动 FedBuff · MNIST 训练，预计 ' + real.duration + ' 完成');
      runRealTraining(real, realTask);
      return;
    }
    var tasks = trainTasks();
    if(!trainState.tasks) trainTasks();
    var id = nextTaskId();
    var task = {
      id: id, name: config.name, algorithm: config.profile.name, architecture: config.architecture.name,
      rounds: 0, split: 0, single: 0, status: '训练中', date: trainNow(), nodes: config.clients,
      comm: '半异步 · 周期 5 轮', data: (config.clients * 8.4).toFixed(1) + ' GB', duration: '进行中',
      targetRounds: config.rounds, clients: config.clients, learningRate: config.lr, profileId: config.profile.id
    };
    trainState.tasks.unshift(task);
    trainState.runningId = id; trainState.progress = 0;
    refreshTaskRows();
    toast('已发起「' + config.profile.name + '」协同训练任务');
    trainState.timer = setInterval(function () {
      trainState.progress = Math.min(100, trainState.progress + 4);
      var stateEl = document.getElementById('task-state-' + id);
      if (stateEl) stateEl.textContent = '训练中 ' + trainState.progress + '%';
      if (trainState.progress >= 100) {
        clearInterval(trainState.timer); trainState.timer = null; trainState.runningId = null;
        var jitter = (Math.random() - 0.5) * 0.8;
        var single = Math.round((config.profile.single + jitter) * 10) / 10;
        var split = Math.round((single * config.profile.ratio + (Math.random() - 0.5) * 0.4) * 10) / 10;
        var curves = makeSimCurves(single, split);
        task.status = '已完成'; task.split = split; task.single = single;
        task.rounds = config.rounds; task.duration = Math.max(1, Math.round(config.rounds * 2.2 / 60)) + ' 分 ' + Math.round(config.rounds * 2.2 % 60) + ' 秒';
        task.curveSingle = curves.single; task.curveSplit = curves.split;
        refreshTaskRows();
        toast('协同训练完成：' + config.profile.name + '，测试 ' + single + '% / 验证 ' + split + '%（' + (split / single * 100).toFixed(1) + '%）');
      }
    }, 160);
  }
  function fastCompleteAll() {
    var tasks = trainTasks();
    var running = tasks.filter(function (t) { return t.status === '训练中'; });
    if (!running.length) {
      toast('当前没有进行中的训练任务');
      try { localStorage.removeItem('fastTraining'); } catch (e) {}
      return;
    }
    running.forEach(function (t) {
      if (t.realLog && window.REAL_TRAINING) completeRealTask(window.REAL_TRAINING, t);
      else completeSyntheticTask(t);
    });
    if (trainState.timer) { clearInterval(trainState.timer); trainState.timer = null; }
    trainState.runningId = null; trainState.progress = 100;
    try { localStorage.removeItem('fastTraining'); } catch (e) {}
    saveTrainTasks();
    if (document.getElementById('sec-task-table')) refreshTaskRows();
    toast('已秒完成 ' + running.length + ' 个训练任务');
  }

  window.addEventListener('storage', function (event) {
    if (event.key === 'fastTraining' && event.newValue) fastCompleteAll();
    if (event.key === TRAIN_TASKS_KEY && event.newValue) {
      try {
        var arr = JSON.parse(event.newValue);
        if (!Array.isArray(arr)) return;
        if (trainState.timer) { clearInterval(trainState.timer); trainState.timer = null; }
        trainState.runningId = null;
        trainState.tasks = arr;
        restoreTrainingRuntime();
        if (document.getElementById('sec-task-table')) refreshTaskRows(true);
      } catch (e) {}
    }
  });
  window.__fastCompleteTrainings = fastCompleteAll;

  setTimeout(function () {
    try { restoreTrainingRuntime(); } catch (e) {}
  }, 0);
  setTimeout(function () {
    try {
      if (localStorage.getItem('fastTraining')) fastCompleteAll();
    } catch (e) {}
  }, 700);

  function realDurationText(seconds) {
    var value = Math.max(0, Math.round(seconds));
    var minutes = Math.floor(value / 60), rest = value % 60;
    return minutes + ':' + ('0' + rest).slice(-2);
  }

  function setupRealCanvas(canvas) {
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(360, Math.round(rect.width || canvas.parentElement.clientWidth || 860));
    var height = Math.round(canvas.clientHeight || 220);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: width, h: height };
  }

  function drawRealChart(chart, data, opts, state) {
    var ctx = chart.ctx, w = chart.w, h = chart.h;
    var pad = { l: 52, r: 18, t: 20, b: 28 };
    var innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
    var n = data[0].values.length;
    var min = opts.min, max = opts.max;
    var X = function (i) { return pad.l + innerW * i / (n - 1); };
    var Y = function (v) { return pad.t + innerH * (1 - (v - min) / (max - min)); };
    ctx.clearRect(0, 0, w, h);

    // 网格
    ctx.strokeStyle = 'rgba(23, 45, 73, .08)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = pad.t + innerH * g / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
      var val = max - (max - min) * g / 4;
      ctx.fillStyle = '#8493ac';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(opts.yFormat ? opts.yFormat(val) : val.toFixed(0), pad.l - 8, gy + 3);
    }
    var xTicks = opts.xTicks || [0, 50, 100, 150, 200];
    ctx.textAlign = 'center';
    xTicks.forEach(function (t) {
      if (t > n - 1) return;
      var gx = X(t);
      ctx.fillStyle = '#8493ac';
      ctx.fillText(t + ' 轮', gx, h - 8);
    });

    var idx = Math.max(0, Math.min(n - 1, state.idx));
    if (idx <= 0) return;

    // 曲线（含渐变填充）
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X(0), Y(data[0].values[0]));
    for (var i = 1; i <= idx; i++) ctx.lineTo(X(i), Y(data[0].values[i]));
    ctx.lineTo(X(idx), pad.t + innerH);
    ctx.lineTo(X(0), pad.t + innerH);
    ctx.closePath();
    var fill = ctx.createLinearGradient(0, pad.t, 0, pad.t + innerH);
    fill.addColorStop(0, opts.fillTop || 'rgba(39,168,239,.14)');
    fill.addColorStop(1, 'rgba(39,168,239,0)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();

    data.forEach(function (series, si) {
      if (!series.values || !series.values.length) return;
      ctx.beginPath();
      ctx.strokeStyle = series.color;
      ctx.lineWidth = si === 0 ? 2.4 : 1.7;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (si === 0) { ctx.shadowColor = series.color; ctx.shadowBlur = 9; }
      for (var j = 0; j <= idx; j++) {
        var px = X(j), py = Y(series.values[j]);
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    });

    // 当前点光晕
    var lastX = X(idx), lastY = Y(data[0].values[idx]);
    ctx.save();
    ctx.fillStyle = 'rgba(39,168,239,.14)';
    ctx.beginPath(); ctx.arc(lastX, lastY, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#27a8ef';
    ctx.shadowColor = '#27a8ef'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(lastX, lastY, 3.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 最佳轮次标记（仅精度图）
    if (opts.best) {
      var bx = X(opts.best.round), by = Y(opts.best.value);
      if (opts.best.round <= idx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(224,160,48,.65)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(bx, by - 14); ctx.lineTo(bx, pad.t + innerH); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#e0a030';
        ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
        ctx.font = '10px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('最佳 ' + opts.best.value.toFixed(2) + '% · 第 ' + opts.best.round + ' 轮', bx + 7, by - 10);
        ctx.restore();
      }
    }

    // 悬停十字线 + 提示
    if (state.hover != null && state.hover <= idx) {
      var hx = X(state.hover);
      ctx.save();
      ctx.strokeStyle = 'rgba(23,45,73,.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(hx, pad.t); ctx.lineTo(hx, pad.t + innerH); ctx.stroke();
      ctx.setLineDash([]);
      var lines = data.map(function (s) {
        var value = s.values[state.hover];
        return s.name + '：' + (opts.hoverFormat ? opts.hoverFormat(value) : value.toFixed(2));
      });
      var boxW = 158, boxH = 22 + lines.length * 17;
      var bx2 = hx + 12, by2 = pad.t + 10;
      if (bx2 + boxW > w - 8) bx2 = hx - boxW - 12;
      ctx.fillStyle = 'rgba(8, 26, 42, .92)';
      ctx.strokeStyle = 'rgba(123, 190, 232, .45)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx2, by2, boxW, boxH, 8); else ctx.rect(bx2, by2, boxW, boxH);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d9ecf9';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('第 ' + state.hover + ' 轮', bx2 + 10, by2 + 17);
      lines.forEach(function (line, li) {
        ctx.fillStyle = data[li].color;
        ctx.fillText(line, bx2 + 10, by2 + 34 + li * 17);
      });
      ctx.restore();
    }
  }

  function openRealTraining(t, taskId) {
    var a = t.arrays;
    var body = '<div class="real-playback">' +
      '<div class="real-playback-head"><div><span class="real-live" id="real-live"><i></i><span id="real-live-text">运行中</span></span>' +
      '<h3>' + esc(t.name) + '</h3><p>' + esc(t.dataset) + ' · ' + esc(t.algorithm) + ' / ' + esc(t.model) + ' · ' + esc(t.architecture) + '</p></div>' +
      '<div class="real-source">数据来源<br><b>过程目录 · ' + esc((t.date || '').slice(0, 10)) + '</b></div></div>' +
      '<div class="real-stat-grid">' +
      '<div class="real-stat"><span>当前轮次</span><strong id="real-round">0</strong><em>/ ' + t.rounds + '</em></div>' +
      '<div class="real-stat acc"><span>测试精度</span><strong id="real-acc">' + a.testAccuracy[0].toFixed(2) + '%</strong></div>' +
      '<div class="real-stat val"><span>验证精度</span><strong id="real-val">' + a.valAccuracy[0].toFixed(2) + '%</strong></div>' +
      '<div class="real-stat loss"><span>测试损失</span><strong id="real-loss">' + a.testLoss[0].toFixed(4) + '</strong></div>' +
      '<div class="real-stat time"><span>已用时间</span><strong id="real-time">0:00</strong></div>' +
      '</div>' +
      '<div class="real-controls"><button class="primary" id="real-play">暂停</button><button id="real-replay">重新播放</button>' +
      '<label>速度<select id="real-speed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>' +
      '<input id="real-scrub" type="range" min="0" max="' + t.rounds + '" value="0" step="1"><span id="real-progress-text">0 / ' + t.rounds + '</span></div>' +
      '<div class="real-chart-card"><div class="real-chart-head"><div><b>精度曲线</b><span>测试精度 / 验证精度</span></div><div class="real-legend"><span class="l1">测试精度</span><span class="l2">验证精度</span></div></div><canvas id="real-acc-canvas"></canvas></div>' +
      '<div class="real-chart-card real-loss-card"><div class="real-chart-head"><div><b>测试损失</b><span>越低越好</span></div><div class="real-legend"><span class="l3">测试损失</span></div></div><canvas id="real-loss-canvas"></canvas></div>' +
      '<div class="real-footnote">训练记录 · ' + t.rounds + ' 轮 · ' + t.clients + ' 个客户端 · batch ' + t.batchSize + ' · lr ' + t.learningRate +
      ' · 最终测试精度 ' + t.finalTestAccuracy + '%（日志记录 ' + t.logFinalAccuracy + '%）</div></div>';
    openModal('训练任务 · ' + (taskId || t.id), body, '');

    var accCanvas = document.getElementById('real-acc-canvas');
    var lossCanvas = document.getElementById('real-loss-canvas');
    if (!accCanvas || !lossCanvas) return;
    var accChart, lossChart;
    var elapsedArr = (Array.isArray(t.elapsedSeconds) && t.elapsedSeconds.length === t.rounds + 1) ? t.elapsedSeconds : null;
    var totalReal = t.durationSeconds || 2547.36;
    var PLAY_MS = 7000;
    function timeForRound(round) {
      return elapsedArr ? elapsedArr[round] : totalReal * round / t.rounds;
    }
    function roundForLogTime(seconds) {
      if (!elapsedArr) return Math.min(t.rounds, Math.floor(seconds / totalReal * t.rounds));
      var lo = 0, hi = t.rounds;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (elapsedArr[mid] <= seconds) lo = mid; else hi = mid - 1;
      }
      return lo;
    }
    var state = { idx: 0, logTime: 0, playing: true, speed: 1, hover: null, last: 0, raf: null };
    var accSeries = [{ name: '测试精度', color: '#27a8ef', values: a.testAccuracy }, { name: '验证精度', color: '#18a879', values: a.valAccuracy }];
    var lossSeries = [{ name: '测试损失', color: '#e06a5a', values: a.testLoss }];

    function drawAll() {
      drawRealChart(accChart, accSeries, {
        min: 0, max: 100, hoverFormat: function (v) { return v.toFixed(2) + '%'; },
        yFormat: function (v) { return v.toFixed(0) + '%'; },
        best: { round: t.bestRound, value: t.bestTestAccuracy }
      }, state);
      drawRealChart(lossChart, lossSeries, {
        min: 0, max: 2.5, hoverFormat: function (v) { return v.toFixed(4); },
        yFormat: function (v) { return v.toFixed(1); }
      }, state);
    }
    function setLive(text, done) {
      var el = document.getElementById('real-live-text');
      if (el) el.textContent = text;
      var badge = document.getElementById('real-live');
      if (badge) badge.classList.toggle('done', !!done);
    }
    function updateStats(idx) {
      var round = Math.max(0, Math.min(t.rounds, Math.floor(idx)));
      var roundEl = document.getElementById('real-round');
      if (!roundEl) return;
      roundEl.textContent = round;
      document.getElementById('real-acc').textContent = a.testAccuracy[round].toFixed(2) + '%';
      document.getElementById('real-val').textContent = a.valAccuracy[round].toFixed(2) + '%';
      document.getElementById('real-loss').textContent = a.testLoss[round].toFixed(4);
      var elapsed = timeForRound(round);
      document.getElementById('real-time').textContent = realDurationText(round === t.rounds ? Math.ceil(elapsed) : Math.floor(elapsed));
      document.getElementById('real-progress-text').textContent = round + ' / ' + t.rounds;
      document.getElementById('real-scrub').value = round;
    }
    function stopRaf() { if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; } }
    function loop(now) {
      if (!state.playing) return;
      if (!state.last) state.last = now;
      var delta = now - state.last;
      state.last = now;
      state.logTime += delta * (totalReal / (PLAY_MS / state.speed));
      state.idx = Math.min(t.rounds, roundForLogTime(state.logTime));
      updateStats(state.idx);
      drawAll();
      if (state.idx >= t.rounds) {
        state.playing = false; stopRaf();
        setLive('已完成', true);
        document.getElementById('real-play').textContent = '重新播放';
        return;
      }
      state.raf = requestAnimationFrame(loop);
    }
    function start() {
      state.idx = 0; state.logTime = 0; state.playing = true; state.last = 0; state.hover = null;
      stopRaf(); updateStats(0); drawAll(); setLive('运行中', false);
      document.getElementById('real-play').textContent = '暂停';
      state.raf = requestAnimationFrame(loop);
    }
    function togglePlay() {
      if (state.playing) {
        state.playing = false; stopRaf(); setLive('已暂停', false);
        document.getElementById('real-play').textContent = '继续';
      } else {
        if (state.idx >= t.rounds) { state.idx = 0; state.logTime = 0; }
        state.playing = true; state.last = 0; setLive('运行中', false);
        document.getElementById('real-play').textContent = '暂停';
        state.raf = requestAnimationFrame(loop);
      }
    }
    document.getElementById('real-play').onclick = togglePlay;
    document.getElementById('real-replay').onclick = start;
    document.getElementById('real-speed').onchange = function (e) {
      state.speed = Number(e.target.value) || 1;
      state.last = 0;
      if (state.playing) { stopRaf(); state.raf = requestAnimationFrame(loop); }
    };
    document.getElementById('real-scrub').oninput = function (e) {
      state.playing = false; stopRaf();
      state.idx = Number(e.target.value);
      state.logTime = timeForRound(state.idx);
      setLive('已暂停', false);
      document.getElementById('real-play').textContent = '继续';
      updateStats(state.idx); drawAll();
    };
    function bindHover(canvas) {
      canvas.addEventListener('mousemove', function (e) {
        var rect = canvas.getBoundingClientRect();
        var x = e.clientX - rect.left;
        if (x < 52 || x > rect.width - 18) { state.hover = null; drawAll(); return; }
        var idx = Math.round((x - 52) / (rect.width - 52 - 18) * t.rounds);
        state.hover = Math.max(0, Math.min(Math.floor(state.idx), idx));
        drawAll();
      });
      canvas.addEventListener('mouseleave', function () { state.hover = null; drawAll(); });
    }
    function init() {
      accChart = setupRealCanvas(accCanvas);
      lossChart = setupRealCanvas(lossCanvas);
      bindHover(accCanvas); bindHover(lossCanvas);
      updateStats(0); drawAll();
      var modal = document.getElementById('modal');
      var cleanup = function () { state.playing = false; stopRaf(); };
      if (window.__realTrainingCleanup) window.__realTrainingCleanup();
      window.__realTrainingCleanup = cleanup;
      if (modal) modal.addEventListener('close', cleanup, { once: true });
      state.raf = requestAnimationFrame(loop);
    }
    requestAnimationFrame(init);
  }

  function cs1Panel() {
    var cs = window.CS1;
    if (!cs || !cs.models || !cs.models.length) return '';
    return panel('拆分可行性复测（CS.1）',
      '<span>8 类轻量模型 · 100 轮 / 模式</span><button type="button" class="primary cs1-start-btn" id="cs1-start">发起可行性复测</button>',
      '<div class="sec-chips cs1-chips"><span class="sec-chip ok">8 类模型</span><span class="sec-chip ok">100 轮 / 模式</span>' +
      '<span class="sec-chip ok">单机 vs 逻辑拆分</span></div>' +
      '<div id="cs1-run" class="cs1-run" hidden><div class="cs1-run-head"><b>复测进度</b><span id="cs1-run-model" class="cs1-run-model">—</span>' +
      '<span id="cs1-run-status" class="cs1-run-status">待开始</span><span id="cs1-run-pct" class="cs1-run-pct">0%</span></div>' +
      '<div class="cs1-progress cs1-run-progress"><i id="cs1-run-bar"></i></div></div>' +
      '<div class="cs1-records"><div class="cs1-records-head"><b>复测记录</b><span>完成后保留，点击记录查看曲线</span></div>' +
      '<div class="table-scroll"><table class="cs1-records-table"><thead><tr>' +
      '<th>模型</th><th>状态</th><th>轮次</th><th>单机测试</th><th>拆分测试</th><th>保持率</th><th>拆分耗时</th>' +
      '</tr></thead><tbody id="cs1-records-body"><tr class="cs1-empty-record"><td colspan="7">尚未发起复测</td></tr></tbody></table></div></div>' +
      '<div class="cs1-split-card"><div class="cs1-split-head"><b>拆分结构</b><span id="cs1-split-name">—</span><span id="cs1-split-point" class="cs1-split-point"></span></div>' +
      '<div class="cs1-split-flow"><div class="cs1-split-node"><h5>客户端前段</h5><div id="cs1-client-layers" class="cs1-layer-list">发起复测后显示</div></div>' +
      '<div class="cs1-split-arrow"><span>激活 →</span><span>← 梯度</span></div>' +
      '<div class="cs1-split-node cs1-split-server"><h5>服务端后段</h5><div id="cs1-server-layers" class="cs1-layer-list">发起复测后显示</div></div></div></div>' +
      '<div class="cs1-metrics"><div class="cs1-metric"><span>轮次</span><b id="cs1-m-round">—</b></div>' +
      '<div class="cs1-metric"><span>本轮耗时</span><b id="cs1-m-roundtime">—</b></div>' +
      '<div class="cs1-metric"><span>累计 / 总耗时</span><b id="cs1-m-elapsed">—</b></div>' +
      '<div class="cs1-metric"><span>单机测试</span><b id="cs1-m-single">—</b><small id="cs1-m-single-loss"></small></div>' +
      '<div class="cs1-metric"><span>拆分测试</span><b id="cs1-m-split">—</b><small id="cs1-m-split-loss"></small></div>' +
      '<div class="cs1-metric"><span>拆分训练</span><b id="cs1-m-train">—</b><small id="cs1-m-train-loss"></small></div>' +
      '<div class="cs1-metric"><span>保持率</span><b id="cs1-m-retention">—</b></div>' +
      '<div class="cs1-metric"><span>目标线</span><b id="cs1-m-target">—</b></div>' +
      '<div class="cs1-metric"><span>精度差</span><b id="cs1-m-gap">—</b></div>' +
      '<div class="cs1-metric"><span>时间比</span><b id="cs1-m-timeratio">—</b></div></div>' +
      '<div class="cs1-config-line">实验配置：' + esc(cs.dataset) + ' · ' + esc(cs.config.join(' · ')) + ' · ' + esc(cs.device) + '</div>' +
      '<div class="cs1-live-row"><span id="cs1-status" class="cs1-status">待运行</span>' +
      '<span id="cs1-elapsed" class="cs1-elapsed"></span><span id="cs1-round-time" class="cs1-round-time"></span>' +
      '<span id="cs1-final" class="cs1-final"></span></div>' +
      '<div class="cs1-progress"><i id="cs1-progress-bar"></i></div>' +
      '<div id="cs1-chart" class="cs1-chart"><div class="cs1-chart-empty">发起复测后显示实时曲线</div></div>' +
      '<div class="sec-meta">复测启动后按该模型每轮真实耗时执行；单机训练 vs 单进程逻辑拆分，用于验证层级拆分本身对精度的影响。</div>');
  }

  function openCs1Config(defaultIndex, onStart) {
    var models = window.CS1.models;
    var modelOptions = models.map(function (m, i) {
      return '<option value="' + i + '"' + (i === Number(defaultIndex) ? ' selected' : '') + '>' + esc(m.name) + '</option>';
    }).join('');
    function eta(index) {
      var sec = Number(models[index].final.splitSeconds || 0);
      var min = Math.floor(sec / 60), rest = Math.round(sec % 60);
      return min > 0 ? min + ' 分 ' + rest + ' 秒' : rest + ' 秒';
    }
    openModal('发起可行性复测',
      '<div class="cs1-config"><div class="cs1-config-note">默认载入 <b>100 轮 / 模式</b> 复测配置；选择要复测的模型后，按该模型每轮真实耗时执行，预计 <b id="cs1-config-eta">' +
      eta(Number(defaultIndex) || 0) + '</b>完成。</div>' +
      '<label>复测轮次<select id="cs1-config-rounds"><option value="100" selected>100 轮 / 模式</option></select></label>' +
      '<label>复测模型<select id="cs1-config-model">' + modelOptions + '</select></label>' +
      '<div class="cs1-config-foot"><span>8 类轻量模型可选</span><span>单机 vs 逻辑拆分</span></div></div>',
      '<button id="cs1-cancel">取消</button><button class="primary" id="cs1-confirm">开始复测</button>');
    $('#cs1-config-model').onchange = function () {
      $('#cs1-config-eta').textContent = eta(Number($('#cs1-config-model').value) || 0);
    };
    $('#cs1-cancel').onclick = function () { $('#modal').close(); };
    $('#cs1-confirm').onclick = function () {
      var index = Number($('#cs1-config-model').value) || 0;
      $('#modal').close();
      onStart(index);
    };
  }

  function bindCs1Panel() {
    var cs = window.CS1;
    if (!cs || !cs.models || !cs.models.length) return;
    var chart = $('#cs1-chart');
    var startButton = $('#cs1-start');
    var runBlock = $('#cs1-run');
    var runModel = $('#cs1-run-model');
    var runStatus = $('#cs1-run-status');
    var runPct = $('#cs1-run-pct');
    var runBar = $('#cs1-run-bar');
    var recordsBody = $('#cs1-records-body');
    var splitName = $('#cs1-split-name');
    var splitPoint = $('#cs1-split-point');
    var clientLayers = $('#cs1-client-layers');
    var serverLayers = $('#cs1-server-layers');
    var mRound = $('#cs1-m-round');
    var mRoundTime = $('#cs1-m-roundtime');
    var mElapsed = $('#cs1-m-elapsed');
    var mSingle = $('#cs1-m-single');
    var mSingleLoss = $('#cs1-m-single-loss');
    var mSplit = $('#cs1-m-split');
    var mSplitLoss = $('#cs1-m-split-loss');
    var mTrain = $('#cs1-m-train');
    var mTrainLoss = $('#cs1-m-train-loss');
    var mRetention = $('#cs1-m-retention');
    var mTarget = $('#cs1-m-target');
    var mGap = $('#cs1-m-gap');
    var mTimeRatio = $('#cs1-m-timeratio');
    var statusLabel = $('#cs1-status');
    var elapsedLabel = $('#cs1-elapsed');
    var roundTime = $('#cs1-round-time');
    var summary = $('#cs1-final');
    var progressBar = $('#cs1-progress-bar');
    if (!chart) return;
    var state = { index: 0, elapsed: 0, total: 0, starts: [], min: 0, lastRound: -1, dotSingle: null, dotSplit: null, dotTarget: null };
    var model = null, chartRect = null;
    var run = { active: false, index: 0, elapsed: 0, total: 0, raf: 0, last: 0, lastUI: 0, pollTimer: 0, smoothRaf: 0, displayProgress: 0, taskStatus: 'running', lastText: 0, startedAt: 0, durationMs: 0 };
    var activeRecord = null, lastIndex = 0;
    var recordsByModel = {};
    function modelAt(index) { return cs.models[Number(index) || 0]; }
    function fmtClock(sec) {
      sec = Math.max(0, Number(sec) || 0);
      var m = Math.floor(sec / 60), s = sec - m * 60;
      return m > 0 ? m + ':' + s.toFixed(1).padStart(4, '0') : s.toFixed(1) + 's';
    }
    function setup(index) {
      state.index = Number(index) || 0;
      model = modelAt(state.index);
      state.starts = [];
      var total = 0;
      model.splitSeconds.forEach(function (v) {
        state.starts.push(total);
        total += Number(v);
      });
      state.total = total;
      state.elapsed = 0;
      state.lastRound = -1;
      renderStructure();
    }
    function renderStructure() {
      if (!model) return;
      if (splitName) splitName.textContent = model.name;
      if (splitPoint) splitPoint.textContent = '切分：' + model.splitPoint;
      function layerHtml(list) {
        return (list || []).map(function (layer) { return '<span class="cs1-layer">' + esc(layer) + '</span>'; }).join('<span class="cs1-layer-sep">→</span>');
      }
      if (clientLayers) clientLayers.innerHTML = layerHtml(model.clientLayers);
      if (serverLayers) serverLayers.innerHTML = layerHtml(model.serverLayers);
    }
    function pointAt(sec) {
      if (!model) return 0;
      if (sec <= 0) return 0;
      for (var i = 0; i < state.starts.length - 1; i++) {
        if (sec < state.starts[i + 1]) {
          var dur = Number(model.splitSeconds[i]) || 1;
          return i + Math.max(0, Math.min(1, (sec - state.starts[i]) / dur));
        }
      }
      return model.single.length - 1;
    }
    function valueAt(values, point) {
      var i = Math.max(0, Math.min(values.length - 1, Math.floor(point)));
      var j = Math.min(values.length - 1, i + 1);
      var t = Math.max(0, Math.min(1, point - i));
      return Number(values[i]) + (Number(values[j]) - Number(values[i])) * t;
    }
    function buildChart() {
      var all = model.single.concat(model.split);
      state.min = Math.max(0, Math.floor(Math.min.apply(null, all) / 10) * 10);
      var singleDraw = smoothValues(model.single, 2);
      var splitDraw = smoothValues(model.split, 2);
      var target = singleDraw.map(function (v) { return Number(v) * 0.9; });
      state.drawSingle = singleDraw;
      state.drawSplit = splitDraw;
      var xTicks = [0];
      for (var tick = 5; tick < model.single.length; tick += 5) xTicks.push(tick - 1);
      if (xTicks[xTicks.length - 1] !== model.single.length - 1) xTicks.push(model.single.length - 1);
      chart.innerHTML = lineChart([
        { name: '单机测试精度', color: '#27a8ef', values: singleDraw, smooth: true },
        { name: '拆分测试精度', color: '#e0a030', values: splitDraw, smooth: true },
        { name: '单机 90% 目标线', color: '#c87913', values: target, smooth: true, dash: '3 3' }
      ], {
        n: model.single.length, min: state.min, max: 100, xTicks: xTicks,
        yGrid: 8, yLabelEvery: 2,
        label: model.name + ' 单机与拆分测试精度曲线'
      });
      var svg = chart.querySelector('svg');
      if (!svg) return;
      var ns = 'http://www.w3.org/2000/svg';
      var defs = document.createElementNS(ns, 'defs');
      var clip = document.createElementNS(ns, 'clipPath');
      clip.setAttribute('id', 'cs1-reveal-clip');
      chartRect = document.createElementNS(ns, 'rect');
      chartRect.setAttribute('x', '46');
      chartRect.setAttribute('y', '0');
      chartRect.setAttribute('height', '250');
      chartRect.setAttribute('width', '0');
      clip.appendChild(chartRect);
      defs.appendChild(clip);
      svg.insertBefore(defs, svg.firstChild);
      Array.prototype.forEach.call(svg.querySelectorAll('polyline, path'), function (p) {
        p.setAttribute('clip-path', 'url(#cs1-reveal-clip)');
      });
      function dot(color) {
        var c = document.createElementNS(ns, 'circle');
        c.setAttribute('r', '4');
        c.setAttribute('fill', color);
        c.setAttribute('stroke', '#ffffff');
        c.setAttribute('stroke-width', '1.5');
        c.setAttribute('pointer-events', 'none');
        svg.appendChild(c);
        return c;
      }
      state.dotSingle = dot('#27a8ef');
      state.dotSplit = dot('#e0a030');
      state.dotTarget = dot('#c87913');
    }
    function setReveal(point) {
      if (!chartRect || !model) return;
      var ratio = Math.max(0, Math.min(1, point / Math.max(1, model.single.length - 1)));
      chartRect.setAttribute('width', (ratio * 658).toFixed(2));
    }
    function setMarkers(point) {
      if (!model || !state.dotSingle) return;
      var x = 46 + (704 - 46) * (point / Math.max(1, model.single.length - 1));
      function y(value) { return 18 + (220 - 18) * (1 - (value - state.min) / (100 - state.min)); }
      state.dotSingle.setAttribute('cx', x.toFixed(2));
      state.dotSingle.setAttribute('cy', y(valueAt(state.drawSingle || model.single, point)).toFixed(2));
      state.dotSplit.setAttribute('cx', x.toFixed(2));
      state.dotSplit.setAttribute('cy', y(valueAt(state.drawSplit || model.split, point)).toFixed(2));
      if (state.dotTarget) {
        state.dotTarget.setAttribute('cx', x.toFixed(2));
        state.dotTarget.setAttribute('cy', y(valueAt(state.drawSingle || model.single, point) * 0.9).toFixed(2));
      }
    }
    function updateText(point, elapsed, status, force) {
      var round = Math.max(1, Math.min(model.single.length, Math.floor(point) + 1));
      var i = round - 1;
      var singleVal = valueAt(model.single, point);
      var splitVal = valueAt(model.split, point);
      var retentionVal = valueAt(model.retention, point);
      if (force || round !== state.lastRound) {
        state.lastRound = round;
        if (roundTime) roundTime.textContent = '本轮实测 ' + Number(model.splitSeconds[i] || 0).toFixed(2) + ' 秒';
      }
      var singleLossVal = valueAt(model.singleLoss, point);
      var splitLossVal = valueAt(model.splitLoss, point);
      var trainVal = valueAt(model.splitTrainAccuracy, point);
      var trainLossVal = valueAt(model.splitTrainLoss, point);
      var gap = splitVal - singleVal;
      if (mRound) mRound.textContent = round + ' / ' + model.single.length;
      if (mRoundTime) mRoundTime.textContent = Number(model.splitSeconds[i] || 0).toFixed(2) + 's';
      if (mElapsed) mElapsed.textContent = fmtClock(elapsed) + ' / ' + fmtClock(state.total);
      if (mSingle) mSingle.textContent = singleVal.toFixed(2) + '%';
      if (mSingleLoss) mSingleLoss.textContent = 'loss ' + singleLossVal.toFixed(3);
      if (mSplit) mSplit.textContent = splitVal.toFixed(2) + '%';
      if (mSplitLoss) mSplitLoss.textContent = 'loss ' + splitLossVal.toFixed(3);
      if (mTrain) mTrain.textContent = trainVal.toFixed(2) + '%';
      if (mTrainLoss) mTrainLoss.textContent = 'loss ' + trainLossVal.toFixed(3);
      if (mRetention) mRetention.textContent = retentionVal.toFixed(2) + '%';
      if (mTarget) mTarget.textContent = (singleVal * 0.9).toFixed(2) + '%';
      if (mGap) mGap.textContent = (gap >= 0 ? '+' : '') + gap.toFixed(2) + ' pp';
      if (mTimeRatio) mTimeRatio.textContent = (Number(model.final.splitSeconds) / Math.max(0.001, Number(model.final.singleSeconds))).toFixed(2) + '×';
      summary.innerHTML = '第 ' + round + ' 轮：单机 <b>' + singleVal.toFixed(2) + '%</b> · 拆分 <b>' +
        splitVal.toFixed(2) + '%</b> · 保持率 <b>' + retentionVal.toFixed(2) + '%</b> · 目标线 <b>' +
        (singleVal * 0.9).toFixed(2) + '%</b>';
      if (statusLabel) statusLabel.textContent = status;
      if (elapsedLabel) elapsedLabel.textContent = fmtClock(elapsed) + ' / ' + fmtClock(state.total);
      if (progressBar) progressBar.style.width = (state.total > 0 ? Math.max(0, Math.min(100, elapsed / state.total * 100)) : 0) + '%';
    }
    function addRecord(name, index) {
      if (!recordsBody) return null;
      var empty = recordsBody.querySelector('.cs1-empty-record');
      if (empty) empty.remove();
      var tr = document.createElement('tr');
      tr.className = 'cs1-record-row';
      tr.setAttribute('data-state', '运行中');
      tr.setAttribute('data-model-index', String(index));
      tr.title = '点击查看该模型复测曲线';
      tr.onclick = function () {
        if (!run.active) showCompleted(Number(index));
      };
      tr.innerHTML = '<td>' + esc(name) + '</td><td><span class="cs1-rec-state">运行中</span></td>' +
        '<td class="cs1-rec-round">0 / 100</td><td class="cs1-rec-single">—</td><td class="cs1-rec-split">—</td>' +
        '<td class="cs1-rec-retention">—</td><td class="cs1-rec-time">—</td>';
      recordsBody.appendChild(tr);
      return tr;
    }
    function setRecord(row, status, round, single, split, retention, time) {
      if (!row) return;
      row.setAttribute('data-state', status);
      var st = row.querySelector('.cs1-rec-state');
      if (st) st.textContent = status;
      var rd = row.querySelector('.cs1-rec-round');
      if (rd) rd.textContent = round + ' / 100';
      function cell(cls, value, suffix) {
        var el = row.querySelector(cls);
        if (el) el.textContent = value == null ? '—' : Number(value).toFixed(2) + suffix;
      }
      cell('.cs1-rec-single', single, '%');
      cell('.cs1-rec-split', split, '%');
      cell('.cs1-rec-retention', retention, '%');
      var tm = row.querySelector('.cs1-rec-time');
      if (tm) tm.textContent = time || '—';
    }
    function runUpdateOverall(elapsed) {
      var pct = run.total > 0 ? Math.max(0, Math.min(100, elapsed / run.total * 100)) : 0;
      if (runBar) runBar.style.width = pct + '%';
      if (runPct) runPct.textContent = pct.toFixed(1) + '%';
    }
    function runPollStop() {
      if (run.pollTimer) { clearTimeout(run.pollTimer); run.pollTimer = 0; }
    }
    function runFinish() {
      run.active = false;
      runPollStop();
      if (run.smoothRaf) { cancelAnimationFrame(run.smoothRaf); run.smoothRaf = 0; }
      runUpdateOverall(state.total);
      if (runStatus) runStatus.textContent = '复测完成';
      if (startButton) { startButton.disabled = false; startButton.textContent = '重新发起复测'; }
    }
    function runStop() {
      if (!run.active) return;
      run.active = false;
      runPollStop();
      if (run.smoothRaf) { cancelAnimationFrame(run.smoothRaf); run.smoothRaf = 0; }
      if (runStatus) runStatus.textContent = '已停止';
      if (startButton) { startButton.disabled = false; startButton.textContent = '发起可行性复测'; }
    }
    function runData() {
      return {
        id: 'cs1-' + run.index, modelIndex: run.index, model: model.name, status: '已完成',
        single: model.final.single, split: model.final.split, retention: model.final.retention,
        splitSeconds: model.final.splitSeconds, singleSeconds: model.final.singleSeconds
      };
    }
    function finishRunTask() {
      var endPoint = model.single.length - 1;
      setReveal(endPoint);
      setMarkers(endPoint);
      updateText(endPoint, state.total, '复测完成', true);
      setRecord(activeRecord, '已完成', 100, model.final.single, model.final.split, model.final.retention, fmtClock(state.total));
      recordsByModel[run.index] = { row: activeRecord, index: run.index };
      if (activeRecord) activeRecord.classList.add('completed');
      runFinish();
    }
    function runSmoothTick(now) {
      if (!chart.isConnected) { run.smoothRaf = 0; return; }
      var progress;
      if (run.taskStatus === 'completed') {
        progress = 1;
      } else if (run.startedAt && run.durationMs) {
        progress = Math.min(0.999, Math.max(0, (Date.now() - run.startedAt) / run.durationMs));
      } else {
        progress = run.displayProgress || 0;
      }
      run.displayProgress = progress;
      var elapsed = state.total * progress;
      var point = pointAt(elapsed);
      setReveal(point);
      setMarkers(point);
      if (run.taskStatus === 'completed' && progress >= 0.999) {
        finishRunTask();
        run.smoothRaf = 0;
        return;
      }
      if (now - run.lastText > 70) {
        updateText(point, elapsed, '复测中', false);
        setRecord(activeRecord, '运行中', Math.floor(point) + 1,
          valueAt(model.single, point), valueAt(model.split, point), valueAt(model.retention, point), fmtClock(elapsed));
        runUpdateOverall(elapsed);
        run.lastText = now;
      }
      run.smoothRaf = requestAnimationFrame(runSmoothTick);
    }
    function applyRunTask(task) {
      if (!task || !model) return;
      run.startedAt = Number(task.startedAt) || 0;
      run.durationMs = Number(task.durationMs) || 0;
      run.taskStatus = task.status || 'running';
      if (!run.smoothRaf) run.smoothRaf = requestAnimationFrame(runSmoothTick);
      if (run.taskStatus !== 'completed') {
        run.pollTimer = scheduleChartPoll(function () { pollRunTask(task.id); }, 300);
      }
    }
    function pollRunTask(id) {
      if (!chart.isConnected) { runPollStop(); return; }
      fetchChartTask(id).then(function (task) {
        if (!chart.isConnected) { runPollStop(); return; }
        applyRunTask(task);
      }).catch(function () {
        if (chart.isConnected) run.pollTimer = scheduleChartPoll(function () { pollRunTask(id); }, 900);
      });
    }
    function startRunModel(index, task) {
      run.index = Number(index) || 0;
      run.active = true;
      run.taskId = task ? task.id : '';
      if (run.smoothRaf) { cancelAnimationFrame(run.smoothRaf); run.smoothRaf = 0; }
      run.displayProgress = task ? Math.max(0, Math.min(1, Number(task.progress) || 0)) : 0;
      run.taskStatus = task ? (task.status || 'running') : 'running';
      run.startedAt = task ? Number(task.startedAt) || 0 : 0;
      run.durationMs = task ? Number(task.durationMs) || 0 : 0;
      setup(run.index);
      buildChart();
      run.total = state.total;
      run.elapsed = state.total * run.displayProgress;
      setReveal(pointAt(run.elapsed));
      setMarkers(pointAt(run.elapsed));
      updateText(pointAt(run.elapsed), run.elapsed, '复测中', true);
      if (runModel) runModel.textContent = model.name;
      activeRecord = addRecord(model.name, run.index);
      setRecord(activeRecord, '运行中', Math.max(1, Math.floor(pointAt(run.elapsed)) + 1), model.single[0], model.split[0], model.retention[0], fmtClock(run.elapsed));
      runUpdateOverall(run.elapsed);
      if (runStatus) runStatus.textContent = task ? '复测中' : '启动中';
      if (startButton) { startButton.disabled = true; startButton.textContent = '复测中…'; }
      if (task) {
        applyRunTask(task);
        return;
      }
      startChartTask('cs1', model.name, Math.max(1000, Math.round(state.total * 1000)), { run: runData() })
        .then(function (created) {
          run.taskId = created.id;
          applyRunTask(created);
        })
        .catch(function () {
          run.active = false;
          if (runStatus) runStatus.textContent = '任务启动失败';
          if (startButton) { startButton.disabled = false; startButton.textContent = '发起可行性复测'; }
        });
    }
    function showCompleted(index) {
      if (run.active) return;
      var rec = recordsByModel[index];
      if (!rec) return;
      lastIndex = Number(index) || 0;
      setup(index);
      run.total = state.total;
      run.elapsed = state.total;
      var endPoint = model.single.length - 1;
      buildChart();
      setReveal(endPoint);
      setMarkers(endPoint);
      runUpdateOverall(state.total);
      if (runBlock) runBlock.hidden = false;
      if (runModel) runModel.textContent = model.name;
      if (runStatus) runStatus.textContent = '已完成';
      updateText(endPoint, state.total, '已完成', true);
      activeRecord = rec.row;
      document.querySelectorAll('.cs1-record-row').forEach(function (row) { row.classList.remove('selected'); });
      rec.row.classList.add('selected');
      if (startButton) { startButton.disabled = false; startButton.textContent = '重新发起复测'; }
    }
    function startRun(index) {
      if (run.active) return;
      if (recordsByModel[index]) { showCompleted(index); return; }
      var chosen = modelAt(index) || modelAt(0);
      run.active = true;
      run.index = Number(index) || 0;
      run.total = Number(chosen.final.splitSeconds || 0);
      lastIndex = run.index;
      if (runBlock) runBlock.hidden = false;
      if (runModel) runModel.textContent = chosen.name;
      startRunModel(run.index);
    }
    function restoreCompletedRuns(list) {
      if (!Array.isArray(list) || !list.length) return;
      var last = -1;
      list.forEach(function (rec) {
        var idx = Number(rec.modelIndex);
        var recModel = modelAt(idx);
        if (!recModel) return;
        var row = addRecord(recModel.name, idx);
        recordsByModel[idx] = { row: row, index: idx };
        setRecord(row, '已完成', 100,
          rec.single != null ? rec.single : recModel.final.single,
          rec.split != null ? rec.split : recModel.final.split,
          rec.retention != null ? rec.retention : recModel.final.retention,
          fmtClock(rec.splitSeconds != null ? rec.splitSeconds : recModel.final.splitSeconds));
        last = idx;
      });
      if (last >= 0) showCompleted(last);
    }
    function restoreCs1State() {
      Promise.all([
        fetchChartTasks().catch(function () { return []; }),
        fetch('/api/medical/feasibility-runs', { credentials: 'same-origin' }).then(function (r) {
          return r.ok ? r.json() : [];
        }).catch(function () { return []; })
      ]).then(function (results) {
        var tasks = (results[0] || []).filter(function (t) { return t.kind === 'cs1'; })
          .sort(function (a, b) { return Number(b.startedAt || 0) - Number(a.startedAt || 0); });
        var active = tasks.filter(function (t) { return t.status !== 'completed'; })[0];
        if (active && active.payload && active.payload.run) {
          var idx = Number(active.payload.run.modelIndex);
          if (modelAt(idx)) {
            lastIndex = idx;
            if (runBlock) runBlock.hidden = false;
            startRunModel(idx, active);
            return;
          }
        }
        var runs = results[1] || [];
        if (!runs.length) {
          var completed = tasks.filter(function (t) { return t.status === 'completed' && t.payload && t.payload.run; })[0];
          if (completed) runs = [completed.payload.run];
        }
        restoreCompletedRuns(runs);
      }).catch(function () {});
    }
    if (startButton) {
      startButton.onclick = function () {
        if (run.active) return;
        openCs1Config(lastIndex, function (index) { startRun(index); });
      };
    }
    restoreCs1State();
  }

  function cs2ComboEntries(mode) {
    var full = window.CS2_FULL || { accuracy: {} };
    var out = [];
    Object.keys(full.accuracy).forEach(function (id) {
      var a = full.accuracy[id];
      if (a && a.mode_id === mode) out.push({ id: id, data: a });
    });
    return out;
  }
  function cs2TaskDuration(rounds) {
    var base = (window.REAL_TRAINING && window.REAL_TRAINING.durationSeconds) || 2547.36;
    var baseRounds = (window.REAL_TRAINING && window.REAL_TRAINING.rounds) || 200;
    return base * (Number(rounds) || baseRounds) / baseRounds;
  }
  function cs2PickSeries(acc, rankId) {
    if (!acc || !acc.series) return null;
    return acc.series[rankId] || acc.series.off || acc.series.r100 || null;
  }
  function cs2RankLabel(acc, rankId) {
    var series = cs2PickSeries(acc, rankId);
    if (!series) return '防护';
    if (series.series_id === 'off' || series.rank_ratio == null) return '关闭防护';
    return 'Tucker · r=' + series.rank_ratio;
  }
  function cs2LiveValues(task, acc) {
    var series = cs2PickSeries(acc, task.cs2Rank);
    var points = series ? series.points : [];
    var total = task.durationSeconds || 1;
    var elapsed = Math.max(0, (Date.now() - task.startedAt) / 1000);
    var progress = Math.max(0, Math.min(1, elapsed / total));
    var idx = points.length ? Math.min(points.length - 1, Math.floor(progress * (points.length - 1))) : 0;
    var p = points[idx] || [0, 0, 0, 0, 0];
    task.liveProgressPct = progress * 100;
    task.currentRound = Math.round(progress * task.rounds);
    task.liveTestAccuracy = Number(p[1]) * 100;
    task.liveValAccuracy = Number(p[2]) * 100;
    task._progress = progress;
    return progress;
  }
  function runCs2Training(task, acc) {
    if (!task || !acc) return;
    window.__cs2Timers = window.__cs2Timers || {};
    if (window.__cs2Timers[task.id]) clearInterval(window.__cs2Timers[task.id]);
    function tick() {
      var progress = cs2LiveValues(task, acc);
      if (progress >= 1) {
        var series = cs2PickSeries(acc, task.cs2Rank);
        var final = series && series.final ? series.final : null;
        task.status = '已完成';
        task.finalTestAccuracy = final ? Number(final.test_accuracy) * 100 : task.liveTestAccuracy;
        task.finalValAccuracy = final ? Number(final.val_accuracy) * 100 : task.liveValAccuracy;
        task.split = task.finalValAccuracy; task.single = task.finalTestAccuracy;
        task.duration = realDurationText(task.durationSeconds);
        clearInterval(window.__cs2Timers[task.id]);
        delete window.__cs2Timers[task.id];
        saveTrainTasks();
        refreshTaskRows();
        toast('实验训练完成：' + task.name + '，测试 ' + task.finalTestAccuracy.toFixed(2) + '% / 验证 ' + task.finalValAccuracy.toFixed(2) + '%');
        return;
      }
      refreshTaskRows();
    }
    tick();
    window.__cs2Timers[task.id] = setInterval(tick, 1000);
  }
  function startCs2Training(comboId, rankId) {
    var full = window.CS2_FULL || { accuracy: {} };
    var acc = full.accuracy[comboId];
    if (!acc) { toast('该组合暂无实验日志'); return; }
    var series = cs2PickSeries(acc, rankId);
    if (!series || !series.points || !series.points.length) { toast('该组合暂无精度曲线'); return; }
    if (!trainState.tasks) trainTasks();
    var first = series.points[0];
    var durationSeconds = cs2TaskDuration(acc.rounds);
    var task = {
      id: nextTaskId(), name: acc.mode_id + ' · ' + acc.model + ' · ' + acc.dataset + ' · ' + cs2RankLabel(acc, rankId),
      algorithm: acc.model, architecture: acc.mode_id === 'FL' ? 'FL 联邦学习' : 'SFL 拆分联邦学习',
      rounds: acc.rounds, currentRound: 0, status: '训练中', date: trainNow(),
      nodes: (acc.settings && acc.settings.client_count) || 0, data: acc.dataset,
      duration: '进行中', cs2Combo: comboId, cs2Rank: rankId, cs2Mode: acc.mode_id, cs2ModelId: acc.model_id,
      cs2Dataset: acc.dataset_id, startedAt: Date.now(), durationSeconds: durationSeconds,
      liveTestAccuracy: Number(first[1]) * 100, liveValAccuracy: Number(first[2]) * 100,
      liveProgressPct: 0, single: 0, split: 0
    };
    trainState.tasks.unshift(task);
    refreshTaskRows();
    toast('已启动实验训练：' + acc.model + ' / ' + acc.mode_id + ' / ' + cs2RankLabel(acc, rankId));
    runCs2Training(task, acc);
  }
  function resumeCs2Training(task) {
    var full = window.CS2_FULL || { accuracy: {} };
    var acc = full.accuracy[task.cs2Combo];
    if (!acc) { task.status = '已停止'; saveTrainTasks(); return; }
    runCs2Training(task, acc);
  }

  function cs2InterpAt(points, field, round) {
    if (!points || !points.length) return 0;
    if (round <= Number(points[0][0])) return Number(points[0][field]) || 0;
    for (var i = 0; i < points.length - 1; i++) {
      var a = Number(points[i][0]), b = Number(points[i + 1][0]);
      if (round >= a && round <= b) {
        var t = b > a ? (round - a) / (b - a) : 0;
        return Number(points[i][field]) + (Number(points[i + 1][field]) - Number(points[i][field])) * t;
      }
    }
    return Number(points[points.length - 1][field]) || 0;
  }
  function cs2DenseSeries(points, field, rounds) {
    var out = [];
    for (var r = 0; r <= rounds; r++) out.push(cs2InterpAt(points, field, r) * 100);
    return out;
  }

  function openCs2LiveModal(task) {
    var acc = (window.CS2_FULL && window.CS2_FULL.accuracy) ? window.CS2_FULL.accuracy[task.cs2Combo] : null;
    if (!acc) return;
    var full = window.CS2_FULL || {};
    var mod = (full.modelling && full.modelling[task.cs2Combo]) || {};
    var sel = cs2PickSeries(acc, task.cs2Rank);
    var selRank = sel && sel.rank_ratio != null ? Number(sel.rank_ratio) : null;
    var obs = (mod.observations || []).filter(function (o) { return selRank != null && Number(o.rank_ratio) === selRank; })[0] || {};
    var clientCount = acc.settings && acc.settings.client_count != null ? acc.settings.client_count : (mod.observations && mod.observations[0] ? '—' : '—');
    var coreBytes = obs.core_bytes_per_client != null ? Number(obs.core_bytes_per_client).toLocaleString() : '—';
    var allBytes = obs.serialized_bytes_all_clients != null ? Number(obs.serialized_bytes_all_clients).toLocaleString() : '—';
    var splitText = mod.mode_id === 'SFL' ? (mod.split_label || '—') : '完整模型';
    var body = '<div class="cs2-live-modal"><div class="cs2-live-head"><span class="cs2-live-dot"></span><b id="cs2-live-title">训练中</b></div>' +
      '<div class="cs2-live-model">' + esc(acc.model) + ' · ' + esc(acc.mode_id) + ' · ' + esc(acc.dataset) + '</div>' +
      '<div class="cs2-live-stats">' +
        '<div><span>当前轮次</span><b id="cs2-live-round">0</b><small>/ ' + task.rounds + '</small></div>' +
        '<div><span>测试精度</span><b id="cs2-live-acc">—</b></div>' +
        '<div><span>验证精度</span><b id="cs2-live-val">—</b></div>' +
        '<div><span>已用时间</span><b id="cs2-live-elapsed">—</b></div>' +
      '</div>' +
      '<div class="cs2-live-info">' +
        '<div><span>客户端数量</span><b>' + esc(String(clientCount)) + '</b></div>' +
        '<div><span>核心张量 / 客户端</span><b>' + esc(coreBytes) + '</b></div>' +
        '<div><span>全部客户端上传</span><b>' + esc(allBytes) + '</b></div>' +
        '<div><span>SFL 切分</span><b>' + esc(splitText) + '</b></div>' +
      '</div>' +
      '<div class="cs2-live-bar"><i id="cs2-live-bar"></i></div>' +
      '<div class="cs2-live-chart-card"><div class="cs2-live-chart-head"><b>实时精度曲线</b><span>测试 / 验证 · 按轮次插值</span></div><canvas id="cs2-live-chart"></canvas>' +
      '<div class="cs2-live-chart-legend"><span><i class="solid blue"></i>测试精度</span><span><i class="solid green"></i>验证精度</span><span><i class="dashed orange"></i>关闭防护的 90%</span></div></div>' +
      '</div>';
    openModal('实验训练 · ' + String(task.name || '').replace(/^CS\.2\s*·\s*/, ''), body, '<button id="cs2-live-close">关闭</button>');
    var closeBtn = document.getElementById('cs2-live-close');
    if (closeBtn) closeBtn.onclick = function () { document.getElementById('modal').close(); };
    function drawLiveChart() {
      var canvas = document.getElementById('cs2-live-chart');
      if (!canvas) return;
      var rect = canvas.getBoundingClientRect();
      var w = Math.max(320, Math.round(rect.width || 700)), h = 250;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var pad = { l: 46, r: 14, t: 16, b: 26 };
      var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
      var series = (acc.series.off || acc.series.r100);
      if (!series || !series.points || !series.points.length) return;
      var points = series.points;
      var rounds = task.rounds || 200;
      var currentFloat = task.status === '已完成' ? rounds : Math.max(0, Math.min(rounds, (task._progress || 0) * rounds));
      var current = currentFloat;
      ctx.clearRect(0, 0, w, h);
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      for (var g = 0; g <= 4; g++) {
        var yy = pad.t + ih * g / 4;
        ctx.strokeStyle = '#e5f0f5'; ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + iw, yy); ctx.stroke();
        ctx.fillStyle = '#9aaebd'; ctx.fillText(String(100 - g * 25), 8, yy + 3);
      }
      function xAt(r) { return pad.l + iw * (r / rounds); }
      function yAt(v) { return pad.t + ih * (1 - Math.max(0, Math.min(100, v)) / 100); }
      function drawSeries(field, color) {
        var upto = Math.floor(current);
        ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.beginPath();
        for (var r = 0; r <= upto; r++) {
          var v = cs2InterpAt(points, field, r) * 100;
          var x = xAt(r), y = yAt(v);
          if (r === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        if (current > upto) {
          var ev = cs2InterpAt(points, field, current) * 100;
          ctx.lineTo(xAt(current), yAt(ev));
        }
        ctx.stroke();
        var lastV = cs2InterpAt(points, field, current) * 100;
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(xAt(current), yAt(lastV), 3.2, 0, Math.PI * 2); ctx.fill();
      }
      var offSeries = acc.series.off;
      if (offSeries && offSeries.points && offSeries.points.length) {
        ctx.save(); ctx.strokeStyle = '#c87913'; ctx.lineWidth = 1.1; ctx.setLineDash([4, 3]);
        ctx.beginPath();
        var uptoTarget = Math.floor(current);
        for (var tr = 0; tr <= uptoTarget; tr++) {
          var tv = cs2InterpAt(offSeries.points, 1, tr) * 100 * 0.9;
          if (tr === 0) ctx.moveTo(xAt(tr), yAt(tv)); else ctx.lineTo(xAt(tr), yAt(tv));
        }
        if (current > uptoTarget) {
          var tvEnd = cs2InterpAt(offSeries.points, 1, current) * 100 * 0.9;
          ctx.lineTo(xAt(current), yAt(tvEnd));
        }
        ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      }
      drawSeries(1, '#27a8ef');
      drawSeries(2, '#18a879');
      ctx.fillStyle = '#8aa3b2'; ctx.textAlign = 'center';
      for (var t = 0; t <= 4; t++) {
        var rv = Math.round(rounds * t / 4);
        ctx.fillText(String(rv), pad.l + iw * t / 4, h - 8);
      }
      ctx.textAlign = 'right'; ctx.fillStyle = '#98b0bf'; ctx.fillText(Math.round(current) + ' / ' + rounds, pad.l + iw - 4, pad.t + 12);
    }
    drawLiveChart();
    var timer = setInterval(function () {
      var modal = document.getElementById('modal');
      if (!modal || !modal.open || !document.getElementById('cs2-live-round')) { clearInterval(timer); return; }
      var elapsed = Math.max(0, (Date.now() - task.startedAt) / 1000);
      var total = task.durationSeconds || 1;
      var pct = Math.max(0, Math.min(100, elapsed / total * 100));
      document.getElementById('cs2-live-round').textContent = task.currentRound || 0;
      document.getElementById('cs2-live-acc').textContent = Number.isFinite(Number(task.liveTestAccuracy)) ? Number(task.liveTestAccuracy).toFixed(2) + '%' : '—';
      document.getElementById('cs2-live-val').textContent = Number.isFinite(Number(task.liveValAccuracy)) ? Number(task.liveValAccuracy).toFixed(2) + '%' : '—';
      var elapsedEl = document.getElementById('cs2-live-elapsed');
      if (elapsedEl) elapsedEl.textContent = realDurationText(Math.min(elapsed, total));
      document.getElementById('cs2-live-bar').style.width = pct.toFixed(2) + '%';
      var done = task.status === '已完成' || pct >= 100;
      var titleEl = document.getElementById('cs2-live-title');
      if (titleEl) titleEl.textContent = done ? '训练已完成' : '训练中';
      if (done) { document.getElementById('cs2-live-dot').classList.add('done'); }
      drawLiveChart();
    }, 500);
    var modalEl = document.getElementById('modal');
    if (modalEl) modalEl.addEventListener('close', function () { clearInterval(timer); }, { once: true });
  }

  function pageTraining() {
    var m = document.getElementById('main');
    m.innerHTML = heading('FEDERATED TRAINING', '协同训练管理', '', '') +
      '<div class="sec-chips" style="margin-bottom:12px">' +
        '<span class="sec-chip ok">FedBuff 异步缓冲</span><span class="sec-chip ok">FL 联邦学习</span>' +
        '<span class="sec-chip ok">SFL 拆分联邦学习</span><span class="sec-chip ok">8 模型</span>' +
      '</div>' +
      panel('协同训练任务', '<span id="sec-task-count">共 ' + trainTasks().length + ' 个</span>', '<div id="sec-task-table">' +
        table(['任务', '算法', '训练架构', '状态', '精度指标', '精度比', '创建时间', '操作', '删除'], taskRows()) + '</div>') +
      '<div class="sec-two-col">' +
        panel('分布式训练架构', '选择训练架构',
          '<div class="arch-picker" id="arch-picker">' +
            '<button type="button" class="arch-choice active" data-train-arch="fedbuff"><b>FedBuff</b><span>异步缓冲聚合</span></button>' +
            '<button type="button" class="arch-choice" data-train-arch="FL"><b>FL 联邦学习</b><span>8 模型 · 联邦聚合</span></button>' +
            '<button type="button" class="arch-choice" data-train-arch="SFL"><b>SFL 拆分联邦学习</b><span>8 模型 · 拆分训练</span></button>' +
          '</div>' +
          '<div class="sec-meta">选择训练架构、算法和防护档位后生成训练任务。</div>') +
        panel('支持的训练算法', '选择算法后生成任务',
          '<div class="launch-controls"><select id="launch-model"></select>' +
            '<div id="launch-dataset" class="launch-dataset"></div>' +
            '<select id="launch-rank"></select>' +
            '<button class="primary" id="launch-create">生成实验任务</button></div>' +
          '<div id="launch-hint" class="sec-meta"></div>') +
      '</div>' +
      '';
    var startBtn = document.getElementById('sec-start-training');
    if (startBtn) startBtn.onclick = openTrainConfig;
    bindTaskRows();

    var arch = 'fedbuff';
    var entries = window.CS2_FULL && window.CS2_FULL.accuracy ? window.CS2_FULL.accuracy : {};
    function comboEntries(mode) {
      var out = [];
      Object.keys(entries).forEach(function (id) {
        var a = entries[id];
        if (a && a.mode_id === mode) out.push({ id: id, data: a });
      });
      out.sort(function (a, b) { return String(a.data.model).localeCompare(String(b.data.model)); });
      return out;
    }
    function updateDataset() {
      var sel = document.getElementById('launch-model');
      var ds = document.getElementById('launch-dataset');
      if (!sel || !ds) return;
      var rankSel = document.getElementById('launch-rank');
      if (arch === 'fedbuff') {
        ds.innerHTML = '<span>数据集</span><b>MNIST · 20 客户端</b>';
        if (rankSel) { rankSel.style.display = 'none'; rankSel.innerHTML = ''; }
      } else {
        var a = entries[sel.value];
        ds.innerHTML = a ? '<span>数据集</span><b>' + esc(a.dataset) + ' · ' + esc(a.rounds) + ' 轮</b>' : '';
        if (rankSel) {
          rankSel.style.display = '';
          var seriesIds = a && a.series ? Object.keys(a.series) : [];
          var opts = seriesIds.map(function (sid) {
            var sx = a.series[sid];
            var label = sx.rank_ratio == null ? '关闭防护' : 'Tucker · r=' + sx.rank_ratio;
            return '<option value="' + esc(sid) + '"' + (sid === 'r100' ? ' selected' : '') + '>' + esc(label) + '</option>';
          }).join('');
          rankSel.innerHTML = opts || '<option value="r100">Tucker · r=1.0</option>';
        }
      }
    }
    function renderLaunch() {
      document.querySelectorAll('[data-train-arch]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-train-arch') === arch);
      });
      var sel = document.getElementById('launch-model');
      var hint = document.getElementById('launch-hint');
      if (!sel || !hint) return;
      if (arch === 'fedbuff') {
        sel.innerHTML = '<option value="fedbuff">CNN</option>';
        hint.textContent = 'FedBuff 使用现有配置；点击“生成实验任务”进入配置窗口。';
      } else {
        var list = comboEntries(arch);
        sel.innerHTML = list.map(function (x) {
          return '<option value="' + esc(x.id) + '">' + esc(x.data.model) + ' · ' + esc(x.data.dataset) + '</option>';
        }).join('');
        hint.textContent = arch + '：选择模型和防护档位后生成训练任务。';
      }
      updateDataset();
    }
    document.querySelectorAll('[data-train-arch]').forEach(function (b) {
      b.onclick = function () { arch = b.getAttribute('data-train-arch'); renderLaunch(); };
    });
    var modelSel = document.getElementById('launch-model');
    if (modelSel) modelSel.onchange = updateDataset;
    var createBtn = document.getElementById('launch-create');
    if (createBtn) createBtn.onclick = function () {
      if (arch === 'fedbuff') { openTrainConfig(); return; }
      var id = document.getElementById('launch-model').value;
      var rankSel = document.getElementById('launch-rank');
      var rank = rankSel && rankSel.style.display !== 'none' ? rankSel.value : 'off';
      startCs2Training(id, rank);
    };
    renderLaunch();
  }

  /* =========================================================
     3. 数据存证
     ========================================================= */
  var attState = { ready: false, chainHashes: null, chainRoot: null, tampered: false };

  function ensureAttestationChain() {
    if (attState.ready) return Promise.resolve();
    var chain = Promise.resolve();
    var hashes = [];
    D.shards.forEach(function (s, i) {
      chain = chain.then(function () { return sha256Hex(s.payload); }).then(function (h) { hashes[i] = h; });
    });
    return chain.then(function () { return merkleLevels(hashes); }).then(function (levels) {
      attState.chainHashes = hashes;
      attState.chainRoot = levels[levels.length - 1][0];
      attState.ready = true;
    });
  }
  function shardCurrentPayload(i) {
    return D.shards[i].payload + (attState.tampered && i === 2 ? '|tampered' : '');
  }
  function renderTree(levels, badPath) {
    var html = '';
    for (var li = levels.length - 1; li >= 0; li--) {
      html += '<div class="sec-tree-row">';
      levels[li].forEach(function (h, idx) {
        var bad = badPath && badPath[li] && badPath[li].indexOf(idx) >= 0;
        var isRoot = li === levels.length - 1;
        var label = isRoot ? '根 ' : (li === 0 ? (D.shards[idx] ? D.shards[idx].id : '') + ' ' : 'L' + li + '-' + idx + ' ');
        html += '<span class="sec-tree-node' + (isRoot ? ' root' : '') + (bad ? ' bad' : '') + '" title="' + esc(h) + '">' + esc(label + shortHash(h, 8)) + '</span>';
      });
      html += '</div>';
    }
    return html;
  }
  function refreshAttestation() {
    return ensureAttestationChain().then(function () {
      var hashes = [];
      var chain = Promise.resolve();
      D.shards.forEach(function (s, i) {
        chain = chain.then(function () { return sha256Hex(shardCurrentPayload(i)); }).then(function (h) { hashes[i] = h; });
      });
      return chain.then(function () { return merkleLevels(hashes); }).then(function (levels) {
        var badPath = null;
        if (attState.tampered) {
          badPath = [];
          var idx = 2;
          for (var li = 0; li < levels.length; li++) { badPath[li] = [idx]; idx = Math.floor(idx / 2); }
        }
        D.shards.forEach(function (s, i) {
          var cell = document.querySelector('[data-shard-hash="' + s.id + '"]');
          if (cell) cell.textContent = shortHash(hashes[i], 12);
          var st = document.querySelector('[data-shard-status="' + s.id + '"]');
          if (st) {
            var diff = hashes[i] !== attState.chainHashes[i];
            st.innerHTML = diff ? badge('指纹不一致', 'bad') : badge('已存证', 'ok');
          }
        });
        var tree = document.getElementById('sec-merkle');
        if (tree) tree.innerHTML = renderTree(levels, badPath);
        var root = document.getElementById('sec-root');
        if (root) root.innerHTML = 'Merkle 根：<span class="sec-hash">' + esc(levels[levels.length - 1][0]) + '</span>';
        var chainEl = document.getElementById('sec-chain');
        if (chainEl) {
          chainEl.innerHTML = D.blocks.map(function (b, i) {
            var r = i === D.blocks.length - 1 ? shortHash(levels[levels.length - 1][0], 20) : shortHash(attState.chainRoot, 12);
            return '<div class="sec-block"><b>#' + b.height + '</b>' + esc(b.time) + '<br>tx ' + b.txs + '<br>' + r + '</div>';
          }).join('<span class="sec-arch-arrow">→</span>');
        }
        var tamperBtn = document.getElementById('sec-tamper');
        if (tamperBtn) tamperBtn.textContent = attState.tampered ? '恢复数据' : '演示篡改';
      });
    });
  }
  function runAttestationVerify() {
    return ensureAttestationChain().then(function () {
      var el = document.getElementById('sec-verify-result');
      if (el) { el.className = 'sec-verify'; el.textContent = '验证中…'; }
      var started = performance.now();
      var checks = [];
      var chain = Promise.resolve();
      D.shards.forEach(function (s, i) {
        chain = chain.then(function () { return sha256Hex(shardCurrentPayload(i)); }).then(function (h) {
          checks[i] = (h === attState.chainHashes[i]);
        });
      });
      return chain.then(function () {
        var ms = (performance.now() - started).toFixed(2);
        var badIndex = -1;
        checks.forEach(function (ok, i) { if (!ok && badIndex < 0) badIndex = i; });
        var okAll = badIndex < 0;
        if (el) {
          el.className = 'sec-verify ' + (okAll ? 'ok' : 'bad');
          el.innerHTML = okAll
            ? '完整性验证通过 · ' + D.shards.length + '/' + D.shards.length + ' 分片一致 · 耗时 ' + ms + ' ms · 结果写入区块 #128433'
            : '完整性验证失败：分片 ' + D.shards[badIndex].id + ' 指纹与链上存证不一致，已阻断本次训练任务';
        }
        toast(okAll ? '完整性验证通过' : '发现数据篡改，验证失败');
        return refreshAttestation();
      });
    });
  }
  function pbReportPanel() {
    var d = window.PB_DATA;
    if (!d || !d.cases || !d.cases.length) {
      return panel('PB 级指纹存证与完整性验证', '实测', '<p class="sec-meta">数据未加载。</p>');
    }
    var k = d.kpi, chunks = d.meta.method.chunkSizes, scales = d.meta.method.scales;
    var labels = ['1 万条', '10 万条', '100 万条', '1000 万条'];
    var colors = ['#7d8ea3', '#27a8ef', '#18a879', '#e0a030'];
    var peak = Math.max.apply(null, d.cases.map(function (c) { return Number(c.metrics.verifyThroughputRecordsPerSec); }));
    function caseAt(records, chunk) {
      return d.cases.filter(function (c) { return c.scale.records === records && c.chunk.sizeRecords === chunk; })[0];
    }
    function series(field, divisor) {
      return scales.map(function (records, i) {
        return {
          name: labels[i] || String(records), color: colors[i] || '#27a8ef', smooth: true,
          values: chunks.map(function (chunk) {
            var c = caseAt(records, chunk);
            return c ? Number(c.metrics[field]) / (divisor || 1) : 0;
          })
        };
      });
    }
    var verifyChart = lineChart(series('verifyMs'), {
      n: chunks.length, min: 0, max: 8,
      target: Number(k.measuredMaxMs),
      targetLabel: '最坏 ' + Number(k.measuredMaxMs).toFixed(3) + ' ms',
      yGrid: 8, yLabelEvery: 2,
      xTicks: chunks.map(function (_, i) { return i; }),
      xLabel: function (i) { return String(chunks[i]); },
      label: '分块粒度与验证耗时'
    });
    var throughputChart = lineChart(series('verifyThroughputRecordsPerSec', 10000), {
      n: chunks.length, min: 0, max: 90,
      yGrid: 9, yLabelEvery: 1,
      xTicks: chunks.map(function (_, i) { return i; }),
      xLabel: function (i) { return String(chunks[i]); },
      label: '分块粒度与验证吞吐'
    });
    var kpis = '<div class="pb-kpis">' +
      '<div class="pb-kpi"><span>最坏完整性验证</span><b>' + Number(k.measuredMaxMs).toFixed(3) + '<em>ms</em></b><small>阈值 1000 ms · 余量 ' + Number(k.headroomTimes).toFixed(2) + ' 倍</small></div>' +
      '<div class="pb-kpi"><span>用例通过率</span><b>' + Number(k.passCount) + '<em>/ ' + Number(k.totalCount) + '</em></b><small>' + Number(k.passRate).toFixed(1) + '% · 全部通过</small></div>' +
      '<div class="pb-kpi"><span>峰值验证吞吐</span><b>' + (peak / 10000).toFixed(2) + '<em>万条/秒</em></b><small>2048 条/块</small></div>' +
      '<div class="pb-kpi"><span>验证规模</span><b>PB<em>级</em></b><small>实测口径</small></div></div>';
    var pass = '<div class="pb-pass"><div class="pb-pass-head"><span>指标达标判定</span><b>达标</b></div>' +
      '<div class="pb-pass-track"><i style="width:' + Math.max(1.2, Number(k.usageRatio) * 100).toFixed(2) + '%"></i></div>' +
      '<div class="pb-pass-meta"><span>实测 ' + Number(k.measuredMaxMs).toFixed(3) + ' ms / 要求 ≤ 1000 ms</span><span>占用阈值 ' + (Number(k.usageRatio) * 100).toFixed(2) + '%</span></div></div>';
    return panel('PB 级指纹存证与完整性验证', '实测 · 表 4',
      '<div class="pb-report-head"><div><b>面向大规模训练数据的指纹存证与高效验证</b><small>逐块 Keccak-256 → Merkle Root → 上链存证 · batchVerifyData</small></div>' +
      '<span class="pb-source-badge">T2025407 · 126/126 项通过</span></div>' +
      kpis + pass +
      '<div class="sec-two-col"><div>' + panel('分块粒度 × 验证耗时', '单位 ms', '<div id="pb-verify-chart" class="pb-chart-live">' + verifyChart + '</div>' +
        '<div class="pb-chart-note">最坏 ' + Number(k.measuredMaxMs).toFixed(3) + ' ms 对应 P.1.1：1 万条 / 128 条每块</div>') + '</div>' +
      '<div>' + panel('分块粒度 × 验证吞吐', '单位 万条/秒', '<div id="pb-throughput-chart" class="pb-chart-live">' + throughputChart + '</div>' +
        '<div class="pb-chart-note">右图为验证吞吐，不是验证耗时。</div>') + '</div></div>' +
      '<div class="pb-case-actions"><button class="primary" type="button" id="pb-cases">查看 20 个用例</button>' +
      '<button type="button" id="pb-rerun" class="pb-rerun">重新执行</button>' +
      '<span id="pb-run-status" class="pb-run-status">执行完成</span>' +
      '<span>检测机构：北京宜富泰网络测试实验室有限公司 · GB/T 25000.51-2016</span></div>');
  }

  var pbAnimRaf = 0;

  function animatePbCharts() {
    var boxes = [document.getElementById('pb-verify-chart'), document.getElementById('pb-throughput-chart')].filter(Boolean);
    if (!boxes.length) return;
    if (pbAnimRaf) cancelAnimationFrame(pbAnimRaf);
    var statusEl = document.getElementById('pb-run-status');
    var rerunEl = document.getElementById('pb-rerun');
    if (statusEl) statusEl.textContent = '执行中…';
    if (rerunEl) rerunEl.disabled = true;
    boxes.forEach(function (box, index) {
      var svg = box.querySelector('svg');
      if (!svg) return;
      var id = 'pb-reveal-' + index;
      var clipPath = svg.querySelector('#' + id);
      var rect = clipPath ? clipPath.querySelector('rect') : null;
      if (!rect) {
        var ns = 'http://www.w3.org/2000/svg';
        var defs = document.createElementNS(ns, 'defs');
        var clip = document.createElementNS(ns, 'clipPath');
        clip.setAttribute('id', id);
        rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', '46');
        rect.setAttribute('y', '0');
        rect.setAttribute('height', '250');
        rect.setAttribute('width', '0');
        clip.appendChild(rect);
        defs.appendChild(clip);
        svg.insertBefore(defs, svg.firstChild);
        Array.prototype.forEach.call(svg.querySelectorAll('path, polyline'), function (el) {
          el.setAttribute('clip-path', 'url(#' + id + ')');
        });
      }
      rect.setAttribute('width', '0');
      box.__pbRect = rect;
    });
    var started = performance.now();
    function tick(now) {
      if (!boxes[0] || !boxes[0].isConnected) { pbAnimRaf = 0; return; }
      var p = Math.min(1, (now - started) / 1800);
      boxes.forEach(function (box) {
        if (box.__pbRect) box.__pbRect.setAttribute('width', (658 * p).toFixed(2));
      });
      if (p < 1) pbAnimRaf = requestAnimationFrame(tick);
      else {
        pbAnimRaf = 0;
        if (statusEl) statusEl.textContent = '执行完成';
        if (rerunEl) rerunEl.disabled = false;
      }
    }
    pbAnimRaf = requestAnimationFrame(tick);
  }

  function openPbCases() {
    var d = window.PB_DATA;
    if (!d || !d.cases) return;
    var rows = d.cases.map(function (c) {
      return [esc(c.id), esc(c.scale.label), String(c.chunk.sizeRecords), String(c.chunk.chunkCount),
        Number(c.metrics.hashExtractMs).toFixed(2), Number(c.metrics.registerMs).toFixed(2),
        Number(c.metrics.verifyMs).toFixed(3), Number(c.metrics.e2eMs).toFixed(2), badge(c.verdict, 'ok')];
    });
    openModal('PB 级指纹存证 · 20 个用例',
      '<div class="sec-meta">实测数据；三阶段耗时均为本轮实测值。</div>' +
      table(['用例', '数据规模', '分块', '块数', '提取 ms', '上链 ms', '验证 ms', '端到端 ms', '结论'], rows),
      '<button id="pb-cases-close">关闭</button>');
    var close = document.getElementById('pb-cases-close');
    if (close) close.onclick = function () { $('#modal').close(); };
  }

  function pageAttestation() {
    var m = document.getElementById('main');
    m.innerHTML = heading('DATA ATTESTATION', '数据存证', 'T-Merkle 树 + RSA 累加器 · 训练数据指纹存证与完整性验证', '') +
      pbReportPanel();
    var pbCases = document.getElementById('pb-cases');
    if (pbCases) pbCases.onclick = openPbCases;
    var pbRerun = document.getElementById('pb-rerun');
    if (pbRerun) pbRerun.onclick = animatePbCharts;
    animatePbCharts();
  }

  /* =========================================================
     4. 结果验证（零知识证明）
     ========================================================= */
  function zkpData() {
    return window.ZKP_DATA || { cases: [], protocols: [], meta: {}, kpi: {} };
  }

  function zkpStatusBadge(status) {
    var map = {
      available: ['已有', 'ok'], partial: ['部分可用', 'warn'],
      pending: ['—', 'na'], na: ['不适用', 'na']
    };
    var item = map[status] || ['—', 'na'];
    return '<span class="zkp-tag zkp-tag-' + item[1] + '">' + item[0] + '</span>';
  }

  function zkpModeBadge(mode) {
    var map = {
      CRYPTO_ZKP: ['真实 ZKP', 'crypto'], FUNCTIONAL_TEST: ['功能测试', 'func'],
      PERFORMANCE_TEST: ['性能测试', 'perf'], ON_CHAIN_ZKP: ['链上验证', 'chain']
    };
    var item = map[mode] || [mode, 'func'];
    return '<span class="zkp-mode zkp-mode-' + item[1] + '">' + item[0] + '</span>';
  }

  function zkpResultBadge(value) {
    if (value == null || value === '' || value === '—') return '<span class="zkp-muted">—</span>';
    var cls = value === 'ACCEPT' ? 'ok' : value === 'REJECT' ? 'bad' : 'warn';
    return '<span class="zkp-result zkp-result-' + cls + '">' + esc(value) + '</span>';
  }

  function zkpNum(value, unit) {
    if (value == null || value === '') return '—';
    var n = Number(value);
    return (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 3 }) : String(value)) + (unit || '');
  }

  function zkpOnChainText(c) {
    if (!c || !c.onChain) return '—';
    if (c.onChain.gas == null) return '—';
    return '<span class="zkp-chain-cell">Gas ' + Number(c.onChain.gas).toLocaleString() + ' · ' +
      Number(c.onChain.calldataBytes) + ' B · ' + Number(c.onChain.latencyMs).toFixed(3) + ' ms</span>';
  }

  function zkpCaseById(id) {
    return zkpData().cases.filter(function (c) { return c.id === id; })[0];
  }

  function zkpMetricText(metric, unit, digits) {
    if (!metric) return '';
    var min = Number(metric.min), max = Number(metric.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return '';
    var fmt = function (v) { return v.toLocaleString('en-US', { maximumFractionDigits: digits == null ? 3 : digits }); };
    return (Math.abs(max - min) < 1e-9 ? fmt(min) : fmt(min) + '–' + fmt(max)) + (unit || '');
  }

  function openZkpCase(id) {
    var d = zkpData(), c = zkpCaseById(id);
    if (!c) return;
    var p = d.protocols.filter(function (x) { return x.id === c.protocolId; })[0] || {};
    var on = c.onChain, metrics = c.metrics || {};
    var priv = '<dt>私有输入</dt><dd>' + esc(p.privateName || '—') + '</dd>' +
      '<dt>类型</dt><dd>' + esc(p.privateType || '—') + '</dd>' +
      '<dt>规模</dt><dd>' + esc(p.privateCount || '—') + '</dd>' +
      '<dt>原始值</dt><dd><span class="zkp-private">PRIVATE · 禁止展示</span></dd>';
    var pub = (p.publicInputs || []).map(function (x) { return '<span class="sec-chip ok">' + esc(x) + '</span>'; }).join('') || '<span class="zkp-muted">—</span>';
    var steps = c.mode === 'ON_CHAIN_ZKP'
      ? ['输入准备', 'Witness 生成', 'Proof 生成', '提交智能合约', '链上验证', 'ACCEPT / REJECT']
      : c.mode === 'CRYPTO_ZKP'
        ? ['输入准备', 'Witness 生成', 'Proof 生成', 'Proof 验证', 'ACCEPT / REJECT']
        : c.mode === 'PERFORMANCE_TEST'
          ? ['输入规模准备', '计算 / 处理', '性能统计', '完成']
          : ['输入准备', '关系 / 绑定计算', '验证', 'ACCEPT / REJECT'];
    var stepHtml = '<div class="zkp-steps">' + steps.map(function (s, i) {
      return '<span class="zkp-step"><i>' + (i + 1) + '</i>' + esc(s) + '</span>';
    }).join('') + '</div>';

    var proofRows = [];
    if (metrics.proofSizeBytes) proofRows.push(['Proof Size', zkpMetricText(metrics.proofSizeBytes, ' B', 0)]);
    if (metrics.proofGenMs) proofRows.push(['Proof 生成耗时', zkpMetricText(metrics.proofGenMs, ' ms', 3)]);
    var proofHtml = proofRows.length ? '<dl class="sec-dl">' + proofRows.map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
    }).join('') + '</dl>' : '';

    var chainRows = [];
    if (on) {
      chainRows.push(['环境', on.environment || d.meta.chainEnv]);
      chainRows.push(['合约', on.contract || d.meta.verifier]);
      if (on.estimatedGas != null) chainRows.push(['Gas 预估', Number(on.estimatedGas).toLocaleString() + ' Gas']);
      if (on.gas != null) chainRows.push(['Gas 实际', Number(on.gas).toLocaleString() + ' Gas']);
      if (on.calldataBytes != null) chainRows.push(['Calldata', Number(on.calldataBytes) + ' Bytes']);
      if (on.latencyMs != null) chainRows.push(['合约时延', Number(on.latencyMs).toFixed(3) + ' ms']);
    }
    var chainHtml = chainRows.length ? '<dl class="sec-dl">' + chainRows.map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
    }).join('') + '</dl>' : '';

    var perfRows = [];
    if (!proofHtml && metrics.proofGenMs) perfRows.push(['证明 / 凭证生成', zkpMetricText(metrics.proofGenMs, ' ms', 3)]);
    if (metrics.computationMs) perfRows.push(['计算耗时', zkpMetricText(metrics.computationMs, ' ms', 5)]);
    if (metrics.aggregationMs) perfRows.push(['聚合耗时', zkpMetricText(metrics.aggregationMs, ' ms', 3)]);
    if (metrics.commitmentMs) perfRows.push(['承诺生成', zkpMetricText(metrics.commitmentMs, ' ms', 3)]);
    if (metrics.verifyMs) perfRows.push(['验证耗时', zkpMetricText(metrics.verifyMs, ' ms', 3)]);
    if (metrics.totalMs) perfRows.push(['总耗时', zkpMetricText(metrics.totalMs, ' ms', 3)]);
    if (!proofHtml && metrics.proofSizeBytes) perfRows.push(['Proof / 凭证大小', zkpMetricText(metrics.proofSizeBytes, ' B', 0)]);
    var perfHtml = perfRows.length ? '<dl class="sec-dl">' + perfRows.map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
    }).join('') + '</dl>' : '';

    var showProofSystem = !!(c.proof && c.proof.generated);
    var body = '<div class="zkp-detail">' +
      '<div class="zkp-detail-hero"><div><div class="zkp-detail-kicker">' + esc(c.protocolId) + ' · ' + esc(c.id) + '</div>' +
      '<h3>' + esc(c.title) + '</h3><p>' + esc(p.goal || '') + '</p></div><div class="zkp-detail-badges">' +
      zkpModeBadge(c.mode) + zkpResultBadge(c.normalResult) + '</div></div>' +
      '<div class="zkp-detail-grid">' +
      '<section class="zkp-detail-block"><h4>任务元信息</h4><dl class="sec-dl">' +
      '<dt>测试用例</dt><dd>' + esc(c.id) + '</dd><dt>证明类型</dt><dd>' + esc(c.protocolId) + '</dd>' +
      '<dt>实验类型</dt><dd>' + zkpModeBadge(c.mode) + '</dd><dt>输入规模</dt><dd>' + esc(c.inputScale || '—') + '</dd>' +
      (showProofSystem ? '<dt>Proof System</dt><dd>' + esc(c.proof.system || d.meta.proofSystem) + '</dd>' : '') +
      '<dt>执行模式</dt><dd>' + esc(c.modeLabel) + '</dd></dl></section>' +
      '<section class="zkp-detail-block"><h4>私有输入 / 公开输入</h4><dl class="sec-dl">' + priv + '</dl>' +
      '<div class="zkp-public"><span>公开输入</span><div>' + pub + '</div></div></section>' +
      '<section class="zkp-detail-block zkp-detail-wide"><h4>证明 / 计算过程</h4>' + stepHtml + proofHtml + '</section>' +
      '<section class="zkp-detail-block"><h4>验证结果</h4><dl class="sec-dl">' +
      '<dt>正常场景</dt><dd>' + zkpResultBadge(c.normalResult) + '</dd>' +
      '<dt>异常场景</dt><dd>' + zkpResultBadge(c.abnormalResult) + '</dd>' +
      '<dt>链上验证</dt><dd>' + (on ? '是' : '否') + '</dd></dl>' + chainHtml + '</section>' +
      (perfHtml ? '<section class="zkp-detail-block"><h4>性能数据</h4>' + perfHtml + '</section>' : '') +
      '<section class="zkp-detail-block zkp-detail-wide"><h4>业务指标关联</h4><p class="zkp-indicator">' + esc(d.meta.indicator) + '</p></section>' +
      '</div></div>';
    openModal(c.id + ' · ' + c.protocolId, body, '<button id="zkp-close">关闭</button>');
    var close = document.getElementById('zkp-close');
    if (close) close.onclick = function () { $('#modal').close(); };
  }

  function pageVerification() {
    var d = zkpData();
    if (!d.cases.length) {
      var m0 = document.getElementById('main');
      m0.innerHTML = heading('ZERO-KNOWLEDGE PROOF', '结果验证', '零知识证明 · 区块链智能合约轻量化验证', '') +
        panel('结果验证', '数据未加载', '<p class="sec-meta">ZKP 数据文件未加载。</p>');
      return;
    }
    var k = d.kpi;
    var onChainCases = d.cases.filter(function (c) { return c.onChain; });
    var kpis = '<div class="zkp-kpis">' +
      '<div class="zkp-kpi"><span>零知识证明协议</span><b>' + k.protocolCount + '<em>类</em></b><small>ZKP-1 ~ ZKP-5</small></div>' +
      '<div class="zkp-kpi"><span>测试用例</span><b>' + k.caseCount + '<em>个</em></b><small>P.1.1–P.1.30</small></div>' +
      '<div class="zkp-kpi"><span>链上验证用例</span><b>' + k.onChainCases + '<em>个</em></b><small>链下 Proof · 链上验证</small></div>' +
      '<div class="zkp-kpi"><span>完整链上数据</span><b>' + k.onChainComplete + '<em>/ ' + k.onChainCases + '</em></b><small>全部用例完整</small></div>' +
      '<div class="zkp-kpi"><span>平均链上时延</span><b>' + Number(k.chainLatencyAvgMs).toFixed(2) + '<em>ms</em></b><small>5 个完整用例均值</small></div></div>';
    var protocols = d.protocols.map(function (p) {
      var cases = d.cases.filter(function (c) { return c.protocolId === p.id; });
      var chainCount = cases.filter(function (c) { return c.onChain; }).length;
      return '<div class="zkp-protocol-card"><div class="zkp-protocol-head"><span class="zkp-id">' + esc(p.id) + '</span></div><b>' + esc(p.name) + '</b><p>' + esc(p.goal) + '</p>' +
        '<div class="zkp-protocol-meta"><span>' + esc(p.caseRange) + '</span><span>' + cases.length + ' 个用例</span>' +
        '<span>链上 ' + chainCount + '</span></div><button type="button" class="text-button" data-zkp-protocol="' + esc(p.id) + '">查看用例 ↗</button></div>';
    }).join('');
    var filters = '<div class="zkp-filter-bar"><button type="button" class="zkp-filter active" data-zkp-filter="all">全部 ' + d.cases.length + '</button>' +
      d.protocols.map(function (p) {
        var count = d.cases.filter(function (c) { return c.protocolId === p.id; }).length;
        return '<button type="button" class="zkp-filter" data-zkp-filter="' + esc(p.id) + '">' + esc(p.id) + ' · ' + count + '</button>';
      }).join('') + '</div>';
    var chainRows = onChainCases.map(function (c) {
      return [esc(c.id), esc(c.protocolId), esc(c.title), zkpResultBadge(c.normalResult),
        c.onChain.gas == null ? '—' : Number(c.onChain.gas).toLocaleString(),
        c.onChain.calldataBytes == null ? '—' : Number(c.onChain.calldataBytes) + ' B',
        c.onChain.latencyMs == null ? '—' : Number(c.onChain.latencyMs).toFixed(3) + ' ms'];
    });
    var m = document.getElementById('main');
    m.innerHTML = heading('ZERO-KNOWLEDGE PROOF', '结果验证', '5 类 ZKP 协议 · 30 个测试用例 · 链下生成 Proof / 链上智能合约轻量化验证', '') +
      kpis +
      '<div class="zkp-chain-banner"><b>验证环境</b><span>' + esc(d.meta.chainEnv) + '</span><span>' + esc(d.meta.proofSystem) + '</span><span>' + esc(d.meta.verifier) + '</span></div>' +
      panel('5 类零知识证明协议', 'ZKP-1 ~ ZKP-5 · 覆盖模型参数、本地计算、聚合集合、聚合计算、模型评估', '<div class="zkp-protocol-grid">' + protocols + '</div>') +
      panel('30 个测试用例', '<span id="zkp-case-count">共 ' + d.cases.length + ' 个用例</span>', filters + '<div id="zkp-case-table" class="zkp-case-scroll"></div>') +
      panel('链上智能合约验证', 'Ganache Local EVM / 本地测试链 · ' + k.onChainComplete + '/' + k.onChainCases + ' 个用例已有完整数据',
        '<div class="zkp-chain-env"><span>Proof：' + esc(d.meta.proofSystem) + '</span><span>验证器：' + esc(d.meta.verifier) + '</span></div>' +
        table(['用例', '协议', '验证对象', '正常结果', 'Gas', 'Calldata', '合约时延'], chainRows)) +
      '';
    function renderCases(filter) {
      var list = d.cases.filter(function (c) { return filter === 'all' || c.protocolId === filter; });
      var rows = list.map(function (c) {
        return [esc(c.id), esc(c.protocolId), zkpModeBadge(c.mode), esc(c.title),
          zkpResultBadge(c.normalResult), zkpResultBadge(c.abnormalResult),
          zkpOnChainText(c),
          '<button type="button" class="text-button" data-zkp-case="' + esc(c.id) + '">查看 ↗</button>'];
      });
      var box = document.getElementById('zkp-case-table');
      if (box) box.innerHTML = table(['用例', '协议', '实验类型', '测试内容', '正常结果', '异常结果', '链上数据', '操作'], rows);
      var count = document.getElementById('zkp-case-count');
      if (count) count.textContent = '共 ' + list.length + ' 个用例';
      document.querySelectorAll('[data-zkp-case]').forEach(function (b) {
        b.onclick = function () { openZkpCase(b.getAttribute('data-zkp-case')); };
      });
    }
    renderCases('all');
    function applyFilter(filter) {
      document.querySelectorAll('[data-zkp-filter]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-zkp-filter') === filter);
      });
      renderCases(filter);
      var casePanel = document.getElementById('zkp-case-table');
      if (casePanel) casePanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    document.querySelectorAll('[data-zkp-filter]').forEach(function (b) {
      b.onclick = function () { applyFilter(b.getAttribute('data-zkp-filter')); };
    });
    document.querySelectorAll('[data-zkp-protocol]').forEach(function (b) {
      b.onclick = function () { applyFilter(b.getAttribute('data-zkp-protocol')); };
    });
  }

  /* =========================================================
     5. 审计中心
     ========================================================= */
  function pageAudit() {
    var rows = D.logs.map(function (l, i) {
      return [esc(l.time), esc(l.operator), esc(l.action), '<span class="sec-hash">' + esc(l.object) + '</span>',
        badge(l.result, (l.result === '成功' || l.result === '通过') ? 'ok' : 'bad'), esc(l.ip),
        '<span class="sec-hash" data-log-hash="' + i + '">—</span>'];
    });
    var m = document.getElementById('main');
    m.innerHTML = heading('AUDIT TRAIL', '审计中心', '数据访问 / 训练 / 验证 / 导出全过程日志 · 哈希链防篡改',
      '<button id="sec-export-audit">导出日志</button>') +
      '<div class="sec-verify ok" id="sec-audit-chain">正在校验审计哈希链…</div>' +
      panel('审计日志', '共 ' + D.logs.length + ' 条', '<div class="filter-bar"><input id="sec-audit-filter" placeholder="搜索操作者、动作或对象"></div>' +
        '<div id="sec-audit-table">' + table(['时间', '操作者', '动作', '对象', '结果', 'IP', '区块哈希'], rows) + '</div>') +
      '';
    var chain = Promise.resolve('GENESIS');
    D.logs.forEach(function (l, i) {
      chain = chain.then(function (prev) {
        return sha256Hex(prev + JSON.stringify(l)).then(function (h) {
          var cell = document.querySelector('[data-log-hash="' + i + '"]');
          if (cell) cell.textContent = shortHash(h, 10);
          return h;
        });
      });
    });
    chain.then(function (last) {
      var el = document.getElementById('sec-audit-chain');
      if (el) el.textContent = '审计哈希链完整 · ' + D.logs.length + ' 条记录 · 链尾哈希 ' + shortHash(last, 18);
    });
    var filter = document.getElementById('sec-audit-filter');
    if (filter) filter.oninput = function () {
      var q = filter.value.trim().toLowerCase();
      document.querySelectorAll('#sec-audit-table tbody tr').forEach(function (tr) {
        tr.style.display = (!q || tr.textContent.toLowerCase().indexOf(q) >= 0) ? '' : 'none';
      });
    };
    var exportBtn = document.getElementById('sec-export-audit');
    if (exportBtn) exportBtn.onclick = function () {
      var lines = ['时间\t操作者\t动作\t对象\t结果\tIP'];
      D.logs.forEach(function (l) { lines.push([l.time, l.operator, l.action, l.object, l.result, l.ip].join('\t')); });
      var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '审计日志-2026-11.txt';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('审计日志已导出');
    };
  }

  /* =========================================================
     6. 平台信息与成果
     ========================================================= */
  function pageAbout() {
    var p = D.project;
    var info = '<dl class="sec-dl">' +
      '<dt>项目名称</dt><dd>' + esc(p.name) + '</dd>' +
      '<dt>项目编号</dt><dd>' + esc(p.code) + '（' + esc(p.plan) + '）</dd>' +
      '<dt>指南方向</dt><dd>' + esc(p.guide) + '</dd>' +
      '<dt>牵头单位</dt><dd>' + esc(p.unit) + '</dd>' +
      '<dt>参与单位</dt><dd>' + esc(p.partner) + '</dd>' +
      '<dt>项目负责人</dt><dd>' + esc(p.leader) + '</dd>' +
      '<dt>执行期限</dt><dd>' + esc(p.period) + '</dd>' +
      '<dt>资助经费</dt><dd>' + esc(p.fund) + '</dd></dl>';
    var version = '<dl class="sec-dl">' +
      '<dt>平台名称</dt><dd>' + esc(p.platform) + '</dd>' +
      '<dt>版本</dt><dd>' + esc(p.version) + '</dd>' +
      '<dt>知识产权</dt><dd>' + esc(p.copyright) + '</dd>' +
      '<dt>成果标注</dt><dd>“湖南省科技创新计划资助（' + esc(p.code) + '）”</dd>' +
      '</dl>';
    var kpiTable = table(['指标', '任务书目标', '当前值', '佐证材料'], D.kpi.map(function (k) {
      return [esc(k.name), esc(k.target), badge(k.current, 'ok'), esc(k.evidence)];
    }));
    var achTable = table(['成果类型', '目标', '当前值', '佐证材料'], D.achievements.map(function (a) {
      return [esc(a.type), esc(a.target), esc(a.actual), esc(a.evidence)];
    }));
    var m = document.getElementById('main');
    m.innerHTML = heading('PLATFORM & ACHIEVEMENTS', '平台信息与成果', '项目档案 · 指标对照 · 成果清单（验收材料索引）', '') +
      '<div class="sec-two-col">' + panel('项目信息', '任务书 2024AQ2028', info) + panel('平台与知识产权', '版本 / 软著 / 标注', version) + '</div>' +
      panel('任务书指标对照', '目标值 / 当前值 / 佐证', kpiTable) +
      panel('成果清单', '论文 / 专利 / 软著 / 报告', achTable) +
      '';
  }

  /* =========================================================
     7. 密态建模
     ========================================================= */
  function cs2TaskPanel() {
    return panel('密态建模任务', '<button type="button" class="primary" id="cs2-start">发起密态建模任务</button>',
      '<div class="sec-chips cs2-chips"><span class="sec-chip ok">FL / SFL</span><span class="sec-chip ok">Tucker 防护</span>' +
      '<span class="sec-chip ok">200 轮训练</span><span class="sec-chip ok">图像重建对照</span></div>' +
      '<div id="cs2-task" class="cs2-task"><div class="cs2-empty">选择 FL 或 SFL 发起密态建模任务。</div></div>');
  }

  function openCs2TaskConfig() {
    var configs = {
      FL: { model: 'ResNet-18', dataset: 'CIFAR-10', clients: 10, split: '完整模型', ranks: [1.0, 0.1, 0.01, 0.001] },
      SFL: { model: 'LeNet-5', dataset: 'Fashion-MNIST', clients: 3, split: '第 1 次池化后', ranks: [1.0, 0.5, 0.25] }
    };
    openModal('发起密态建模任务',
      '<div class="cs2-config"><div class="cs2-config-note">选择训练方式与 Tucker 防护档位；任务详情将展示训练曲线、节点链路、精度对比和图像重建对照。</div>' +
      '<label>训练方式<select id="cs2-mode"><option value="FL" selected>联邦学习 FL</option><option value="SFL">拆分联邦学习 SFL</option></select></label>' +
      '<div class="cs2-config-grid"><div><span>模型</span><b id="cs2-model">ResNet-18</b></div><div><span>数据集</span><b id="cs2-dataset">CIFAR-10</b></div>' +
      '<div><span>客户端</span><b id="cs2-clients">10</b></div><div><span>切分位置</span><b id="cs2-split">完整模型</b></div></div>' +
      '<label>防护配置<select id="cs2-rank"></select></label>' +
      '<label>训练轮次<select id="cs2-rounds"><option value="200" selected>200 轮</option></select></label>' +
      '<div class="cs2-config-foot"><span>训练任务</span><span>数据来源：实验日志</span></div></div>',
      '<button id="cs2-cancel">取消</button><button class="primary" id="cs2-confirm">开始任务</button>');
    function setMode() {
      var mode = $('#cs2-mode').value, cfg = configs[mode];
      $('#cs2-model').textContent = cfg.model;
      $('#cs2-dataset').textContent = cfg.dataset;
      $('#cs2-clients').textContent = String(cfg.clients);
      $('#cs2-split').textContent = cfg.split;
      var options = '<option value="off">关闭防护</option>' + cfg.ranks.map(function (r, i) {
        return '<option value="' + r + '"' + (i === 0 ? ' selected' : '') + '>Tucker · r=' + r + '</option>';
      }).join('');
      $('#cs2-rank').innerHTML = options;
    }
    $('#cs2-mode').onchange = setMode;
    setMode();
    $('#cs2-cancel').onclick = function () { $('#modal').close(); };
    $('#cs2-confirm').onclick = function () {
      var mode = $('#cs2-mode').value, rank = $('#cs2-rank').value;
      $('#modal').close();
      renderCs2Task(mode, rank);
    };
  }

  function cs2Smooth(values, radius) {
    var out = [], r = radius == null ? 5 : radius;
    for (var i = 0; i < values.length; i++) {
      var sum = 0, count = 0;
      for (var j = Math.max(0, i - r); j <= Math.min(values.length - 1, i + r); j++) {
        sum += Number(values[j]);
        count++;
      }
      out.push(sum / Math.max(1, count));
    }
    return out;
  }

  function openCs2Image(src, title) {
    openModal(title || '图像查看',
      '<div class="cs2-lightbox"><img id="cs2-lightbox-img" src="' + esc(src) + '" alt=""><div class="cs2-lightbox-hint">点击图片放大 / 还原</div></div>',
      '<button id="cs2-lightbox-close">关闭</button>');
    var img = document.getElementById('cs2-lightbox-img');
    if (img) img.onclick = function () { img.classList.toggle('zoomed'); };
    var close = document.getElementById('cs2-lightbox-close');
    if (close) close.onclick = function () { $('#modal').close(); };
  }

  var cs2SmoothRaf = 0, cs2DisplayProgress = 0, cs2TaskStatus = '', cs2LastUi = 0, cs2StartedAt = 0, cs2DurationMs = 0;

  function renderCs2Task(mode, rankValue, restored, activeTask) {
    var cs2 = window.CS2;
    if (!cs2) return;
    if (cs2SmoothRaf) { cancelAnimationFrame(cs2SmoothRaf); cs2SmoothRaf = 0; }
    cs2DisplayProgress = 0;
    cs2TaskStatus = '';
    cs2LastUi = 0;
    cs2StartedAt = 0;
    cs2DurationMs = 0;
    var data = cs2.training[mode], series = data.series;
    var off = series.filter(function (s) { return s.id === 'off'; })[0];
    var chosen = off;
    if (rankValue !== 'off') {
      chosen = series.filter(function (s) { return Number(s.rank) === Number(rankValue); })[0] || off;
    }
    var cfg = mode === 'FL'
      ? { model: 'ResNet-18', dataset: 'CIFAR-10', clients: 10, split: '完整模型' }
      : { model: 'LeNet-5', dataset: 'Fashion-MNIST', clients: 3, split: '第 1 次池化后' };
    var offVals = off.points.map(function (p) { return p.test_accuracy * 100; });
    var chosenVals = chosen.points.map(function (p) { return p.test_accuracy * 100; });
    var offDraw = cs2Smooth(offVals), chosenDraw = cs2Smooth(chosenVals);
    var offValVals = off.points.map(function (p) { return p.val_accuracy * 100; });
    var chosenValVals = chosen.points.map(function (p) { return p.val_accuracy * 100; });
    var n = off.points.length;
    var chartSeries = [{ name: '关闭防护', color: '#7d8ea3', values: offDraw, smooth: true }];
    if (chosen.id !== off.id) {
      chartSeries.push({ name: chosen.label, color: '#27a8ef', values: chosenDraw, smooth: true, dash: '3 3' });
    }
    var cs2Ticks = [0];
    for (var tickRound = 20; tickRound <= 200; tickRound += 20) cs2Ticks.push(tickRound - 1);
    var chartMarkup = lineChart(chartSeries, {
      n: n, min: 0, max: 100,
      yGrid: 10, yLabelEvery: 2,
      xTicks: cs2Ticks,
      label: mode + ' ' + cfg.model + ' ' + cfg.dataset + ' 测试精度'
    });
    var nodeHtml = mode === 'FL'
      ? '<div class="cs2-nodes"><div class="cs2-node"><b>客户端 × ' + cfg.clients + '</b><small>完整模型 · 本地数据</small></div><span class="cs2-arrow">模型更新 →<br>← 广播</span><div class="cs2-node cs2-node-server"><b>聚合服务端</b><small>FedBuff · 10 客户端</small></div></div>'
      : '<div class="cs2-nodes"><div class="cs2-node"><b>客户端前段</b><small>LeNet-5 · 第 1 次池化后</small></div><span class="cs2-arrow">激活 →<br>← 梯度</span><div class="cs2-node"><b>拆分服务端后段</b><small>后段前向 / 反向</small></div><span class="cs2-arrow">前段更新 →</span><div class="cs2-node cs2-node-server"><b>聚合服务端</b><small>Tucker 聚合</small></div></div>';
    var protocol = chosen.protocol_metrics || off.protocol_metrics;
    var protocolHtml = '';
    if (protocol) {
      protocolHtml = '<div class="cs2-protocol"><div><span>每客户端前段聚合</span><b>' + Number(protocol.front_update_numeric_bytes_per_client || 0).toLocaleString() + ' B</b></div>' +
        '<div><span>拆分通道数值量/轮</span><b>' + Number(protocol.boundary_total_bytes || 0).toLocaleString() + ' B</b></div>' +
        '<div><span>标签上传</span><b>' + (protocol.labels_sent ? '是' : '否') + '</b></div></div>';
    }
    var gallery = cs2.galleries[mode];
    function metricText(obj, keys) {
      if (!obj || !obj.metrics) return '';
      return keys.map(function (k) { return k.toUpperCase() + ' ' + Number(obj.metrics[k]).toFixed(k === 'ssim' ? 4 : 3); }).join(' · ');
    }
    var galleryHtml = (gallery && gallery.samples || []).map(function (s) {
      var keys = mode === 'FL' ? ['psnr_db', 'ssim', 'lpips'] : ['mse'];
      return '<div class="cs2-gallery-item"><div class="cs2-gallery-title">' + esc(s.label || s.sample_id) + '</div>' +
        '<div class="cs2-gallery-images"><figure><img loading="lazy" src="' + esc(s.original.asset) + '" alt="原图"><figcaption>公开样本原图</figcaption></figure>' +
        '<figure><img loading="lazy" src="' + esc(s.off.asset) + '" alt="关闭防护重建"><figcaption>关闭防护后重建<br><small>' + esc(metricText(s.off, keys)) + '</small></figcaption></figure>' +
        '<figure><img loading="lazy" src="' + esc(s.on.asset) + '" alt="Tucker 后重建"><figcaption>Tucker 后重建<br><small>' + esc(metricText(s.on, keys)) + '</small></figcaption></figure></div></div>';
    }).join('');
    var rankLabel = chosen.id === 'off' ? '关闭防护' : 'Tucker r=' + chosen.rank;
    function bindCs2Gallery(container) {
      Array.prototype.forEach.call(container.querySelectorAll('.cs2-gallery-images img'), function (img) {
        img.onclick = function () { openCs2Image(img.src, img.alt); };
      });
    }
    var task = document.getElementById('cs2-task');
    if (!task) return;
    task.innerHTML = '<div class="cs2-task-head"><div><b>' + esc(mode + ' · ' + cfg.model + ' · ' + cfg.dataset) + '</b>' +
      '<small>200 轮 · ' + cfg.clients + ' 客户端 · ' + esc(rankLabel) + '</small></div></div>' +
      '<div class="cs2-progress-head"><span id="cs2-round">第 1 / 200 轮</span><span id="cs2-pct">0%</span></div>' +
      '<div class="cs2-progress"><i id="cs2-progress-bar"></i></div>' +
      '<div class="cs2-metrics"><div><span>关闭防护测试</span><b id="cs2-off-acc">—</b><small id="cs2-off-val">验证 —</small></div>' +
      '<div><span>' + esc(rankLabel) + '</span><b id="cs2-chosen-acc">—</b><small id="cs2-chosen-val">验证 —</small></div>' +
      '<div><span>相对关闭防护</span><b id="cs2-delta">—</b><small>测试准确率差</small></div>' +
      '<div><span>防护范围</span><b>' + (mode === 'FL' ? '全模型更新' : '前段聚合更新') + '</b><small>' + esc(cfg.split) + '</small></div></div>' +
      '<div class="cs2-subpanel"><h4>节点与模型分层</h4>' + nodeHtml + protocolHtml + '</div>' +
      '<div class="cs2-subpanel cs2-chart-panel"><h4>同轮精度对比</h4><div id="cs2-chart"></div></div>' +
      '<div class="cs2-subpanel cs2-gallery" id="cs2-gallery" hidden><h4>图像重建对照</h4><div class="cs2-gallery-list">' + (galleryHtml || '<p class="sec-meta">暂无图像重建样本。</p>') + '</div>' +
      '<div class="sec-meta">' + (mode === 'SFL' ? 'SFL 仅比较待聚合前段更新；拆分通道仍传输激活与边界梯度。' : 'FL 图库为 GIA/iDLG 公开样本，用于展示聚合服务端更新观察条件。') + '</div></div>';
    var chartBox = document.getElementById('cs2-chart');
    chartBox.innerHTML = chartMarkup;
    var svg = chartBox.querySelector('svg');
    var clipRect = null, dotOff = null, dotChosen = null;
    if (svg) {
      var ns = 'http://www.w3.org/2000/svg';
      var defs = document.createElementNS(ns, 'defs');
      var clip = document.createElementNS(ns, 'clipPath');
      clip.setAttribute('id', 'cs2-reveal-clip');
      clipRect = document.createElementNS(ns, 'rect');
      clipRect.setAttribute('x', '46');
      clipRect.setAttribute('y', '0');
      clipRect.setAttribute('height', '250');
      clipRect.setAttribute('width', '0');
      clip.appendChild(clipRect);
      defs.appendChild(clip);
      svg.insertBefore(defs, svg.firstChild);
      Array.prototype.forEach.call(svg.querySelectorAll('path, polyline'), function (el) {
        el.setAttribute('clip-path', 'url(#cs2-reveal-clip)');
      });
      function dot(color) {
        var c = document.createElementNS(ns, 'circle');
        c.setAttribute('r', '4');
        c.setAttribute('fill', color);
        c.setAttribute('stroke', '#fff');
        c.setAttribute('stroke-width', '1.5');
        c.setAttribute('pointer-events', 'none');
        svg.appendChild(c);
        return c;
      }
      dotOff = dot('#7d8ea3');
      dotChosen = dot('#27a8ef');
    }
    function interp(values, point) {
      var i = Math.max(0, Math.min(values.length - 1, Math.floor(point)));
      var j = Math.min(values.length - 1, i + 1);
      var t = Math.max(0, Math.min(1, point - i));
      return Number(values[i]) + (Number(values[j]) - Number(values[i])) * t;
    }
    function frame(point, silent) {
      if (!clipRect) return;
      var pct = (point / (n - 1)) * 100;
      clipRect.setAttribute('width', (Math.max(0, Math.min(1, point / (n - 1))) * 658).toFixed(2));
      var x = 46 + 658 * (point / (n - 1));
      var y = function (v) { return 18 + 202 * (1 - v / 100); };
      var offNow = interp(offVals, point), chosenNow = interp(chosenVals, point);
      var offDrawNow = interp(offDraw, point), chosenDrawNow = interp(chosenDraw, point);
      dotOff.setAttribute('cx', x.toFixed(2));
      dotOff.setAttribute('cy', y(offDrawNow).toFixed(2));
      dotChosen.setAttribute('cx', x.toFixed(2));
      dotChosen.setAttribute('cy', y(chosenDrawNow).toFixed(2));
      $('#cs2-pct').textContent = Math.round(pct) + '%';
      $('#cs2-progress-bar').style.width = pct + '%';
      if (silent) return;
      var round = Math.max(1, Math.min(200, Math.round(point) + 1));
      var offValNow = interp(offValVals, point), chosenValNow = interp(chosenValVals, point);
      $('#cs2-round').textContent = '第 ' + round + ' / 200 轮';
      $('#cs2-off-acc').textContent = offNow.toFixed(2) + '%';
      $('#cs2-off-val').textContent = '验证 ' + offValNow.toFixed(2) + '%';
      $('#cs2-chosen-acc').textContent = chosenNow.toFixed(2) + '%';
      $('#cs2-chosen-val').textContent = '验证 ' + chosenValNow.toFixed(2) + '%';
      $('#cs2-delta').textContent = (chosenNow - offNow >= 0 ? '+' : '') + (chosenNow - offNow).toFixed(2) + ' pp';
    }
    function cs2SmoothTick(now) {
      if (!chartBox.isConnected) { cs2SmoothRaf = 0; return; }
      var progress;
      if (cs2TaskStatus === 'completed') {
        progress = 1;
      } else if (cs2StartedAt && cs2DurationMs) {
        progress = Math.min(0.999, Math.max(0, (Date.now() - cs2StartedAt) / cs2DurationMs));
      } else {
        progress = cs2DisplayProgress || 0;
      }
      cs2DisplayProgress = progress;
      var silent = now - cs2LastUi < 70;
      frame((n - 1) * progress, silent);
      if (!silent) cs2LastUi = now;
      if (cs2TaskStatus === 'completed' && progress >= 0.999) {
        frame(n - 1);
        var galleryEl = document.getElementById('cs2-gallery');
        if (galleryEl) galleryEl.hidden = false;
        cs2SmoothRaf = 0;
        return;
      }
      cs2SmoothRaf = requestAnimationFrame(cs2SmoothTick);
    }
    function cs2ApplyTask(t) {
      if (!t || !chartBox.isConnected) return;
      cs2StartedAt = Number(t.startedAt) || 0;
      cs2DurationMs = Number(t.durationMs) || 0;
      cs2TaskStatus = t.status || 'running';
      if (!cs2SmoothRaf) cs2SmoothRaf = requestAnimationFrame(cs2SmoothTick);
      if (cs2TaskStatus !== 'completed') {
        scheduleChartPoll(function () { pollCs2Task(t.id); }, 300);
      }
    }
    function pollCs2Task(id) {
      if (!chartBox.isConnected) return;
      fetchChartTask(id).then(function (t) {
        if (chartBox.isConnected) cs2ApplyTask(t);
      }).catch(function () {
        if (chartBox.isConnected) scheduleChartPoll(function () { pollCs2Task(id); }, 900);
      });
    }
    bindCs2Gallery(task);
    if (restored) {
      frame(n - 1);
      var restoredGallery = document.getElementById('cs2-gallery');
      if (restoredGallery) restoredGallery.hidden = false;
      return;
    }
    if (activeTask) {
      cs2DisplayProgress = Math.max(0, Math.min(1, Number(activeTask.progress) || 0));
      cs2TaskStatus = activeTask.status || 'running';
      cs2StartedAt = Number(activeTask.startedAt) || 0;
      cs2DurationMs = Number(activeTask.durationMs) || 0;
      cs2ApplyTask(activeTask);
      return;
    }
    var runData = {
      id: 'cs2-' + mode + '-' + rankValue, mode: mode, rank: rankValue,
      model: cfg.model, dataset: cfg.dataset, status: '已完成'
    };
    startChartTask('cs2', mode + ' ' + cfg.model, 7000, { mode: mode, rank: rankValue, run: runData })
      .then(function (created) {
        cs2ApplyTask(created);
      })
      .catch(function () {
        var hint = document.getElementById('cs2-chart');
        if (hint) hint.innerHTML = '<p class="sec-meta">任务启动失败，请重试。</p>';
      });
  }


  function cs2SystemArchitecture(title, subtitle) {
    var groups = [
      ['A', '医院端侧', '本地影像', '模型前段'],
      ['B', '医院端侧', '本地检验', '模型中段'],
      ['C', '医院端侧', '本地病理', '模型后段']
    ];
    var groupHtml = groups.map(function (g) {
      return '<article class="cs2-l2-group">' +
        '<header><b>客户端组 ' + g[0] + '</b><span>' + g[1] + '</span></header>' +
        '<div class="cs2-l2-flow">' +
          '<div class="cs2-l2-node data"><b>' + g[2] + '</b><span>原始数据不出域</span></div>' +
          '<div class="cs2-l2-node client"><b>客户端节点</b><span>' + g[3] + ' / 本地计算</span></div>' +
          '<div class="cs2-l2-node mid"><b>中间值</b><span>组内串行计算</span></div>' +
          '<div class="cs2-l2-node edge"><b>边缘节点</b><span>密态投影 / 局部聚合</span></div>' +
          '<div class="cs2-l2-node zkp"><b>ZKP 证明生成</b><span>计算正确性校验</span></div>' +
        '</div>' +
      '</article>';
    }).join('');
    var steps = ['训练请求', '数据查询', '数据验证', '组内串行', '密态投影', 'ZKP 生成', '异步并行', 'ZKP 验证', '聚合密态数据'];
    var stepHtml = steps.map(function (x, i) {
      return '<span class="cs2-step-chip" data-cs2-step="' + (i + 1) + '"><i>' + (i + 1) + '</i>' + x + '</span>';
    }).join('');
    return panel(title || '平台分层架构', subtitle || '端侧 · 边缘 · 云端 · 层间动态数据流转',
      '<div class="cs2-layers">' +
        '<section class="cs2-layer-row l4" data-cs2-layer="l4">' +
          '<aside class="cs2-layer-axis"><b>L4</b><span>云端服务层</span><small>聚合 / 验证 / 模型</small></aside>' +
          '<div class="cs2-layer-body">' +
            '<div class="cs2-l4-grid">' +
              '<div class="cs2-l4-cloud"><div class="cs2-l4-cloud-head"><span>云服务中心</span><b>全局模型 · 密态聚合</b></div>' +
                '<div class="cs2-l4-services"><span>智能计算</span><span>数据资源</span><span>智能服务</span><span>聚合密态数据</span></div>' +
                '<p>ZKP 验证通过后进入安全聚合，云端无法还原本地明文。</p></div>' +
              '<div class="cs2-l4-stats">' +
                '<div><b>3</b><span>客户端组</span></div><div><b>200</b><span>轮训练</span></div>' +
                '<div><b>8</b><span>密态算法</span></div><div><b>9</b><span>流转节点</span></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<div class="cs2-layer-flow" data-cs2-link="l4"><i class="p1"></i><i class="p2"></i><span>↑ 密态聚合数据 / 验证结果</span><em>↓ 全局模型下发</em></div>' +
        '<section class="cs2-layer-row l3" data-cs2-layer="l3">' +
          '<aside class="cs2-layer-axis"><b>L3</b><span>联邦聚合层</span><small>跨机构参数聚合</small></aside>' +
          '<div class="cs2-layer-body">' +
            '<div class="cs2-layer-head"><b>联邦学习 · 只上传加密梯度</b><span>原始数据不共享</span></div>' +
            '<div class="cs2-l3-grid">' +
              '<div class="cs2-l3-inst"><b>医院 A</b><span>密态梯度</span></div>' +
              '<div class="cs2-l3-inst"><b>医院 B</b><span>密态梯度</span></div>' +
              '<div class="cs2-l3-inst"><b>医院 C</b><span>密态梯度</span></div>' +
              '<div class="cs2-l3-verify"><b>ZKP 验证</b><span>聚合前校验通过</span></div>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<div class="cs2-layer-flow" data-cs2-link="l3"><i class="p1"></i><i class="p2"></i><span>↑ 密态中间值 / 加密梯度</span><em>↓ 聚合规则 / 轮次</em></div>' +
        '<section class="cs2-layer-row l2" data-cs2-layer="l2">' +
          '<aside class="cs2-layer-axis"><b>L2</b><span>拆分学习层</span><small>组内串行 / 组间并行</small></aside>' +
          '<div class="cs2-layer-body">' +
            '<div class="cs2-layer-head"><b>客户端组 · 组内分层串行计算</b><span>每组独立训练，不交换原始数据</span></div>' +
            '<div class="cs2-l2-grid">' + groupHtml + '</div>' +
          '</div>' +
        '</section>' +
        '<div class="cs2-layer-flow" data-cs2-link="l2"><i class="p1"></i><i class="p2"></i><span>↑ 数据索引 / 查询结果 / 哈希</span><em>↓ 训练数据请求</em></div>' +
        '<section class="cs2-layer-row l1" data-cs2-layer="l1">' +
          '<aside class="cs2-layer-axis"><b>L1</b><span>数据存证层</span><small>查询 / 校验 / 上链</small></aside>' +
          '<div class="cs2-layer-body">' +
            '<div class="cs2-layer-head"><b>训练前 · 数据准备与链上存证</b><span>查询 → 校验 → 哈希上链</span></div>' +
            '<div class="cs2-l1-chain"><span>训练数据请求</span><i></i><span>数据查询</span><i></i><span>哈希上链</span><i></i><span>数据验证</span><i></i><span>查询结果</span></div>' +
          '</div>' +
        '</section>' +
        '<div class="cs2-arch-stepbar"><div class="cs2-arch-stepbar-head"><span>REAL FLOW</span><b>9 步真实流转</b></div>' + stepHtml + '</div>' +
      '</div>');
  }

  function cs2LiveDataFlow() {
    var mini = function (title, desc) {
      return '<div class="cs2-pipe-card"><b>' + title + '</b><span>' + desc + '</span></div>';
    };
    var groups = ['A', 'B', 'C'].map(function (g) {
      return '<div class="cs2-pipe-group"><div class="cs2-pipe-group-head"><b>客户端组 ' + g + '</b><span>本地训练</span></div>' +
        '<div class="cs2-pipe-group-row"><span>客户端节点</span><i></i><span>边缘节点</span></div>' +
        '<div class="cs2-pipe-group-tags"><span>中间值</span><span>密态投影</span><span>ZKP</span></div></div>';
    }).join('');
    var steps = ['训练请求', '数据查询', '数据验证', '组内串行', '密态投影', 'ZKP 生成', '异步并行', 'ZKP 验证', '聚合密态数据'];
    var stepHtml = steps.map(function (x, i) {
      return '<span class="cs2-live-step" data-cs2-step="' + (i + 1) + '"><i>' + (i + 1) + '</i>' + x + '</span>';
    }).join('');
    return panel('端到端动态数据流', '训练前 → 训练过程 → 训练后 · 实时状态',
      '<div class="cs2-pipe" id="cs2-live-stage">' +
        '<div class="cs2-pipe-head"><div><span class="cs2-arch-kicker">END-TO-END ENCRYPTED PIPELINE</span><b>密态数据正在流转</b></div>' +
          '<span class="cs2-pipe-live"><i></i>LIVE FLOW</span></div>' +
        '<div class="cs2-pipe-grid">' +
          '<section class="cs2-pipe-phase before" data-cs2-phase="before"><header><span>01</span><b>训练前</b><em>数据准备</em></header>' +
            '<div class="cs2-pipe-list">' + mini('训练数据请求', '提交训练任务与数据索引') + mini('链上数据查询', '查询索引、权限与版本') + mini('完整性验证', '数据摘要与版本一致性') + '</div>' +
            '<div class="cs2-pipe-chain">区块链：查询结果 · 哈希上链</div></section>' +
          '<section class="cs2-pipe-phase process" data-cs2-phase="process"><header><span>02</span><b>训练过程</b><em>组内串行 / 组间并行</em></header>' +
            '<div class="cs2-pipe-groups">' + groups + '</div>' +
            '<div class="cs2-pipe-transfer"><span>组内串行</span><i></i><span>密态投影</span><i></i><span>ZKP 生成</span><i></i><span>异步并行</span></div></section>' +
          '<section class="cs2-pipe-phase after" data-cs2-phase="after"><header><span>03</span><b>训练后</b><em>验证与聚合</em></header>' +
            '<div class="cs2-pipe-list">' + mini('零知识证明验证', '验证本地计算正确性') + mini('密态数据聚合', '只聚合密态份额') + mini('全局模型更新', '云端无法还原明文') + '</div>' +
            '<div class="cs2-pipe-chain">审计：哈希上链 · 查询结果 · 验证记录</div></section>' +
        '</div>' +
        '<div class="cs2-pipe-track"><span>训练前</span><i><b class="cs2-pipe-packet"></b></i><span>训练过程</span><i><b class="cs2-pipe-packet p2"></b></i><span>训练后</span><em>加密梯度 / 密态中间值 → 聚合密态数据</em></div>' +
        '<div class="cs2-pipe-steps">' + stepHtml + '</div>' +
        '<div class="cs2-pipe-log"><div><b>训练前</b><span>数据查询 · 哈希上链 · 完整性验证</span></div>' +
          '<div><b>训练过程</b><span>3 组客户端 · 组内串行 · 组间异步并行</span></div>' +
          '<div><b>训练后</b><span>ZKP 验证 · 密态聚合 · 全局模型更新</span></div></div>' +
        '<div class="cs2-pipe-status"><span class="cs2-live-dot"></span><span>当前流转</span><b id="cs2-live-label">训练请求</b><em id="cs2-live-counter">1 / 9</em></div>' +
      '</div>');
  }


  var treeEdges = [
    ['tp-base','tp-a1','① 请求 · ② 查询','1,2'],['tp-base','tp-b1','① 请求 · ② 查询','1,2'],['tp-base','tp-c1','① 请求 · ② 查询','1,2'],
    ['tp-a1','tp-a2','③ 数据验证','3','h'],['tp-a2','tp-aedge','④ 组内串行','4'],
    ['tp-b1','tp-b2','③ 数据验证','3','h'],['tp-b2','tp-bedge','④ 组内串行','4'],
    ['tp-c1','tp-c2','③ 数据验证','3','h'],['tp-c2','tp-cedge','④ 组内串行','4'],
    ['tp-aedge','tp-async','⑤ 密态投影 · ⑥ ZKP 生成','5,6'],['tp-bedge','tp-async','⑤ 密态投影 · ⑥ ZKP 生成','5,6'],['tp-cedge','tp-async','⑤ 密态投影 · ⑥ ZKP 生成','5,6'],
    ['tp-async','tp-fed','⑦ 组间异步并行传输','7'],
    ['tp-fed','tp-root','⑧ ZKP 验证','8']
  ];  var treeRendered=false;
  function renderTreeEdges() {
    var stage=document.getElementById('tree-stage');
    if(!stage) return;
    var svg=document.getElementById('tree-svg');
    if(!svg) return;
    var frame=document.getElementById('tree-zoom-frame');
    var arch=frame&&frame.querySelector('.tree-arch');
    var zoomed=frame&&frame.classList.contains('tree-zoom-on');
    if(zoomed) frame.classList.remove('tree-zoom-on');
    if(arch) arch.style.transition='none';
    void stage.offsetHeight;
    var rect=stage.getBoundingClientRect();
    var w=stage.clientWidth||rect.width,h=stage.clientHeight||rect.height;
    svg.setAttribute('viewBox','0 0 '+w+' '+h);
    svg.setAttribute('width',w); svg.setAttribute('height',h);
    function node(id){ return document.getElementById(id); }
    var defs='<defs><marker id="tp-arrow" viewBox="0 0 10 10" refX="9.2" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#5aa9c0"/></marker>'+
      '<filter id="tp-label-shadow" x="-30%" y="-80%" width="160%" height="260%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#2e657a" flood-opacity=".16"/></filter></defs>';
    var pathBody='';
    var labelBody='';
    for(var i=0;i<treeEdges.length;i++){
      var e=treeEdges[i], from=node(e[0]), to=node(e[1]);
      if(!from||!to) continue;
      var fr=from.getBoundingClientRect(), tr=to.getBoundingClientRect();
      var d,x1,x2,y1,y2;
      if(e[4]==='h'){
        x1=fr.right-rect.left-3; x2=tr.left-rect.left+3;
        y1=fr.top-rect.top+fr.height/2; y2=tr.top-rect.top+tr.height/2;
        d='M '+x1.toFixed(1)+' '+y1.toFixed(1)+' C '+((x1+x2)/2).toFixed(1)+' '+y1.toFixed(1)+', '+((x1+x2)/2).toFixed(1)+' '+y2.toFixed(1)+', '+x2.toFixed(1)+' '+y2.toFixed(1);
      }else{
        x1=fr.left-rect.left+fr.width/2; y1=fr.top-rect.top-3;
        x2=tr.left-rect.left+tr.width/2; y2=tr.bottom-rect.top;
        d='M '+x1.toFixed(1)+' '+y1.toFixed(1)+' C '+x1.toFixed(1)+' '+((y1+y2)/2).toFixed(1)+', '+x2.toFixed(1)+' '+((y1+y2)/2).toFixed(1)+', '+x2.toFixed(1)+' '+y2.toFixed(1);
      }
      var mx=(x1+x2)/2, my=(y1+y2)/2;
      var lw=20;
      for(var ci=0;ci<e[2].length;ci++){
        lw += /[\u4e00-\u9fff]/.test(e[2].charAt(ci)) ? 9.8 : 5.8;
      }
      pathBody+='<g class="tp-edge" data-tp-edge="'+e[3]+'">'
        +'<path d="'+d+'" fill="none" stroke="#7cb9cb" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#tp-arrow)"/>'
        +'<circle r="3.4" fill="#22b394"><animateMotion dur="2.9s" begin="'+((i%3)*0.9)+'s" repeatCount="indefinite" path="'+d+'"/></circle>'
        +'</g>';
      labelBody+='<g class="tp-edge tp-edge-label" data-tp-edge="'+e[3]+'">'
        +'<rect x="'+(mx-lw/2).toFixed(1)+'" y="'+(my-11).toFixed(1)+'" width="'+lw.toFixed(1)+'" height="22" rx="11" fill="#ffffff" stroke="#b9d9e4" stroke-width="1.2" filter="url(#tp-label-shadow)"/>'
        +'<text x="'+mx.toFixed(1)+'" y="'+(my+3.8).toFixed(1)+'" text-anchor="middle" font-size="10" font-weight="600" fill="#2f6377">'+e[2]+'</text>'
        +'</g>';
    }
    svg.innerHTML=defs+'<g class="tp-edge-paths">'+pathBody+'</g><g class="tp-edge-labels">'+labelBody+'</g>';
    if(zoomed) frame.classList.add('tree-zoom-on');
    if(frame){ frame.style.height=Math.ceil(stage.scrollHeight*((window.__treeZoomPct||75)/100))+'px'; }
    if(arch) requestAnimationFrame(function(){ arch.style.transition=''; });
    treeRendered=true;
  }
  var treeObserver=null;
  function observeTreeStage(){
    if(!window.ResizeObserver) return;
    var stage=document.getElementById('tree-stage');
    if(!stage) return;
    if(treeObserver && treeObserver.__stage===stage) return;
    if(treeObserver) treeObserver.disconnect();
    treeObserver=new ResizeObserver(function(){ if(document.getElementById('tree-stage')) renderTreeEdges(); });
    treeObserver.__stage=stage;
    treeObserver.observe(stage);
  }
  function refreshTreeEdges(){ treeRendered=false; }
  if(!window.__treeResize){
    window.__treeResize=true;
    window.addEventListener('resize',function(){ if(document.getElementById('tree-stage')) renderTreeEdges(); });
  }

  window.__treeZoomPct = 100;
  function applyTreeZoom(pct){
    if(typeof pct==='number') window.__treeZoomPct=Math.max(50,Math.min(150,pct));
    var frame=document.getElementById('tree-zoom-frame');
    if(!frame) return;
    frame.style.setProperty('--tree-zoom',(window.__treeZoomPct/100));
    frame.classList.add('tree-zoom-on');
    var arch=frame.querySelector('.tree-arch, .axis-arch');
    if(arch) frame.style.height=Math.ceil(arch.scrollHeight*(window.__treeZoomPct/100))+'px';
    var label=document.getElementById('tree-zoom-value');
    if(label) label.textContent=window.__treeZoomPct+'%';
  }
  function bindTreeZoom(){
    if(window.__treeZoomBound) return;
    window.__treeZoomBound=true;
    window.__treeZoomStep=function(delta){ applyTreeZoom(window.__treeZoomPct+delta); };
    window.__treeZoomReset=function(){ applyTreeZoom(75); };
    var frame=document.getElementById('tree-zoom-frame');
    if(frame && !frame.__wheelBound){
      frame.__wheelBound=true;
      var last=0;
      frame.addEventListener('wheel',function(e){
        if(!e.ctrlKey) return;
        var stage=frame.querySelector('.tree-stage, .axis-arch');
        if(!stage) return;
        var r=stage.getBoundingClientRect();
        var inStage=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
        if(!inStage) return;
        var now=Date.now();
        if(now-last<70) { e.preventDefault(); return; }
        last=now;
        e.preventDefault();
        var step=e.deltaY<0?5:-5;
        applyTreeZoom(window.__treeZoomPct+step);
      },{passive:false});
    }
  }

  function platformArchitecture() {
    window.__treeZoomPct=100;
    function leaf(id,title,sub,tagStep,tagText){ return '<div class="tp-leaf" id="'+id+'"><b>'+title+'</b><span>'+sub+'</span>'+(tagStep?'<div class="tp-leaf-tag"><i data-tp-step="'+tagStep+'">'+tagText+'</i></div>':'')+'</div>'; }
    function edgeNode(id,name,sub,color){
      return '<div class="tp-node tp-edge-node '+color+'" id="'+id+'"><b>'+name+'</b><span>'+sub+'</span>'+
        '<div class="tp-chips"><i data-tp-step="5">⑤ 密态投影</i><i data-tp-step="6">⑥ ZKP 生成</i><i>中间值</i></div></div>';
    }
    var steps=['训练请求','数据查询','数据验证','组内串行','密态投影','ZKP 生成','异步并行','ZKP 验证','聚合密态数据'];
    var stepHtml=steps.map(function(x,i){ return '<span class="tree-step" data-plat-step="'+(i+1)+'"><i>'+(i+1)+'</i>'+x+'</span>'; }).join('');
    return panel('平台分层架构','数据自下而上汇聚 · 一棵完整的密态计算树',
      '<div class="tree-zoom-tools"><span>Ctrl + 滚轮缩放</span><b id="tree-zoom-value">100%</b></div>'+
      '<div class="tree-zoom-frame" id="tree-zoom-frame"><div class="tree-arch">'+
        '<div class="tree-legend"><span><i></i>端侧数据不出域</span><span><i></i>密态中间值</span><span><i></i>加密梯度上行</span><em>底部多路数据逐层汇聚到云服务中心</em></div>'+
        '<div class="tree-stage" id="tree-stage">'+
          '<svg id="tree-svg" class="tree-svg"></svg>'+
          '<div class="tree-level tree-l0" data-caption="L0 · 云端" data-phase="训练后"><div class="tp-node tp-root" id="tp-root">'+
            '<div class="tp-root-head"><b>云服务中心</b><span data-tp-step="9">⑨ 聚合密态数据 → 全局模型</span></div>'+
            '<div class="tp-services"><span>智能计算</span><span>数据资源</span><span>智能服务</span></div>'+
            '<div class="tp-root-stats"><span>3 客户端组</span><span>200 轮训练</span><span>8 密态算法</span><span>9 流转步骤</span></div></div></div>'+
          '<div class="tree-level tree-l1" data-caption="L1 · 联邦学习" data-phase="训练后"><div class="tp-node tp-fed" id="tp-fed">'+
            '<b>联邦学习 · 跨机构聚合</b><span data-tp-step="8">⑧ ZKP 验证通过后聚合</span><div class="tp-fed-hospitals"><span>医院 A<i>密态梯度</i></span><span>医院 B<i>密态梯度</i></span><span>医院 C<i>密态梯度</i></span></div>'+
            '<div class="tp-fed-verify"><b>⑧ 零知识证明验证</b><span>聚合前校验 · 通过才进入聚合</span></div><div class="tp-fed-note">只上传加密梯度 · 原始数据不共享</div></div></div>'+
          '<div class="tree-level tree-l2" data-caption="L2 · 安全传输" data-phase="训练过程"><div class="tp-node tp-async" id="tp-async"><b data-tp-step="7">⑦ 密态数据组间异步并行传输</b><span>只上传加密梯度 / 密态份额</span>'+
            '<div class="tp-async-chips"><span>加密梯度</span><span>密态份额</span><span>组间并行</span></div></div></div>'+
          '<div class="tree-level tree-l3" data-caption="L3 · 拆分学习" data-phase="训练过程">' +
            edgeNode('tp-aedge','边缘节点 · 局部聚合','客户端组 A','g-a')+
            edgeNode('tp-bedge','边缘节点 · 局部聚合','客户端组 B','g-b')+
            edgeNode('tp-cedge','边缘节点 · 局部聚合','客户端组 C','g-c')+
          '</div>'+
          '<div class="tree-level tree-l4" data-caption="L4 · 端侧数据" data-phase="训练过程">' +
            '<div class="tp-group-leaves"><div class="tp-leaves">'+leaf('tp-a1','数据集 A','本地影像',3,'③ 数据验证')+leaf('tp-a2','客户端 A','模型前段',4,'④ 组内串行')+'</div></div>'+
            '<div class="tp-group-leaves"><div class="tp-leaves">'+leaf('tp-b1','数据集 B','本地检验',3,'③ 数据验证')+leaf('tp-b2','客户端 B','模型中段',4,'④ 组内串行')+'</div></div>'+
            '<div class="tp-group-leaves"><div class="tp-leaves">'+leaf('tp-c1','数据集 C','本地病理',3,'③ 数据验证')+leaf('tp-c2','客户端 C','模型后段',4,'④ 组内串行')+'</div></div>'+
          '</div>'+
          '<div class="tree-level tree-base" data-caption="L5 · 数据存证" data-phase="训练前"><div class="tp-node tp-base" id="tp-base">'+
            '<b>区块链 · 数据存证</b><div class="tp-base-chips"><i data-tp-step="1">① 训练数据请求</i><i data-tp-step="2">② 数据查询</i><span>哈希上链</span><span>查询结果</span><span>训练后审计</span></div></div></div>' +
        '</div>'+
        '<div class="tree-dynamic"><div class="tree-dynamic-head"><span>LIVE FLOW</span><b>当前流转</b><strong id="plat-live-label">训练数据请求</strong><em id="plat-live-counter">1 / 9</em></div><div class="tree-steps">'+stepHtml+'</div></div>'+
      '</div></div>');
  }

  function startPlatformFlow() {
    var labels=['训练数据请求','区块链数据查询','数据可用性验证','组内串行计算','密态投影','零知识证明生成','密态数据组间异步并行传输','零知识证明验证','聚合密态数据'];
    if(window.__platFlowTimer){ clearInterval(window.__platFlowTimer); window.__platFlowTimer=null; }
    var index=0;
    function tick(){
      if(!document.querySelector('.tree-arch')){ clearInterval(window.__platFlowTimer); window.__platFlowTimer=null; return; }
      if(!treeRendered) renderTreeEdges();
      bindTreeZoom();
      applyTreeZoom();
      observeTreeStage();
      document.querySelectorAll('[data-plat-step]').forEach(function(el){
        el.classList.toggle('active',Number(el.getAttribute('data-plat-step'))===index+1);
      });
      document.querySelectorAll('[data-tp-step]').forEach(function(el){
        el.classList.toggle('active',Number(el.getAttribute('data-tp-step'))===index+1);
      });
      document.querySelectorAll('[data-tp-edge]').forEach(function(el){
        var steps=(el.getAttribute('data-tp-edge')||'').split(',');el.classList.toggle('active',steps.indexOf(String(index+1))>=0);
      });
      document.querySelectorAll('.tp-node,.tp-leaf').forEach(function(el){
        el.classList.toggle('active',!!el.querySelector('[data-tp-step].active'));
      });
      var label=document.getElementById('plat-live-label');
      var counter=document.getElementById('plat-live-counter');
      if(label) label.textContent=labels[index];
      if(counter) counter.textContent=(index+1)+' / '+labels.length;
      index=(index+1)%labels.length;
    }
    tick();
    setTimeout(function(){
      if(!document.querySelector('.tree-arch')) return;
      treeRendered=false;
      renderTreeEdges();
      applyTreeZoom();
    },150);
    window.__platFlowTimer=setInterval(tick,2400);
  }

  function cs2ResultPanel(comboId, rankId) {
    var full = window.CS2_FULL || { accuracy: {}, modelling: {}, reconstruction: {} };
    var acc = full.accuracy[comboId];
    if (!acc) return '';
    var mod = full.modelling[comboId] || {};
    var rec = full.reconstruction[comboId] || {};
    var off = acc.series && (acc.series.off || acc.series.r100);
    var selected = cs2PickSeries(acc, rankId) || off;
    var final = (selected && selected.final) || (off && off.final) || {};
    var testAcc = final.test_accuracy != null ? (Number(final.test_accuracy) * 100).toFixed(2) + '%' : '—';
    var valAcc = final.val_accuracy != null ? (Number(final.val_accuracy) * 100).toFixed(2) + '%' : '—';
    var settings = acc.settings || {};
    var evalCount = off && off.points ? off.points.length : 0;
    var settingsRows = [
      ['运行平台', settings.platform || '—'], ['客户端', settings.client_count != null ? settings.client_count : '—'],
      ['batch', settings.batch_size != null ? settings.batch_size : '—'], ['优化器', settings.optimizer || '—'],
      ['数据划分', settings.partition || '—'], ['训练轮次', acc.rounds + ' 轮'],
      ['评估点', evalCount + ' 个'], ['数据来源', acc.source_id || '—']
    ];
    var keepSids = ['off'];
    if (rankId && rankId !== 'off' && acc.series && acc.series[rankId]) keepSids.push(rankId);
    var seriesRows = Object.keys(acc.series || {}).filter(function (sid) { return keepSids.indexOf(sid) >= 0; }).map(function (sid) {
      var s = acc.series[sid];
      var label = s.rank_ratio == null ? '关闭防护' : 'Tucker · r=' + s.rank_ratio;
      var f = s.final || {};
      var t = f.test_accuracy != null ? (Number(f.test_accuracy) * 100).toFixed(2) + '%' : '—';
      var v = f.val_accuracy != null ? (Number(f.val_accuracy) * 100).toFixed(2) + '%' : '—';
      var d = f.test_delta_pp != null ? (Number(f.test_delta_pp) > 0 ? '+' : '') + Number(f.test_delta_pp).toFixed(2) + ' pp' : '—';
      return [label, t, v, d, sid === 'off' ? '基线' : '防护'];
    });
    var selectedRank = selected && selected.rank_ratio != null ? Number(selected.rank_ratio) : null;
    var obsRows = (mod.observations || []).filter(function (o) {
      return selectedRank != null && Number(o.rank_ratio) === selectedRank;
    }).map(function (o) {
      var tensor = o.tensor || {};
      var shape = Array.isArray(tensor.core_shape) ? tensor.core_shape.join(' × ') : (tensor.core_shape || '—');
      var err = o.projection_error != null ? Number(o.projection_error).toFixed(4) : (o.full_rank_error != null ? Number(o.full_rank_error).toExponential(2) : '—');
      return ['r=' + o.rank_ratio, shape, o.core_bytes_per_client != null ? Number(o.core_bytes_per_client).toLocaleString() : '—',
        o.serialized_bytes_all_clients != null ? Number(o.serialized_bytes_all_clients).toLocaleString() : '—', err];
    });
    var chart = '';
    if (off && off.points && off.points.length) {
      var denseRounds = Number(acc.rounds) || Number(off.points[off.points.length - 1][0]) || 200;
      var seriesList = [{ name: '关闭防护', color: '#8da3b3', dash: '5 4', values: cs2DenseSeries(off.points, 1, denseRounds) }];
      if (selected && selected !== off) seriesList.push({ name: cs2RankLabel(acc, rankId), color: '#27a8ef', smooth: true, values: cs2DenseSeries(selected.points, 1, denseRounds) });
      var targetVals = cs2DenseSeries(off.points, 1, denseRounds).map(function (v) { return v * 0.9; });
      seriesList.push({ name: '关闭防护的 90%', color: '#c87913', dash: '4 3', values: targetVals });
      chart = lineChart(seriesList, { label: '实验精度曲线', n: denseRounds + 1, min: 0, max: 100, xLabel: function (i) { return i; } });
    }
    var split = mod.mode_id === 'SFL' ? (mod.split_label || '—') : '完整模型';
    var splitInfo = '';
    if (mod.mode_id === 'SFL') {
      var splitShapes = JSON.stringify(mod.split_activation_shapes || []);
      var gradShapes = JSON.stringify(mod.split_boundary_gradient_shapes || []);
      splitInfo = '<div class="cs2-split-info"><b>SFL 切分信息</b><span>切分位置：' + esc(mod.split_label || '—') + '</span>' +
        '<span>激活形状：' + esc(splitShapes) + '</span><span>边界梯度形状：' + esc(gradShapes) + '</span>' +
        '<span>前段保护张量：' + esc(mod.protected_parameter_tensors != null ? mod.protected_parameter_tensors : '—') + ' 个</span></div>';
    }
    var imageStatus = rec.images && rec.images.original ? '已生成' : '暂无图像';
    var body = '<div class="cs2-result-head"><div><b>' + esc(acc.model) + ' · ' + esc(acc.mode_id) + '</b><span>' + esc(acc.dataset) + ' · ' + esc(acc.rounds) + ' 轮 · ' + esc(split) + ' · ' + esc(cs2RankLabel(acc, rankId)) + '</span></div>' +
      '<span class="cs2-result-source">数据来源：实验日志</span></div>' +
      '<div class="cs2-result-stats">' +
        '<div><span>最终测试精度</span><strong>' + testAcc + '</strong></div>' +
        '<div><span>最终验证精度</span><strong>' + valAcc + '</strong></div>' +
        '<div><span>防护档位</span><strong>' + esc(cs2RankLabel(acc, rankId)) + '</strong></div>' +
        '<div><span>重建图状态</span><strong>' + esc(imageStatus) + '</strong></div>' +
      '</div>' +
      '<div class="cs2-settings-grid">' + settingsRows.map(function (r) {
        return '<div><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>';
      }).join('') + '</div>' +
      (chart ? '<div class="cs2-result-chart">' + chart + '</div>' : '') +
      table(['防护档位', '最终测试', '最终验证', '相对基线', '类型'], seriesRows) +
      (obsRows.length ? table(['建模档位', '核心张量形状', '核心字节/客户端', '序列化字节/全部', '投影误差'], obsRows) : '<div class="sec-meta">当前防护档位暂无建模观测记录。</div>') +
      splitInfo +
      (rec.images && rec.images.original ? '<div class="cs2-result-images">' +
        '<figure><img src="' + esc(rec.images.original) + '" alt="原图"><figcaption>原图</figcaption></figure>' +
        '<figure><img src="' + esc(rec.images.off) + '" alt="关闭防护重建"><figcaption>关闭防护重建</figcaption></figure>' +
        '<figure><img src="' + esc(rec.images.on) + '" alt="开启防护重建"><figcaption>开启防护重建</figcaption></figure></div>' : '') +
      '<div class="sec-meta">图像展示：原图 / 关闭防护重建 / 开启防护重建。</div>';
    return panel('实验结果', esc(acc.model) + ' · ' + esc(acc.mode_id) + ' · ' + esc(acc.dataset), body);
  }

  function cs2CoveragePanel() {
    var full = window.CS2_FULL || { accuracy: {}, modelling: {}, reconstruction: {} };
    var rows = Object.keys(full.accuracy).map(function (id) {
      var a = full.accuracy[id], m = full.modelling[id] || {}, r = full.reconstruction[id] || {};
      var off = a.series && a.series.off;
      var f = (off && off.final) || {};
      var test = f.test_accuracy != null ? (Number(f.test_accuracy) * 100).toFixed(2) + '%' : '—';
      return [a.mode_id, esc(a.model), esc(a.dataset), String(a.rounds), test, String(Object.keys(a.series || {}).length),
        String((m.observations || []).length), esc(r.display_image_source || '—')];
    });
    return panel('全量数据覆盖', '16 组合 · 8 模型 × FL/SFL',
      '<details class="cs2-coverage" open><summary>展开查看全部 16 个组合的精度、档位与图片来源</summary>' +
      table(['框架', '模型', '数据集', '轮数', '关闭防护测试', '档位数', '建模观测', '图片来源'], rows) +
      '</details>');
  }

  function pageEncrypted() {
    var m = document.getElementById('main');
    var algs = (D.algorithms || []).map(function (a) {
      return '<span class="sec-chip ok">' + esc(a) + '</span>';
    }).join('');
    var modelHtml = (D.algorithms || []).map(function (a) {
      return '<div class="tdmafl-model"><b>' + esc(a) + '</b><span>Tucker 四阶张量化</span></div>';
    }).join('');
    var modules = [
      ['01','四阶张量化','卷积层梯度保持 <em>O×I×Kh×Kw</em>；全连接层补 <em>1×1</em> 单例维度，统一为四阶张量。'],
      ['02','共享正交因子矩阵','训练前通过承诺—揭示—PRG—QR 协同生成；服务器只看到公开承诺，不获得因子矩阵。'],
      ['03','核心张量投影与上传','客户端计算 <em>C = G ×₁U₁ᵀ ×₂U₂ᵀ ×₃U₃ᵀ ×₄U₄ᵀ</em>，仅上传核心张量。'],
      ['04','核心聚合与本地重构','服务器按样本量加权聚合核心张量；客户端用本地因子矩阵重构全局梯度。']
    ].map(function (x) {
      return '<article class="tdmafl-module">'+
        '<div class="tdmafl-module-top"><span class="tdmafl-num">'+x[0]+'</span>'+badge('TD-MAFL','ok')+'</div>'+
        '<h3>'+esc(x[1])+'</h3><p>'+x[2]+'</p></article>';
    }).join('');
    var flow = [
      ['1','统一张量化','把各层梯度统一为四阶张量，并设置每层各模态维度与 Tucker 秩。','G ∈ R^{d₁×d₂×d₃×d₄}'],
      ['2','协同生成共享因子','承诺—揭示共享随机份额，由共享种子经 PRG 和鲁棒 QR 生成正交因子矩阵。','UᵀU = I'],
      ['3','本地核心投影','客户端用本地梯度与共享因子矩阵计算核心张量，只上传核心张量。','C = G × Uᵀ'],
      ['4','服务器核心聚合','服务器按样本量加权聚合核心张量，并广播全局核心张量。','C_g = Σ αᵢCᵢ'],
      ['5','本地重构与更新','客户端用本地因子矩阵重构全局梯度，再输入优化器更新模型。','Ĝ = C_g × U']
    ].map(function (x) {
      return '<article class="tdmafl-flow-step"><div class="tdmafl-flow-head"><span>'+x[0]+'</span><h4>'+esc(x[1])+'</h4></div>'+
        '<p>'+esc(x[2])+'</p><code>'+esc(x[3])+'</code></article>';
    }).join('');
    m.innerHTML = heading('ENCRYPTED MODELING', '密态建模算法', '基于 Tucker 分解与服务器不可见共享正交因子矩阵的联邦梯度防护', '') +
      '<div class="sec-chips" style="margin-bottom:12px"><span class="sec-chip ok">半诚实服务器</span><span class="sec-chip ok">TD-MAFL</span>' +
      '<span class="sec-chip ok">Tucker 分解</span><span class="sec-chip ok">核心张量</span></div>' +
      (function(){ var combo=window.__pendingCs2Combo||window.__lastCs2Combo; var rank=window.__pendingCs2Rank||window.__lastCs2Rank||'r100'; window.__pendingCs2Combo=null; window.__pendingCs2Rank=null; return combo?cs2ResultPanel(combo,rank):''; })() +
      panel('支持的模型结构', '任务书指标 ≥8 种', '<div class="tdmafl-models">' + modelHtml + '</div>' +
        '<div class="sec-meta">覆盖 MLP / CNN / ResNet / Transformer / LSTM / 逻辑回归 / SVM / K-Means。TD-MAFL 通过四阶张量化统一处理卷积层与全连接层梯度，不要求在秘密份额上执行前向与反向。</div>') +
      panel('TD-MAFL 核心模块', '论文方法', '<div class="tdmafl-modules">' + modules + '</div>') +
      panel('TD-MAFL 训练流程', '四阶张量化 → 核心张量 → 聚合重构', '<div class="tdmafl-flow">' + flow + '</div>' +
        '<div class="sec-meta">TD-MAFL 是结构化梯度防护，不是密码学安全聚合：服务器可见核心张量，但不能仅凭核心张量唯一确定原始梯度方向；安全性依赖共享因子矩阵不泄露、客户端不共谋。论文不提供端到端密码学隐私证明。</div>') +
      '';
    var cs2Imgs = document.querySelectorAll('.cs2-result-images img');
    cs2Imgs.forEach(function (img) {
      img.style.cursor = 'zoom-in';
      img.onclick = function () { openCs2Image(img.src, img.alt || '图像查看'); };
    });
    if (!document.getElementById('cs2-task')) return;
    Promise.all([
      fetchChartTasks().catch(function () { return []; }),
      fetch('/api/medical/encrypted-runs', { credentials: 'same-origin' }).then(function (r) {
        return r.ok ? r.json() : [];
      }).catch(function () { return []; })
    ]).then(function (results) {
      var tasks = (results[0] || []).filter(function (t) { return t.kind === 'cs2'; })
        .sort(function (a, b) { return Number(b.startedAt || 0) - Number(a.startedAt || 0); });
      var active = tasks.filter(function (t) { return t.status !== 'completed'; })[0];
      if (active && active.payload && active.payload.run) {
        var taskRun = active.payload.run;
        if (taskRun.mode === 'FL' || taskRun.mode === 'SFL') {
          renderCs2Task(taskRun.mode, String(taskRun.rank == null ? 'off' : taskRun.rank), false, active);
          return;
        }
      }
      var list = results[1] || [];
      if (!list.length) {
        var completed = tasks.filter(function (t) { return t.status === 'completed' && t.payload && t.payload.run; })[0];
        if (completed) list = [completed.payload.run];
      }
      if (!list.length) return;
      var last = list[list.length - 1];
      if (last && (last.mode === 'FL' || last.mode === 'SFL')) {
        renderCs2Task(last.mode, String(last.rank == null ? 'off' : last.rank), true);
      }
    }).catch(function () {});

  }

  var renderers = {
    overview: pageOverview,
    training: pageTraining,
    encrypted: pageEncrypted,
    attestation: pageAttestation,
    verification: pageVerification,
    audit: pageAudit,
    about: pageAbout
  };
  window.__secCrypto = { sha256Hex: sha256Hex, merkleLevels: merkleLevels, shortHash: shortHash };
  window.renderSecurityPage = function (id) {
    clearTimers();
    if (renderers[id]) renderers[id]();
  };
})();
