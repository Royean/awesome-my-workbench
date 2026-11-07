// Export only explicitly reviewed logo associations from the public reference catalog.
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function exportHospitalLogoMap(catalog,publicDir){
 catalog=path.resolve(catalog);publicDir=path.resolve(publicDir);
 const db=new DatabaseSync(catalog,{readOnly:true});
 try{
  const rows=db.prepare("SELECT * FROM hospitals WHERE logo_verified=1 AND logo_review_status='approved' ORDER BY hospital_id").all();
  const mappings=[],assets=[];const ids=new Set();
  for(const row of rows){
   const details=JSON.parse(row.details_json),config=details.logoMapping||{};
   const id=config.publicId||row.hospital_id;
   if(!/^[a-z0-9-]+$/.test(id)||ids.has(id))throw Error('Invalid or duplicate directory ID: '+id);
   ids.add(id);
   const rawAliases=JSON.parse(row.aliases_json);
   if(!Array.isArray(rawAliases)||(config.aliases!==undefined&&!Array.isArray(config.aliases)))throw Error('Invalid aliases: '+id);
   const name=config.name??row.name;if(typeof name!=='string'||!name.trim())throw Error('Invalid name: '+id);
   const inheritedAliases=[...new Set([...rawAliases,...(config.aliases||[]),...(name!==row.name?[row.name]:[])])];
   if(inheritedAliases.some(a=>typeof a!=='string'))throw Error('Invalid aliases: '+id);
   const excludedAliases=config.excludedAliases??[];
   if(!Array.isArray(excludedAliases)||excludedAliases.some(a=>typeof a!=='string'||!a.trim()))throw Error('Invalid reviewed alias exclusions: '+id);
   const excluded=new Set(excludedAliases.map(a=>a.trim()));
   const aliases=inheritedAliases.filter(a=>!excluded.has(a.trim()));
   if(config.city!==undefined&&typeof config.city!=='string')throw Error('Invalid reviewed city: '+id);
   if(config.scope!==undefined&&!['brand','institution'].includes(config.scope))throw Error('Invalid mapping scope: '+id);
   if(config.brandId!==undefined&&(typeof config.brandId!=='string'||!config.brandId||config.scope==='brand'))throw Error('Invalid branch brand ID: '+id);
   const city=(config.city||'').trim();
   const cities=config.cities||[];
   if(config.scope==='brand'){
    if(city||!Array.isArray(cities)||!cities.length||cities.some(c=>typeof c!=='string'||!c.trim()))throw Error('Brand needs reviewed cities and no prefilled city: '+id);
   }else if(!city)throw Error('Institution needs an explicitly reviewed city: '+id);
   const candidates=JSON.parse(row.logo_candidates_json);
   const candidate=candidates.find(c=>c.review_status==='approved'&&c.original===row.logo_candidate_path);
   if(!candidate||!row.logo_source_page||!config.reviewedAt)throw Error('Missing approved candidate/source/review date: '+id);
   for(const url of [row.logo_source_page,row.logo_source_url,...(config.website?[config.website]:[])])if(!/^https?:$/.test(new URL(url).protocol))throw Error('Invalid source URL: '+id);
   const original=path.resolve(path.dirname(catalog),row.logo_candidate_path);
   const bytes=fs.readFileSync(original),sha=createHash('sha256').update(bytes).digest('hex');
   if(sha!==candidate.sha256)throw Error('Logo hash mismatch: '+id);
   let extension=null;
   if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))extension='png';
   else if(bytes[0]===255&&bytes[1]===216)extension='jpg';
   else if(bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length)extension='webp';
   if(!extension)throw Error('Only reviewed PNG/JPEG/WebP assets are exported: '+id);
   const filename='hospital-'+sha+'.'+extension;
   assets.push({filename,bytes});
   mappings.push({id,catalogHospitalId:row.hospital_id,name,aliases,kind:'hospital',city,
    ...(config.scope==='brand'?{scope:'brand',cities}:{}),...(config.brandId?{brandId:config.brandId}:{}),province:row.province,
    logo:'/provider-logos/'+filename,website:config.website||row.logo_source_page,
    sourceUrl:row.logo_source_page,logoSourceUrl:row.logo_source_url,verifiedAt:config.reviewedAt});
  }
  const brands=new Map(mappings.filter(m=>m.scope==='brand').map(m=>[m.id,m]));
  for(const mapping of mappings){
   if(mapping.brandId&&!brands.get(mapping.brandId)?.cities.includes(mapping.city))throw Error('Branch needs a reviewed brand in its city: '+mapping.id);
  }
  // Validate the whole set before writing; pending candidates and private records never enter this file.
  fs.mkdirSync(path.join(publicDir,'provider-logos'),{recursive:true});
  for(const asset of assets)fs.writeFileSync(path.join(publicDir,'provider-logos',asset.filename),asset.bytes);
  const file=path.join(publicDir,'hospital-logo-map.js'),temp=file+'.tmp';
  fs.writeFileSync(temp,'// Generated from the reviewed hospital catalog. Run scripts/export-hospital-logo-map.mjs.\nexport const hospitalLogoMappings = '+JSON.stringify(mappings,null,2)+';\n');
  fs.renameSync(temp,file);
  return {mappings:mappings.length,assets:new Set(assets.map(a=>a.filename)).size,output:file};
 }finally{db.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const repo=path.resolve(import.meta.dirname,'..');
 const args=process.argv.slice(2);if(args.length>2)throw Error('Usage: node scripts/export-hospital-logo-map.mjs [catalog.sqlite] [publicDir]');
 console.log(JSON.stringify(exportHospitalLogoMap(args[0]||path.join(repo,'data/reference-cache/hospital-catalog/hospitals.sqlite'),args[1]||path.join(repo,'public'))));
}
