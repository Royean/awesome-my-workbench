#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import { migrateAccounts, hashPassword, normalizeEmail, ensureWorkbenches, transaction, digest } from '../lib/accounts.mjs';
const args=process.argv.slice(2),command=args.shift();
const option=name=>{const i=args.indexOf(`--${name}`);return i>=0?args[i+1]:undefined;};
try{
 if(!['create-admin','create-admin-invitation','reset-password'].includes(command))throw new Error('Usage: account-admin.mjs create-admin|create-admin-invitation|reset-password --email EMAIL [--name NAME]; provide password on stdin');
 const email=normalizeEmail(option('email'));
 let hash=null;
 if(command!=='create-admin-invitation'){
  if(process.stdin.isTTY)throw new Error('Provide password on stdin using a hidden shell prompt or password manager');
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>4096)throw new Error('Password input too long');}
  const password=input.replace(/\r?\n$/,'');if(/[\r\n]/.test(password))throw new Error('Provide one password line');
  hash=await hashPassword(password);
 }
 const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));const dir=process.env.HEALTH_DATA_DIR||path.join(root,'data');fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);
 const db=new DatabaseSync(path.join(dir,'health.sqlite'));fs.chmodSync(path.join(dir,'health.sqlite'),0o600);migrateAccounts(db);
 const result=transaction(db,()=>{
  const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);let id;
  if(command.startsWith('create-admin')){if(u)throw new Error('Account already exists');if(db.prepare("SELECT id FROM users WHERE role='admin'").get())throw new Error('An administrator already exists');id=randomUUID();db.prepare('INSERT INTO users VALUES(?,?,?,?,?,0,?)').run(id,email,String(option('name')||email).slice(0,80),'admin',hash,Date.now());ensureWorkbenches(db,id);}
  else {if(!u)throw new Error('Account does not exist');id=u.id;db.prepare('UPDATE users SET password_hash=?,disabled=0 WHERE id=?').run(hash,id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.prepare('UPDATE invitations SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').run(Date.now(),id);}
  db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(randomUUID(),id,`cli.${command}`,id,Date.now());
  if(command==='create-admin-invitation'){const token=randomBytes(32).toString('base64url'),now=Date.now(),expiresAt=now+86400000;db.prepare('INSERT INTO invitations VALUES(?,?,?,?,?,NULL)').run(randomUUID(),id,digest(token),now,expiresAt);return {token,expiresAt};}
 });db.close();process.stdout.write(result?JSON.stringify(result)+'\n':'Account operation completed.\n');
}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
