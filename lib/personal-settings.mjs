// One preferences record per account; legacy scope records remain intact for rollback.
export function createPersonalSettings(db,bad){
 db.exec('CREATE TABLE IF NOT EXISTS personal_settings(owner TEXT PRIMARY KEY, body TEXT NOT NULL)');
 function context(space){
  const scope=db.prepare('SELECT user_id FROM data_scopes WHERE space=?').get(space);
  if(scope)return {owner:scope.user_id,user:db.prepare('SELECT id,name FROM users WHERE id=?').get(scope.user_id),legacy:`account:${scope.user_id}:health:personal`};
  if(String(space).startsWith('account:'))throw bad('账号空间不存在');
  return {owner:'local',user:null,legacy:'personal'};
 }
 function read(space){
  const c=context(space);let row=db.prepare('SELECT body FROM personal_settings WHERE owner=?').get(c.owner);
  if(!row){
   const old=JSON.parse(db.prepare('SELECT body FROM settings WHERE space=?').get(c.legacy)?.body||'{}');
   const initial={name:c.user?.name||old.name||'Captain',focus:old.focus??'建立可持续的健康习惯',...(old.waterGoalMl?{waterGoalMl:old.waterGoalMl}:{})};
   db.prepare('INSERT INTO personal_settings VALUES(?,?)').run(c.owner,JSON.stringify(initial));row={body:JSON.stringify(initial)};
  }
  return {...JSON.parse(row.body),...(c.user?{name:c.user.name}:{})};
 }
 function write(space,b){
  const clean={...read(space)};
  if(b.name!==undefined){if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>80)throw bad('昵称需为 1–80 个字符','name');clean.name=b.name.trim();}
  if(b.focus!==undefined)clean.focus=String(b.focus||'').slice(0,180);
  if(b.waterGoalMl!==undefined&&b.waterGoalMl!==''){const v=Number(b.waterGoalMl);if(!Number.isInteger(v)||v<100||v>10000)throw bad('每日饮水目标需在 100–10000 毫升之间','waterGoalMl');clean.waterGoalMl=v;}
  const c=context(space);db.exec('BEGIN IMMEDIATE');try{
   db.prepare('INSERT OR REPLACE INTO personal_settings VALUES(?,?)').run(c.owner,JSON.stringify(clean));
   if(c.user&&b.name!==undefined)db.prepare('UPDATE users SET name=? WHERE id=?').run(clean.name,c.user.id);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return clean;
 }
 return {read,write};
}
