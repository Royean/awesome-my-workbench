import {DatabaseSync, backup} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const source = path.resolve(process.env.HEALTH_DATA_DIR || 'data');
const destination = path.resolve(process.env.WORKBENCH_BACKUP_DIR || 'backups');
if(destination === source || destination.startsWith(source + path.sep)) throw Error('Backup destination must be outside the data directory');
const keep = Number(process.env.WORKBENCH_BACKUP_KEEP || 7);
if(!Number.isInteger(keep) || keep < 1 || keep > 31) throw Error('Backup retention must be 1–31 snapshots');
fs.mkdirSync(destination, {recursive:true, mode:0o700});
const name = new Date().toISOString().replaceAll(':','-') + '-' + randomUUID().slice(0,8);
const staged = path.join(destination, '.pending-' + name);
fs.mkdirSync(staged, {mode:0o700});
try {
  const db = new DatabaseSync(path.join(source, 'health.sqlite'), {readOnly:true});
  try { await backup(db, path.join(staged, 'health.sqlite')); } finally { db.close(); }
  // Uploads are immutable. Copy after the DB snapshot so every committed reference exists.
  if(fs.existsSync(path.join(source,'uploads'))) fs.cpSync(path.join(source,'uploads'),path.join(staged,'uploads'),{recursive:true});
  fs.writeFileSync(path.join(staged,'manifest.json'), JSON.stringify({format:1,createdAt:new Date().toISOString(),database:'health.sqlite',attachments:'uploads',retention:keep})+'\n',{mode:0o600});
  const verify = new DatabaseSync(path.join(staged,'health.sqlite'),{readOnly:true});
  try { if(verify.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('Backup integrity verification failed'); } finally {verify.close();}
  fs.renameSync(staged,path.join(destination,name));
  const snapshots = fs.readdirSync(destination).filter(n=>/^\d{4}-\d{2}-\d{2}T/.test(n)&&fs.statSync(path.join(destination,n)).isDirectory()).sort().reverse();
  for(const old of snapshots.slice(keep)) fs.rmSync(path.join(destination,old),{recursive:true});
  console.log('Backup completed and verified:',name);
} catch(error) {fs.rmSync(staged,{recursive:true,force:true});throw error;}
