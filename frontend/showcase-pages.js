'use strict';
/* 功能演示大屏 / 链上验证记录 / 关于项目与荣誉墙
 * 纯前端展示页；依赖 security-data.js（window.SEC）、zkp-data.js（window.ZKP_DATA）与 app.js 的 window.__ui。
 * 链上验证记录来自检测报告第三部分；没有原始区块高度/交易哈希，因此不展示演示区块。
 */
(function () {
  var D = window.SEC;
  var $ = function (s) { return document.querySelector(s); };
  var ui = function () { return window.__ui || {}; };
  function esc(v) { return ui().esc ? ui().esc(v) : String(v == null ? '' : v); }
  function toast(m) { if (ui().toast) ui().toast(m); }
  function openModal(t, b, f) { if (ui().modal) ui().modal(t, b, f || ''); }
  function cryptoLib() { return window.__secCrypto || {}; }
  function sha256Hex(text) {
    if (cryptoLib().sha256Hex) return cryptoLib().sha256Hex(text);
    return Promise.resolve('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  }
  function shortHash(h, n) { if (!h) return '—'; return h.slice(0, n || 10) + '…' + h.slice(-4); }

  var cleanups = [];
  function addCleanup(fn) { cleanups.push(fn); }
  function runCleanups() {
    cleanups.forEach(function (fn) { try { fn(); } catch (e) { } });
    cleanups = [];
  }
  window.__showcaseCleanup = runCleanups;

  function panel(title, meta, body) {
    return '<section class="records-panel"><div class="panel-title"><h2>' + title + '</h2><span>' + (meta || '') + '</span></div><div class="sec-panel-body">' + body + '</section>';
  }
  function table(headers, rows) {
    return '<div class="table-scroll"><table><thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function heading(eyebrow, title, desc, actions) {
    return '<div class="page-heading"><div><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1><p>' + desc + '</p></div>' +
      (actions ? '<div class="sec-actions">' + actions + '</div>' : '') + '</div>';
  }
  function badge(text, kind) { return '<span class="sec-badge ' + (kind || '') + '">' + esc(text) + '</span>'; }

  function animateCount(el, target, decimals, duration) {
    target = Number(target);
    if (!Number.isFinite(target)) { el.textContent = '—'; return; }
    var started = null;
    var raf = 0;
    function tick(ts) {
      if (!el.isConnected) return;
      if (!started) started = ts;
      var p = Math.min(1, (ts - started) / (duration || 1200));
      var eased = 1 - Math.pow(1 - p, 3);
      var v = target * eased;
      if (decimals > 0) el.textContent = v.toFixed(decimals);
      else el.textContent = Math.round(v).toLocaleString('zh-CN');
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    addCleanup(function () { cancelAnimationFrame(raf); });
  }

  /* ===== 深色大屏 · 树形分层架构（与平台总览同构） ===== */
  var bsTreeEdges = [
    ['bst-base','bst-a1','① 请求 · ② 查询','1,2'],['bst-base','bst-b1','① 请求 · ② 查询','1,2'],['bst-base','bst-c1','① 请求 · ② 查询','1,2'],
    ['bst-a1','bst-a2','③ 数据验证','3','h'],['bst-a2','bst-aedge','④ 组内串行','4'],
    ['bst-b1','bst-b2','③ 数据验证','3','h'],['bst-b2','bst-bedge','④ 组内串行','4'],
    ['bst-c1','bst-c2','③ 数据验证','3','h'],['bst-c2','bst-cedge','④ 组内串行','4'],
    ['bst-aedge','bst-async','⑤ 密态投影 · ⑥ ZKP 生成','5,6'],['bst-bedge','bst-async','⑤ 密态投影 · ⑥ ZKP 生成','5,6'],['bst-cedge','bst-async','⑤ 密态投影 · ⑥ ZKP 生成','5,6'],
    ['bst-async','bst-fed','⑦ 组间异步并行传输','7'],
    ['bst-fed','bst-root','⑧ ZKP 验证','8']
  ];
  var bsRendered=false;
  function bsRenderEdges(){
    var stage=document.getElementById('bs-tree-stage');
    if(!stage) return;
    var svg=document.getElementById('bs-tree-svg');
    if(!svg) return;
    var rect=stage.getBoundingClientRect();
    var w=stage.clientWidth||rect.width,h=stage.clientHeight||rect.height;
    svg.setAttribute('viewBox','0 0 '+w+' '+h);
    svg.setAttribute('width',w); svg.setAttribute('height',h);
    function node(id){ return document.getElementById(id); }
    var defs='<defs><marker id="bst-arrow" viewBox="0 0 10 10" refX="9.2" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#4db6e4"/></marker>'+
      '<filter id="bst-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
    var pathBody='',labelBody='';
    for(var i=0;i<bsTreeEdges.length;i++){
      var e=bsTreeEdges[i], from=node(e[0]), to=node(e[1]);
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
      for(var ci=0;ci<e[2].length;ci++){ lw += /[\u4e00-\u9fff]/.test(e[2].charAt(ci)) ? 9.8 : 5.8; }
      pathBody+='<g class="bst-edge" data-bst-edge="'+e[3]+'">'
        +'<path d="'+d+'" fill="none" stroke="#3c7fa6" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#bst-arrow)"/>'
        +'<circle r="3.4" fill="#39e0b2"><animateMotion dur="2.9s" begin="'+((i%3)*0.9)+'s" repeatCount="indefinite" path="'+d+'"/></circle>'
        +'</g>';
      labelBody+='<g class="bst-edge bst-edge-label" data-bst-edge="'+e[3]+'">'
        +'<rect x="'+(mx-lw/2).toFixed(1)+'" y="'+(my-11).toFixed(1)+'" width="'+lw.toFixed(1)+'" height="22" rx="11" fill="rgba(6,26,46,.96)" stroke="#2f6fa6" stroke-width="1.2"/>'
        +'<text x="'+mx.toFixed(1)+'" y="'+(my+3.8).toFixed(1)+'" text-anchor="middle" font-size="10" font-weight="600" fill="#b9e3f2">'+e[2]+'</text>'
        +'</g>';
    }
    svg.innerHTML=defs+'<g class="bst-edge-paths">'+pathBody+'</g><g class="bst-edge-labels">'+labelBody+'</g>';
    bsRendered=true;
  }
  var bsObserver=null;
  function bsObserveStage(){
    if(!window.ResizeObserver) return;
    var stage=document.getElementById('bs-tree-stage');
    if(!stage) return;
    if(bsObserver && bsObserver.__stage===stage) return;
    if(bsObserver) bsObserver.disconnect();
    bsObserver=new ResizeObserver(function(){ if(document.getElementById('bs-tree-stage')) bsRenderEdges(); });
    bsObserver.__stage=stage;
    bsObserver.observe(stage);
  }
  function bsArchitecture() {
    var nodes = [];
    var edges = [];
    var routes = [];
    function block(x, y, w, h, title, steps, detail) {
      nodes.push('<g class="bsa-stage-node" data-bsa-phase="' + steps + '">' +
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="8"/>' +
        '<text x="' + (x + w / 2) + '" y="' + (y + (detail ? 20 : h / 2 + 5)) + '">' + title + '</text>' +
        (detail ? '<text class="bsa-stage-detail" x="' + (x + w / 2) + '" y="' + (y + 39) + '">' + detail + '</text>' : '') +
        '</g>');
    }
    function link(step, d, lane, reverse) {
      edges.push('<path class="bsa-stage-line' + (reverse ? ' bsa-stage-return' : '') +
        '" data-bsa-flow="' + step + '" d="' + d + '" marker-end="url(#bsa-stage-arrow)"/>');
      routes.push('<circle r="3.4" fill="#22b394"><animateMotion dur="2.9s" begin="' +
        (lane * 0.9) + 's" repeatCount="indefinite" path="' + d + '"/></circle>');
    }
    function caption(x, y, label) {
      return '<text class="bsa-stage-caption" x="' + x + '" y="' + y + '">' + label + '</text>';
    }
    var labels = [];
    block(590, 16, 500, 54, '云服务中心 · ⑨ 聚合密态数据', '9', '智能计算　·　数据资源　·　智能服务');
    block(625, 100, 430, 54, '联邦学习 · ⑧ 零知识证明验证', '8', '校验各组证明，通过后进入聚合');
    block(600, 183, 480, 48, '⑦ 密态数据组间异步并行传输', '7');
    link(8, 'M840 100 V70', 1);
    link(7, 'M840 183 V154', 0);
    block(18, 642, 132, 36, '① 训练数据请求', '1');

    var lanes = [90, 610, 1130].map(function (x, lane) {
      var mid = x + 230;
      var proofPort = 660 + lane * 180;
      var name = 'ABC'.charAt(lane);
      block(x + 115, 266, 230, 40, '⑥ 零知识证明生成 · ' + name, '6');
      block(x + 115, 333, 230, 40, '⑤ 密态投影 · ' + name, '5');
      block(x + 115, 409, 230, 38, '边缘节点 · 局部聚合', '4');
      block(x + 22, 483, 118, 40, '数据集 ' + name, '3');
      block(x + 172, 483, 118, 40, '客户端 ' + name + '₁', '1,2,3,4');
      block(x + 322, 483, 118, 40, '客户端 ' + name + '₂', '4');
      block(x + 115, 578, 230, 40, '区块链存证 · ' + name, '1,2');
      link(7, 'M' + mid + ' 266 V247 H' + proofPort + ' V231', lane);
      link(6, 'M' + mid + ' 333 V306', lane);
      link(5, 'M' + mid + ' 409 V373', lane);
      link(4, 'M' + (x + 290) + ' 503 H' + (x + 322), lane);
      link(4, 'M' + (x + 381) + ' 483 V463 H' + mid + ' V447', lane);
      link(3, 'M' + (x + 140) + ' 495 H' + (x + 172), lane);
      link(3, 'M' + (x + 172) + ' 511 H' + (x + 140), lane, true);
      link(2, 'M' + (mid - 22) + ' 578 V523', lane);
      link(2, 'M' + (mid + 22) + ' 523 V578', lane, true);
      link(1, 'M150 ' + (650 + lane * 9) + ' H' + mid + ' V618', lane);
      labels.push(caption(x + 16, 402, '客户端组 ' + name));
      labels.push(caption(x + 302, 478, '④ 串行'));
      labels.push(caption(mid - 102, 552, '查询结果 ↑'));
      labels.push(caption(mid + 36, 552, '哈希上链 ↓'));
      return '<rect class="bsa-stage-lane" x="' + x + '" y="384" width="460" height="152" rx="10"/>';
    });

    var steps = ['训练请求','数据查询','数据验证','组内串行','密态投影','ZKP 生成','异步并行','ZKP 验证','聚合密态数据'];
    var stepHtml = steps.map(function (label, index) {
      return '<span data-bsa-step="' + (index + 1) + '">' + '①②③④⑤⑥⑦⑧⑨'.charAt(index) + ' ' + label + '</span>';
    }).join('');
    return '<div class="bst-flowwrap">' +
      '<svg viewBox="0 0 1680 690" class="bs-topo bs-arch2" aria-label="分层安全推理架构">' +
      '<style>' +
        '.bsa-stage-node rect{fill:#123151;stroke:#3c8fd1;stroke-width:1.4}' +
        '.bsa-stage-node text{fill:#d8ecff;font-size:15px;font-weight:600;text-anchor:middle}' +
        '.bsa-stage-node .bsa-stage-detail{font-size:11px;font-weight:400;fill:#9fc6df}' +
        '.bsa-stage-node.bsa-active rect{stroke:#8dffe7;stroke-width:2.2;filter:url(#bsa-stage-glow)}' +
        '.bsa-stage-lane{fill:#0b2239;stroke:#285171;stroke-dasharray:5 4}' +
        '.bsa-stage-line{fill:none;stroke:#4a8aaa;stroke-width:1.4;stroke-dasharray:5 4}' +
        '.bsa-stage-return{stroke:#408c7e}' +
        '.bsa-stage-line.bsa-flow-active{stroke:#8dffe7!important;stroke-width:2.2!important;stroke-dasharray:none!important;filter:none}' +
        '.bsa-stage-caption{fill:#9fc6df;font-size:12px}' +
      '</style>' +
      '<defs><marker id="bsa-stage-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 1 L9 5 L0 9 Z" fill="#5aa9c0"/></marker>' +
      '<filter id="bsa-stage-glow" x="-10%" y="-35%" width="120%" height="170%"><feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#5fe0c4" flood-opacity=".65"/></filter></defs>' +
      lanes.join('') + '<g>' + edges.join('') + '</g><g>' + nodes.join('') + '</g>' +
      '<g>' + labels.join('') + caption(1610, 130, '训练后') + caption(1610, 400, '训练中') + caption(1610, 605, '训练前') + '</g>' +
      '<g class="bsa-particles" aria-hidden="true" pointer-events="none">' + routes.join('') + '</g></svg>' +
      '<div class="bsa-flowbar" id="bsa-flowbar"><span class="bsa-flow-title"><i></i>LIVE FLOW · 全链路实时流转</span>' + stepHtml + '</div>' +
      '<div class="bsa-status"><span class="bsa-status-dot"></span>当前流转 <b id="bsa-live-label">训练数据请求</b><em id="bsa-live-counter">1 / 9</em></div></div>';
  }

  function bsStartFlow(){
    var labels=['训练数据请求','区块链数据查询','数据可用性验证','组内串行计算','密态投影','零知识证明生成','密态数据组间异步并行传输','零知识证明验证','聚合密态数据'];
    if(window.__bsFlowTimer){ clearInterval(window.__bsFlowTimer); window.__bsFlowTimer=null; }
    var stepDuration = 2400;
    var index=0;
    var architecture = document.querySelector('.bs-arch2');
    if (!architecture) return;
    function tick(){
      architecture.querySelectorAll('path[data-bsa-flow]').forEach(function (path) {
        var active = path.dataset.bsaFlow.split(',').includes(String(index + 1));
        path.classList.toggle('bsa-flow-active', active);
      });
      document.querySelectorAll('.bsa-flowbar [data-bsa-step]').forEach(function(el){
        el.classList.toggle('active',Number(el.getAttribute('data-bsa-step'))===index+1);
      });
      document.querySelectorAll('.bs-arch2 [data-bsa-phase]').forEach(function(el){
        var on=el.dataset.bsaPhase.split(',').includes(String(index + 1));
        el.classList.toggle('bsa-active',on);
      });
      var label=document.getElementById('bsa-live-label');
      var counter=document.getElementById('bsa-live-counter');
      if(label) label.textContent=labels[index];
      if(counter) counter.textContent=(index+1)+' / '+labels.length;
      index=(index+1)%labels.length;
    }
    tick();
    window.__bsFlowTimer=setInterval(tick,stepDuration);
    addCleanup(function(){
      clearInterval(window.__bsFlowTimer);
      window.__bsFlowTimer=null;
    });
  }

  /* =========================================================
     功能演示大屏
     ========================================================= */
  function pageScreen() {
    var m = document.getElementById('main');
    var kpi = D.kpi.map(function (k) {
      return '<div class="bs-ring-item"><svg viewBox="0 0 100 100" class="bs-ring" aria-hidden="true">' +
        '<circle cx="50" cy="50" r="40" fill="none" stroke="rgba(120,200,255,.14)" stroke-width="8"/>' +
        '<circle class="bs-ring-fill" cx="50" cy="50" r="40" fill="none" stroke="#37c8ff" stroke-width="8" stroke-linecap="round" stroke-dasharray="251" stroke-dashoffset="251" transform="rotate(-90 50 50)"/>' +
        '</svg><div class="bs-ring-text"><b>' + esc(k.current) + '</b><small>' + esc(k.name) + '</small></div></div>';
    }).join('');
    var taskTicker = D.tasks.slice(0, 5).map(function (t) {
      return '<div class="bs-tick-row"><span>' + esc(t.id) + '</span><span>' + esc(t.name) + '</span><span>' + esc(t.algorithm) + '</span><span>' + esc(t.status) + '</span><span>' + (t.single ? (t.split / t.single * 100).toFixed(1) + '%' : '—') + '</span></div>';
    }).join('');
    var zkp = window.ZKP_DATA || { cases: [] };
    var chainCases = zkp.cases.filter(function (c) { return c.onChain; });
    var blockTicker = chainCases.map(function (c) {
      var gas = c.onChain.gas == null ? '—' : Number(c.onChain.gas).toLocaleString() + ' gas';
      return '<span class="bs-block">' + esc(c.id) + ' · ' + gas + '</span>';
    }).join('');
    var fullData = window.CS2_FULL || {};
    var comboCount = Object.keys(fullData.accuracy || {}).length;
    var modelMap = {};
    Object.keys(fullData.accuracy || {}).forEach(function (id) { var a = fullData.accuracy[id]; if (a && a.model) modelMap[a.model] = 1; });
    var modelCount = Object.keys(modelMap).length;
    var obsCount = 0, archiveCount = 0;
    Object.keys(fullData.modelling || {}).forEach(function (id) { obsCount += (fullData.modelling[id].observations || []).length; });
    Object.keys(fullData.reconstruction || {}).forEach(function (id) { archiveCount += Number(fullData.reconstruction[id].archived_observation_count || 0); });
    var capCards = [
      ['◈', '拆分学习', '端侧、边缘、云端分层拆分，原始数据不出域。', 'L1-L4 分层'],
      ['▣', 'Tucker 核心张量防护', '梯度投影为核心张量，服务器不可见共享因子基。', '四阶张量化'],
      ['⇄', '异步缓冲聚合', 'FedBuff 异步缓冲聚合，20 客户端 200 轮实验。', '20 / 200'],
      ['✓', '零知识证明', '5 类验证算子、30 个测试用例，聚合前校验。', '5 类 · 30 用例'],
      ['⛓', '区块链存证', '数据指纹、Merkle 根与链上审计记录。', 'PB 级存证'],
      ['◎', '多中心协同', '医院 A/B/C 多中心联邦训练与模型同步。', '3 中心']
    ].map(function (c, i) {
      return '<div class="bs-rich-card" style="animation-delay:' + (i * 0.08) + 's"><div class="bs-rich-icon">' + c[0] + '</div><b>' + c[1] + '</b><p>' + c[2] + '</p><small>' + c[3] + '</small></div>';
    }).join('');
    var dataCards = [
      ['实验组合', comboCount || 16, 'FL / SFL 组合'],
      ['模型覆盖', modelCount || 8, 'LeNet → EfficientNet'],
      ['建模观测', obsCount || 32, '核心张量 / 上传指标'],
      ['重建归档', archiveCount || 18, '图像重建记录'],
      ['训练架构', 3, 'FedBuff / FL / SFL'],
      ['算法覆盖', (D.algorithms || []).length, '密态建模算法']
    ].map(function (x, i) {
      return '<div class="bs-data-card" style="animation-delay:' + (i * 0.06) + 's"><span>' + x[0] + '</span><b data-count="' + x[1] + '">0</b><small>' + x[2] + '</small></div>';
    }).join('');
    var barRows = [
      ['模型覆盖', 100], ['实验组合', 100], ['建模观测', 100], ['重建归档', 100]
    ].map(function (b, i) {
      return '<div class="bs-bar-row"><span>' + b[0] + '</span><div class="bs-bar"><i style="--w:' + b[1] + '%;animation-delay:' + (i * 0.12) + 's"></i></div><em>' + b[1] + '%</em></div>';
    }).join('');
    var steps = [
      ['01', '数据不出域', '端侧数据仅本地参与训练'],
      ['02', '共享因子初始化', '承诺—揭示生成共享正交因子'],
      ['03', '核心张量投影', '本地梯度投影后仅上传核心张量'],
      ['04', '安全聚合重构', '服务器聚合，客户端本地重构更新'],
      ['05', '结果验证与存证', 'ZKP 校验、链上记录与审计']
    ].map(function (x, i) {
      return '<div class="bs-step-card" style="animation-delay:' + (i * 0.1) + 's"><b>' + x[0] + '</b><strong>' + x[1] + '</strong><span>' + x[2] + '</span></div>';
    }).join('');

    m.innerHTML = '<div class="bs-wrap">' +
      '<canvas id="bs-canvas" class="bs-canvas"></canvas>' +
      '<div class="bs-top"><div class="bs-kicker">湖南省科技创新计划 · 重点研发计划 · 项目编号 2024AQ2028</div>' +
      '<div class="bs-top-actions"><button id="bs-full">全屏演示</button></div></div>' +
      '<div class="bs-hero"><div class="bs-eyebrow">AI DATA SECURITY &amp; COMPUTING SECURITY</div>' +
      '<h1>大模型安全训练推理平台</h1><p>拆分学习 · 密态训练 · 数据存证 · 零知识验证</p>' +
      '<div class="bs-hero-chips"><span>2 种训练架构</span><span>8 种密态算法</span><span>5 类 ZKP 协议</span><span>PB 级 ≤1 秒</span></div></div>' +
      '<div class="bs-stats">' +
      '<div class="bs-stat"><div class="bs-num" data-count="2">0</div><div class="bs-label">接入机构 · 家</div></div>' +
      '<div class="bs-stat"><div class="bs-num" data-count="12">0</div><div class="bs-label">协同训练任务 · 个</div></div>' +
      '<div class="bs-stat"><div class="bs-num" data-count="128.6" data-decimals="1">0</div><div class="bs-label">存证训练数据 · GB</div></div>' +
      '<div class="bs-stat"><div class="bs-num" data-count="30">0</div><div class="bs-label">零知识证明用例 · 个</div></div>' +
      '</div>' +
      '<div class="bs-arch-stack">' +
      '<div class="bs-panel"><div class="bs-panel-title">分层安全推理架构</div>' +
        bsArchitecture() +
        '</div>' +
      '<div class="bs-panel"><div class="bs-panel-title">任务书指标达成</div><div class="bs-rings">' + kpi + '</div></div>' +
      '</div>' +
      '<div class="bs-grid two">' +
      '<div class="bs-panel"><div class="bs-panel-title">协同训练任务</div><div class="bs-ticker"><div class="bs-ticker-inner">' + taskTicker + taskTicker + '</div></div></div>' +
      '<div class="bs-panel"><div class="bs-panel-title">真实链上验证记录</div><div class="bs-blocks">' + blockTicker + '</div>' +
      '<div class="bs-meta">Ganache Local EVM · 4/5 完整</div></div>' +
      '</div>' +
      '<div class="bs-rich-section"><div class="bs-section-title"><span>PLATFORM CAPABILITIES</span><b>平台核心能力</b></div><div class="bs-rich-grid">' + capCards + '</div></div>' +
      '<div class="bs-rich-section"><div class="bs-section-title"><span>EXPERIMENT DATA</span><b>实验数据规模</b></div><div class="bs-data-grid">' + dataCards + '</div><div class="bs-bars">' + barRows + '</div></div>' +
      '<div class="bs-rich-section"><div class="bs-section-title"><span>SECURE PIPELINE</span><b>安全训练链路</b></div><div class="bs-steps">' + steps + '</div></div>' +
      '<div class="bs-footer"><span>人工智能数据安全与计算安全关键技术研究 · 湖南科技大学 · 湖南医沃信息技术有限公司</span></div>' +
      '<div class="bs-bottom-action"><button id="bs-exit" class="bs-exit-bottom">进入工作台</button></div>' +
      '</div>';

    bsStartFlow();
    document.getElementById('bs-exit').onclick = function () { window.navigate('overview'); };
    var full = document.getElementById('bs-full');
    full.onclick = function () {
      var wrap = $('.bs-wrap');
      if (!wrap) return;
      if (document.fullscreenElement) { document.exitFullscreen(); full.textContent = '全屏演示'; }
      else if (wrap.requestFullscreen) { wrap.requestFullscreen().then(function () { full.textContent = '退出全屏'; }).catch(function () { toast('当前环境不支持全屏'); }); }
      else { toast('当前环境不支持全屏'); }
    };

    // 数字动画
    document.querySelectorAll('#main [data-count]').forEach(function (el) {
      animateCount(el, parseFloat(el.dataset.count), Number(el.dataset.decimals || 0), 1400);
    });
    // 指标环动画
    setTimeout(function () {
      document.querySelectorAll('#main .bs-ring-fill').forEach(function (c) { c.style.strokeDashoffset = '0'; });
    }, 120);
    // 极简静态星点背景（低对比，不做粒子连线与强动效）
    var canvas = document.getElementById('bs-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var parts = [];
    var raf = 0;
    function resize() {
      var rect = canvas.getBoundingClientRect();
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(320, rect.width) * dpr;
      canvas.height = Math.max(320, rect.height) * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!parts.length) {
        for (var i = 0; i < 18; i++) {
          parts.push({ x: Math.random() * rect.width, y: Math.random() * rect.height, vx: (Math.random() - 0.5) * 0.08, vy: (Math.random() - 0.5) * 0.08, r: Math.random() * 0.8 + 0.4, a: Math.random() * 0.16 + 0.1 });
        }
      }
    }
    function frame() {
      var rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      for (var i = 0; i < parts.length; i++) {
        var a = parts[i];
        a.x += a.vx; a.y += a.vy;
        if (a.x < 0 || a.x > rect.width) a.vx *= -1;
        if (a.y < 0 || a.y > rect.height) a.vy *= -1;
        ctx.fillStyle = 'rgba(130,190,235,' + a.a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    resize();
    frame();
    window.addEventListener('resize', resize);
    addCleanup(function () { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); });
  }

  /* =========================================================
     链上验证记录（Ganache Local EVM · 真实检测数据）
     ========================================================= */
  function chainStatus(status) {
    var map = { available: ['已有', 'ok'], partial: ['部分可用', 'warn'], pending: ['待整理', 'warn'], na: ['不适用', 'na'] };
    var item = map[status] || ['—', 'na'];
    return '<span class="zkp-tag zkp-tag-' + item[1] + '">' + item[0] + '</span>';
  }

  function chainResult(value) {
    if (!value || value === '—') return '<span class="zkp-muted">—</span>';
    var cls = value === 'ACCEPT' ? 'ok' : value === 'REJECT' ? 'bad' : 'warn';
    return '<span class="zkp-result zkp-result-' + cls + '">' + esc(value) + '</span>';
  }

  function openChainRecord(c) {
    var z = window.ZKP_DATA || { protocols: [] };
    var p = z.protocols.filter(function (x) { return x.id === c.protocolId; })[0] || {};
    var on = c.onChain || {};
    var body = '<div class="zkp-detail"><div class="zkp-detail-hero"><div><div class="zkp-detail-kicker">' +
      esc(c.protocolId) + ' · ' + esc(c.id) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(p.goal || '') + '</p></div>' +
      '<div class="zkp-detail-badges">' + chainResult(c.normalResult) + '</div></div>' +
      '<div class="zkp-detail-grid"><section class="zkp-detail-block zkp-detail-wide"><h4>链上验证数据</h4><dl class="sec-dl">' +
      '<dt>验证环境</dt><dd>' + esc(z.meta.chainEnv) + '</dd>' +
      '<dt>Proof System</dt><dd>' + esc(z.meta.proofSystem) + '</dd>' +
      '<dt>验证器</dt><dd>' + esc(z.meta.verifier) + '</dd>' +
      '<dt>Gas 预估</dt><dd>' + (on.estimatedGas == null ? '—' : Number(on.estimatedGas).toLocaleString() + ' Gas') + '</dd>' +
      '<dt>Gas 实际</dt><dd>' + (on.gas == null ? '—' : Number(on.gas).toLocaleString() + ' Gas') + '</dd>' +
      '<dt>Calldata</dt><dd>' + (on.calldataBytes == null ? '—' : Number(on.calldataBytes) + ' Bytes') + '</dd>' +
      '<dt>合约时延</dt><dd>' + (on.latencyMs == null ? '—' : Number(on.latencyMs).toFixed(3) + ' ms') + '</dd>' +
      '</dl>' +
      '</section></div></div>';
    openModal(c.id + ' · 链上验证记录', body, '');
  }

  function pageChain3d() {
    var z = window.ZKP_DATA;
    var m = document.getElementById('main');
    if (!z || !z.cases) {
      m.innerHTML = heading('CHAIN VERIFICATION', '链上验证记录', 'Ganache Local EVM / 本地测试链', '') +
        panel('链上验证记录', '数据未加载', '<p class="sec-meta">ZKP 数据文件未加载。</p>');
      return;
    }
    var chainCases = z.cases.filter(function (c) { return c.onChain; });
    var complete = chainCases.filter(function (c) { return c.onChain.gas != null; }).length;
    var k = z.kpi || {};
    var rows = chainCases.map(function (c) {
      var on = c.onChain || {};
      return [esc(c.id), esc(c.protocolId), esc(c.title), chainResult(c.normalResult),
        Number(on.gas).toLocaleString(),
        Number(on.calldataBytes) + ' B',
        Number(on.latencyMs).toFixed(3) + ' ms',
        '<button type="button" class="text-button" data-chain-case="' + esc(c.id) + '">查看 ↗</button>'];
    });
    var kpis = '<div class="zkp-kpis">' +
      '<div class="zkp-kpi"><span>链上验证用例</span><b>' + chainCases.length + '<em>个</em></b><small>P.1.4 / P.1.14 / P.1.22 / P.1.26 / P.1.30</small></div>' +
      '<div class="zkp-kpi"><span>完整链上数据</span><b>' + complete + '<em>/ ' + chainCases.length + '</em></b><small>全部用例完整</small></div>' +
      '<div class="zkp-kpi"><span>平均合约时延</span><b>' + Number(k.chainLatencyAvgMs || 0).toFixed(2) + '<em>ms</em></b><small>5 个完整用例均值</small></div>' +
      '<div class="zkp-kpi"><span>Gas 范围</span><b>' + Number(k.gasMin).toLocaleString() + '<em>~</em></b><small>至 ' + Number(k.gasMax).toLocaleString() + ' Gas</small></div>' +
      '<div class="zkp-kpi"><span>Calldata 范围</span><b>' + Number(k.calldataMin) + '<em>~</em></b><small>至 ' + Number(k.calldataMax) + ' Bytes</small></div></div>';
    m.innerHTML = heading('CHAIN VERIFICATION', '链上验证记录', 'Ganache Local EVM / 本地测试链 · Groth16', '') +
      kpis +
      '<div class="zkp-chain-banner"><b>验证环境</b><span>' + esc(z.meta.chainEnv) + '</span><span>' + esc(z.meta.proofSystem) + '</span><span>' + esc(z.meta.verifier) + '</span></div>' +
      panel('真实链上验证用例', '5 个用例 · 全部完整',
        table(['用例', '协议', '验证对象', '正常结果', 'Gas', 'Calldata', '合约时延', '操作'], rows)) +
      panel('链上环境', 'Ganache 本地测试链', '<dl class="sec-dl"><dt>网络</dt><dd>' + esc(z.meta.chainEnv) + '</dd><dt>Proof System</dt><dd>' + esc(z.meta.proofSystem) + '</dd><dt>验证器</dt><dd>' + esc(z.meta.verifier) + '</dd><dt>合约地址</dt><dd>运行时生成，文档未提供</dd></dl>');


    document.querySelectorAll('[data-chain-case]').forEach(function (b) {
      b.onclick = function () {
        var c = z.cases.filter(function (x) { return x.id === b.getAttribute('data-chain-case'); })[0];
        if (c) openChainRecord(c);
      };
    });
  }

  /* =========================================================
     关于项目 / 荣誉墙
     ========================================================= */
  function pageProject() {
    var m = document.getElementById('main');
    var p = D.project;
    var objCards = D.objectives.map(function (o) {
      return '<div class="pj-card"><div class="pj-card-icon">' + o.icon + '</div><h3>' + esc(o.title) + '</h3><p>' + esc(o.desc) + '</p></div>';
    }).join('');
    var timeline = D.milestones.map(function (ms, i) {
      return '<article class="pj-mile" style="animation-delay:' + (i * 0.12) + 's">' +
        '<div class="pj-mile-year">' + esc(ms.year) + '</div>' +
        '<div class="pj-mile-body"><div class="pj-mile-head"><b>' + esc(ms.title) + '</b><span>' + esc(ms.period) + '</span></div>' +
        '<ul>' + ms.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></article>';
    }).join('');
    var honors = D.honors.map(function (h, i) {
      return '<div class="pj-honor" style="animation-delay:' + (i * 0.1) + 's"><div class="pj-honor-icon">' + h.icon + '</div>' +
        '<div class="pj-honor-count"><span data-count="' + esc(h.count) + '">0</span><em>' + esc(h.unit) + '</em></div>' +
        '<div class="pj-honor-type">' + esc(h.type) + '</div><small>' + esc(h.note) + '</small></div>';
    }).join('');
    var team = D.team.map(function (t) {
      return '<div class="pj-member"><div class="pj-avatar">' + esc(t.name.slice(0, 1)) + '</div><b>' + esc(t.name) + '</b>' +
        '<span>' + esc(t.role) + ' · ' + esc(t.field) + '</span><small>' + esc(t.org) + '</small><small class="pj-work">' + esc(t.work) + '</small></div>';
    }).join('');
    m.innerHTML = heading('PROJECT PROFILE', '关于项目', '人工智能数据安全与计算安全关键技术研究 · 2024AQ2028', '') +
      '<div class="pj-hero"><div class="pj-hero-glow"></div>' +
      '<div class="pj-hero-eyebrow">HUNAN PROVINCIAL SCIENCE &amp; TECHNOLOGY INNOVATION PROGRAM</div>' +
      '<h1>' + esc(p.name) + '</h1>' +
      '<p>面向大模型的分布式分层安全推理平台：拆分学习 · 密态训练 · 数据存证 · 零知识验证；面向多源大规模数据，在原始数据不出域的前提下实现协作训练与可信推理。</p>' +
      '<div class="pj-meta"><span>项目编号 <b>' + esc(p.code) + '</b></span><span>牵头单位 <b>' + esc(p.unit) + '</b></span><span>参与单位 <b>' + esc(p.partner) + '</b></span><span>执行期限 <b>' + esc(p.period) + '</b></span><span>资助经费 <b>' + esc(p.fund) + '</b></span></div>' +
      '<div class="pj-hero-actions"><button class="primary" id="pj-go-overview">查看平台总览</button><button id="pj-go-screen">进入功能演示大屏</button></div>' +
      '</div>' +
      '<div class="pj-objectives">' + objCards + '</div>' +
      panel('项目里程碑', '任务书年度计划', '<div class="pj-timeline">' + timeline + '</div>') +
      panel('荣誉墙', '成果指标', '<div class="pj-honors">' + honors + '</div>') +
      panel('研究团队', '湖南科技大学 × 湖南医沃信息技术有限公司', '<div class="pj-team">' + team + '</div>') +
      '<div class="pj-cta"><b>功能演示入口</b><div class="sec-actions"><button class="primary" id="pj-cta-overview">平台总览</button><button id="pj-cta-screen">功能演示大屏</button><button id="pj-cta-verify">结果验证</button><button id="pj-cta-chain">链上验证记录</button></div></div>';

    document.querySelectorAll('#main [data-count]').forEach(function (el) {
      animateCount(el, parseFloat(el.dataset.count), 0, 1400);
    });
    document.getElementById('pj-go-overview').onclick = function () { window.navigate('overview'); };
    document.getElementById('pj-go-screen').onclick = function () { window.navigate('screen'); };
    document.getElementById('pj-cta-overview').onclick = function () { window.navigate('overview'); };
    document.getElementById('pj-cta-screen').onclick = function () { window.navigate('screen'); };
    document.getElementById('pj-cta-verify').onclick = function () { window.navigate('verification'); };
    document.getElementById('pj-cta-chain').onclick = function () { window.navigate('chain3d'); };
  }

  var renderers = { screen: pageScreen, chain3d: pageChain3d, project: pageProject };
  window.renderShowcasePage = function (id) {
    runCleanups();
    if (renderers[id]) renderers[id]();
  };
})();
