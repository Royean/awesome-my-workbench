// Preserve poem boundaries only for the explicitly supported collection export format.
export function readerTextPages(source,name=''){
 const text=String(source).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 const blocks=text.trim().split(/\n[ \t]*\n[ \t]*\n+/);
 const header=blocks[0]||'';
 const poetry=/^(唐诗三百首|宋词三百首)\n来源：https?:\/\/[^\n]+\n仅含原文，无现代译注。$/.test(header);
 if(poetry&&blocks.length>1){const poems=blocks.slice(1).map(block=>{const lines=block.split('\n');return {title:lines[0],author:lines[1],text:block};});if(poems.every(p=>p.title&&p.author&&p.text.split('\n').length>=3))return {poetry:true,pages:poems};}
 const pages=[];for(let i=0;i<text.length;i+=4000)pages.push({title:`第 ${pages.length+1} 页`,author:'',text:text.slice(i,i+4000)});return {poetry:false,pages:pages.length?pages:[{title:'第 1 页',author:'',text:''}]};
}
export function highlightSegments(text,annotations=[],page=1){
 const ranges=annotations.filter(a=>['highlight','note'].includes(a.annotationType)&&a.page===page&&Number.isInteger(a.startOffset)&&Number.isInteger(a.endOffset)&&a.startOffset>=0&&a.endOffset>a.startOffset&&a.endOffset<=text.length&&text.slice(a.startOffset,a.endOffset)===a.quote).map(a=>({start:a.startOffset,end:a.endOffset})).sort((a,b)=>a.start-b.start||a.end-b.end);
 const merged=[];for(const r of ranges){const last=merged.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else merged.push({...r});}
 const segments=[];let offset=0;for(const range of merged){if(range.start>offset)segments.push({text:text.slice(offset,range.start),highlight:false});segments.push({text:text.slice(range.start,range.end),highlight:true});offset=range.end;}if(offset<text.length)segments.push({text:text.slice(offset),highlight:false});return segments;
}
