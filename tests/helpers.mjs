// Shared, state-free helpers for isolated server processes in tests.
import {spawn} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
export const repoRoot=path.resolve(import.meta.dirname,'..');
// Reserve a free port (only for servers whose APP_ORIGIN must be known before start).
export async function freePort(){const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r)});const {port}=s.address();await new Promise(r=>s.close(r));return port;}
// Starts server.mjs and resolves once it reports its actual listening port (PORT=0 by default).
// Readiness is the observable "listening" log line, not a sleep; fails fast if the process exits.
export function startServer({env={},cwd=repoRoot,script='server.mjs',timeoutMs=20000}={}){
 const proc=spawn(process.execPath,[script],{cwd,env:{...process.env,PORT:'0',...env},stdio:['ignore','pipe','pipe']});
 let out='',err='';
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{proc.kill();reject(Error(`server did not report listening within ${timeoutMs}ms\n${out}\n${err}`))},timeoutMs);
  const onExit=code=>{clearTimeout(timer);reject(Error(`server exited (${code}) before listening\n${err}`))};
  proc.once('exit',onExit);
  proc.stderr.on('data',x=>{err+=x});
  proc.on('exit',(code,signal)=>{if(signal!=='SIGTERM'&&code!==0)console.error(`[test server exited unexpectedly code=${code} signal=${signal}]\n${err}`)});
  proc.stdout.on('data',x=>{out+=x;const m=/localhost:(\d+)/.exec(out);if(m){clearTimeout(timer);proc.off('exit',onExit);proc.stdout.resume();const port=Number(m[1]);resolve({proc,port,base:`http://127.0.0.1:${port}`,stderr:()=>err,stop:()=>stopProcess(proc)});}});
 });
}
export async function stopProcess(proc){if(!proc||proc.exitCode!==null||proc.signalCode!==null)return;const exited=new Promise(r=>proc.once('exit',r));proc.kill();await exited;}
// Poll an observable condition instead of sleeping for a fixed time.
export async function waitFor(check,{timeoutMs=5000,intervalMs=5,message='condition not met'}={}){const end=Date.now()+timeoutMs;for(;;){const v=await check();if(v)return v;if(Date.now()>end)throw Error(message);await new Promise(r=>setTimeout(r,intervalMs));}}
