import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {LAYOUT_WIDGETS,defaultLayoutConfig,applyLayoutChanges,validateLayoutConfig,layoutValidationError} from '../public/layout-config.js';
import {transaction} from './accounts.mjs';

const fail=(status,message,code='validation_failed')=>Object.assign(new Error(message),{status,expose:true,code});
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,allowed)=>{if(!record(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw layoutValidationError('布局请求包含不支持的内容');};
const expected=value=>{if(!Number.isSafeInteger(value)||value<0)throw layoutValidationError('请先读取当前布局版本','expectedRevision');};
const previewLifetime=60*60*1000;

export function createLayouts({db,authEnabled=false,origin='',clock=Date.now}){
 db.exec(fs.readFileSync(new URL('../migrations/006-dashboard-layouts.sql',import.meta.url),'utf8'));
 function scope({user,workbench,page='dashboard'}){
  if(authEnabled&&!user?.id)throw fail(401,'请先登录','token_missing');
  if(workbench?.id!=='health'||workbench?.type!=='health'||page!=='dashboard')throw fail(400,'目前仅健康首页支持布局编辑','unsupported_layout');
  const owner=authEnabled?user.id:'local';
  if(authEnabled&&!db.prepare("SELECT id FROM user_workbenches WHERE user_id=? AND id='health' AND type='health'").get(owner))throw fail(404,'工作台不存在','not_found');
  return {owner,workbench:'health',page:'dashboard',user:user??null};
 }
 const argsFor=s=>[s.owner,s.workbench,s.page];
 function currentTheme(s){return (authEnabled?db.prepare('SELECT themeColor FROM user_workbenches WHERE user_id=? AND id=?').get(s.owner,s.workbench):db.prepare('SELECT themeColor FROM workbenches WHERE id=?').get(s.workbench))?.themeColor||'#2C6B51';}
 function setTheme(s,color){
  if(authEnabled)db.prepare('UPDATE user_workbenches SET themeColor=? WHERE user_id=? AND id=?').run(color,s.owner,s.workbench);
  else db.prepare("INSERT INTO workbenches(id,name,type,themeColor) VALUES('health','健康','health',?) ON CONFLICT(id) DO UPDATE SET themeColor=excluded.themeColor").run(color);
 }
 function read(s){
  const row=db.prepare('SELECT revision,config,updated_at FROM dashboard_layouts WHERE owner=? AND workbench=? AND page=?').get(...argsFor(s));
  const history=db.prepare('SELECT revision,updated_at,source,summary FROM dashboard_layout_versions WHERE owner=? AND workbench=? AND page=? ORDER BY revision DESC').all(...argsFor(s)).map(r=>({revision:r.revision,updatedAt:r.updated_at,source:r.source,summary:JSON.parse(r.summary)}));
  return {owner:authEnabled?s.owner:null,workbench:s.workbench,page:s.page,revision:row?.revision??0,config:row?validateLayoutConfig(JSON.parse(row.config)):defaultLayoutConfig(),themeColor:currentTheme(s),updatedAt:row?.updated_at??null,history};
 }
 const assertRevision=(snapshot,value)=>{expected(value);if(snapshot.revision!==value)throw fail(409,'布局已被其他操作更新，请刷新后再调整','layout_conflict');};
 function save(s,before,config,color,source,summary){
  const at=new Date(clock()).toISOString();
  if(before.revision===0)db.prepare('INSERT OR IGNORE INTO dashboard_layout_versions VALUES(?,?,?,?,?,?,?,?,?)').run(...argsFor(s),0,JSON.stringify(before.config),before.themeColor,at,'default',JSON.stringify(['初始默认布局']));
  const revision=before.revision+1;
  db.prepare('INSERT INTO dashboard_layout_versions VALUES(?,?,?,?,?,?,?,?,?)').run(...argsFor(s),revision,JSON.stringify(config),color,at,source,JSON.stringify(summary));
  db.prepare('INSERT INTO dashboard_layouts VALUES(?,?,?,?,?,?) ON CONFLICT(owner,workbench,page) DO UPDATE SET revision=excluded.revision,config=excluded.config,updated_at=excluded.updated_at').run(...argsFor(s),revision,JSON.stringify(config),at);
  setTheme(s,color);
  db.prepare('DELETE FROM dashboard_layout_versions WHERE owner=? AND workbench=? AND page=? AND revision>0 AND revision<?').run(...argsFor(s),Math.max(1,revision-29));
  return read(s);
 }
 function previewRow(s,id){
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw fail(404,'布局预览不存在或已过期','layout_preview_unavailable');
  const row=db.prepare('SELECT * FROM dashboard_layout_previews WHERE id=? AND owner=? AND workbench=? AND page=?').get(id,...argsFor(s));
  if(!row||row.expires_at<=clock())throw fail(404,'布局预览不存在或已过期','layout_preview_unavailable');
  return row;
 }
 function publicPreview(s,row){
  const summary=JSON.parse(row.summary),affectedDevices=['desktop','mobile'].filter(device=>summary.some(text=>text.includes(device==='desktop'?'电脑':'手机')));
  const target=affectedDevices.length===1?'&layoutDevice='+affectedDevices[0]:'';
  return {...read(s),revision:row.base_revision,baseRevision:row.base_revision,config:validateLayoutConfig(JSON.parse(row.config)),themeColor:row.theme_color,previewId:row.id,previewUrl:origin+'/?layoutPreview='+row.id+target+'#dashboard',affectedDevices,expiresAt:new Date(row.expires_at).toISOString(),summary,preview:true};
 }
 return {
  catalog(input){scope(input);return {workbench:'health',page:'dashboard',schemaVersion:1,devices:['desktop','mobile'],widgets:structuredClone(LAYOUT_WIDGETS)};},
  get(input){return read(scope(input));},
  preview(input,body,source='web'){
   const s=scope(input);exact(body,['expectedRevision','changes']);expected(body.expectedRevision);
   return transaction(db,()=>{const before=read(s);assertRevision(before,body.expectedRevision);const change=applyLayoutChanges(before.config,before.themeColor,body.changes);const now=clock(),id=randomUUID();
    db.prepare('DELETE FROM dashboard_layout_previews WHERE expires_at<=?').run(now);
    db.prepare('INSERT INTO dashboard_layout_previews VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,...argsFor(s),before.revision,JSON.stringify(change.config),change.themeColor,now,now+previewLifetime,source,JSON.stringify(change.summary));
    db.prepare('DELETE FROM dashboard_layout_previews WHERE owner=? AND id NOT IN(SELECT id FROM dashboard_layout_previews WHERE owner=? ORDER BY created_at DESC,rowid DESC LIMIT 20)').run(s.owner,s.owner);
    return publicPreview(s,previewRow(s,id));
   });
  },
  getPreview(input,id){const s=scope(input);return publicPreview(s,previewRow(s,id));},
  update(input,body,source='web'){
   const s=scope(input);exact(body,['expectedRevision','changes','previewId']);expected(body.expectedRevision);
   if((body.changes!==undefined)===(body.previewId!==undefined))throw layoutValidationError('请选择直接调整布局或应用预览');
   return transaction(db,()=>{const before=read(s);assertRevision(before,body.expectedRevision);let config,color,summary;
    if(body.previewId!==undefined){const row=previewRow(s,body.previewId);assertRevision(before,row.base_revision);config=validateLayoutConfig(JSON.parse(row.config));color=row.theme_color;summary=JSON.parse(row.summary);db.prepare('DELETE FROM dashboard_layout_previews WHERE id=? AND owner=?').run(row.id,s.owner);}
    else{const change=applyLayoutChanges(before.config,before.themeColor,body.changes);config=change.config;color=change.themeColor;summary=change.summary;}
    return save(s,before,config,color,source,summary);
   });
  },
  restore(input,body,source='web'){
   const s=scope(input);exact(body,['expectedRevision','revision']);expected(body.expectedRevision);if(body.revision!==undefined)expected(body.revision);
   return transaction(db,()=>{const before=read(s);assertRevision(before,body.expectedRevision);const revision=body.revision??before.history.find(h=>h.revision<before.revision)?.revision;
    if(revision===undefined)throw fail(409,'还没有可恢复的布局版本','layout_history_unavailable');
    const row=db.prepare('SELECT config,theme_color FROM dashboard_layout_versions WHERE owner=? AND workbench=? AND page=? AND revision=?').get(...argsFor(s),revision);
    if(!row)throw fail(404,'布局版本不存在或已超过保留范围','layout_history_unavailable');
    return save(s,before,validateLayoutConfig(JSON.parse(row.config)),row.theme_color,source,['恢复布局版本 '+revision]);
   });
  },
  // Existing theme picker remains a versioned writer; its atomic merge reads the latest config.
  updateTheme(input,color){const s=scope(input);return transaction(db,()=>{const before=read(s);const change=applyLayoutChanges(before.config,before.themeColor,{themeColor:color});if(change.themeColor===before.themeColor)return before;return save(s,before,change.config,change.themeColor,'theme',change.summary);});}
 };
}
