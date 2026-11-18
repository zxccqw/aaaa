'use strict';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pages={dashboard:{title:'工作台总览',icon:'▣'},lab:{title:'皮肤检验',icon:'⌘'},review:{title:'报告复核',icon:'✎'},patients:{title:'患者索引',icon:'⧉'},settings:{title:'连接与设置',icon:'⚙'},status:{title:'系统状态',icon:'◎'},overview:{title:'平台总览',icon:'◉'},training:{title:'协同训练管理',icon:'⇄'},encrypted:{title:'密态建模算法',icon:'⛨'},attestation:{title:'数据存证',icon:'▦'},verification:{title:'结果验证',icon:'✓'},chain3d:{title:'链上验证记录',icon:'⛓'},audit:{title:'审计中心',icon:'▤'},screen:{title:'功能演示大屏',icon:'◈'},about:{title:'平台信息与成果',icon:'ⓘ'},project:{title:'关于项目',icon:'✦'},help:{title:'帮助中心',icon:'✧'}};
let page=location.hash.slice(1)||'dashboard';
let role;
const doctorPages=new Set(['dashboard','lab','review','patients']);
function canAccess(id){
 if(!Object.hasOwn(pages,id))return false;
 if(role==='doctor')return doctorPages.has(id);
 return role==='admin'&&!doctorPages.has(id)&&!medicalPages.has(id);
}
function goToLogin(){location.replace('/login.html?next='+encodeURIComponent(location.hash.slice(1)));}
function toast(message){
 $('#toast').textContent=message;$('#toast').style.display='block';
 clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',5000);
}
const sidebarExpanded={workbench:false,lab:false,security:false,showcase:false,workspace:false};
const navGroups=[
 {id:'workbench',name:'工作台',icon:'▣',children:[{id:'dashboard',name:'工作台总览'}]},
 {id:'lab',name:'医疗检验',icon:'⌘',children:[{id:'lab',name:'皮肤检验'},{id:'review',name:'报告复核'},{id:'patients',name:'患者索引'}]},
 {id:'security',name:'安全计算',icon:'◉',children:[{id:'overview',name:'平台总览'},{id:'training',name:'协同训练管理'},{id:'encrypted',name:'密态建模算法'},{id:'attestation',name:'数据存证'},{id:'verification',name:'结果验证'},{id:'chain3d',name:'链上验证记录'},{id:'audit',name:'审计中心'}]},
 {id:'showcase',name:'功能演示',icon:'◈',children:[{id:'screen',name:'功能演示大屏'}]},
 {id:'workspace',name:'工作空间',icon:'⚙',children:[{id:'status',name:'系统状态'},{id:'settings',name:'连接与设置'},{id:'about',name:'平台信息与成果'},{id:'project',name:'关于项目'},{id:'help',name:'帮助中心'}]}
];
const medicalPages=new Set(navGroups.find(group=>group.id==='lab').children.map(child=>child.id));
function drawNav(){
 $('#nav').innerHTML=navGroups
  .map(group=>({...group,children:group.children.filter(child=>canAccess(child.id))}))
  .filter(group=>group.children.length)
  .map(group=>{
  const groupActive=group.children.some(child=>child.id===page);
  return `
  
  <details class="sidebar-dropdown workspace-dropdown" data-group="${group.id}" ${(sidebarExpanded[group.id]||groupActive)?'open':''}>
   <summary class="sidebar-dropdown-title ${groupActive?'active':''}"><span class="n-icon">${group.icon}</span><span>${group.name}</span><span class="sidebar-arrow" aria-hidden="true">⌄</span></summary>
   ${group.children.map(child=>`<button class="nav-item sidebar-child ${page===child.id?'active':''}" data-page="${child.id}">${child.name}</button>`).join('')}
  </details>`;
 }).join('');
 $('#nav').querySelectorAll('[data-group]').forEach(group=>group.ontoggle=()=>{sidebarExpanded[group.dataset.group]=group.open});
 $('#nav').querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>navigate(button.dataset.page));
}

function navigate(id){page=id;document.body.classList.remove('mobile-open');location.hash=id;render();}
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(id!==page){page=id;render()}});
const securityPageIds=['overview','training','encrypted','attestation','verification','audit','about'];
const showcasePageIds=['screen','chain3d','project'];
const workspacePageIds=['dashboard','review','patients','status','help'];
const breadcrumbMap={dashboard:'工作台 / 工作台总览',lab:'医疗检验 / 皮肤检验',review:'医疗检验 / 报告复核',patients:'医疗检验 / 患者索引',settings:'工作空间 / 连接与设置',status:'工作空间 / 系统状态',help:'工作空间 / 帮助中心',overview:'安全计算 / 平台总览',training:'安全计算 / 协同训练管理',encrypted:'安全计算 / 密态建模算法',attestation:'安全计算 / 数据存证',verification:'安全计算 / 结果验证',chain3d:'安全计算 / 链上验证记录',audit:'安全计算 / 审计中心',screen:'功能演示 / 功能演示大屏',about:'工作空间 / 平台信息与成果',project:'工作空间 / 关于项目'};
function render(){
 if(!role)return;
 const openModal=document.getElementById('modal');
 if(openModal&&openModal.open)openModal.close();
 if(!canAccess(page)){page=role==='admin'?'overview':'dashboard';history.replaceState(null,'','#'+page);}
 if(!location.hash){try{history.replaceState(null,'','#'+page)}catch(error){location.hash=page}}
 if(window.__showcaseCleanup)window.__showcaseCleanup();
 drawNav();
 const isSecurity=securityPageIds.indexOf(page)>=0;
 const isShowcase=showcasePageIds.indexOf(page)>=0;
 const isWorkspace=workspacePageIds.indexOf(page)>=0;
 document.body.classList.toggle('medical-mode',page!=='settings');
 document.body.classList.toggle('screen-view',page==='screen');
 $('#breadcrumb').textContent=breadcrumbMap[page]||'';
 const note=$('#mode-note');
 if(note&&(isSecurity||isShowcase)){
  note.childNodes.forEach(node=>{if(node.nodeType===Node.TEXT_NODE)node.textContent='演示环境：安全计算与功能演示为仿真/回放数据，指标口径与任务书一致，验收以第三方报告与证书为准。'});
 }else if(note&&page==='settings'){
  note.childNodes.forEach(node=>{if(node.nodeType===Node.TEXT_NODE)node.textContent='演示环境：此处检查本地服务连接状态与运行配置。'});
 }
 if(page==='lab')return window.renderMedicalCenter('lab');
 if(page==='dashboard'&&role==='doctor'){
  $('#main').innerHTML='<div class="page-heading"><h1>工作台总览</h1></div><section class="settings-card"><h3>皮肤检验</h3><p>登记检查、查看影像和保存检查记录。</p><button id="doctor-lab" class="primary">进入皮肤检验</button></section>';
  $('#doctor-lab').onclick=()=>navigate('lab');
  return;
 }
 if(isSecurity&&window.renderSecurityPage)return window.renderSecurityPage(page);
 if(isShowcase&&window.renderShowcasePage)return window.renderShowcasePage(page);
 if(isWorkspace&&window.renderWorkspacePage)return window.renderWorkspacePage(page);
 renderSettings();
}
async function renderSettings(){
 $('#main').innerHTML='<h1>连接与设置</h1><div class="settings-card"><h3>皮肤检验服务</h3><p>正在检查后端连接…</p><div id="backend-status"></div><button id="refresh-status">刷新状态</button></div>';
 $('#refresh-status').onclick=renderSettings;
 try{
  const response=await fetch('/api/medical/status');if(!response.ok)throw Error('HTTP '+response.status);
  const status=await response.json();
  if(page!=='settings')return;
  $('.settings-card>p').textContent='Spring Boot 后端已连接';
  $('#backend-status').innerHTML='<p>AI 病灶分割服务 '+(status.segmentationConfigured?'已就绪（SkinFusion-Seg）':'未就绪')+'</p><p>' + (status.databaseConfigured ? '检查记录存储在 MySQL。' : '检查记录存储在本地文件。') + '</p>';
 }catch(error){if(page==='settings')$('.settings-card>p').textContent='后端连接失败，请检查服务是否启动。';}
}
$('#collapse').onclick=()=>{document.body.classList.toggle(innerWidth<=700?'mobile-open':'collapsed')};
$('#connect-link').onclick=()=>navigate('settings');
(function(){


const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const centers=[
{id:'imaging',name:'影像中心',en:'MEDICAL IMAGING',icon:'◉',desc:'多模态影像归档、图像预览与阅片记录',types:['全部','CT','DR','MRI','超声','乳腺钼靶','PET-CT'],features:['图片导入','检查分类','坐标标注','历史检查查询','阅片报告']},
{id:'lab',name:'皮肤检验',en:'LABORATORY',icon:'⌘',desc:'皮肤检验登记、检查图片预览与报告记录',types:['全部','皮肤检验'],features:['皮肤检验登记','图片预览','坐标标注','检查记录','报告复核']},
{id:'pathology',name:'病理中心',en:'DIGITAL PATHOLOGY',icon:'▧',desc:'病理标本、切片资料与诊断报告管理',types:['全部','组织病理','细胞学','免疫组化','分子病理'],features:['标本登记','切片目录','图片预览','区域标注','病理报告']},
{id:'functional',name:'功能检查中心',en:'FUNCTIONAL DIAGNOSTICS',icon:'∿',desc:'电生理与生理功能检查资料统一管理',types:['全部','心电','脑电','肺功能','睡眠监测','肌电','听力','骨密度'],features:['检查登记','附件信息','参数录入','事件记录','检查报告']},
{id:'reports',name:'综合报告中心',en:'INTEGRATED REPORTS',icon:'▤',desc:'以患者为线索，汇总跨科室检查与历史报告',types:['全部','待处理','草稿','已复核'],features:['患者检索','跨中心汇总','检查时间线','报告预览','报告导出']}
].filter(c=>c.id==='lab');
let records=[];
async function medicalRequest(path,method='GET',data){
 const response=await fetch('/api/medical'+path,{method,headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 if(response.status===401)goToLogin();
 const text=await response.text();
 let result={};try{result=text?JSON.parse(text):{};}catch(e){result={};}
 if(!response.ok)throw Error(result.error||'医疗接口请求失败');return result;
}
const demo=[
['P-DEMO-001','示例患者 A','imaging','CT','胸部 CT','待处理'],
['P-DEMO-SKIN','皮肤检验示例','lab','皮肤检验','皮肤检查记录','待处理'],
['P-DEMO-002','示例患者 B','pathology','组织病理','组织切片检查','待处理'],
['P-DEMO-002','示例患者 B','functional','心电','常规心电检查','草稿'],
['P-DEMO-003','示例患者 C','imaging','超声','甲状腺超声','已复核']
].map((r,i)=>({id:'demo-'+i,patientId:r[0],patientName:r[1],center:r[2],type:r[3],title:r[4],status:r[5],date:'2026-11-07',demo:true,findings:'演示记录，仅用于展示工作流程。',conclusion:'',metrics:[],events:[],annotations:[]}));
let page=centers.some(c=>c.id===location.hash.slice(1))?location.hash.slice(1):'lab',tab='全部',query='',selected=null,showDemo=true,urls=[];
const demoDeleted=new Set(JSON.parse(localStorage.getItem('demoDeleted')||'[]'));
const demoVisible=()=>demo.filter(r=>!demoDeleted.has(r.id));
const all=()=>[...records,...(showDemo?demoVisible():[])].filter(r=>r.center==='lab'&&r.type==='皮肤检验');
const center=()=>centers.find(c=>c.id===page);
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3000)}

function nav(id){document.body.classList.remove('menu-open');urls.forEach(URL.revokeObjectURL);urls=[];page=id;tab='全部';query='';selected=null;location.hash=id;render()}
function render(){
 const c=center(), own=all().filter(record=>record.center===page);
 $('#mode-note').childNodes.forEach(node=>{if(node.nodeType===Node.TEXT_NODE)node.textContent=''});
 $('#main').innerHTML=`
  <div class="page-heading">
   <div><div class="eyebrow">${c.en}</div><h1>${c.name}</h1></div>
   <button class="primary" id="create">＋ 新建检查</button>
  </div>
  <div class="stat-grid">
   ${[['检查记录',own.length,'本中心累计'],['待处理',own.filter(r=>r.status==='待处理').length,'等待录入与查看'],['报告草稿',own.filter(r=>r.status==='草稿').length,'等待人工复核'],['已复核',own.filter(r=>r.status==='已复核').length,'已完成工作记录']].map((item,index)=>`
    <div class="stat-card"><div>${item[0]}<span class="stat-icon">${['▤','◷','✎','✓'][index]}</span></div><strong>${item[1]}</strong><small>${item[2]}</small></div>
   `).join('')}
  </div>
  <details class="records-panel collapsible-records" open>
   <summary class="panel-title"><h2>检查工作列表</h2><span>${own.length} 条记录 <span class="records-chevron" aria-hidden="true">⌄</span></span></summary>
   <div class="records-content">
    <div class="filter-bar"><input id="search" aria-label="搜索患者或检查" placeholder="搜索患者编号、姓名或检查项目" value="${esc(query)}"></div>
    <div id="records"></div>
   </div>
  </details>
  <div class="bottom-note">演示记录带“示例”标记 · 标记、报告及复核均为人工操作</div>`;
 $('#create').onclick=createRecord;
 $('#search').oninput=event=>{query=event.target.value;drawRecords()};
 drawRecords();
}

function drawRecords(){
 const list=all().filter(r=>(page==='reports'||r.center===page)&&(tab==='全部'||(page==='reports'?r.status:r.type)===tab)&&[r.patientId,r.patientName,r.title].some(v=>v.includes(query)));
 $('#records').innerHTML=list.length?'<div class="table-scroll"><table><thead><tr><th>患者信息</th><th>检查项目</th><th>检查类型</th><th>检查日期</th><th>报告状态</th><th>操作</th></tr></thead><tbody>'+list.map(r=>'<tr><td><b>'+esc(r.patientName)+'</b> '+(r.demo?'<em>示例</em>':'')+'<small>'+esc(r.patientId)+'</small></td><td>'+esc(r.title)+'<small>'+centers.find(c=>c.id===r.center).name+'</small></td><td><span class="type-tag">'+esc(r.type)+'</span></td><td>'+esc(r.date)+'</td><td><span class="status status-'+({'待处理':'pending','草稿':'draft','已复核':'done'}[r.status])+'">'+esc(r.status)+'</span></td><td><div class="row-actions"><button class="text-button" data-open="'+r.id+'">'+(page==='reports'?'查看汇总':'打开检查')+' ↗</button><button class="text-button danger" data-delete="'+r.id+'">删除</button></div></td></tr>').join('')+'</tbody></table></div>':'<div class="empty"><span>▤</span><h3>暂无符合条件的检查</h3><p>调整搜索条件，或新建一条检查记录。</p></div>';
 document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openRecord(b.dataset.open));
 document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async event=>{
  event.stopPropagation();
  const r=all().find(x=>x.id===b.dataset.delete);if(!r)return;
  if(r.demo){
   if(!confirm('确定删除这条示例记录？\n示例记录仅用于演示，删除后不再显示。'))return;
   demoDeleted.add(r.id);
   localStorage.setItem('demoDeleted',JSON.stringify([...demoDeleted]));
   if(selected===r.id)selected=null;
   if($('#modal').open)$('#modal').close();
   render();toast('已删除示例记录：'+r.patientName+' · '+r.title);
   return;
  }
  if(!confirm('确定删除这条检查记录？\n患者：'+r.patientName+'（'+r.patientId+'）\n项目：'+r.title+'\n删除后不可恢复。'))return;
  b.disabled=true;
  try{
   await medicalRequest('/records/'+r.id,'DELETE');
   records=records.filter(x=>x.id!==r.id);
   if(selected===r.id)selected=null;
   if($('#modal').open)$('#modal').close();
   render();toast('已删除检查记录：'+r.patientName+' · '+r.title);
  }catch(e){toast(e.message);b.disabled=false;}
 });
}
function uuid(){
 if(window.crypto&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
 const bytes=new Uint8Array(16);
 if(window.crypto&&typeof crypto.getRandomValues==='function')crypto.getRandomValues(bytes);
 else for(let i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
function modal(title,body,foot=''){ $('#modal').innerHTML='<div class="modal-head"><h2>'+esc(title)+'</h2><button id="close-modal" aria-label="关闭">×</button></div><div class="modal-body">'+body+'</div><div class="modal-foot">'+foot+'</div>';$('#close-modal').onclick=()=>$('#modal').close();if(!$('#modal').open)$('#modal').showModal()}
function field(name,label,value='',type='text'){return '<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" required maxlength="120"></label>'}
function createRecord(){
 const active=page==='reports'?'imaging':page;
 modal('新建检查记录','<form id="new-form" class="form-grid">'+field('patientId','患者编号')+field('patientName','患者姓名／脱敏代号')+'<label>所属中心<select name="center">'+centers.filter(c=>c.id!=='reports').map(c=>'<option value="'+c.id+'" '+(c.id===active?'selected':'')+'>'+c.name+'</option>').join('')+'</select></label><label>检查类型<select name="type" id="new-type"></select></label>'+field('title','检查项目')+field('date','检查日期',new Date().toLocaleDateString('sv-SE'),'date')+'</form>','<button class="primary" id="submit-new">创建记录</button>');
 const form=$('#new-form'),types=()=>{$('#new-type').innerHTML=centers.find(c=>c.id===form.elements.center.value).types.slice(1).map(t=>'<option>'+t+'</option>').join('')};
 form.elements.center.onchange=types;types();$('#submit-new').onclick=async()=>{if(!form.reportValidity()){toast('请先填写完整信息');return}try{const r={...Object.fromEntries(new FormData(form)),id:uuid(),status:'待处理',findings:'',conclusion:'',metrics:[],events:[],annotations:[]};const saved=await medicalRequest('/records','POST',r);records.unshift(saved);$('#modal').close();render();openRecord(saved.id)}catch(e){toast('创建失败：'+e.message)}};
}
function openRecord(id){
 const r=all().find(r=>r.id===id);if(!r)return;selected=id;
 if(page==='reports'){openSummary(r);return}
 const imageMode=['imaging','pathology'].includes(r.center)||(r.center==='lab'&&r.type==='皮肤检验');
 modal(r.title,'<div class="detail-grid inspection-stack"><section class="inspection-images"><h3>'+(imageMode?'图片与标注':'检查结果与资料')+'</h3>'+(imageMode?'<div class="viewer"><img id="preview-image" alt="所选检查图片"><span id="image-empty">导入图片预览 · PNG / JPEG</span></div><div class="viewer-tools"><div class="image-action-buttons"><label class="image-upload-button"><span id="image-picker-label">选择图片（可多选）</span><input id="image-file" type="file" accept="image/png,image/jpeg" multiple style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden"></label><button id="dataset-picker-open">从数据集选择</button><button class="primary" id="segment-image" disabled>AI 病灶分割</button><button class="primary" id="analyze-image" disabled hidden>分析图片</button></div><label>缩放<input id="zoom" type="range" min="50" max="200" value="100"></label></div><p id="batch-progress" role="status" class="batch-progress">可一次选择最多10张图片，每张不超过10MB；选好后点击「AI 病灶分割」</p><div id="image-thumbnails" class="image-thumbnails"></div><div id="dataset-picker" class="dataset-picker" hidden></div><div id="segment-result" class="segment-result"></div><div id="annotation-list"></div>':'<div class="result-box"><div class="result-head"><span>指标／参数</span><button id="add-metric">＋ 添加</button></div><div id="metric-list"></div></div><div class="attachment"><label>选择资料附件<input id="result-file" type="file" accept=".pdf,.csv,.txt,.png,.jpg,.jpeg"></label><p id="attachment-name" class="muted">附件仅在本次页面中查看文件信息。</p></div>')+'</section><section class="inspection-events"><h3>工作记录</h3><div id="event-list"></div><div class="event-input"><input id="event-text" placeholder="'+(r.center==='pathology'?'记录标本、切片或取材情况':r.center==='lab'?'记录标本状态或复核说明':'记录检查事件或观察情况')+'"><button id="add-event">添加</button></div></section><section class="inspection-report"><h3>报告编辑</h3><label>检查所见<textarea id="findings" rows="6">'+esc(r.findings)+'</textarea></label><label>结论<textarea id="conclusion" rows="4">'+esc(r.conclusion)+'</textarea></label><div id="seg-analysis-result"></div><div class="conclusion-image-area" hidden><h4>AI 病灶分割结果</h4><div class="generated-image-slot" role="img" aria-label="AI 病灶分割结果"><span>AI 病灶分割结果会显示在左侧图片区域</span></div></div></section></div>','<span id="save-message" role="status"></span><button id="save-draft">保存草稿</button><button class="primary" id="review">确认复核</button>');
 const draft=JSON.parse(JSON.stringify(r));
 const activeRequests=new Set();
 const editorSession=uuid();$('#modal').dataset.session=editorSession;
 $('#modal').addEventListener('close',()=>{activeRequests.forEach(controller=>controller.abort());},{once:true});
 function draw(){
  $('#event-list').innerHTML=draft.events.length?draft.events.map(e=>'<div class="event-item">'+esc(e)+'</div>').join(''):'<p class="muted">暂无工作记录</p>';
  if(imageMode){$('#annotation-list').innerHTML=draft.annotations.map((a,i)=>'<div class="event-item">'+esc(a.file)+' · '+a.x+', '+a.y+'<button data-remove="'+i+'">删除</button></div>').join('');document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{draft.annotations.splice(+b.dataset.remove,1);draw()})}
  else $('#metric-list').innerHTML=draft.metrics.length?'<table><thead><tr><th>项目</th><th>结果</th><th>单位</th><th>参考范围</th></tr></thead><tbody>'+draft.metrics.map(m=>'<tr>'+[m.name,m.value,m.unit,m.range].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<p class="muted">暂无结果，点击添加录入检查指标。</p>';
 }
 draw();
 $('#add-event').onclick=()=>{const v=$('#event-text').value.trim();if(v){draft.events.push(v);$('#event-text').value='';draw()}};
 if(imageMode){
  let analysisBusy=false,segmentBusy=false,segAnalysisBusy=false,activeImage=0;
  let images=(draft.analyses||[]).map(item=>({...item,file:null,preview:item.result?.originalImageUrl||'',kind:'analysis'}));
  if(!images.length&&draft.analysis)images=[{name:'历史图片',status:'success',result:draft.analysis,file:null,preview:draft.analysis.originalImageUrl}];
  const currentEditor=()=>$('#modal').open&&$('#modal').dataset.session===editorSession;
  const validMedia=url=>/^\/api\/medical\/media\/[a-f0-9-]+-(original|result)\.png$/.test(url||'');
  const storeResults=()=>{
   draft.analyses=images.map(({name,status,result,error})=>({name,status,result,error}));
   delete draft.analysis;
  };

  function showImage(index){
   activeImage=index;
   const item=images[index],preview=$('#preview-image');
   if(item&&(item.preview.startsWith('blob:')||validMedia(item.preview))){
    preview.src=item.preview;preview.style.display='block';$('#image-empty').style.display='none';
   }else{preview.removeAttribute('src');preview.style.display='none';$('#image-empty').style.display='block';}
   $('#zoom').value='100';preview.style.width='100%';
   document.querySelectorAll('[data-preview-image]').forEach(button=>button.classList.toggle('selected',Number(button.dataset.previewImage)===index));
   if(item&&item.seg)renderSegmentResult({name:item.name,originalImageUrl:item.preview,...item.seg});
   renderSegmentAnalysis(item&&item.analysis?item.analysis:null);
   updateSegmentButton();
  }
  function renderImages(){
   const labels={pending:'待分割',running:'分割中',success:'已分割',failed:'失败'};
   $('#image-thumbnails').innerHTML=images.map((item,index)=>'<button type="button" data-preview-image="'+index+'" class="image-thumbnail '+(index===activeImage?'selected':'')+'">'+((item.preview.startsWith('blob:')||validMedia(item.preview))?'<img alt="待分割图片缩略图" src="'+esc(item.preview)+'">':'')+'<span>'+esc((index+1)+'. '+item.name)+'</span><small>'+esc(item.kind==='analysis'?'历史AI结果':labels[item.status])+'</small></button>').join('');
   document.querySelectorAll('[data-preview-image]').forEach(button=>button.onclick=()=>showImage(Number(button.dataset.previewImage)));
   const finished=images.filter(item=>item.status==='success'||item.status==='failed').length;
   $('#batch-progress').textContent=images.length?'共 '+images.length+' 张 · 已分割 '+images.filter(item=>item.seg).length+' 张':'可一次选择最多10张图片，每张不超过10MB；选好后点击「AI 病灶分割」';
   const slot=$('.generated-image-slot');
   slot.classList.add('batch-results');
   slot.innerHTML=images.length?images.map((item,index)=>{
    const result=item.result;
    const content=item.status==='success'&&result&&validMedia(result.resultImageUrl)?'<img class="analysis-result-image" alt="第'+(index+1)+'张分析结果" src="'+esc(result.resultImageUrl)+'"><p>'+esc(result.imageCaption)+'</p>'+result.regions.map((region,i)=>'<p>#'+(i+1)+' '+esc(region.label)+'</p>').join(''):'<p>'+esc(item.error||labels[item.status])+'</p>';
    return '<article class="batch-result"><h4>'+esc((index+1)+'. '+item.name)+'</h4>'+content+(item.status==='failed'&&item.file?'<button type="button" data-retry-image="'+index+'">重试这张图片</button>':'')+'</article>';
   }).join(''):'<span>选择图片后，点击“分析图片”查看结果</span>';
   document.querySelectorAll('[data-retry-image]').forEach(button=>{button.disabled=analysisBusy;button.onclick=()=>runAnalysis([Number(button.dataset.retryImage)])});
   $('#analyze-image').disabled=analysisBusy||!images.some(item=>item.file&&item.status!=='success');
   updateSegmentButton();
  }
  function updateReport(){
   const completed=images.filter(item=>item.status==='success');
   if(!completed.length)return;
   draft.findings=completed.map(item=>'【'+item.name+'】'+item.result.findings).join('\n\n');
   draft.conclusion=completed.map(item=>'【'+item.name+'】'+item.result.conclusion).join('\n\n');
   $('#findings').value=draft.findings;$('#conclusion').value=draft.conclusion;
  }
  async function runAnalysis(indices){
   if(analysisBusy||!indices.length)return;
   analysisBusy=true;
   $('#analyze-image').textContent='正在批量分析…';$('#image-file').disabled=true;
   $('#findings').disabled=true;$('#conclusion').disabled=true;$('#save-draft').disabled=true;$('#review').disabled=true;
   let cursor=0;
   async function worker(){
    while(cursor<indices.length&&currentEditor()){
     const index=indices[cursor++],item=images[index],controller=new AbortController();
     activeRequests.add(controller);item.status='running';item.error='';renderImages();
     const form=new FormData();form.append('image',item.file);
     const timer=setTimeout(()=>controller.abort(),170000);
     try{
      const response=await fetch('/api/medical/analysis',{method:'POST',body:form,signal:controller.signal});
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'图片分析失败');
      if(!currentEditor())return;
      item.status='success';item.result=result;
     }catch(error){
      if(!currentEditor())return;
      item.status='failed';item.error=error.name==='AbortError'?'分析超时，请重试':error.message;
     }finally{clearTimeout(timer);activeRequests.delete(controller);}
     if(currentEditor()){storeResults();updateReport();renderImages();}
    }
   }
   try{
    await Promise.all(Array.from({length:Math.min(2,indices.length)},()=>worker()));
    if(currentEditor()){
     draft.events.push(new Date().toLocaleString()+' · 批量图片分析完成，成功 '+images.filter(item=>item.status==='success').length+' 张，失败 '+images.filter(item=>item.status==='failed').length+' 张');
     draw();toast('批量分析已结束，请复核结果后保存草稿。');
    }
   }finally{
    analysisBusy=false;
    if(currentEditor()){
     $('#analyze-image').textContent='分析图片';$('#image-file').disabled=false;$('#findings').disabled=false;$('#conclusion').disabled=false;$('#save-draft').disabled=false;$('#review').disabled=false;
     renderImages();
    }
   }
  }
  $('#analyze-image').onclick=()=>runAnalysis(images.map((item,index)=>item.file&&item.status!=='success'?index:-1).filter(index=>index>=0));
  $('#image-file').onchange=event=>{
   const files=Array.from(event.target.files);if(!files.length)return;
   if(images.length+files.length>10||files.some(file=>!['image/png','image/jpeg'].includes(file.type)||file.size>10*1024*1024)){
    toast('当前检查累计最多10张图片，每张请选择10MB以内的PNG或JPEG');event.target.value='';return;
   }
   const firstNewImage=images.length;
   const added=files.map(file=>{const preview=URL.createObjectURL(file);urls.push(preview);return {name:file.name,file,preview,status:'pending'}});
   images.push(...added);
   $('#image-picker-label').textContent='继续添加图片（可多选）';
   storeResults();renderImages();showImage(firstNewImage);draw();
   event.target.value='';

  };
  $('#zoom').oninput=event=>$('#preview-image').style.width=event.target.value+'%';
  $('#preview-image').onclick=event=>{
   const item=images[activeImage];if(!item)return;
   const bounds=event.target.getBoundingClientRect();
   draft.annotations.push({file:item.name,imageIndex:activeImage,x:+((event.clientX-bounds.left)/bounds.width).toFixed(3),y:+((event.clientY-bounds.top)/bounds.height).toFixed(3)});draw();
  };
  function updateSegmentButton(){
   const item=images[activeImage],button=$('#segment-image');
   if(button)button.disabled=segmentBusy||!item||!item.file;
  }
  function renderSegmentAnalysis(result){
   const box=$('#seg-analysis-result');
   if(!box)return;
   if(!result){box.innerHTML='';return;}
   box.innerHTML='<div class="segment-card segment-analysis"><h4>AI 辅助分析 · 基于病灶分割结果</h4>'+
    '<h5>检查所见</h5><p>'+esc(result.findings||'').replace(/\n/g,'<br>')+'</p>'+
    '<h5>辅助结论</h5><p>'+esc(result.conclusion||'').replace(/\n/g,'<br>')+'</p></div>';
  }
  async function runSegmentationAnalysis(targetItem){
   const item=targetItem||images[activeImage];
   if(segAnalysisBusy||!item||!item.seg)return;
   segAnalysisBusy=true;
   try{
    const overlay=await fetch(item.seg.overlayImageUrl,{cache:'no-store'});
    if(!overlay.ok)throw Error('读取病灶分割叠加图失败');
    const blob=await overlay.blob();
    const form=new FormData();
    form.append('image',blob,'segmentation-overlay.png');
    form.append('mode','segmentation');
    form.append('lesionAreaRatio',String(item.seg.lesionAreaRatio||0));
    const response=await fetch('/api/medical/analysis',{method:'POST',body:form});
    const result=await response.json();
    if(!response.ok)throw Error('AI 辅助分析暂不可用');
    if(!currentEditor())return;
    item.analysis=result;
    draft.segmentAnalysis=result;
    const prefix='【AI辅助分析 · '+item.name+'】';
    const currentFindings=($('#findings').value||'').trim();
    const currentConclusion=($('#conclusion').value||'').trim();
    draft.findings=(currentFindings?currentFindings+'\n\n':'')+prefix+'\n'+result.findings;
    draft.conclusion=(currentConclusion?currentConclusion+'\n\n':'')+result.conclusion;
    $('#findings').value=draft.findings;
    $('#conclusion').value=draft.conclusion;
    draft.events.push(new Date().toLocaleString()+' · AI 辅助分析完成：'+item.name);
    renderSegmentAnalysis(result);draw();
    toast('AI 辅助分析完成，已生成检查所见与结论');
   }catch(error){toast('AI 辅助分析暂不可用，请稍后重试');}
   finally{segAnalysisBusy=false;}
  }
  function renderSegmentResult(seg){
   const box=$('#segment-result');
   if(!seg){box.innerHTML='';return;}
   const original=seg.originalImageUrl?'<figure><img src="'+esc(seg.originalImageUrl)+'" alt="原图"><figcaption>原图</figcaption></figure>':'';
   box.innerHTML='<div class="segment-card"><h4>AI 病灶分割结果'+(seg.name?' · '+esc(seg.name):'')+'</h4><div class="segment-images">'+original+'<figure><img src="'+esc(seg.overlayImageUrl)+'" alt="病灶分割叠加图"><figcaption>叠加图</figcaption></figure><figure><img src="'+esc(seg.maskImageUrl)+'" alt="病灶分割掩码"><figcaption>预测掩码</figcaption></figure></div><p>病灶面积占比 <b>'+(Number(seg.lesionAreaRatio)*100).toFixed(1)+'%</b> · 推理耗时 '+esc(String(seg.inferenceMs))+' ms · '+esc(seg.model||'SkinFusion-Seg')+' '+esc(seg.version||'')+'</p></div>';
  }
  let datasetCache=null,datasetFilter='全部';
  const datasetPanel=$('#dataset-picker');
  function renderDataset(){
   const all=(datasetCache&&datasetCache.items)||[];
   const items=all.filter(item=>datasetFilter==='全部'||item.center===datasetFilter);
   const centers=[...new Set(all.map(item=>item.center))];
   datasetPanel.innerHTML='<div class="dataset-head"><b>ISIC2018 测试集</b><span>共 '+all.length+' 张</span><select id="dataset-filter"><option>全部</option>'+centers.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select><button type="button" id="dataset-close">收起</button></div><div class="dataset-grid">'+items.map(item=>'<button type="button" class="dataset-item" data-dataset-id="'+esc(item.id)+'"><img loading="lazy" src="/api/medical/dataset/'+esc(item.id)+'/thumb" alt="'+esc(item.sampleId)+'"><span>'+esc(item.sampleId)+'</span><small>'+esc(item.center.replace('simulated_center_','模拟中心 '))+'</small></button>').join('')+'</div>';
   const select=$('#dataset-filter');select.value=datasetFilter;
   select.onchange=event=>{datasetFilter=event.target.value;renderDataset();};
   $('#dataset-close').onclick=()=>{datasetPanel.hidden=true;};
   datasetPanel.querySelectorAll('[data-dataset-id]').forEach(button=>{button.onclick=()=>pickDataset(button.dataset.datasetId);});
  }
  async function openDataset(){
   datasetPanel.hidden=!datasetPanel.hidden;
   if(datasetPanel.hidden)return;
   if(!datasetCache){
    datasetPanel.innerHTML='<p class="muted">正在加载 ISIC2018 测试集…</p>';
    try{
     const response=await fetch('/api/medical/dataset');
     const data=await response.json();
     if(!response.ok)throw Error(data.error||'加载数据集失败');
     datasetCache=data;
    }catch(error){datasetPanel.innerHTML='<p class="muted">'+esc(error.message)+'</p>';return;}
   }
   renderDataset();
  }
  async function pickDataset(id){
   if(images.length>=10){toast('当前检查累计最多10张图片');return;}
   try{
    const response=await fetch('/api/medical/dataset/'+id);
    if(!response.ok)throw Error('读取数据集图片失败');
    const blob=await response.blob();
    const file=new File([blob],'ISIC-'+id+'.png',{type:'image/png'});
    const preview=URL.createObjectURL(file);urls.push(preview);
    images.push({name:'ISIC-'+id+'.png',file,preview,status:'pending',source:'isic'});
    storeResults();showImage(images.length-1);renderImages();draw();
    datasetPanel.hidden=true;
    toast('已选择数据集图片 ISIC-'+id);
   }catch(error){toast(error.message);}
  }
  async function runSegmentation(){
   const item=images[activeImage];
   if(segmentBusy||!item||!item.file)return;
   segmentBusy=true;updateSegmentButton();
   const button=$('#segment-image');button.textContent='分割中…';
   try{
    const form=new FormData();form.append('image',item.file);
    const response=await fetch('/api/medical/segment',{method:'POST',body:form});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'AI病灶分割失败');
    if(!currentEditor())return;
    const ratio=(Number(result.lesionAreaRatio)*100).toFixed(1);
    item.status='success';item.seg=result;
    draft.segmentations=draft.segmentations||[];
    draft.segmentations.push({name:item.name,...result});
    const note='【AI病灶分割】'+item.name+'：病灶面积占比 '+ratio+'%（'+(result.model||'SkinFusion-Seg')+' '+result.version+'，推理 '+result.inferenceMs+'ms）';
    draft.findings=(draft.findings?draft.findings.trim()+'\n':'')+note;
    $('#findings').value=draft.findings;
    draft.events.push(new Date().toLocaleString()+' · AI病灶分割完成：'+item.name+'，病灶面积占比 '+ratio+'%');
    renderSegmentResult({name:item.name,originalImageUrl:item.preview,...result});renderImages();draw();
    toast('AI病灶分割完成：病灶占比 '+ratio+'%，正在生成辅助结论…');
    setTimeout(()=>runSegmentationAnalysis(item),0);
   }catch(error){toast(error.message);}
   finally{segmentBusy=false;button.textContent='AI 病灶分割';updateSegmentButton();}
  }
  $('#dataset-picker-open').onclick=openDataset;
  $('#segment-image').onclick=runSegmentation;
  if(draft.segmentations&&draft.segmentations.length)renderSegmentResult(draft.segmentations[draft.segmentations.length-1]);
  if(draft.segmentAnalysis)renderSegmentAnalysis(draft.segmentAnalysis);
  renderImages();showImage(0);

 }else{
  $('#result-file').onchange=e=>{const f=e.target.files[0];$('#attachment-name').textContent=f?f.name+' · '+Math.ceil(f.size/1024)+' KB':''};
  $('#add-metric').onclick=()=>{const row=document.createElement('form');row.className='metric-editor';row.innerHTML='<input name="name" placeholder="项目名称" required><input name="value" placeholder="结果" required><input name="unit" placeholder="单位"><input name="range" placeholder="参考范围"><button class="primary">保存</button>';$('#metric-list').append(row);row.onsubmit=e=>{e.preventDefault();draft.metrics.push(Object.fromEntries(new FormData(row)));draw()}};
 }
 async function save(status){
  if(r.demo){toast('示例记录仅供浏览，请新建检查后保存');return}
  if(status==='已复核'&&!$('#conclusion').value.trim()){toast('请填写结论后再确认复核');return}
  draft.findings=$('#findings').value;draft.conclusion=$('#conclusion').value;draft.status=status;draft.updatedAt=new Date().toISOString();
  $('#save-draft').disabled=true;$('#review').disabled=true;
  try{const saved=await medicalRequest('/records/'+id,'PUT',draft);Object.assign(draft,saved);records=records.map(x=>x.id===id?saved:x)}catch(e){toast(e.message);return}finally{$('#save-draft').disabled=false;$('#review').disabled=false;}
  $('#save-message').textContent='已保存 · '+status;render();
 }
 $('#save-draft').onclick=()=>save('草稿');$('#review').onclick=()=>save('已复核');
}
function openSummary(r){
 const history=all().filter(x=>x.patientId===r.patientId).sort((a,b)=>b.date.localeCompare(a.date));
 modal('患者综合报告','<div class="record-banner"><div><b>'+esc(r.patientName)+'</b><span>'+esc(r.patientId)+' · '+history.length+' 项检查</span></div></div><div class="timeline">'+history.map(x=>'<article><div class="timeline-date">'+esc(x.date)+' · '+centers.find(c=>c.id===x.center).name+'</div><h3>'+esc(x.title)+' <span class="type-tag">'+esc(x.status)+'</span></h3><p><b>检查所见</b><br>'+esc(x.findings||'尚未填写')+'</p><p><b>结论</b><br>'+esc(x.conclusion||'尚未填写')+'</p></article>').join('')+'</div>','<button class="primary" id="export-report">导出文本报告</button>');
 $('#export-report').onclick=()=>{const text=['患者 '+r.patientName,'编号 '+r.patientId,...history.map(x=>[x.date,x.title,x.status,'检查所见 '+(x.findings||'尚未填写'),'结论 '+(x.conclusion||'尚未填写')].join('\n'))].join('\n\n');const u=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download='综合报告-'+r.patientId+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};
}


window.__ui={$,esc,modal,toast,medicalRequest};
window.renderMedicalCenter=async function(id){page=id;tab='全部';query='';$('#main').innerHTML='<p>正在连接医疗数据库…</p>';try{records=await medicalRequest('/records');if(location.hash.slice(1)!==id)return;render()}catch(e){$('#main').textContent='医疗数据库连接失败，请重启更新后的 Java 服务。'+e.message}};
})();
function setupProfile(){
 const toggle=$('#profile-toggle');
 const actions=$('#profile-actions');
 const buttons=actions.querySelectorAll('button');
 const setOpen=open=>{
  actions.hidden=!open;
  toggle.setAttribute('aria-expanded',String(open));
 };
 toggle.onclick=()=>setOpen(actions.hidden);
 document.addEventListener('click',event=>{
  if(!event.target.closest('.profile'))setOpen(false);
 });
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!actions.hidden){
   setOpen(false);
   toggle.focus();
  }
 });
 const endSession=async switchAccount=>{
  buttons.forEach(button=>button.disabled=true);
  try{
   const response=await fetch('/api/auth/logout',{method:'POST'});
   if(!response.ok&&response.status!==401)throw Error();
   if(switchAccount){goToLogin();return;}
   location.replace('/login.html');
  }catch{
   toast(switchAccount?'切换账号失败，请重试':'退出失败，请重试');
   buttons.forEach(button=>button.disabled=false);
  }
 };
 $('#switch-account').onclick=()=>endSession(true);
 $('#logout').onclick=()=>endSession(false);
}
async function startWorkspace(){
 try{
  const response=await fetch('/api/auth/session');
  if(response.status===401){goToLogin();return;}
  if(!response.ok)throw Error();
  const session=await response.json();
  if(!['doctor','admin'].includes(session.role))throw Error();
  if(session.role==='admin'){
   for(const name of ['security-data','cs1-data','cs2-data','cs2-full-data','pb-data','zkp-data','security-pages','showcase-pages']){
    await new Promise((resolve,reject)=>{
     const script=document.createElement('script');
     script.src=name+'.js?v=144';
     script.onload=resolve;
     script.onerror=reject;
     document.head.append(script);
    });
   }
  }
  role=session.role;
  $('.profile b').textContent=role==='admin'?'管理员':'医生';
  $('.profile .avatar').textContent=role==='admin'?'管':'医';
  $('#connect-link').hidden=role==='doctor';
  setupProfile();
  render();
  document.body.removeAttribute('data-loading');
 }catch(e){
  window.__lastLoadError=e;
  console.error('WORKSPACE_LOAD_ERROR',e);
  document.body.replaceChildren(Object.assign(document.createElement('p'),{textContent:'工作台暂时无法加载，请刷新重试。'}));
  document.body.removeAttribute('data-loading');
 }
}
startWorkspace();
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});




