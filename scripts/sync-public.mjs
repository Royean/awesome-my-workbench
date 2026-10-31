import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const source=path.resolve(root,'../health-workbench/public');
const target=path.join(root,'public');
fs.mkdirSync(target,{recursive:true});
const replacements=[['本地运行 · 数据保存在此电脑','已登录 · 数据按账号隔离'],['数据仅保存在运行服务的这台电脑。示例空间和个人空间分别保存。','数据保存在私有云端，需登录访问并按用户身份隔离。示例空间和个人空间分别保存。'],['本地健康记录','私有健康记录'],['本地记录摘要','记录摘要'],['本地摘要','记录摘要'],['仅保存到本机','仅保存到当前用户的私有云空间'],['仅存储在本机','仅存储在当前用户的私有云空间'],['存到本机','存到私有云端'],['保留在本机','保留在私有云端'],['本地统计摘要','记录统计摘要'],['本机资料与设置','云端资料与设置'],['本机收件箱','资料收件箱'],['本地个人空间','私有个人空间'],['保存在本机','保存在私有云端'],['保存在本地','保存在私有云端'],['仅存本机','私有云存储'],['仅保存在本机','仅在当前登录用户的私有云空间保存'],['本机 SQLite','云端 D1'],['本地 SQLite','云端 D1'],['本机存储','私有云存储'],['本地存储','私有云存储'],['仅本机访问','需登录访问'],['本机文件','云端文件'],['本地文件','所选文件']];
for(const entry of fs.readdirSync(source,{withFileTypes:true})){if(!entry.isFile()||entry.name==='index.html')continue;const from=path.join(source,entry.name),to=path.join(target,entry.name);if(/\.(js|css|svg|html)$/.test(entry.name)){let text=fs.readFileSync(from,'utf8');for(const [a,b] of replacements)text=text.replaceAll(a,b);fs.writeFileSync(to,text)}else fs.copyFileSync(from,to)}
console.log('Synced public assets without local index or runtime data');
